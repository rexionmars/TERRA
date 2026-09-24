"""
EMIT L2A surface reflectance over an area, read without downloading a scene.

EMIT (Green et al., 2020; Thompson et al., 2024) is a 285-channel imaging
spectrometer on the International Space Station, 381-2493 nm at about 7.4 nm
sampling and 60 m ground sampling. A L2A reflectance granule is about 1.9 GB
and covers roughly 75 x 75 km; an area drawn in this application is usually a
small fraction of that. The LP DAAC serves every granule through OPeNDAP
(Hyrax), which returns any hyperslab of any variable, so only the rows and
columns under the area are transferred.

A granule is stored in instrument geometry: `reflectance[downtrack, crosstrack,
band]`. Its `location/glt_x` and `location/glt_y` are a geometry lookup table
on a north-up lon/lat grid, holding for each output cell the 1-based crosstrack
and downtrack index of the observation that falls there (0 where none does).
The classifier runs on instrument pixels and its answers are placed on the
output grid through that table afterwards: the reflectance is never resampled.

Search goes to NASA CMR, which needs no credentials. Every OPeNDAP request
needs an Earthdata Login bearer token, read from EARTHDATA_TOKEN. The token is
never written to a progress line or an error message.
"""

from __future__ import annotations

import io
import math
import os
import re
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import numpy as np

from terra import protocol

CMR_GRANULES = 'https://cmr.earthdata.nasa.gov/search/granules.umm_json'
OPENDAP = 'https://opendap.earthdata.nasa.gov/collections/{concept}/granules/{granule}'

LPDAAC_PROTECTED = 'https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected'

RFL_SHORT_NAME = 'EMITL2ARFL'
# The first day of EMIT science operations: the start of the record.
RECORD_START = '2022-08-01'
MASK_SHORT_NAME = 'EMITL2AMASK'
# Products of the same acquisition that the mineral map reads beside the
# reflectance: fractional cover (Cloud Optimized GeoTIFFs on the ortho grid of
# the reflectance's geometry lookup table) and the official Tetracorder
# identification (instrument geometry, as the reflectance). Both exist in
# version 001 only when this was written.
FRCOV_SHORT_NAME = 'EMITL2BFRCOV'
L2B_MIN_SHORT_NAME = 'EMITL2BMIN'
DERIVED_VERSIONS = ('001',)

# Reflectance versions searched, newest first. Version 002 is being produced
# by reprocessing and, over Brazil, held 1,010 granules against 22,328 of
# version 001 when this was written; an acquisition present in both is taken
# from 002. Version 001 ships its mask as a second file of the same granule,
# 002 as a granule of its own collection.
RFL_VERSIONS = ('002', '001')

# The mask band whose value 1 marks an observation the EMIT team excludes from
# downstream products: cloud, dilated cloud, cirrus and spacecraft, combined.
# Named rather than indexed, and looked up in the granule's own band list.
AGGREGATE_MASK_BAND = 'Aggregate Flag'

FILL = -9999.0

TOKEN_ENV = 'EARTHDATA_TOKEN'

RETRY_WAITS = (2, 5, 10)

# Bytes of reflectance asked for per OPeNDAP request: 64 rows of a full
# 1242-column swath at 285 channels of float32. The service answers in about
# 20 s whatever the size below that -- 21 to 24 s for 5 channels and for 285 of
# the same rows, measured 2026-09-24 -- so an area narrower than the swath is
# read in as many rows per request as fit the same budget, not in 64.
BLOCK_BYTES = 64 * 1242 * 285 * 4


class NoToken(protocol.Unavailable):
    """No Earthdata Login token was provided."""


@dataclass(frozen=True)
class Granule:
    ur: str                     # EMIT_L2A_RFL_002_20260919T145435, or
                                # EMIT_L2A_RFL_001_20240830T135446_2424309_051
    concept: str                # collection concept id, for the OPeNDAP path
    start: str                  # ISO 8601
    cloud_cover: float | None
    footprint: Any              # shapely geometry, lon/lat
    version: str = ''
    # Direct HTTPS location of the granule's file, for reads OPeNDAP does not
    # serve (the version 001 mask, which is a second file of its granule).
    data_url: str = ''

    @property
    def acquisition(self) -> str:
        """The start timestamp every product of one acquisition shares."""
        m = re.search(r'\d{8}T\d{6}', self.ur)
        return m[0] if m else self.ur


# HTTP -------------------------------------------------------------------------


def _token() -> str:
    token = os.environ.get(TOKEN_ENV, '').strip()
    if not token:
        raise NoToken(
            'EMIT data needs a NASA Earthdata Login token. Create one at '
            'https://urs.earthdata.nasa.gov/profile (Generate Token) and set it '
            'in Settings > Data access, or export EARTHDATA_TOKEN.'
        )
    return token


def _get(url: str, *, auth: bool, params: dict | None = None,
         timeout: float = 300.0, what: str = 'request') -> bytes:
    """GET with retries on transient failures; raises Unavailable at the end."""
    import requests

    headers = {'Authorization': f'Bearer {_token()}'} if auth else {}
    last: Exception | None = None
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=timeout)
            if r.status_code in (401, 403):
                raise protocol.Unavailable(
                    f'Earthdata refused the {what} (HTTP {r.status_code}); the '
                    'token may be expired or the LP DAAC EULA not yet accepted '
                    'for this account'
                )
            if 400 <= r.status_code < 500:
                # A missing file or a malformed request does not recover on a
                # second attempt; only the service's own failures are retried.
                raise protocol.Unavailable(f'the {what} failed: HTTP {r.status_code} for {r.url}')
            if r.status_code >= 500:
                raise RuntimeError(f'HTTP {r.status_code}')
            return r.content
        except protocol.Unavailable:
            raise
        except Exception as e:  # noqa: BLE001 - network failures take many forms
            last = e
            if attempt < len(RETRY_WAITS):
                wait = RETRY_WAITS[attempt]
                protocol.emit_progress(-1, f'{what} failed ({type(e).__name__}), retrying in {wait}s')
                time.sleep(wait)
    raise protocol.Unavailable(f'the {what} failed after {len(RETRY_WAITS) + 1} attempts: {last}')


# Search -----------------------------------------------------------------------


def _polygon_param(polygon) -> str:
    """CMR's polygon parameter: lon,lat pairs, counter-clockwise, closed."""
    from shapely.geometry import Polygon
    from shapely.geometry.polygon import orient

    hull = polygon.convex_hull
    if not isinstance(hull, Polygon):
        hull = polygon.buffer(1e-4).convex_hull
    ring = orient(hull, sign=1.0).exterior.coords
    return ','.join(f'{x:.6f},{y:.6f}' for x, y in ring)


def _footprint(umm: dict):
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    polys = []
    geo = umm.get('SpatialExtent', {}).get('HorizontalSpatialDomain', {}).get('Geometry', {})
    for gp in geo.get('GPolygons', []):
        pts = gp['Boundary']['Points']
        polys.append(Polygon([(p['Longitude'], p['Latitude']) for p in pts]))
    return unary_union(polys) if polys else None


def _cloud_cover(umm: dict) -> float | None:
    v = umm.get('CloudCover')
    if v is not None:
        return float(v)
    for a in umm.get('AdditionalAttributes', []):
        if a.get('Name', '').upper() in ('CLOUD_COVER', 'CLOUDCOVER'):
            try:
                return float(a['Values'][0])
            except (KeyError, IndexError, ValueError):
                return None
    return None


def parse_granules(body: dict, polygon, max_cloud: float, version: str) -> list[Granule]:
    """Granules of one CMR umm_json page whose footprint meets the area."""
    out = []
    for item in body.get('items', []):
        umm, meta = item['umm'], item['meta']
        fp = _footprint(umm)
        if fp is None or not fp.intersects(polygon):
            continue
        cc = _cloud_cover(umm)
        if cc is not None and cc > max_cloud:
            continue
        out.append(Granule(
            ur=umm['GranuleUR'], concept=meta['collection-concept-id'],
            start=umm['TemporalExtent']['RangeDateTime']['BeginningDateTime'],
            cloud_cover=cc, footprint=fp, version=version,
        ))
    return out


def search(polygon, start: str, end: str, *, max_cloud: float = 100.0,
           versions: tuple[str, ...] = RFL_VERSIONS, page_size: int = 500) -> list[Granule]:
    """
    Every reflectance granule whose footprint meets the area in the period,
    one per acquisition (the newest version holding it), least cloudy first.
    CMR returns footprints, so the intersection is tested against the area
    itself rather than against its bounding box.
    """
    import json

    by_acq: dict[str, Granule] = {}
    for version in versions:
        params = {
            'short_name': RFL_SHORT_NAME, 'version': version,
            'polygon': _polygon_param(polygon),
            'temporal': f'{start}T00:00:00Z,{end}T23:59:59Z',
            'page_size': page_size, 'sort_key': 'start_date',
        }
        body = json.loads(_get(CMR_GRANULES, auth=False, params=params, timeout=60,
                               what='CMR granule search'))
        for g in parse_granules(body, polygon, max_cloud, version):
            by_acq.setdefault(g.acquisition, g)
    out = list(by_acq.values())
    out.sort(key=lambda g: (g.cloud_cover if g.cloud_cover is not None else 100.0, g.start))
    return out


def find_mask(rfl: Granule) -> Granule | None:
    """
    The mask of the same acquisition. Version 001 keeps it inside the
    reflectance granule as EMIT_L2A_MASK_001_<same suffix>; version 002 has
    its own collection, searched newest version first.
    """
    import json

    if rfl.version == '001':
        name = rfl.ur.replace('_RFL_', '_MASK_', 1)
        return Granule(name, rfl.concept, rfl.start, None, rfl.footprint, '001',
                       data_url=f'{LPDAAC_PROTECTED}/EMITL2ARFL.001/{rfl.ur}/{name}.nc')
    day = rfl.acquisition[:8]
    temporal = f'{day[:4]}-{day[4:6]}-{day[6:]}T00:00:00Z,{day[:4]}-{day[4:6]}-{day[6:]}T23:59:59Z'
    for version in ('003', '002'):
        params = {'short_name': MASK_SHORT_NAME, 'version': version,
                  'temporal': temporal, 'page_size': 200}
        body = json.loads(_get(CMR_GRANULES, auth=False, params=params, timeout=60,
                               what='CMR mask search'))
        for item in body.get('items', []):
            umm, meta = item['umm'], item['meta']
            if rfl.acquisition in umm['GranuleUR']:
                urls = [u['URL'] for u in umm.get('RelatedUrls', [])
                        if u.get('Type') == 'GET DATA' and u['URL'].startswith('https://')
                        and u['URL'].endswith('.nc')]
                return Granule(umm['GranuleUR'], meta['collection-concept-id'],
                               umm['TemporalExtent']['RangeDateTime']['BeginningDateTime'],
                               None, _footprint(umm), version,
                               data_url=urls[0] if urls else '')
    return None


def _same_acquisition(short_name: str, rfl: Granule,
                      versions: tuple[str, ...] = DERIVED_VERSIONS) -> tuple[str, list[str]] | None:
    """
    The granule UR and download addresses of another product of the
    acquisition `rfl` belongs to, newest version first, or None.

    Matched by the acquisition timestamp every product of one acquisition
    carries in its UR, searched over that day: a version 002 reflectance
    granule has no orbit and scene suffix to build the other UR from.
    """
    import json

    day = rfl.acquisition[:8]
    temporal = f'{day[:4]}-{day[4:6]}-{day[6:]}T00:00:00Z,{day[:4]}-{day[4:6]}-{day[6:]}T23:59:59Z'
    for version in versions:
        params = {'short_name': short_name, 'version': version,
                  'temporal': temporal, 'page_size': 200}
        body = json.loads(_get(CMR_GRANULES, auth=False, params=params, timeout=60,
                               what=f'CMR {short_name} search'))
        for item in body.get('items', []):
            umm = item['umm']
            if rfl.acquisition in umm['GranuleUR']:
                urls = [u['URL'] for u in umm.get('RelatedUrls', [])
                        if u.get('Type') == 'GET DATA' and u['URL'].startswith('https://')]
                return umm['GranuleUR'], urls
    return None


def find_frcov(rfl: Granule) -> dict[str, str] | None:
    """
    The fractional cover files of the acquisition: `pv`, `npv` and `bare`, each
    a GeoTIFF address, or None where the product does not exist for it.

    EMIT L2B FRCOV (Ochoa et al., 2025) is spectral unmixing of the same
    reflectance into photosynthetic vegetation, non-photosynthetic vegetation
    and bare soil, with an endmember library the EMIT team built for arid
    regions (EMIT L3 ATBD, section 4.1).
    """
    found = _same_acquisition(FRCOV_SHORT_NAME, rfl)
    if found is None:
        return None
    _, urls = found
    out: dict[str, str] = {}
    for key, tag in (('pv', 'FRCOVPV_'), ('npv', 'FRCOVNPV_'), ('bare', 'FRCOVBARE_')):
        match = [u for u in urls if tag in u and u.endswith('.tif')]
        if match:
            out[key] = match[0]
    return out if len(out) == 3 else None


def find_l2b_min(rfl: Granule) -> Granule | None:
    """The EMIT L2B mineral identification of the acquisition, or None."""
    found = _same_acquisition(L2B_MIN_SHORT_NAME, rfl)
    if found is None:
        return None
    ur, urls = found
    files = [u for u in urls if u.endswith('.nc') and '_MINUNCERT_' not in u]
    if not files:
        return None
    return Granule(ur, '', rfl.start, None, rfl.footprint, DERIVED_VERSIONS[0], data_url=files[0])


def uncertainty_url(rfl: Granule) -> str:
    """
    The reflectance uncertainty file of the acquisition. Both versions ship it
    as a second file of the reflectance granule, EMIT_L2A_RFLUNCERT_<suffix>.
    """
    name = rfl.ur.replace('_RFL_', '_RFLUNCERT_', 1)
    return f'{LPDAAC_PROTECTED}/EMITL2ARFL.{rfl.version}/{rfl.ur}/{name}.nc'


# OPeNDAP ------------------------------------------------------------------------


@dataclass
class Structure:
    """What the DMR says about one granule: array shapes and global attributes."""

    shapes: dict[str, tuple[int, ...]]
    attributes: dict[str, list[str]]


def _url(g: Granule) -> str:
    return OPENDAP.format(concept=g.concept, granule=g.ur)


def structure(g: Granule) -> Structure:
    """Parse the granule's DAP4 metadata response (DMR)."""
    xml = _get(_url(g) + '.dmr.xml', auth=True, timeout=120, what='OPeNDAP metadata request')
    root = ET.fromstring(xml)

    def local(tag: str) -> str:
        return tag.rsplit('}', 1)[-1]

    dims: dict[str, int] = {}
    shapes: dict[str, tuple[int, ...]] = {}
    attributes: dict[str, list[str]] = {}

    def walk(node, path: str) -> None:
        for child in node:
            kind = local(child.tag)
            name = child.get('name', '')
            if kind == 'Dimension':
                dims[f'{path}/{name}'] = int(child.get('size', '0'))
                dims[name] = int(child.get('size', '0'))
            elif kind == 'Group':
                walk(child, f'{path}/{name}')
            elif kind == 'Attribute' and path == '':
                attributes[name] = [v.text or '' for v in child if local(v.tag) == 'Value']
            elif kind in ('Float32', 'Float64', 'Int8', 'Int16', 'Int32', 'Int64',
                          'UInt8', 'UInt16', 'UInt32', 'UInt64', 'Byte', 'String'):
                shape = []
                for d in child:
                    if local(d.tag) == 'Dim':
                        ref = d.get('name', '')
                        size = d.get('size')
                        if size is not None:
                            shape.append(int(size))
                        else:
                            shape.append(dims.get(ref, dims.get(ref.rsplit('/', 1)[-1], 0)))
                shapes[f'{path}/{name}'] = tuple(shape)

    walk(root, '')
    return Structure(shapes=shapes, attributes=attributes)


def read(g: Granule, slabs: dict[str, tuple[slice, ...]]) -> dict[str, np.ndarray]:
    """
    Hyperslabs of one or more variables, in one DAP4 request.

    `slabs` maps a variable path (`/reflectance`, `/location/glt_x`) to one
    slice per dimension, with explicit start and stop. The response is a
    NetCDF-4 file, opened in memory with h5py.
    """
    try:
        import h5py
    except ImportError as e:
        raise protocol.MissingDependency('EMIT reading needs h5py') from e

    parts = []
    for var, sl in slabs.items():
        idx = ''.join(f'[{s.start}:1:{s.stop - 1}]' for s in sl)
        parts.append(f'{var}{idx}')
    ce = quote(';'.join(parts), safe='/[]:;')
    body = _get(f'{_url(g)}.dap.nc4?dap4.ce={ce}', auth=True, what='OPeNDAP data request')
    out: dict[str, np.ndarray] = {}
    with h5py.File(io.BytesIO(body), 'r') as f:
        for var in slabs:
            out[var] = np.asarray(f[var.lstrip('/')][...])
    return out


# Geometry ----------------------------------------------------------------------


@dataclass(frozen=True)
class OutputGrid:
    """A north-up lon/lat grid covering the area at the granules' spacing."""

    lon0: float      # west edge
    lat0: float      # north edge
    dlon: float
    dlat: float      # positive; rows run south
    width: int
    height: int

    def centres(self) -> tuple[np.ndarray, np.ndarray]:
        lon = self.lon0 + (np.arange(self.width) + 0.5) * self.dlon
        lat = self.lat0 - (np.arange(self.height) + 0.5) * self.dlat
        return lon, lat

    def extent(self) -> dict:
        return {'lon_min': self.lon0, 'lon_max': self.lon0 + self.width * self.dlon,
                'lat_min': self.lat0 - self.height * self.dlat, 'lat_max': self.lat0}

    def cell_area_ha(self) -> np.ndarray:
        """Area of one cell per row, on the WGS84 sphere of equal area."""
        _, lat = self.centres()
        r = 6371007.2  # authalic radius, m
        dy = math.radians(self.dlat) * r
        dx = math.radians(self.dlon) * r * np.cos(np.radians(lat))
        return dx * dy / 1e4


def output_grid(polygon, geotransform: list[float]) -> OutputGrid:
    """
    The grid on which results are reported: the area's bounding box, at the
    first granule's ortho spacing. A second granule is sampled onto the same
    grid by nearest cell, so results from several passes line up.
    """
    dlon, dlat = abs(geotransform[1]), abs(geotransform[5])
    w, s, e, n = polygon.bounds
    width = max(1, math.ceil((e - w) / dlon))
    height = max(1, math.ceil((n - s) / dlat))
    return OutputGrid(w, n, dlon, dlat, width, height)


def area_mask(grid: OutputGrid, polygon) -> np.ndarray:
    """True for output cells whose centre lies inside the area."""
    from shapely import contains_xy

    lon, lat = grid.centres()
    lo, la = np.meshgrid(lon, lat)
    return contains_xy(polygon, lo, la)


@dataclass
class Placement:
    """For each output cell inside the area, the instrument pixel observed there."""

    row: np.ndarray       # 0-based downtrack index, -1 where none
    col: np.ndarray       # 0-based crosstrack index, -1 where none


def ortho_cells(grid: OutputGrid, gt: list[float], shape: tuple[int, ...]):
    """
    The ortho cell of each output cell centre in a grid of geotransform `gt`
    and `shape` (rows, columns): column and row per output column and row, and
    which of them fall inside that grid.
    """
    lon, lat = grid.centres()
    gx = np.floor((lon - gt[0]) / gt[1]).astype(int)
    gy = np.floor((lat - gt[3]) / gt[5]).astype(int)
    xs = (gx >= 0) & (gx < shape[1])
    ys = (gy >= 0) & (gy < shape[0])
    return gx, gy, xs, ys


def place(g: Granule, st: Structure, grid: OutputGrid, inside: np.ndarray) -> Placement:
    """Read the geometry lookup table under the grid and invert it."""
    gt = [float(v) for v in st.attributes['geotransform']]
    glt_shape = st.shapes['/location/glt_x']
    # Ortho cell of each output cell centre in this granule's own GLT grid.
    gx, gy, xs, ys = ortho_cells(grid, gt, glt_shape)
    row = np.full((grid.height, grid.width), -1, dtype=np.int32)
    col = np.full((grid.height, grid.width), -1, dtype=np.int32)
    if not xs.any() or not ys.any():
        return Placement(row, col)
    x0, x1 = int(gx[xs].min()), int(gx[xs].max()) + 1
    y0, y1 = int(gy[ys].min()), int(gy[ys].max()) + 1
    glt = read(g, {'/location/glt_x': (slice(y0, y1), slice(x0, x1)),
                   '/location/glt_y': (slice(y0, y1), slice(x0, x1))})
    glt_x, glt_y = glt['/location/glt_x'], glt['/location/glt_y']
    yy, xx = np.meshgrid(gy, gx, indexing='ij')
    ok = inside & ys[:, None] & xs[None, :]
    cx = np.zeros_like(yy)
    cy = np.zeros_like(yy)
    cx[ok] = glt_x[yy[ok] - y0, xx[ok] - x0]
    cy[ok] = glt_y[yy[ok] - y0, xx[ok] - x0]
    hit = ok & (cx > 0) & (cy > 0)
    row[hit] = cy[hit] - 1
    col[hit] = cx[hit] - 1
    return Placement(row, col)


# Reflectance ---------------------------------------------------------------------


@dataclass
class Block:
    """Instrument pixels of one row block: where they are and what they measured."""

    rows: np.ndarray            # downtrack index per pixel
    cols: np.ndarray            # crosstrack index per pixel
    reflectance: np.ndarray     # (pixels, bands), NaN where unusable
    masked: np.ndarray          # True where the aggregate mask excludes the pixel


def band_parameters(g: Granule, st: Structure) -> dict[str, np.ndarray]:
    nb = st.shapes['/sensor_band_parameters/wavelengths'][0]
    got = read(g, {
        '/sensor_band_parameters/wavelengths': (slice(0, nb),),
        '/sensor_band_parameters/fwhm': (slice(0, nb),),
        '/sensor_band_parameters/good_wavelengths': (slice(0, nb),),
    })
    return {k.rsplit('/', 1)[-1]: v for k, v in got.items()}


def _resolve(session, url: str) -> tuple[str, int]:
    """
    The signed address an authenticated request for `url` is redirected to,
    and the file's size. The token is sent to the LP DAAC only; every later
    read goes to the signed address without it.
    """
    first = session.get(url, headers={'Authorization': f'Bearer {_token()}',
                                      'Range': 'bytes=0-0'}, timeout=120)
    if first.status_code in (401, 403):
        raise protocol.Unavailable(
            f'Earthdata refused the file request (HTTP {first.status_code}); the '
            'token may be expired or the LP DAAC EULA not yet accepted')
    if first.status_code != 206:
        raise protocol.Unavailable(f'{url} did not accept a byte-range request '
                                   f'(HTTP {first.status_code})')
    return first.url, int(first.headers['Content-Range'].rsplit('/', 1)[1])


class RangeFile(io.RawIOBase):
    """
    A read-only file over HTTP byte ranges, for h5py.

    The LP DAAC answers an authenticated request with a redirect to a signed
    CloudFront address; that address is resolved once and used for every later
    range, so the token is sent to the LP DAAC only. Blocks are cached, because
    HDF5 reads its metadata in many small pieces from the same few regions.
    """

    def __init__(self, url: str, block: int = 1 << 20):
        import requests

        self._session = requests.Session()
        self._url, self._size = _resolve(self._session, url)
        self._block = block
        self._cache: dict[int, bytes] = {}
        self._pos = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._pos, io.SEEK_END: self._size}[whence]
        self._pos = base + offset
        return self._pos

    def _fetch(self, index: int) -> bytes:
        if index not in self._cache:
            lo = index * self._block
            hi = min(lo + self._block, self._size) - 1
            r = self._session.get(self._url, headers={'Range': f'bytes={lo}-{hi}'}, timeout=300)
            if r.status_code != 206:
                raise protocol.Unavailable(f'byte-range read failed (HTTP {r.status_code})')
            self._cache[index] = r.content
        return self._cache[index]

    def read_ranges(self, ranges: list[tuple[int, int]], workers: int = 8) -> list[bytes]:
        """
        Several (offset, length) byte ranges, fetched concurrently at the
        signed address. For a contiguous dataset whose rows are read one range
        each: HDF5 would ask for them one after another, and the time is in the
        round trips, not the bytes.
        """
        from concurrent.futures import ThreadPoolExecutor

        import requests

        def get(r: tuple[int, int]) -> bytes:
            lo, n = r
            last: Exception | None = None
            for wait in (0, *RETRY_WAITS):
                if wait:
                    time.sleep(wait)
                try:
                    resp = requests.get(self._url, headers={'Range': f'bytes={lo}-{lo + n - 1}'},
                                        timeout=300)
                    if resp.status_code == 206 and len(resp.content) == n:
                        return resp.content
                    last = RuntimeError(f'HTTP {resp.status_code}, {len(resp.content)} bytes')
                except Exception as e:  # noqa: BLE001 - network failures take many forms
                    last = e
            raise protocol.Unavailable(f'byte-range read failed: {last}')

        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(get, ranges))

    def readinto(self, buf) -> int:
        n = min(len(buf), max(0, self._size - self._pos))
        out = memoryview(buf)
        done = 0
        while done < n:
            index, offset = divmod(self._pos + done, self._block)
            chunk = self._fetch(index)[offset:offset + n - done]
            out[done:done + len(chunk)] = chunk
            done += len(chunk)
        self._pos += n
        return n


class MaskReader:
    """The aggregate cloud flag of one acquisition, read by window."""

    def __init__(self, mask: Granule):
        try:
            import h5py
        except ImportError as e:
            raise protocol.MissingDependency('EMIT reading needs h5py') from e
        if not mask.data_url:
            raise protocol.Unavailable(f'no download address is listed for {mask.ur}')
        self.granule = mask
        self._file = h5py.File(RangeFile(mask.data_url), 'r')
        names = self._file['sensor_band_parameters/mask_bands'][...]
        labels = [n.decode() if isinstance(n, bytes) else str(n) for n in names]
        for i, name in enumerate(labels):
            if re.sub(r'\s+', ' ', name).strip().lower() == AGGREGATE_MASK_BAND.lower():
                self.band = i
                break
        else:
            raise protocol.Unavailable(f'the EMIT mask has no {AGGREGATE_MASK_BAND!r} band: {labels}')

    def window(self, r0: int, r1: int, c0: int, c1: int) -> np.ndarray:
        """True where the aggregate flag excludes the observation."""
        return np.asarray(self._file['mask'][r0:r1, c0:c1, self.band]) >= 0.5


def blocks(g: Granule, st: Structure, placement: Placement,
           mask: MaskReader | None,
           progress: Callable[[int, int], None] | None = None) -> Iterator[Block]:
    """
    The instrument pixels the area needs, read in row blocks.

    Only pixels that some output cell points at are returned; the rest of a
    block's window is read (a hyperslab is a rectangle) and discarded.
    """
    need = placement.row >= 0
    if not need.any():
        return
    rows, cols = placement.row[need], placement.col[need]
    wanted = np.unique(np.stack([rows, cols], axis=1), axis=0)
    c0, c1 = int(wanted[:, 1].min()), int(wanted[:, 1].max()) + 1
    r_all = np.unique(wanted[:, 0])
    nb = st.shapes['/reflectance'][2]
    rows_per = max(1, BLOCK_BYTES // ((c1 - c0) * nb * 4))
    starts = list(range(int(r_all.min()), int(r_all.max()) + 1, rows_per))
    for n, r0 in enumerate(starts):
        r1 = min(r0 + rows_per, int(r_all.max()) + 1)
        sel = wanted[(wanted[:, 0] >= r0) & (wanted[:, 0] < r1)]
        if len(sel) == 0:
            continue
        cube = read(g, {'/reflectance': (slice(r0, r1), slice(c0, c1), slice(0, nb))})['/reflectance']
        spec = cube[sel[:, 0] - r0, sel[:, 1] - c0, :].astype(np.float64)
        spec[spec <= FILL + 1] = np.nan
        masked = np.zeros(len(sel), dtype=bool)
        if mask is not None:
            m = mask.window(r0, r1, c0, c1)
            masked = m[sel[:, 0] - r0, sel[:, 1] - c0]
        if progress is not None:
            progress(n + 1, len(starts))
        yield Block(rows=sel[:, 0], cols=sel[:, 1], reflectance=spec, masked=masked)


# Beside the reflectance ---------------------------------------------------------


def _placed_window(placement: Placement):
    """Rows and columns of the placed pixels, and the rectangle holding them."""
    need = placement.row >= 0
    rows, cols = placement.row[need], placement.col[need]
    return need, rows, cols, int(rows.min()), int(rows.max()) + 1, int(cols.min()), int(cols.max()) + 1


def frcov_at(urls: dict[str, str], grid: OutputGrid, cells: np.ndarray) -> dict[str, np.ndarray]:
    """
    Fractional cover at the output cells, 0 to 1, NaN where the product has no
    value or the cell is not in `cells`.

    The files are Cloud Optimized GeoTIFFs; each is opened at its signed
    address and read over the window the cells fall in, placed by its own
    geotransform, which for EMIT is the reflectance's ortho grid.
    """
    import rasterio
    import requests
    from rasterio.windows import Window

    out: dict[str, np.ndarray] = {}
    session = requests.Session()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                      GDAL_HTTP_MAX_RETRY='3', GDAL_HTTP_RETRY_DELAY='2'):
        for key, url in urls.items():
            signed, _ = _resolve(session, url)
            vals = np.full((grid.height, grid.width), np.nan)
            with rasterio.open('/vsicurl/' + signed) as ds:
                t = ds.transform
                gx, gy, xs, ys = ortho_cells(grid, [t.c, t.a, t.b, t.f, t.d, t.e], (ds.height, ds.width))
                ok = cells & ys[:, None] & xs[None, :]
                if ok.any():
                    yy, xx = np.meshgrid(gy, gx, indexing='ij')
                    y0, y1 = int(yy[ok].min()), int(yy[ok].max()) + 1
                    x0, x1 = int(xx[ok].min()), int(xx[ok].max()) + 1
                    arr = ds.read(1, window=Window(x0, y0, x1 - x0, y1 - y0)).astype(np.float64)
                    if ds.nodata is not None:
                        arr[arr == ds.nodata] = np.nan
                    arr[(arr < 0.0) | (arr > 1.0)] = np.nan
                    vals[ok] = arr[yy[ok] - y0, xx[ok] - x0]
            out[key] = vals
    return out


class L2BReader:
    """The official Tetracorder identification of one acquisition, by window."""

    def __init__(self, granule: Granule):
        try:
            import h5py
        except ImportError as e:
            raise protocol.MissingDependency('EMIT reading needs h5py') from e
        self.granule = granule
        self._file = h5py.File(RangeFile(granule.data_url), 'r')

    def metadata(self) -> list[dict]:
        """One row per L2B index: index, library, record, name, group."""
        md = self._file['mineral_metadata']

        def text(v) -> str:
            return v.decode('latin1') if isinstance(v, bytes) else str(v)

        return [{'index': int(md['index'][i]), 'library': text(md['library'][i]),
                 'record': int(md['record'][i]), 'name': text(md['name'][i]),
                 'group': int(md['group'][i])}
                for i in range(md['index'].shape[0])]

    def ids(self, placement: Placement, groups: tuple[int, ...]) -> dict[int, np.ndarray]:
        """
        Per group, the L2B mineral index at each output cell: 0 where L2B
        identified nothing, -1 where no pixel was placed or the value is fill.
        """
        shape = placement.row.shape
        out = {g: np.full(shape, -1, dtype=np.int32) for g in groups}
        if not (placement.row >= 0).any():
            return out
        need, rows, cols, r_lo, r_hi, c0, c1 = _placed_window(placement)
        for g in groups:
            win = np.asarray(self._file[f'group_{g}_mineral_id'][r_lo:r_hi, c0:c1]).astype(np.int32)
            v = win[rows - r_lo, cols - c0]
            v[v < 0] = -1
            out[g][need] = v
        return out


class UncertaintyReader:
    """
    The one-sigma reflectance uncertainty of one acquisition, by window.

    The variable is stored contiguous and uncompressed (EMIT L2A V001, checked
    2026-09-24), so each instrument row of a window is one byte range at a
    known offset, and the rows are fetched concurrently: through HDF5 they were
    fetched one after another, at 15 s for 20 rows. Any other layout is read
    through HDF5.
    """

    def __init__(self, rfl: Granule):
        try:
            import h5py
        except ImportError as e:
            raise protocol.MissingDependency('EMIT reading needs h5py') from e
        self._range = RangeFile(uncertainty_url(rfl))
        self._file = h5py.File(self._range, 'r')
        d = self._file['reflectance_uncertainty']
        self._shape = d.shape
        self._dtype = d.dtype
        self._offset = d.id.get_offset() if d.chunks is None and d.compression is None else None

    def window(self, r0: int, r1: int, c0: int, c1: int) -> np.ndarray:
        """(rows, cols, bands), NaN where fill."""
        if self._offset is None:
            u = np.asarray(self._file['reflectance_uncertainty'][r0:r1, c0:c1, :])
        else:
            _, ncols, nb = self._shape
            size = self._dtype.itemsize
            ranges = [(int(self._offset) + (r * ncols + c0) * nb * size, (c1 - c0) * nb * size)
                      for r in range(r0, r1)]
            rows = self._range.read_ranges(ranges)
            u = np.stack([np.frombuffer(b, dtype=self._dtype).reshape(c1 - c0, nb) for b in rows])
        u = u.astype(np.float64)
        u[u <= FILL + 1] = np.nan
        return u
