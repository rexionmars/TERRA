# Solar analysis handoff — implementation brief

Brief for adding solar resource and photovoltaic siting analysis to TERRA. The
research is complete and externally validated; what follows is the port.

Companion to [TIER1_HANDOFF.md](TIER1_HANDOFF.md), which covers the Sentinel-2
derived capabilities. This document is independent of it: the two can be built in
either order.

Source of truth for the surfaces described here: [`app.go`](../app.go),
[`backend/types.go`](../backend/types.go), [`backend/sidecar.go`](../backend/sidecar.go),
[`sidecar/infer.py`](../sidecar/infer.py). See also [ARCHITECTURE.md](ARCHITECTURE.md)
and [API.md](API.md).

---

## 1. Why this is architecturally different

Every analysis TERRA performs today starts from a Sentinel-2 scene stack. Solar
does not. It is a parallel axis with three consequences that are product
advantages, not caveats:

- **It never fails on scene availability.** No usable scenes, permanent cloud, or
  an AOI outside the archive are not failure modes here. Any AOI on Earth returns
  an answer.
- **The fixed-legend limitation does not apply.** The crop models emit only
  `{3, 21, 25, 39, 41}` and are semantically wrong outside western Parana
  (see the Limitations section of the README). Solar is physics with no trained
  head, so there is no domain to shift out of.
- **It is fast.** A complete analysis runs in well under a minute (section 6),
  against minutes for a classification run.

It therefore belongs as its own action alongside `predict` and `lulc`, not as an
extension of either.

## 2. Research source

Reference implementation: `mestrado/experiments/solar_resource/` in the research
repository, with `report.md` documenting method, results and limitations.

| Module | Role |
|--------|------|
| `power_api.py` | NASA POWER client, caching, grid-redundancy test |
| `solar_model.py` | Solar geometry, clear-sky indices, Perez transposition, PVWatts |
| `solar_terrain_map.py` | Terrain from DEM, POA lookup, horizon shading, suitability |
| `sentinel_crosscheck.py` | Scene cloud cover against the clear-sky index |
| `benchmark_gsa.py` | Comparison against the Global Solar Atlas |

### Validation status

Two independent checks, both in `report.md`:

| Check | Result |
|-------|--------|
| Clear-sky index against Sentinel-2 scene cloud cover | Spearman rho = -0.850, n = 134 |
| GHI against Global Solar Atlas (Solargis) | within 1.8% to 2.6% |
| Optimum tilt against Global Solar Atlas | identical (25 degrees) |
| Specific yield against Global Solar Atlas | **high by 2.8% to 6.7%** |

The first validates temporal behaviour, the second the absolute level. The yield
discrepancy is understood and must be corrected before shipping — see section 7.

## 3. New dependencies

Only one new external service, and it needs no key.

| Dependency | Status |
|------------|--------|
| NASA POWER REST API | **New.** `https://power.larc.nasa.gov/api/temporal/{daily,hourly}/point`. No authentication, no quota published. |
| Copernicus DEM GLO-30 | **Already available.** Collection `cop-dem-glo-30` in the Planetary Computer STAC catalog TERRA already queries, served as a COG `data` asset. Verified: one item covers a study-area AOI, `gsd: 30`. |
| MapBiomas | **Already in app** via `sidecar/lulc.py`. |
| `pvlib` | **New Python package.** Pure Python, 19 MB wheel, depends only on numpy/pandas/scipy/requests which are already present. Add to `requirements.txt`, not to `requirements-prithvi.txt`: this is a light dependency and must not sit behind the torch install. |

The DEM point matters: terrain analysis needs no new imagery infrastructure. It
uses the same `/vsicurl` COG path as Sentinel-2.

## 4. Features to port

### 4.1 Solar resource card (start here)

**Source:** `power_api.py`, `solar_model.py`, `run_solar_analysis.py`.
**Target:** new `sidecar/solar.py`, `action: 'solar_resource'`.

Point analysis at the AOI centroid: 30-year monthly climatology of GHI, DNI and
DHI; interannual variability with trend; clear-sky index; optimum tilt and
azimuth; photovoltaic specific yield.

```jsonc
// request
{
  "action": "solar_resource",
  "polygon_geojson": { },
  "climatology_years": 30,
  "hourly_years": 10,
  "surface_azimuth": 0,      // 0 = north; the southern-hemisphere default
  "performance_ratio": null, // null = model it; a number overrides (section 7)
  "work_dir": "/tmp/geosense-solar-xxxx"
}

// response
{
  "solar": {
    "resource": {
      "ghi_annual_kwh_m2": 1772, "ghi_std": 61, "ghi_cv_pct": 3.4,
      "ghi_p10": 1695, "ghi_p90": 1849, "n_years": 30,
      "trend_per_year": 0.83, "trend_p_value": 0.531,
      "monthly": [{"month": 1, "ghi": 6.37, "dni": 4.97, "dhi": 2.71, "kt": 0.540}]
    },
    "geometry": {
      "optimal_tilt_deg": 25.0, "optimal_poa_kwh_m2_year": 1883,
      "gain_over_horizontal_pct": 8.1,
      "tilt_tolerance": [{"deviation_deg": 10, "loss_pct": 1.23}]
    },
    "pv": {
      "specific_yield_kwh_kwp_year": 1553, "performance_ratio": 0.80,
      "capacity_factor_pct": 17.7, "monthly_yield": [ ]
    },
    "grid_note": "radiation resolved at 1 degree; the AOI is not resolved internally"
  }
}
```

**Mandatory in the response:** the resolution note. The radiation product resolves
a single 1 degree cell, so every point inside an AOI returns the same value. A
user who sees a per-AOI number without that note will assume it is local.

**Acceptance:** for the study-area AOIs, GHI within 3% of 1772 kWh m-2 year-1 and
optimum tilt of 25 degrees (`mestrado/experiments/solar_resource/report.md`,
sections 5 to 7).

### 4.2 Terrain-resolved irradiation overlay

**Source:** `solar_terrain_map.py` (`load_terrain`, `horn_slope_aspect`,
`build_poa_lookup`, `interpolate_poa`, `horizon_angles`, `shading_loss_fraction`).
**Target:** `sidecar/solar.py`, `action: 'solar_terrain'`.

The atmospheric resource has no spatial structure at AOI scale, but the
irradiation reaching an inclined surface does, because the surface is terrain.
This is the mappable quantity.

Pipeline: fetch the DEM tile from `cop-dem-glo-30`, reproject onto the AOI grid,
derive slope and aspect by Horn (1981), build the POA lookup table over
(slope, aspect), interpolate onto pixels, apply horizon shading.

Delivered as a PNG data URI positioned by `ImageOverlay`, matching the existing
classification overlay path, plus a GeoTIFF for export.

**Acceptance:** annual POA between roughly 1300 and 1880 kWh m-2 year-1 over the
study areas, with spatial standard deviation of 3% to 4% (report section 10).

### 4.3 Seasonal maps and anisotropy

**Source:** `solar_terrain_map.py` (`SEASONS`, `season_mask`), `run_seasonal_maps.py`.
**Target:** a `season` parameter on `solar_terrain`.

The annual map averages a geometry that reverses within the year. North minus
south irradiation at 25 degrees of slope:

| Season | Contrast |
|--------|---------:|
| Annual | +35.4% |
| Winter crop cycle (May-Sep) | +105.4% |
| Winter (Jun-Aug) | **+132.4%** |
| Summer (Dec-Feb) | **-1.9%** |

The spatial standard deviation of the map is 0.8% in summer and 8.2% in winter.
Shipping only the annual map hides that entirely.

The anisotropy raster (winter divided by summer, 0.33 to 0.83 over the study
areas) carries the seasonal information in a single layer and is the better
default for a map view that has room for one.

### 4.4 Photovoltaic siting map

**Source:** `solar_terrain_map.py` (`suitability_map`, `SUITABILITY_LEGEND`).
**Target:** `action: 'solar_siting'`.

Five classes from slope limits and MapBiomas land-cover eligibility. Structurally
identical to the classification raster TERRA already renders, so it reuses the
overlay, legend and export paths.

```
0  Excluded - protected or occupied cover   (MapBiomas 3, 9, 24, 33, 46, 47, 48)
1  Excluded - slope above 15 degrees
2  Restrictive - slope 10 to 15 degrees
3  Suitable - conflicts with annual cropping (MapBiomas 20, 39, 40, 41, 62)
4  Suitable - no land-use conflict
```

**Two requirements, both non-negotiable.**

Cropland stays its own class and is **never summed into the suitable area**. Over
the three study areas that distinction is 280 ha against 1740 ha — a pixel that is
geometrically fine but currently produces soybean carries a trade-off a binary map
would hide.

The slope thresholds and the excluded-cover list are **project conventions, not
verified legal restrictions**. They must be user-editable in the UI, and the
response must carry the values used. Legal reserve, permanent preservation areas
and municipal zoning require the CAR and local legislation, which this analysis
does not consult.

## 5. Suggested order

1. **4.1 resource card** — no raster work, exercises the new data source alone.
2. **4.2 terrain overlay** — adds the DEM path; reuses the existing overlay machinery.
3. **4.3 seasonal** — a parameter on 4.2 once it works.
4. **4.4 siting** — needs 4.2 plus the MapBiomas path that already exists.

## 6. Performance budget

Measured on the research hardware (Apple Silicon, `.venv` of the research repo):

| Step | Cost |
|------|------|
| POWER daily, 30 years | seconds |
| POWER hourly, 10 years | ~23 s (2.3 s per year) |
| Perez transposition, 87 672 hours | 0.13 s |
| POA lookup, research settings (10 y, 1/10 degree, 1116 pairs) | 54 s |
| **POA lookup, product settings (10 y, 3/20 degree, 198 pairs)** | **5.0 s** |
| DEM reprojection and Horn slope/aspect | sub-second |
| Horizon model, 16 azimuths | sub-second |

**Coarsen the grid, keep the period.** Error against the research configuration,
over 5000 random (slope, aspect) samples:

| Configuration | Mean error | Max error |
|---------------|-----------:|----------:|
| 10 years, 3/20 degree | **0.04%** | 0.31% |
| 10 years, 2/15 degree | 0.02% | 0.15% |
| 5 years, 3/20 degree | 0.56% | 1.06% |
| 3 years, 3/20 degree | 2.86% | 3.41% |

Coarsening the lookup grid is nearly free; shortening the period is what costs
accuracy, and it barely saves time because the POWER fetch dominates. Ship
10 years with the coarse grid.

Cache the POWER series per rounded coordinate: the radiation grid is 1 degree, so
neighbouring AOIs return byte-identical series and a cache keyed on the grid cell
serves them all.

## 7. Calibration requirement

**Do not ship the yield model as it stands.**

Against the Global Solar Atlas, the specific yield computed here is high by 2.8%
to 6.7%, and the discrepancy sits entirely in the performance ratio: 0.877 against
0.798. The research model omits soiling, inter-row shading, degradation,
availability and cabling losses, which the reference includes.

Two acceptable resolutions:

1. Expose `performance_ratio` as a request parameter, defaulting to a reference
   value near 0.80, and report which was used.
2. Add the missing loss terms explicitly and let the modelled PR fall to the
   reference range.

Option 1 is smaller and honest as long as the response states the assumption.
Option 2 is better if the app is meant to support system design rather than
screening. Either way the response must carry the PR, so a user can see what
produced the number.

Reference: `benchmark_gsa.py` and section 9.1 of the research report.

## 8. What stays in research

| Item | Reason |
|------|--------|
| Class-41 terrain association | A hypothesis test, not a feature. Result was negative: terrain orientation does not explain the crop subgroups. See research report section 12. |
| Sentinel-2 cloud cross-check | A validation of the data product, not a user capability. Could become a quality indicator later. |
| Wind-driven module temperature | The MERRA-2 2 m wind field is implausible at one of the three study sites (97.3% of hours below 0.5 m/s). Until wind comes from another source, prefer a fixed reference wind. |
| Fine-resolution resource | Would require geostationary retrieval at ~2 km or the Atlas Brasileiro de Energia Solar. The Global Solar Atlas shows the real spread between the three study sites is 0.82%, so this is low priority. |
| Single-axis tracking | Not evaluated; would change the result appreciably at this DNI level. |

## 9. Project constraints

- [CONTRIBUTING.md](../CONTRIBUTING.md) and [RELEASING.md](RELEASING.md):
  SemVer, small reviewable pull requests.
- No emoji in code, comments, logs, plots or UI strings.
- Descriptive, non-promotional naming.
- The repository-level `.claude/CLAUDE.md` style rules apply to TERRA as well.
- Every response that reports a solar figure must also report the assumption that
  produced it: the performance ratio, the tilt, and the resolution note of 4.1.
