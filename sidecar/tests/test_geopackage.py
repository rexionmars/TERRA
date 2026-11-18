"""
Opening GeoPackage files on the map.

Each file is written here with sqlite3, in the layout of the standard (OGC
12-128r18, GeoPackage 1.3.1): the three gpkg_ tables, a feature table with an
INTEGER primary key, and geometries as GeoPackageBinary blobs over ISO WKB.
"""

from __future__ import annotations

import io
import json
import sqlite3
import struct
from pathlib import Path

import pytest
import shapely
from pyproj import CRS, Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box

from terra.geopackage import actions, reader
from terra.geopackage.reader import GeoPackageError, open_layers

# A field near Cascavel, Paraná, in SIRGAS 2000 / UTM zone 22S: 1000 m by 500 m.
UTM = 31982
FIELD_UTM = box(250_000, 7_240_000, 251_000, 7_240_500)


def gpb(geom, srs_id: int, envelope: int = 1, big_endian: bool = False) -> bytes:
    """A GeoPackageBinary blob (clause 2.1.3.1.1) around the ISO WKB of geom."""
    order = '>' if big_endian else '<'
    empty = geom.is_empty
    if empty:
        envelope = 0
    flags = (0b1_0000 if empty else 0) | (envelope << 1) | (0 if big_endian else 1)
    head = b'GP' + bytes([0, flags]) + struct.pack(order + 'i', srs_id)
    if envelope == 1:
        minx, miny, maxx, maxy = geom.bounds
        head += struct.pack(order + '4d', minx, maxx, miny, maxy)
    elif envelope == 2:
        minx, miny, maxx, maxy = geom.bounds
        head += struct.pack(order + '6d', minx, maxx, miny, maxy, 0.0, 0.0)
    wkb = shapely.to_wkb(geom, byte_order=0 if big_endian else 1, flavor='iso',
                         output_dimension=3)
    return head + wkb


def new_gpkg(path: Path) -> sqlite3.Connection:
    """An empty GeoPackage with the coordinate systems Requirement 11 asks for, and UTM 22S."""
    con = sqlite3.connect(path)
    con.execute('PRAGMA application_id = 1196444487')
    con.execute('PRAGMA user_version = 10301')
    con.executescript("""
        CREATE TABLE gpkg_spatial_ref_sys (
          srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL,
          organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL,
          description TEXT);
        CREATE TABLE gpkg_contents (
          table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
          identifier TEXT UNIQUE, description TEXT DEFAULT '',
          last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
        CREATE TABLE gpkg_geometry_columns (
          table_name TEXT NOT NULL, column_name TEXT NOT NULL,
          geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL,
          z TINYINT NOT NULL, m TINYINT NOT NULL,
          CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
    """)
    con.executemany('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)', [
        ('WGS 84 geodetic', 4326, 'EPSG', 4326, CRS.from_epsg(4326).to_wkt(), None),
        ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', None),
        ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', None),
        ('SIRGAS 2000 / UTM zone 22S', UTM, 'EPSG', UTM, CRS.from_epsg(UTM).to_wkt(), None),
    ])
    return con


def add_layer(con: sqlite3.Connection, name: str, geometry_type: str, srs_id: int,
              rows: list[tuple], columns: str = 'nome TEXT, area REAL',
              title: str | None = None) -> None:
    """A feature table, registered, holding rows of (geometry blob or None, *attributes)."""
    con.execute(f'CREATE TABLE "{name}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, '
                f'geom {geometry_type}, {columns})')
    con.execute("INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) "
                "VALUES (?, 'features', ?, ?)", (name, title or name, srs_id))
    con.execute('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 0, 0)',
                (name, 'geom', geometry_type, srs_id))
    marks = ', '.join('?' * len(rows[0])) if rows else ''
    names = 'geom, ' + ', '.join(c.split()[0] for c in columns.split(', '))
    for r in rows:
        con.execute(f'INSERT INTO "{name}" ({names}) VALUES ({marks})', r)
    con.commit()


@pytest.fixture
def farm(tmp_path: Path) -> Path:
    path = tmp_path / 'fazenda.gpkg'
    con = new_gpkg(path)
    two_parts = MultiPolygon([box(251_500, 7_240_000, 251_600, 7_240_100),
                              box(252_000, 7_240_000, 252_400, 7_240_400)])
    add_layer(con, 'talhões', 'MULTIPOLYGON', UTM, [
        (gpb(FIELD_UTM, UTM), 'talhão 1', 50.0),
        (gpb(two_parts, UTM), 'talhão 2', 17.0),
        (None, 'sem desenho', None),
    ])
    add_layer(con, 'poços', 'POINT', 4326, [(gpb(Point(-53.46, -24.93), 4326), 'poço 1', 2.0)])
    add_layer(con, 'estradas', 'LINESTRING', UTM,
              [(gpb(LineString([(250_000, 7_239_000), (252_000, 7_239_500)]), UTM), 'BR-277', 0.0)])
    con.close()
    return path


def read(out: Path, layer: dict) -> dict:
    return json.loads((out / layer['file']).read_text(encoding='utf-8'))


def test_a_layer_in_utm_is_written_in_longitude_and_latitude(farm: Path, tmp_path: Path) -> None:
    out = tmp_path / 'out'
    layer = open_layers(str(farm), str(out))[0]
    assert layer['name'] == 'talhões'
    assert layer['kind'] == 'polygon'
    assert layer['crs'] == 'SIRGAS 2000 / UTM zone 22S (EPSG:31982)'
    fc = read(out, layer)
    ring = fc['features'][0]['geometry']['coordinates'][0]
    to_lonlat = Transformer.from_crs(UTM, 4326, always_xy=True)
    expected = {(round(x, 7), round(y, 7)) for x, y in
                (to_lonlat.transform(x, y) for x, y in FIELD_UTM.exterior.coords)}
    assert {(x, y) for x, y in ring} == expected
    w, s, e, n = layer['bounds']
    assert -54 < w < e < -53 and -25 < s < n < -24


def test_every_feature_carries_its_key_and_its_attributes(farm: Path, tmp_path: Path) -> None:
    out = tmp_path / 'out'
    layer = open_layers(str(farm), str(out))[0]
    fc = read(out, layer)
    assert [f['id'] for f in fc['features']] == [1, 2]
    assert fc['features'][0]['properties'] == {'nome': 'talhão 1', 'area': 50.0}
    # Both parts of a multipart row are drawn; the map has no one-polygon rule.
    assert fc['features'][1]['geometry']['type'] == 'MultiPolygon'
    assert layer['columns'] == ['nome', 'area']


def test_a_row_with_no_geometry_is_counted_but_not_drawn(farm: Path, tmp_path: Path) -> None:
    layer = open_layers(str(farm), str(tmp_path / 'out'))[0]
    assert (layer['count'], layer['drawn'], layer['unreadable']) == (3, 2, 0)


def test_points_and_lines_are_drawn_as_well_as_polygons(farm: Path, tmp_path: Path) -> None:
    out = tmp_path / 'out'
    layers = {layer['name']: layer for layer in open_layers(str(farm), str(out))}
    assert layers['poços']['kind'] == 'point'
    assert read(out, layers['poços'])['features'][0]['geometry'] == {
        'type': 'Point', 'coordinates': [-53.46, -24.93]}
    assert layers['estradas']['kind'] == 'line'
    line = read(out, layers['estradas'])['features'][0]['geometry']
    assert line['type'] == 'LineString' and -54 < line['coordinates'][0][0] < -53


def test_a_layer_of_any_geometry_keeps_each_kind(tmp_path: Path) -> None:
    path = tmp_path / 'misto.gpkg'
    con = new_gpkg(path)
    add_layer(con, 'misto', 'GEOMETRY', 4326, [
        (gpb(box(-53.4, -24.9, -53.3, -24.8), 4326), 'polígono', 1.0),
        (gpb(Point(-53.4, -24.9), 4326), 'poço', 2.0),
        (gpb(Polygon(), 4326), 'vazio', 3.0),
    ])
    con.close()
    out = tmp_path / 'out'
    [layer] = open_layers(str(path), str(out))
    assert layer['kind'] == 'mixed'
    assert [f['geometry']['type'] for f in read(out, layer)['features']] == ['Polygon', 'Point']


def test_coordinates_in_wgs84_keep_longitude_first(tmp_path: Path) -> None:
    # EPSG:4326 declares latitude first; a GeoPackage stores x first anyway.
    path = tmp_path / 'wgs84.gpkg'
    con = new_gpkg(path)
    add_layer(con, 'area', 'POLYGON', 4326,
              [(gpb(box(-53.4, -24.9, -53.3, -24.8), 4326), 'a', 1.0)])
    con.close()
    [layer] = open_layers(str(path), str(tmp_path / 'out'))
    assert layer['bounds'] == [-53.4, -24.9, -53.3, -24.8]


def test_a_big_endian_header_with_a_z_envelope_is_read_in_two_dimensions(tmp_path: Path) -> None:
    path = tmp_path / 'be.gpkg'
    con = new_gpkg(path)
    poly = shapely.force_3d(box(-53.4, -24.9, -53.3, -24.8), 800.0)
    add_layer(con, 'area', 'POLYGON', 4326,
              [(gpb(poly, 4326, envelope=2, big_endian=True), 'a', 1.0)])
    con.close()
    out = tmp_path / 'out'
    [layer] = open_layers(str(path), str(out))
    ring = read(out, layer)['features'][0]['geometry']['coordinates'][0]
    assert all(len(p) == 2 for p in ring)


def test_layers_that_cannot_be_drawn_are_listed_with_the_reason(tmp_path: Path) -> None:
    path = tmp_path / 'outros.gpkg'
    con = new_gpkg(path)
    add_layer(con, 'sem sistema', 'POLYGON', -1, [(gpb(box(0, 0, 1, 1), -1), 'x', 1.0)])
    con.execute("INSERT INTO gpkg_contents (table_name, data_type, identifier) "
                "VALUES ('ortofoto', 'tiles', 'ortofoto')")
    con.execute("INSERT INTO gpkg_contents (table_name, data_type, identifier) "
                "VALUES ('tabela', 'attributes', 'tabela')")
    con.commit()
    con.close()
    layers = {layer['name']: layer for layer in open_layers(str(path), str(tmp_path / 'out'))}
    assert set(layers) == {'sem sistema', 'ortofoto'}
    assert 'no coordinate system' in layers['sem sistema']['reason']
    assert 'raster' in layers['ortofoto']['reason']
    assert not any(layer['file'] for layer in layers.values())


def test_a_layer_is_drawn_up_to_its_limit_and_still_counts_every_row(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reader, 'MAX_FEATURES', 2)
    path = tmp_path / 'muitos.gpkg'
    con = new_gpkg(path)
    add_layer(con, 'area', 'POINT', 4326,
              [(gpb(Point(-53.4, -24.9 + i / 100), 4326), str(i), 1.0) for i in range(5)])
    con.close()
    [layer] = open_layers(str(path), str(tmp_path / 'out'))
    assert (layer['count'], layer['drawn']) == (5, 2)


def test_a_file_that_is_not_a_geopackage_says_what_it_is(tmp_path: Path) -> None:
    text = tmp_path / 'notas.gpkg'
    text.write_text('not a database')
    with pytest.raises(GeoPackageError, match='is not a GeoPackage'):
        open_layers(str(text), str(tmp_path / 'out'))
    plain = tmp_path / 'outro.gpkg'
    sqlite3.connect(plain).execute('CREATE TABLE t (a)').connection.close()
    with pytest.raises(GeoPackageError, match='no gpkg_contents table'):
        open_layers(str(plain), str(tmp_path / 'out'))
    with pytest.raises(GeoPackageError, match='no longer at'):
        open_layers(str(tmp_path / 'sumiu.gpkg'), str(tmp_path / 'out'))


def test_opening_a_file_leaves_it_as_it_was(farm: Path, tmp_path: Path) -> None:
    before = farm.read_bytes()
    open_layers(str(farm), str(tmp_path / 'out'))
    assert farm.read_bytes() == before
    assert sorted(p.name for p in farm.parent.iterdir()) == ['fazenda.gpkg', 'out']


def test_the_action_writes_one_json_object_and_the_files_in_its_work_dir(
        farm: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    out = io.StringIO()
    monkeypatch.setattr('sys.stdout', out)
    work = tmp_path / 'work'
    work.mkdir()
    actions.open_file({'path': str(farm)}, work)
    layers = json.loads(out.getvalue())['geopackage']['layers']
    assert [layer['file'] for layer in layers] == ['0.geojson', '1.geojson', '2.geojson']
    assert all((work / layer['file']).is_file() for layer in layers)
    with pytest.raises(GeoPackageError):
        actions.open_file({'path': ''}, work)
