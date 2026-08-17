# Spectral response in TERRA: what exists, what to build, what is unresolved

Written to be handed to a session that has none of the preceding context. It
covers three pieces of work that share one foundation: exposing what the sensor
measured, per pixel and per class, and comparing it against outside references.

Everything below was measured on live imagery over a study AOI in Cascavel,
Parana (`-53.52,-24.92` to `-53.46,-24.87`), tiles T21JZN and T22JBT, which is
where the shipped models were fitted.

---

## 1. Foundation already in place

Commit `cbffa46` corrected the Sentinel-2 radiometric offset. Read it before
touching anything spectral, because every number below depends on it.

### The correction

L2A products from processing baseline 04.00 onward (25 January 2022) carry
`BOA_ADD_OFFSET = -1000`. Reflectance is `(DN + offset) / 10000`. The sidecar
divided by 10000 alone, so every band read 0.1 high. The Planetary Computer
does not harmonise this.

In `sidecar/infer.py`:

| Function | Use |
|---|---|
| `boa_add_offset(product)` | The offset for that product, from `s2:processing_baseline`, falling back to acquisition date. Zero for pre-04.00 scenes. |
| `to_reflectance(dn, product)` | Physically correct reflectance. Use for anything REPORTED as a quantity. |
| `as_trained(dn)` | `DN / 10000`, the convention the shipped models were fitted under. Model inputs only. |
| `load_reflectance_to_reference_grid(...)` | The band loader with the conversion applied. |

### The seam, and why it is not a compromise

`as_trained` exists because the shipped heads were fitted on 22 products
acquired 2024-05-04 to 2026-01-04, all after baseline 04.00, by a pipeline that
also divided by 10000. They learned a feature space where every band sits 0.1
high and are self-consistent inside it. Feeding them corrected reflectance
moves 56.8 per cent of pixels and turns 70.8 per cent soybean into 62.0 per
cent forest formation on cropland.

**Do not "finish the job" by routing model inputs through `to_reflectance`.**
That is not an oversight. The seam closes only when the heads are refitted on
corrected inputs, at which point `as_trained` is deleted rather than edited.

---

## 2. Build first: spectrum per class, inside the application

This is the highest-value item and the only one with no methodological caveat.

**What it is.** For a completed run, the mean reflectance per band for each
predicted class, with its spread across the AOI. Seven points per class.

**Why it is worth building.** The application already reads seven bands per
date and never surfaces them. More importantly it connects to the domain-shift
diagnostics that already exist: those report MMD, KL and a change-vector
magnitude, which say *that* a distribution moved without saying *where*. A
per-class spectrum says which band moved and in which direction, which is the
interpretable half the diagnostics are missing.

**Where the data is.** `build_feature_matrix` in `sidecar/infer.py` already
loads B02, B03, B04, B08 per date, and the classify path also loads B8A, B11,
B12. The per-band values exist inside the feature vector and are discarded.

**Reference implementation.** `experiments/spectral_response_and_offset.py`,
section 2, computes exactly this and writes `class_spectra.csv` with
`class_id`, `class_name`, `band`, `wavelength_nm`, `convention`, `n_pixels`,
`mean`, `sd`, `p05`, `p95`.

**Use `to_reflectance` here**, not `as_trained`. This is a reported quantity.

**Name the classes.** The classifier emits MapBiomas codes `{3, 21, 25, 39,
41}`. `class_palette.py` exposes `CLASSIFIER_LEGEND` and `CLASSIFIER_COLORS`.
Never show a bare integer: 39 means nothing to a reader who has not memorised
that legend.

---

## 3. Build second: cross-reference against a spectral library

The machinery works and is proven. Its limits are real and must be stated in
any interface that exposes it.

### Required steps, in order

**Convolve, do not compare directly.** A library spectrum is hyperspectral;
Sentinel-2 has seven broad bands here, from 36 nm (B04) to 228 nm (B12) wide.

```
rho_band = integral(rho(l) S(l) dl) / integral(S(l) dl)
```

`S(l)` comes from the ESA spectral response functions:
`https://sentinels.copernicus.eu/documents/247904/685211/S2-SRF_COPE-GSEG-EOPG-TN-15-0007_3.1.xlsx`
Sheet `Spectral Responses (S2A)`, column `S2A_SR_AV_B2` for B02 (no leading
zero), `S2A_SR_AV_B8A`, `S2A_SR_AV_B11`.

**Verify the convolution.** A flat spectrum at `r` must return `r` in every
band, since the integral is normalised by the response's own area. The
reference implementation asserts this to 2.2e-16. Any weighting or units error
breaks it.

**Compare with a scale-invariant metric.** Spectral Angle Mapper: the angle
between the pixel vector and the reference. A material in shade differs from
the same material in sun by a multiplier, and the angle ignores that.

Both functions are about twenty lines each in
`experiments/spectral_response_and_offset.py`, sections 3 and 4. No new
dependency is required.

### The limit, which is not negotiable

Measured against 1,131 soybean leaf spectra:

| Class | Angle to soybean leaf (rad) |
|---|---|
| Agriculture-Pasture Mosaic | 0.093 |
| Other Temporary Crops | 0.170 |
| Forest Formation | 0.190 |
| **Soybean** | **0.239** |
| Non-vegetated Area | 0.337 |

Soybean is not closest to the soybean reference. This is not a classification
error. Library spectra are leaf level; a Sentinel-2 pixel is canopy, with soil
through the gaps and shadow between rows. Band by band, canopy over leaf:

| B02 | B03 | B04 | B08 | B8A | B11 | B12 |
|---|---|---|---|---|---|---|
| 0.80 | 0.53 | **1.70** | **0.49** | 0.53 | 0.73 | 0.92 |

The ratio is not constant. If it were, the difference would be brightness and
SAM would return zero. Soil raises the red while gaps and shadow lower the NIR,
in opposite directions, so the shape itself is distorted and normalisation does
not remove it.

**Consequence for any UI.** With seven broad bands and a leaf library, a small
angle means consistency, not identification. Do not label the output "material
identified". The figure at `docs/img/spectral/library_limit.png` makes this
argument in four panels.

---

## 4. Build third, and only if the second is wanted properly

Closing the leaf-to-canopy gap needs either canopy-level reference spectra, or
a radiative transfer model taking leaf reflectance to canopy given LAI, leaf
angle distribution and soil background. That is PROSAIL, PROSPECT plus SAIL.

Half of it already exists here. `sidecar/canopy_field.py` and
`sidecar/canopy_voxel.py` do Beer-Lambert over leaf-area density, and
`sidecar/helios_grow.py` grows species architecture. What is missing is the
optical half: propagating leaf reflectance through the simulated canopy. With
that, the simulation would predict the spectrum Sentinel-2 should see for a
given AOI at a given age and LAI, and the comparison against the real pixel
becomes a validation rather than an approximation.

---

## 5. Libraries

### Spectral libraries

| Source | Access | Content |
|---|---|---|
| **EcoSIS** (`ecosis.org`) | Open HTTP API, no key. `GET /api/package/search?text=...` then `GET /api/package/{id}/export?metadata=true` returns CSV with wavelength columns. | Vegetation focused, including crops. Used here: package `cdbb6b09-b481-4022-a0da-ad95a8b085d8`, 1,131 soybean spectra, 350-2500 nm. |
| **ECOSTRESS** (`speclib.jpl.nasa.gov`) | No working bulk endpoint found; browse and download by hand. | ~3,400 spectra: vegetation, soils, man-made. Successor to the ASTER library. |
| **USGS splib07** | Direct download. | Minerals mainly, some vegetation. |

Two cautions. EcoSIS packages may serve reflectance as a percentage; check
whether the NIR plateau reads 0.45 or 45 and divide accordingly. And most of
these are leaf or sample level, which is the limit described in section 3.

**Do not commit downloaded library data.** It is third-party material and it is
large: the EcoSIS soybean package alone is 28 MB. The repository `.gitignore`
already excludes it and the ESA workbook, along with `experiments/figures`,
where a single 600 dpi TIFF runs to 39 MB.

### Software dependencies

Already installed in `.venv`, used only by the experiments:

```
ipykernel  matplotlib  scienceplots  openpyxl  jupytext
```

`openpyxl` is the only one strictly required, to read the ESA workbook. The
convolution and SAM need nothing beyond numpy.

If the analysis moves into the sidecar, it adds **no new runtime dependency**:
numpy and pandas are already there. The ESA response functions would need to be
either vendored (~860 KB xlsx, or a much smaller derived CSV) or fetched once
and cached, the way `cached_power_series` caches NASA POWER.

R, for figures only, per project convention: Python computes and exports CSV, R
draws.

```
ggplot2  patchwork  svglite  ragg  dplyr  readr  scales
```

Figures follow the `nature-figure` skill: 183 mm width, 5 pt glyph floor,
Arial declared and checked with `stopifnot`, SVG plus PDF plus TIFF at 600 dpi,
and a PNG for the web. Scripts: `experiments/plot_spectral.R` and
`experiments/plot_library_limit.R`.

**MapBiomas colours need darkening for line plots.** They are made to fill map
polygons; against white the pale ones measure 1.12:1 and 1.73:1, which no line
can be followed at. Both R scripts carry `darken_to_contrast`, which walks each
hue down until it clears 3:1 while remaining recognisable.

---

## 6. Unresolved, and not for an implementation session to decide

**Refitting the heads.** Until the models are refitted on offset-corrected
inputs, `as_trained` stays and the application reports indices on one
convention while the classifier consumes another. Both are documented; neither
is silent. Whether to refit is a research decision.

**Published index values.** The SBrT protocol was developed in the uncorrected
space. Classification metrics survive, because the transform is the same
constant across every band and sample, so the learned boundaries are valid in
that space. Absolute NDVI, EVI and SAVI values do not survive, and neither does
anything inverted from them, including LAI. This needs to be raised with the
supervising faculty before anything is republished.

**Classification confidence is low independent of all this.** Mean 0.409 over
the test AOI, with no pixel above 0.7. The AOI returned 12 scenes against the
22 dates the model expects, and the remainder is zero-padded. Worth
investigating separately; it is not caused by the offset.

---

## 7. Reproducing

```bash
.venv/bin/python experiments/spectral_response_and_offset.py   # computes, writes CSV
Rscript experiments/plot_spectral.R                            # offset evidence
Rscript experiments/plot_library_limit.R                       # the library limit
```

The Python script imports the sidecar's own loaders rather than reimplementing
them, so what it measures is the path the application takes. It writes CSV only;
plotting is R. Both are network-dependent: STAC queries, the ESA workbook and
the EcoSIS package are fetched on first run and cached beside the scripts.

Verification that should hold after any change here: `pytest sidecar/tests -q`
passes 362, and the class shares over the Cascavel AOI are unchanged unless the
heads were deliberately refitted.
