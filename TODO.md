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

# TERRA product status and backlog

This file separates capabilities present in the application from work that is
still proposed. “Implemented” means the product path exists in the UI and/or
sidecar; it does not by itself mean that the method has been independently
validated for every region or use.

## Implemented

- **Land-cover classification:** spectro-temporal Random Forest by default,
  with optional Temporal Transformer and Prithvi paths. The classifiers emit
  MapBiomas classes `{3, 21, 25, 39, 41}`. Results include confidence and
  comparison with MapBiomas, including class-level and spatial diagnostics.
- **Surface water:** NDWI, MNDWI and AWEI_nsh masks and per-date water
  frequency summaries.
- **Field boundaries:** Sentinel-2 delineation; resulting fields can be used
  as areas for queued analyses.
- **Vegetation health and phenology:** NDVI/NDRE departures from previous
  seasons, vegetation-index time series, and seasonal dates.
- **Public-register overlap:** PRODES/DETER, IBAMA/ICMBio, indigenous lands,
  conservation units and CAR property boundaries, with source-read status.
- **Sentinel-1 radar:** VV/VH time series, water screening and canopy-loss
  signals.
- **Management zones:** per-field NDVI zones exported as GeoJSON.
- **Surface mineral map:** EMIT-based products and associated spectral
  diagnostics.
- **Analysis workspace:** projects, areas and runs; saved Studio boards and
  task-oriented workspaces; comparisons, domain-shift diagnostics, data
  tables, field-level compositor runs and PDF reports.

See [README.md](README.md) for the product descriptions and current
limitations. The application remains local-first and is intended for focused
research and analysis, not as a general-purpose GIS.

## Highest-priority gaps

These address the reliability and usability of results already produced.

- [ ] **Independent validation and error-adjusted area.** Add a reference
  sampling and labeling workflow, estimate class areas with confidence
  intervals, and report user's and producer's accuracy. Agreement with
  MapBiomas is not field validation. See Olofsson et al. (2014).
- [ ] **Regional evaluation of classification and confidence.** Test across
  independent areas, seasons and relevant land-cover contexts; document where
  the fixed legend and training domain do not support interpretation.
- [ ] **Field-boundary review and validation.** Measure performance on local
  fields and support manual correction, split and merge before downstream
  field-level analyses.
- [ ] **Reproducible exports.** Extend the research pack to include the
  accuracy and domain-shift results and a manifest of inputs, selected scenes,
  model/version, parameters and output geometry.
- [ ] **Task-based onboarding.** Make the first useful workflow discoverable
  without requiring users to know which Studio editors to assemble. Update
  the user guide to match the current Studio-first application.

## Research and product candidates

These are not implemented commitments; each method needs a stated use case,
validation data and acceptance criteria before being promoted into the product.

- [ ] **Field event detection:** identify abrupt time-series changes. A signal
  must not be presented as a cause such as frost, hail or harvest without
  independent event records. BFAST is one candidate method (Verbesselt et al.,
  2010).
- [ ] **User-labeled classifier adaptation:** train or calibrate for a local
  region only after a labeling workflow and spatially independent validation
  are defined.
- [ ] **Harmonized Landsat and Sentinel-2 (HLS):** investigate whether a denser
  time series materially improves seasonal products in cloudy regions.
- [ ] **Phenology by class and temporal index explorer:** add only where these
  readings answer a defined research question beyond the existing series and
  phenology products.
- [ ] **Yield-related analysis:** require matched harvest/yield-monitor data
  and local calibration. Do not describe an uncalibrated relative potential
  map as a yield estimate.
- [ ] **Change detection:** distinguish within-area change maps from the
  existing comparison of classified runs; define reference data and
  uncertainty before interpreting change as land-cover conversion.

## Interpretation limits to preserve

- The classifier legend is fixed and the models were fitted for western
  Paraná study areas; confidence is not accuracy.
- MapBiomas is a reference map, not field truth, and reported hectares are
  not adjusted for classification error.
- Field segmentation has not been validated on Paraná fields; adjacent fields
  can merge.
- Vegetation departures are not diagnoses of stress or its cause.
- Register overlap is a screening result, not a legal finding; APP and legal
  reserve geometries are not available from the current SICAR source.
- Radar canopy-loss thresholds are not calibrated against harvest records.
- Management zones describe canopy similarity, not its cause or a prescription.
- EMIT mineral products have 60 m pixels; band depth is not mineral abundance
  and no spectral unmixing is performed.

## References

- Olofsson, P. et al. (2014). Good practices for estimating area and
  assessing accuracy of land change. *Remote Sensing of Environment*, 148,
  42–57.
- Verbesselt, J. et al. (2010). Detecting trend and seasonal changes in
  satellite image time series. *Remote Sensing of Environment*, 114(1),
  106–115. These references inform candidate methods; they do not validate
  TERRA outputs.

