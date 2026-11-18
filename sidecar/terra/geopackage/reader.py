"""
The layers of a GeoPackage, written as GeoJSON in longitude and latitude.

Three tables of the standard are read (OGC 12-128r18, GeoPackage 1.3.1):

- `gpkg_contents` (clause 1.1.3) lists every table the file holds and, in
  `data_type`, what it holds: `features`, `tiles`, `attributes` and others;
- `gpkg_geometry_columns` (clause 2.1.5) names the geometry column of each
  feature table, the geometry type it declares and its coordinate system;
- `gpkg_spatial_ref_sys` (clause 1.1.2) describes each coordinate system by
  authority and code, and as WKT.

A geometry is a GeoPackageBinary blob (clause 2.1.3.1.1): the bytes `GP`, a
version, a flags byte, the srs_id, an optional envelope, then the geometry as
OGC well-known binary. The header is read here and the WKB goes to shapely.
That clause fixes the axis order of the WKB as (x, y), x the easting or the
longitude, whatever order the coordinate system declares, which is why the
transformer is built with always_xy.

Requirement 11 reserves two coordinate systems: srs_id -1 for an undefined
Cartesian one and 0 for an undefined geographic one. The first cannot be put on
the globe and is refused. The second is degrees on an unnamed datum, read as
WGS 84 and said so in the layer's description.

EVERY LAYER IS WRITTEN WHOLE, as RFC 7946 GeoJSON, one file per layer, for the
map to draw: points, lines and polygons alike, each feature with its row's
attributes as properties and its key as `id`. The map fetches the files by URL
(app_geopackage.go), because a bound method would hand tens of megabytes to the
page as one string.
"""

from __future__ import annotations

import json
import math
import sqlite3
import struct
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError
from shapely.geometry.base import BaseGeometry

from terra.protocol import Unavailable, emit_progress

# Rows drawn per layer. A state's rural register holds hundreds of thousands of
# properties; past this the map would spend seconds on a layer nobody reads at
# that density, so it is drawn in part and the listing says how much.
MAX_FEATURES = 250_000
# Attribute text is cut at this many characters; a note longer than this is a
# document, not an attribute to read on a map.
MAX_TEXT = 2000
# Decimal places kept of a coordinate in degrees, about 1 cm of ground, which
# is finer than any vector a map draws and keeps the files a third smaller.
PRECISION = 7

# Bytes of envelope for each value of the flags' envelope indicator (Table 5).
ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
# How a layer is drawn, from the geometry type gpkg_geometry_columns declares.
# GEOMETRY and GEOMETRYCOLLECTION may hold any of the three.
KINDS = {
    'POINT': 'point', 'MULTIPOINT': 'point',
    'LINESTRING': 'line', 'MULTILINESTRING': 'line', 'CIRCULARSTRING': 'line',
    'COMPOUNDCURVE': 'line', 'CURVE': 'line', 'MULTICURVE': 'line',
    'POLYGON': 'polygon', 'MULTIPOLYGON': 'polygon', 'CURVEPOLYGON': 'polygon',
    'SURFACE': 'polygon', 'MULTISURFACE': 'polygon',
    'GEOMETRY': 'mixed', 'GEOMETRYCOLLECTION': 'mixed',
}


class GeoPackageError(Unavailable):
    """The file or a layer cannot be read, for the reason given."""


def quote(name: str) -> str:
    """An SQL identifier, quoted, so a table called `order` or `talhões 2024` reads."""
    return '"' + name.replace('"', '""') + '"'


def connect(path: str) -> sqlite3.Connection:
    """
    The file opened read-only, once it is known to be a GeoPackage.

    Read-only through the URI so that opening a file never writes to it, not
    even the journal SQLite would otherwise create beside it.
    """
    p = Path(path)
    if not p.is_file():
        raise GeoPackageError(f'{p.name} is no longer at {p.parent}.')
    try:
        con = sqlite3.connect(p.resolve().as_uri() + '?mode=ro', uri=True)
        tables = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}
    except sqlite3.DatabaseError as e:
        raise GeoPackageError(f'{p.name} is not a GeoPackage: {e}.') from e
    if 'gpkg_contents' not in tables:
        con.close()
        raise GeoPackageError(
            f'{p.name} is an SQLite database but not a GeoPackage: it has no '
            f'gpkg_contents table.')
    return con


def _has_table(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (name,)).fetchone()
    return row is not None


def layer_crs(con: sqlite3.Connection, srs_id: int) -> tuple[CRS, str]:
    """
    The coordinate system of srs_id, and how to name it to the reader.

    By authority and code where the file gives them, which is how almost every
    file names EPSG systems, and from the WKT definition otherwise.
    """
    if srs_id == -1:
        raise GeoPackageError(
            'the layer has no coordinate system (srs_id -1, undefined Cartesian), '
            'so its coordinates cannot be placed on the globe')
    if srs_id == 0:
        return CRS.from_epsg(4326), 'undefined geographic, read as WGS 84'
    row = con.execute(
        'SELECT srs_name, organization, organization_coordsys_id, definition '
        'FROM gpkg_spatial_ref_sys WHERE srs_id = ?', (srs_id,)).fetchone()
    if row is None:
        raise GeoPackageError(
            f'the layer names coordinate system {srs_id}, which the file does not describe')
    srs_name, organization, code, definition = row
    crs: CRS | None = None
    errors: list[str] = []
    if organization and str(organization).upper() != 'NONE' and code is not None:
        try:
            crs = CRS.from_authority(str(organization).upper(), str(code))
        except CRSError as e:
            errors.append(str(e))
    if crs is None and definition and str(definition).strip().lower() != 'undefined':
        try:
            crs = CRS.from_wkt(str(definition))
        except CRSError as e:
            errors.append(str(e))
    if crs is None:
        detail = f': {errors[-1]}' if errors else ''
        raise GeoPackageError(
            f'the coordinate system of the layer ({srs_name or srs_id}) could '
            f'not be read{detail}')
    authority = crs.to_authority()
    label = crs.name if authority is None else f'{crs.name} ({authority[0]}:{authority[1]})'
    return crs, label


def wkb_type(blob: bytes) -> int | None:
    """
    The base WKB geometry type of a GeoPackageBinary blob, 0 when it is empty,
    None when the blob is not one.

    The type is read modulo 1000, which removes the Z and M variants of the ISO
    numbering, and with the high flag bits of the PostGIS variant masked.
    """
    if len(blob) < 8 or blob[:2] != b'GP':
        return None
    flags = blob[3]
    if flags & 0b0010_0000:
        return None
    if flags & 0b0001_0000:
        return 0
    envelope = ENVELOPE_BYTES.get((flags >> 1) & 0b111)
    if envelope is None:
        return None
    start = 8 + envelope
    if len(blob) < start + 5:
        return None
    order = '<' if blob[start] == 1 else '>'
    (code,) = struct.unpack(order + 'I', blob[start + 1:start + 5])
    return (code & 0x0FFF_FFFF) % 1000


def decode(blob: bytes) -> BaseGeometry:
    """A whole GeoPackageBinary blob as a shapely geometry."""
    if len(blob) < 8 or blob[:2] != b'GP':
        raise GeoPackageError('the geometry is not in the GeoPackage binary format')
    flags = blob[3]
    if flags & 0b0010_0000:
        raise GeoPackageError(
            'the geometry uses an extension of the GeoPackage format that TERRA does not read')
    envelope = ENVELOPE_BYTES.get((flags >> 1) & 0b111)
    if envelope is None:
        raise GeoPackageError('the geometry header is damaged')
    try:
        geom: BaseGeometry = shapely.from_wkb(blob[8 + envelope:])
    except shapely.errors.GEOSException as e:
        raise GeoPackageError(f'the geometry could not be read: {e}') from e
    return geom


def _value(v: Any) -> str | int | float | None:
    """An attribute as a GeoJSON property: text cut short, no blobs, no NaN."""
    if isinstance(v, str):
        return v if len(v) <= MAX_TEXT else v[:MAX_TEXT] + '…'
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    return None


class FeatureTable:
    """One feature table: its columns, its geometry column and its key."""

    def __init__(self, con: sqlite3.Connection, name: str) -> None:
        row = None
        if _has_table(con, 'gpkg_geometry_columns'):
            row = con.execute(
                'SELECT column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns '
                'WHERE table_name = ?', (name,)).fetchone()
        if row is None:
            raise GeoPackageError(f'{name} has no geometry column registered')
        self.name = name
        self.geometry_column = str(row[0])
        self.geometry_type = str(row[1]).upper()
        self.srs_id = int(row[2])
        columns = con.execute(f'PRAGMA table_info({quote(name)})').fetchall()
        # Requirement 29: an INTEGER primary key that is the rowid. rowid is
        # the same value where a file breaks the rule by leaving it out.
        key = next((c[1] for c in columns if c[5] == 1 and 'INT' in str(c[2]).upper()), None)
        self.key = quote(str(key)) if key else 'rowid'
        self.attributes = [str(c[1]) for c in columns
                           if c[1] != self.geometry_column and c[1] != key]


def _to_lonlat(crs: CRS) -> Transformer | None:
    """The transformer from crs to longitude and latitude, or None when it is already."""
    if crs.equals(CRS.from_epsg(4326), ignore_axis_order=True):
        return None
    return Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)


def _lonlat(geoms: np.ndarray, transformer: Transformer | None) -> np.ndarray:
    """Every geometry in longitude and latitude, in two dimensions, at PRECISION."""
    def apply(xy: np.ndarray) -> np.ndarray:
        if transformer is not None:
            lon, lat = transformer.transform(xy[:, 0], xy[:, 1])
            xy = np.column_stack([lon, lat])
        return np.round(xy, PRECISION)

    flat: np.ndarray = shapely.force_2d(geoms)
    out: np.ndarray = shapely.transform(flat, apply)
    return out


def _layer(con: sqlite3.Connection, name: str, title: str, out: Path, n: int) -> dict[str, Any]:
    """
    One feature layer written to `out/<n>.geojson`, and what the listing says of it.

    A layer that cannot be drawn is described with the reason and no file.
    """
    layer: dict[str, Any] = {
        'name': name, 'title': title, 'data_type': 'features', 'geometry_type': '',
        'kind': '', 'crs': '', 'count': 0, 'drawn': 0, 'unreadable': 0,
        'bounds': None, 'columns': [], 'file': '', 'reason': '',
    }
    try:
        t = FeatureTable(con, name)
        layer['geometry_type'] = t.geometry_type
        layer['kind'] = KINDS.get(t.geometry_type, 'mixed')
        layer['columns'] = t.attributes
        layer['count'] = int(con.execute(f'SELECT COUNT(*) FROM {quote(name)}').fetchone()[0])
        crs, layer['crs'] = layer_crs(con, t.srs_id)
        attrs = ''.join(f', {quote(a)}' for a in t.attributes)
        rows = con.execute(
            f'SELECT {t.key}, {quote(t.geometry_column)}{attrs} FROM {quote(name)} '
            f'ORDER BY {t.key} LIMIT {MAX_FEATURES}').fetchall()
    except (GeoPackageError, sqlite3.DatabaseError) as e:
        layer['reason'] = str(e)
        return layer

    fids: list[int] = []
    geoms: list[BaseGeometry] = []
    props: list[dict[str, Any]] = []
    for r in rows:
        blob = r[1]
        if blob is None or wkb_type(bytes(blob)) == 0:
            continue
        try:
            geom = decode(bytes(blob))
        except GeoPackageError:
            layer['unreadable'] += 1
            continue
        if geom.is_empty:
            continue
        fids.append(int(r[0]))
        geoms.append(geom)
        props.append({c: _value(v) for c, v in zip(t.attributes, r[2:], strict=True)})

    placed = _lonlat(np.array(geoms, dtype=object), _to_lonlat(crs)) if geoms else np.array([])
    if len(placed):
        west, south, east, north = (float(v) for v in shapely.total_bounds(placed))
        if not all(math.isfinite(v) for v in (west, south, east, north)):
            layer['reason'] = 'its coordinates fall outside the coordinate system of the layer'
            return layer
        if west < -180 or east > 180 or south < -90 or north > 90:
            layer['reason'] = ('its coordinates are not longitudes and latitudes once '
                               'converted; the coordinate system of the layer may be wrong')
            return layer
        layer['bounds'] = [west, south, east, north]

    # ASSEMBLED AS TEXT, the geometries by GEOS. json.dump writes a large value
    # in pure Python, piece by piece: on 212 polygons of 20,000 vertices it took
    # most of a 13.6 s open, where shapely.to_geojson writes the same
    # coordinates in C in 1.3 s. Only the properties, which are small, go
    # through json.
    geojson = shapely.to_geojson(placed) if len(placed) else []
    features = [
        f'{{"type":"Feature","id":{fid},"geometry":{g},"properties":'
        f'{json.dumps(p, allow_nan=False, ensure_ascii=False, separators=(",", ":"))}}}'
        for fid, g, p in zip(fids, geojson, props, strict=True)
    ]
    file = f'{n}.geojson'
    with (out / file).open('w', encoding='utf-8') as f:
        f.write('{"type":"FeatureCollection","features":[')
        f.write(','.join(features))
        f.write(']}')
    layer['file'] = file
    layer['drawn'] = len(features)
    return layer


def open_layers(path: str, out_dir: str) -> list[dict[str, Any]]:
    """
    Every layer of the file that can be shown on a map, in the file's order,
    each feature layer written as GeoJSON into out_dir.

    A layer that cannot be drawn is listed with the reason rather than left out,
    so a file of raster tiles is answered with what it holds instead of with an
    empty list. Attribute tables, which have no geometry at all, are left out.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    con = connect(path)
    try:
        contents = con.execute(
            "SELECT table_name, data_type, COALESCE(identifier, '') FROM gpkg_contents "
            "WHERE data_type != 'attributes' ORDER BY rowid").fetchall()
        layers: list[dict[str, Any]] = []
        for n, (name, data_type, title) in enumerate(contents):
            # One line per layer, so a file that takes a minute says where it is.
            emit_progress(round(100 * n / max(len(contents), 1)),
                          f'Reading {title or name} ({n + 1} of {len(contents)})')
            if data_type == 'features':
                layers.append(_layer(con, str(name), str(title), out, n))
                continue
            layers.append({
                'name': str(name), 'title': str(title), 'data_type': str(data_type),
                'geometry_type': '', 'kind': '', 'crs': '', 'count': 0, 'drawn': 0,
                'unreadable': 0, 'bounds': None, 'columns': [], 'file': '',
                'reason': 'it is a raster layer, which TERRA does not draw from a GeoPackage',
            })
        return layers
    finally:
        con.close()
