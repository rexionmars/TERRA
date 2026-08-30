"""
Digital elevation models: four products, one grid, one way of reading them.

Two chains read the ground. The flood envelope measures how much of a HAND
extent is decided by the terrain and how much by the choice of DEM, which only
means anything if every product is read over the same ground, at the same
moment, through the same code. Solar terrain and siting read one product over
one window. Both arrive here, and the reasons are the same in kind.

WHY THE WHOLE WINDOW, MERGED.

Copernicus tiles are one degree. Reading `items[0]` -- the first tile the
catalogue returns, with no merge -- gives an AOI that crosses a tile edge a DEM
covering part of itself. For slope and aspect that degrades in patches. For
HAND it fails differently and worse: flow accumulation needs the contributing
area upstream of each cell, so a DEM cut at the AOI edge truncates the drainage
network, fewer cells clear the drainage-area threshold, and every cell whose
water enters from outside references a drainage cell farther downstream than
the real one. The HAND comes out too high and the flood extent too small -- a
plausible map, wrong in a direction nothing on screen would reveal. The study
this ports never met the failure: it ran on a fixed AOI that already had a
margin drawn around it. The solar terrain read did meet it, for as long as
it lived in solar.py with a reader of its own.

So every intersecting tile is merged, over a window buffered beyond the AOI so
the drainage entering it is real terrain rather than a domain edge. The search
is by the BUFFERED window and not by the AOI, or a tile intersecting only the
buffer ring would never be returned and the merge would leave a hole exactly
where the inflow is.

WHERE THE TWO CHAINS DIFFER, they differ by argument and not by module.
`read_merged` refuses a window the tiles do not fill when `require_coverage` is
set, which the envelope needs and the terrain read does not: Copernicus
publishes no tile over the sea, so a coastal AOI has a gap that is a fact about
the catalogue rather than a broken read.

PROVENANCE. The study drew COP30, NASADEM, SRTMGL1 and COP90 from OpenTopography
with an API key. Planetary Computer carries three of those four plus alos-dem
and no key, so the whole set comes from the catalogue TERRA already reads. It
does not carry SRTMGL1; alos-dem takes that slot. The DEM set is therefore not
the study's, and the study's published IoU range is not a prediction of what
this will measure.

COST. Measured on the ported chain in hand.py: 4.3 microseconds per cell, so a
900 by 900 grid is 3.5 s per product and four products over a 50 km AOI is
about a minute. Memory binds before time: at 1e7 cells the DEM held here is
40 MB in float32, while the chain downstream holds several float64 arrays of
80 MB each.
"""

import math
from dataclasses import dataclass

import numpy as np

from terra.terrain import hand
from terra import stac


@dataclass(frozen=True)
class Product:
    """One DEM product as the catalogue serves it."""

    id: str
    collection: str
    native_resolution_m: float
    # Tried in order. The Copernicus and ALOS items name the elevation band
    # "data"; NASADEM names it "elevation". A product whose asset keys change
    # under us has to fail by name rather than by KeyError on a href.
    asset_keys: tuple


# The order matters twice. The first entry defines the reference grid every
# other product is compared on, and cop-dem-glo-30 is the one collection TERRA
# already reads in production (terra/energy), so the grid the envelope is measured
# on is the grid the rest of the application already draws.
COLLECTIONS = {
    "cop30": Product("cop30", "cop-dem-glo-30", 30.0, ("data",)),
    "nasadem": Product("nasadem", "nasadem", 30.0, ("elevation", "data")),
    "alos": Product("alos", "alos-dem", 30.0, ("data",)),
    "cop90": Product("cop90", "cop-dem-glo-90", 90.0, ("data",)),
}

DEFAULT_IDS = ("cop30", "nasadem", "alos", "cop90")

# Below this, the value is a void fill rather than a measurement: NASADEM and
# SRTM write -32768 into voids, ALOS writes -9999, and neither is always
# declared as the COG's nodata. The lowest bare land on Earth is the Dead Sea
# shore near -430 m, so -1000 m separates the two populations with no product
# in this set anywhere near the boundary.
VOID_BELOW_M = -1000.0


# ------------------------------------------------------------------ the buffer
#
# The buffer is not a constant to pick blind. Two arguments pull against each
# other and neither has a clean optimum.
#
# Pulling it up: HAND needs the contributing area of every cell in the AOI.
# Taken strictly that is the full upstream watershed, which for a lowland AOI is
# hundreds of kilometres and unbounded in principle. No buffer this product can
# afford makes the drainage network complete, so the buffer is a bounded
# compromise and the residual has to be stated rather than hidden: cells fed by
# a channel entering from beyond the buffer keep a HAND that is too high, so
# their flood extent is underestimated. That belongs in the payload qualifier.
#
# Pulling it down: cost is quadratic. A square AOI of side L buffered by b costs
# ((L + 2b) / L)^2 times the unbuffered read, in cells and so in seconds.
#
# BUFFER_MIN_M sets the floor at the scale of a first-order channel. At the
# 0.5 km2 drainage threshold hand.py defaults to, a channel head needs about
# 556 cells of 30 m upstream; a compact catchment of that area is roughly 0.8 km
# across and an elongated one about 2 km. Below 2 km the channels feeding the
# AOI edge are not yet channels when they arrive.
#
# BUFFER_MAX_M caps the absolute cost. At L = 50 km the cap holds the overhead
# to (60/50)^2 = 1.44, about 4e6 cells and 17 s per product. Letting the
# fraction run uncapped there would give b = 10 km, 2.07e6 extra cells and 27 s
# per product, for a gain on the regional drainage that is real but unquantified
# -- the missing area is still unbounded either way.
#
# Between the two the buffer follows the AOI, because the length scale of the
# drainage entering an area scales with the area, and a fixed metre value would
# be most of the domain on a 3 km AOI and a rounding error on a 60 km one.
BUFFER_FRACTION_OF_AOI = 0.2
BUFFER_MIN_M = 2000.0
BUFFER_MAX_M = 5000.0


def metres_per_degree(lat_deg):
    """Metres per degree of longitude and of latitude at a given latitude."""
    # From hand.pixel_size_m rather than a second pair of constants here: the
    # buffer is converted to degrees with the same numbers the cell size is
    # reported with, so the buffer cannot be a different length than the cells
    # it is measured in.
    return hand.pixel_size_m(lat_deg, 1.0, 1.0)


def aoi_extent_m(bounds):
    """The AOI's width and height in metres, from geographic bounds."""
    minx, miny, maxx, maxy = bounds
    m_lon, m_lat = metres_per_degree(0.5 * (miny + maxy))
    return (maxx - minx) * m_lon, (maxy - miny) * m_lat


def recommended_buffer_m(bounds):
    """The buffer for this AOI, in metres. See the argument above the constants."""
    width_m, height_m = aoi_extent_m(bounds)
    # The longer side, not the shorter and not the diagonal. On a long thin AOI
    # the drainage that matters enters along the long edge, and sizing off the
    # short side would buffer least where the inflow is widest.
    scale = max(width_m, height_m)
    return float(min(BUFFER_MAX_M, max(BUFFER_MIN_M, BUFFER_FRACTION_OF_AOI * scale)))


def buffer_bounds(bounds, buffer_m):
    """Geographic bounds widened by a distance in metres on every side."""
    if buffer_m < 0:
        raise ValueError(f"buffer_m must not be negative, got {buffer_m}")
    minx, miny, maxx, maxy = bounds
    m_lon, m_lat = metres_per_degree(0.5 * (miny + maxy))
    dlon = buffer_m / m_lon
    dlat = buffer_m / m_lat
    return (minx - dlon, miny - dlat, maxx + dlon, maxy + dlat)


# -------------------------------------------------------------------- the grid


@dataclass(frozen=True)
class Grid:
    """A north-up raster grid: what a product was read on, or compared on."""

    transform: object
    width: int
    height: int
    crs: object

    @property
    def shape(self):
        return (self.height, self.width)

    @classmethod
    def of(cls, array, transform, crs):
        return cls(transform, int(array.shape[1]), int(array.shape[0]), crs)


def snap_bounds(bounds, transform):
    """
    Widen bounds outward until every edge lands on a cell boundary of `transform`.

    Without this the merged window starts wherever the buffer arithmetic landed,
    which is mid-cell, and rasterio resamples the source to reach it. That would
    put a sub-cell shift into the reference product itself -- the one product in
    the set that is supposed to be read exactly as the catalogue stores it, so
    that a disagreement between products is a disagreement between measurements
    and not between two interpolations of them.
    """
    if transform.b != 0 or transform.d != 0:
        raise ValueError("snap_bounds needs an axis-aligned transform")
    rx, ry = transform.a, -transform.e
    if rx <= 0 or ry <= 0:
        raise ValueError(
            f"snap_bounds needs a north-up grid with positive resolution, "
            f"got a={transform.a} e={transform.e}"
        )
    x0, y0 = transform.c, transform.f
    minx, miny, maxx, maxy = bounds
    # The epsilon absorbs the float error in the division, so bounds already on
    # a cell boundary are not pushed a whole cell outward by a floor of 3.99999.
    eps = 1e-9
    w = x0 + math.floor((minx - x0) / rx + eps) * rx
    e = x0 + math.ceil((maxx - x0) / rx - eps) * rx
    n = y0 - math.floor((y0 - maxy) / ry + eps) * ry
    s = y0 - math.ceil((y0 - miny) / ry - eps) * ry
    return (w, s, e, n)


def grids_match(a, b, tol=1e-3):
    """
    Whether two grids are the same grid, to a thousandth of a cell.

    Compared in cells rather than in degrees because the transform mixes the two
    units: the origin is around 46 degrees and the resolution around 0.00028, so
    a single absolute tolerance is either meaningless for one or impossible for
    the other.
    """
    if a.crs != b.crs or a.shape != b.shape:
        return False
    rx, ry = abs(a.transform.a), abs(a.transform.e)
    return (
        abs(a.transform.a - b.transform.a) < tol * rx
        and abs(a.transform.e - b.transform.e) < tol * ry
        and abs(a.transform.c - b.transform.c) < tol * rx
        and abs(a.transform.f - b.transform.f) < tol * ry
    )


def cell_size_m(grid):
    """The grid's cell size in metres, at its centre latitude."""
    lat_mid = grid.transform.f + 0.5 * grid.height * grid.transform.e
    return hand.pixel_size_m(lat_mid, abs(grid.transform.a), abs(grid.transform.e))


def payload_grid(grid):
    """The `grid` block of the flood payload: width, height and bounds."""
    t = grid.transform
    return {
        "width": grid.width,
        "height": grid.height,
        "bounds": {
            "lon_min": float(t.c),
            "lat_min": float(t.f + grid.height * t.e),
            "lon_max": float(t.c + grid.width * t.a),
            "lat_max": float(t.f),
        },
    }


def resample_onto(array, grid, reference):
    """
    Move an array from its own grid onto the reference grid, nearest neighbour.

    Nearest and not bilinear. The agreement raster counts, cell by cell, how
    many products call a cell flooded; bilinear would put a value at that cell
    that no product measured, and the count would then be an agreement between
    measurements and interpolations of measurements. Nearest keeps every value a
    value some product actually reports, at the cost of visible blockiness where
    a 90 m product lands on a 30 m grid -- which is honest, and is why the
    `resampled` flag has to reach the payload.

    Cells of the reference grid that fall outside the source come back NaN.
    """
    from rasterio.warp import Resampling, reproject

    out = np.full(reference.shape, np.nan, dtype=np.float32)
    reproject(
        source=np.ascontiguousarray(array, dtype=np.float32),
        destination=out,
        src_transform=grid.transform,
        src_crs=grid.crs,
        dst_transform=reference.transform,
        dst_crs=reference.crs,
        src_nodata=np.nan,
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
    )
    return out


# --------------------------------------------------------------------- reading


# Below this, the difference is the geometry library rounding rather than a gap.
COVERAGE_TOL = 1e-6


def missing_fraction(target, tile_bounds):
    """The share of `target`, from 0 to 1, that no tile covers."""
    from shapely.geometry import box
    from shapely.ops import unary_union

    want = box(*target)
    have = unary_union([box(*b) for b in tile_bounds])
    return want.difference(have).area / want.area


def read_merged(sources, bounds, progress=None, require_coverage=True):
    """
    Merge every source over `bounds` and return (array, transform, crs).

    The window is snapped to the first source's grid, so that source is read at
    integer offsets and copied rather than resampled. Sources are expected to
    share one grid -- tiles of one product do -- and any that do not are
    resampled onto the first one's, which is the correct fallback for the one
    case it arises in: Copernicus tiles change longitude spacing at 50 degrees
    of latitude, so an AOI straddling that parallel merges two spacings.

    `require_coverage` refuses a window the tiles do not fill. The flood
    envelope needs that: merge writes NaN where nothing covered, NaN propagates
    into the flow accumulation as a hole in the drainage network, and the HAND
    that results is wrong over a region rather than absent over it. The terrain
    read behind solar siting passes False, because Copernicus publishes no tile
    over the sea, so a coastal area has a legitimate gap and the chain
    downstream already treats a cell with no elevation as unsuitable ground.
    The gap is reported through `progress` rather than passed over in silence.

    float32, not float64. It halves the 40 MB a 1e7 cell window costs, and a
    DEM has no elevation float32 cannot hold: at 9000 m its spacing is 1 mm,
    two orders below the vertical error of any product here. It is NOT safe for
    the depression fill downstream -- hand.fill_depressions raises each cell
    1e-3 m above its neighbour along a flat path, and at 9000 m that increment
    is the float32 spacing itself, so the increments would round away and leave
    the plateau the epsilon exists to break. That function allocates its own
    float64 accumulator, which is what keeps this safe.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.merge import merge as rio_merge

    sources = list(sources)
    if not sources:
        raise RuntimeError("no DEM tile was given for this window")

    opened = []
    try:
        for n, src in enumerate(sources, start=1):
            if progress:
                progress(f"reading tile {n} of {len(sources)}")
            opened.append(rasterio.open(src))

        crs = opened[0].crs
        odd = sorted({str(d.crs) for d in opened if d.crs != crs})
        if odd:
            raise RuntimeError(
                f"tiles of one product arrived in more than one CRS ({crs} "
                f"against {', '.join(odd)}), which a merge cannot resolve "
                "without reprojecting the reference product"
            )

        target = snap_bounds(bounds, opened[0].transform)
        missing = missing_fraction(target, [d.bounds for d in opened])
        if missing > COVERAGE_TOL:
            if require_coverage:
                raise RuntimeError(
                    f"the catalogue returned {len(opened)} tiles, which leave "
                    f"{missing * 100:.1f} percent of the requested window "
                    "uncovered"
                )
            if progress:
                progress(
                    f"{missing * 100:.1f} percent of this window has no tile; "
                    "those cells read as no data"
                )

        array, transform = rio_merge(
            opened,
            bounds=target,
            nodata=float("nan"),
            dtype="float32",
            resampling=Resampling.nearest,
        )
    finally:
        for d in opened:
            d.close()

    array = array[0]
    if array.size == 0:
        raise RuntimeError("the merged DEM window is empty for this AOI")
    array[array < VOID_BELOW_M] = np.nan
    if not np.isfinite(array).any():
        raise RuntimeError(
            "the merged DEM window holds no valid elevation: every cell is a "
            "void fill or outside the tiles that were returned"
        )
    return array, transform, crs


def resolve(collection):
    """The Product for a short id or a Planetary Computer collection id."""
    if collection in COLLECTIONS:
        return COLLECTIONS[collection]
    for product in COLLECTIONS.values():
        if product.collection == collection:
            return product
    known = ", ".join(sorted(COLLECTIONS))
    raise ValueError(f"unknown DEM product {collection!r}; known ids are {known}")


def _asset_href(item, product):
    for key in product.asset_keys:
        if key in item.assets:
            return item.assets[key].href
    raise RuntimeError(
        f"{product.collection} item {item.id} carries none of the elevation "
        f"assets {product.asset_keys}; it has {sorted(item.assets)}"
    )


def fetch(polygon, collection, buffer_m, progress=None):
    """
    Read one DEM product over the buffered AOI. Returns (array, transform, crs).

    `polygon` is a shapely geometry in EPSG:4326, as everywhere else in the
    sidecar. Signing is `pc.sign_inplace` on the client, the same route
    solar.py takes, so the hrefs come back already signed and no key is needed.
    """
    from shapely.geometry import box

    product = resolve(collection)
    window = buffer_bounds(polygon.bounds, buffer_m)

    if progress:
        progress(f"{product.id}: searching {product.collection}")
    # The buffered window, not the AOI. Searching by the AOI would miss a tile
    # that intersects only the buffer ring, and the merge would then leave a
    # hole in precisely the band the buffer was added to cover.
    items = stac.search(product.collection, intersects=box(*window))
    if not items:
        raise RuntimeError(f"no {product.collection} tile covers this AOI")

    hrefs = [_asset_href(item, product) for item in items]

    def tile_progress(message):
        if progress:
            progress(f"{product.id}: {message}")

    return read_merged(hrefs, window, progress=tile_progress)


@dataclass
class ProductRead:
    """One product as it was read, and how it relates to the reference grid."""

    product: Product
    array: np.ndarray
    grid: Grid
    reference: Grid
    resampled: bool

    def describe(self):
        """The part of the payload's `products` row that does not need a mask."""
        return {
            "id": self.product.id,
            "collection": self.product.collection,
            "native_resolution_m": self.product.native_resolution_m,
            "resampled": self.resampled,
        }


def fetch_set(polygon, ids=DEFAULT_IDS, buffer_m=None, progress=None):
    """
    Read every product over one buffered AOI, on a shared reference grid.

    The first id read defines the reference grid and the rest are compared
    against it; `resampled` records, per product, whether its own grid differs
    from that one. It is determined rather than assumed: cop90 always differs,
    and whether nasadem and alos happen to share Copernicus's pixel origin is a
    fact about the catalogue, not something to assert here.

    WHAT THIS DELIBERATELY DOES NOT DO. It leaves each array on its native grid.
    Upsampling a 90 m DEM to 30 m before running HAND would turn every cell into
    a 3 by 3 plateau, and the depression fill would then spend its epsilon
    breaking plateaus that are an artefact of the upsampling while D8 picked
    flow directions out of the tie-break rather than out of the terrain. The
    correct order is to run HAND on each product's own grid and align the
    resulting mask, which is what `align_mask` is for.
    """
    if buffer_m is None:
        buffer_m = recommended_buffer_m(polygon.bounds)

    reads = []
    reference = None
    for pid in ids:
        product = resolve(pid)
        array, transform, crs = fetch(polygon, pid, buffer_m, progress=progress)
        grid = Grid.of(array, transform, crs)
        if reference is None:
            reference = grid
        reads.append(
            ProductRead(
                product=product,
                array=array,
                grid=grid,
                reference=reference,
                resampled=not grids_match(grid, reference),
            )
        )
    return reads


def align_mask(mask, read):
    """
    Put a product's boolean mask on the reference grid, ready to be counted.

    Nearest neighbour leaves a 0/1 field exactly 0 or 1, so the threshold below
    only has to decide the cells that fell outside the source. Those are counted
    dry: the products are read over one buffered window and their snapped
    extents differ by less than a cell, so the affected cells are a sliver on
    the border of that window -- which the report never reaches, because the
    figures are taken inside the AOI polygon and the window extends past it by
    the whole buffer. The sliver was previously argued away as falling inside a
    discarded ring; the AOI mask is the stronger guarantee that replaced it.

    STILL UNCALLED. The action resamples each product onto the reference grid
    BEFORE running its terrain chain, so nothing aligns a finished mask. That
    order is a known defect -- measured, the two orders agree at IoU 0.73 to
    0.81 while the products themselves agree at 0.43 to 0.69, so the choice
    moves the answer as much as the terrain does. This function is what the
    correct order needs and is kept for it.
    """
    mask = np.asarray(mask, dtype=bool)
    if not read.resampled:
        return mask
    moved = resample_onto(mask.astype(np.float32), read.grid, read.reference)
    return np.nan_to_num(moved, nan=0.0) >= 0.5


def fetch_file(polygon, out_path, buffer_m: float = 0.0, progress=None) -> str:
    """
    A Copernicus DEM GLO-30 window written to a file, merged across every tile.

    The third of the three reads: `fetch` returns arrays over a buffered window
    and `fetch_set` returns one ProductRead per product, while this returns the
    path of a GeoTIFF, which is what the solar terrain chain consumes.

    Served as a COG from the same Planetary Computer catalogue Sentinel-2 comes
    from, so this needs no new imagery infrastructure.

    `buffer_m` widens the window so terrain outside the AOI can still cast onto
    pixels inside it. Without it, a ridge just beyond the boundary is invisible
    and the pixels it shades are reported as unshaded.

    TWO FAILURES THIS NO LONGER HAS. As solar.fetch_dem it read `items[0]`, so an AOI crossing a
    one-degree Copernicus tile boundary received terrain covering part of
    itself, plausible on screen and wrong in a direction nothing revealed. And
    it searched by the AOI rather than by the buffered window, so a tile
    intersecting only the buffer ring was never returned and the shading band
    the buffer exists to provide had a hole in exactly the place it mattered.
    Both were fixed by bringing it here, beside read_merged, which the flood
    envelope already required to get them right.

    Coverage is not required. Copernicus publishes no tile over the sea, so a
    coastal area has a legitimate gap; those cells arrive as NaN, the fraction
    is reported through `progress`, and the chain downstream already reads a
    cell with no elevation as ground a plant cannot stand on.
    """
    import rasterio
    from shapely.geometry import box

    bounds = buffer_bounds(polygon.bounds, buffer_m)
    items = stac.search(COLLECTIONS["cop30"].collection, intersects=box(*bounds))
    if not items:
        raise RuntimeError("no Copernicus DEM tile covers this AOI")

    array, transform, crs = read_merged(
        [item.assets["data"].href for item in items],
        bounds,
        progress=progress,
        require_coverage=False,
    )

    with rasterio.open(
        out_path,
        "w",
        driver="GTiff",
        height=array.shape[0],
        width=array.shape[1],
        count=1,
        dtype="float32",
        crs=crs,
        transform=transform,
        nodata=float("nan"),
        compress="lzw",
    ) as dst:
        dst.write(array, 1)
    return str(out_path)
