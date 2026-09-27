# TODO: product features

Candidate products for TERRA. Each item states what it delivers, what already
exists in the code to build on, and its complexity (low, medium or high). The
complexity estimates the technical scope, not a schedule.

What exists today: classification with per-pixel confidence, comparison with
MapBiomas, NDVI series with phenology (start, peak and end of season, computed
over a run's area), surface water, mineral map, field delineation, the job
queue (`internal/jobs`) and the single compositor graph for every field of an
area (`frontend/src/lib/fieldSets.ts`).

What is missing: Sentinel-1, Landsat or HLS, error-adjusted area, training on
user samples, management zones, socio-environmental checks and vegetation
anomaly. Only surface water computes an anomaly today.

## 1. Built on what exists (fields, jobs, single graph)

- [x] **Per-field table**
  - Delivers: one row per field (area by class, season dates, mean
    confidence), exportable to CSV.
  - Builds on: the per-field runs and the single compositor graph.
  - Complexity: low.
- [x] **Season dates per field**
  - Delivers: emergence, peak and senescence for each field, with an
    uncertainty window.
  - Builds on: `sidecar/terra/phenology.py`, which already runs in every
    field job. What is missing is gathering the results across fields and
    showing them.
  - Complexity: low to medium.
  - Limitation: NDVI marks emergence and senescence, not the sowing and
    harvest days. Sowing precedes emergence by several days and harvest
    follows senescence. With a 5-day revisit and cloud, the uncertainty is
    days to weeks, and the product has to show it.
- [x] **Vegetation health**
  - Delivers: NDVI/NDRE anomaly of each field against its own history and
    against neighbouring fields of the same crop, as a map and a score per
    field.
  - Builds on: the existing Sentinel-2 series and red-edge bands B05–B07. It
    would be a new job kind (`jobWork` in `app_jobs.go`, `JOB_KINDS` in
    `frontend/src/lib/jobs.ts`).
  - Complexity: medium.
  - Reference: both, chosen on the compositor's Vegetation health node
    (earlier seasons, computed by the sidecar; other fields of the set on a
    shared date, within one crop where a class map is linked).
- [x] **Management zones**
  - Delivers: 3 to 5 zones per field from several seasons of NDVI/EVI (fuzzy
    k-means; Fridgen et al., 2004), exportable to GeoJSON or shapefile for
    variable-rate application.
  - Builds on: the field polygons and the series.
  - Complexity: medium.
  - Implemented as the `zones` job kind (sidecar `terra/zones`) and the
    compositor's Management zones node, which chooses 3, 4 or 5 zones and
    exports every field's zones as one GeoJSON. NDVI only (per season, the
    90th percentile of clear dates); diagonal distance, not Mahalanobis, for
    the reason terra/zones/cluster.py gives. No shapefile: no writer is
    installed in the sidecar environment.
- [ ] **Field event alerts**
  - Delivers: abrupt drops in the series (hail, frost, lodging, early
    harvest), found by break detection (BFAST; Verbesselt et al., 2010).
  - Builds on: the per-field series. It can be part of vegetation health.
  - Complexity: medium.

## 2. Need new data or new screens

- [x] **Socio-environmental checks**
  - Delivers: overlap of each field, in hectares and with dates, with:
    - PRODES/DETER: deforestation after 2008 (Código Florestal) and after
      31 Dec 2020 (EUDR);
    - CAR/SICAR (APP and legal reserve);
    - IBAMA embargoes;
    - indigenous lands;
    - conservation units.
  - Missing: downloading the public layers per area (TerraBrasilis offers
    WFS) and the vector intersections.
  - Complexity: medium.
  - Implemented as the `overlap` job kind (sidecar `terra/overlap`) and the
    compositor's Socio-environmental overlap node; the Field table carries
    its columns. ICMBio embargoes are read beside IBAMA's. APP and legal
    reserve are not: SICAR publishes only the property boundary by WFS.
- [ ] **Error-adjusted area**
  - Delivers: area of each class with a 95% confidence interval, plus user's
    and producer's accuracy (Olofsson et al., 2014).
  - Missing: a stratified random sample, a screen to label each point over
    the imagery, and the estimator. Today the method is only cited
    (`sidecar/terra/landcover/mapbiomas.py`), not computed.
  - Complexity: medium to high.
- [ ] **Training on user samples**
  - Delivers: a classifier fitted to the region, using labelled fields
    ("soybean", "maize") as training samples.
  - Missing: a labelling screen, and retraining the Random Forest or a layer
    over Prithvi. Prithvi is used frozen today.
  - Complexity: medium for the Random Forest, high for the network.

## 3. New imagery sources

- [x] **Sentinel-1 (radar)**
  - Delivers: a series that does not depend on cloud (VV/VH). It serves the
    season cycle in the summer crop, harvest detection by the drop in VH, and
    water mapping under cloud.
  - Builds on: the Planetary Computer serves the RTC collection through the
    same STAC as Sentinel-2.
  - Complexity: high (speckle, terrain, new sidecar slice).
  - Implemented as the `radar` job kind (sidecar `terra/radar`) and the
    compositor's Radar series node; the Field table carries its columns.
    Canopy losses are every VH drop of 3 dB the cross ratio follows by 1 dB,
    not the largest drop alone, since a period across two crops holds two
    harvests. Thresholds are not calibrated against harvest records.
- [ ] **HLS (Landsat + Sentinel-2)**
  - Delivers: a 2 to 3 day revisit, which improves season dates and health in
    cloudy regions.
  - Builds on: the data is at NASA, and the Earthdata token already exists
    because of EMIT.
  - Complexity: medium.
- [ ] **Yield**
  - Delivers: reliable only when calibrated with the user's harvest data
    (yield monitor). Without that data, only a relative potential map is
    possible.
  - Complexity: high, and depends on data.

## Suggested order

1. Per-field table with CSV export: it closes the field → jobs → results flow
   at the lowest cost.
2. Vegetation health as a job kind: the queue and the single graph are ready
   for it.
3. Socio-environmental checks: relevant to rural credit, the soy moratorium
   and the EUDR, and they depend on no model.
4. Error-adjusted area: it gives a statistical basis to the areas TERRA
   reports.

## References

- Fridgen, J. J. et al. (2004). Management Zone Analyst (MZA): software for
  subfield management zone delineation. *Agronomy Journal*, 96(1), 100–108.
- Olofsson, P. et al. (2014). Good practices for estimating area and
  assessing accuracy of land change. *Remote Sensing of Environment*, 148,
  42–57.
- Verbesselt, J. et al. (2010). Detecting trend and seasonal changes in
  satellite image time series. *Remote Sensing of Environment*, 114(1),
  106–115.
