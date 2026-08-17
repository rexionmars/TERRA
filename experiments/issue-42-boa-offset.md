# Sentinel-2 BOA_ADD_OFFSET is not applied: reflectance is inflated by 0.1 for every acquisition since baseline 04.00

## Summary

The sidecar converts Sentinel-2 L2A digital numbers to reflectance with `DN / 10000` and never applies `BOA_ADD_OFFSET`. Since processing baseline 04.00 (25 January 2022) L2A products carry a band-dependent offset of `-1000`, so the correct conversion is `(DN + BOA_ADD_OFFSET) / QUANTIFICATION_VALUE`, that is `(DN - 1000) / 10000`.

Every acquisition from 2022 onward is therefore read with reflectance inflated by roughly 0.1 in every band. The Microsoft Planetary Computer does not harmonise this: its `sentinel-2-l2a` items expose no `raster:bands` scale or offset, and microsoft/PlanetaryComputer#134, which asks for automatic harmonisation as Earth Engine and Sentinel Hub do, has been open since November 2022.

## Measured

One scene over a study AOI in Cascavel, Paraná, 336,535 valid pixels, `s2:processing_baseline` above 04.00:

| Band | DN median | `DN / 10000` | `(DN - 1000) / 10000` |
|------|-----------|--------------|------------------------|
| B02 | 1427 | 0.143 | 0.043 |
| B03 | 1631 | 0.163 | 0.063 |
| B04 | 1718 | 0.172 | 0.072 |
| B08 | 3338 | 0.334 | 0.234 |
| B8A | 3539 | 0.354 | 0.254 |
| B11 | 3114 | 0.311 | 0.211 |
| B12 | 2438 | 0.244 | 0.144 |

A blue reflectance of 0.143 over cropland is not physically attainable.

## Why a normalised index makes it worse

Adding a constant `c` to both bands leaves the numerator of NDVI unchanged and inflates the denominator by `2c`, so the compression is worst exactly where the signal matters:

```
NDVI = (NIR - Red) / (NIR + Red + 2c)
```

On the scene above, median NDVI moves from 0.315 to 0.525 and the 95th percentile from 0.562 to 0.881. A p95 of 0.56 in February in western Paraná, at peak soybean, is not reachable; 0.88 is what a closed canopy gives.

## The clearest evidence

Running the shipped Random Forest over the AOI and taking the mean spectrum of each predicted class, class 3, Forest Formation, reads:

| Convention | B02 | B04 | B08 | B12 |
|------------|-----|-----|-----|-----|
| `DN / 10000` | 0.123 | 0.123 | 0.418 | 0.172 |
| offset applied | 0.023 | 0.023 | 0.318 | 0.072 |

The corrected row is the textbook signature of dense vegetation: blue and red near zero from chlorophyll absorption, a step into the NIR, low SWIR from leaf water. The uncorrected row describes no vegetation that exists. The classes come from the project's own model, not from an independent segmentation.

## What is affected

`grep -n "/ 10000" sidecar/*.py` returns 22 reflectance conversion sites (excluding `infer.py:882`, which computes hectares). Downstream:

- NDVI, EVI and SAVI, hence the 22 raw NDVI dates and the temporal descriptors inside the 80-feature vector
- Phenology, since SOS, POS and EOS are thresholds on an NDVI curve that is compressed
- `lai_ndvi.py`, which inverts Beer-Lambert on NDVI, and therefore plant age, the growth in `helios_grow.py`, and the intercepted light the canopy reports
- The water indices, all three of which are normalised differences
- The four statistics per raw band in the feature matrix
- `render_composite`, where the stretch operates on inflated values

## Two things to settle before fixing

**What did training use.** `sidecar/train_prithvi.py:53` also divides by 10000. If the shipped classifiers were fitted on data read the same way, the classification may be internally consistent while every absolute quantity above is wrong, and correcting inference alone would introduce a train/serve mismatch. If training used pre-2022 imagery or a harmonised source, the mismatch exists today. This needs checking against the SBrT 2026 protocol before any change lands.

**The clip.** `infer.py:764` and `:917` apply `np.clip(arr / 10000.0, 0, 1)`. Applying the offset makes genuinely dark surfaces negative, which is precisely the information the offset was introduced to preserve, so clipping at zero after the correction would discard it. The clip bound has to be reconsidered together with the conversion.

## Reproducing

`experiments/spectral_response_and_offset.py` measures all of the above against live imagery, using the sidecar's own loaders rather than a reimplementation, and writes the per-class spectra and the figures. It also downloads the ESA spectral response functions and verifies the convolution against a flat spectrum.

## Suggested shape of the fix

Read the offset from the product rather than hardcoding it, defaulting to 0 for pre-04.00 acquisitions, and route every conversion through one function so the constant has a single home. Bear in mind the correction changes every number the application has ever reported for imagery after January 2022, so it warrants its own commit and a note in the release notes.

