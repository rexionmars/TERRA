---
title: 'TERRA: Desktop land-cover classification from Sentinel-2 time series'
tags:
  - remote sensing
  - land cover
  - Sentinel-2
  - MapBiomas
  - random forest
  - desktop application
  - Python
  - Go
authors:
  - name: João Leonardi da Silva Melo
    orcid: 0009-0009-2715-3211
    corresponding: true
    affiliation: '1'
affiliations:
  - index: 1
    name: iCEV Instituto de Ensino Superior, Teresina, PI, Brazil
date: 31 July 2026
bibliography: paper.bib
---

# Summary

TERRA is an open-source desktop application for agricultural land-cover
classification from Sentinel-2 Level-2A time series. A researcher draws or
imports an area of interest (AOI), chooses an acquisition period and cloud
threshold, runs a classifier, and inspects prediction and confidence overlays,
vegetation-index / phenology summaries, optional MapBiomas reference layers,
and side-by-side comparison of saved runs.

Imagery is read on demand from the Microsoft Planetary Computer STAC catalog
as Cloud-Optimized GeoTIFFs: only the polygon window and required bands are
fetched, so full Sentinel-2 product downloads are unnecessary [@planetarycomputer;
@drusch2012sentinel]. The default spectro-temporal Random Forest path
reproduces the method reported for western Paraná cropland monitoring
[@melo2026sbrt]. Optional Temporal Transformer and Prithvi-EO 2.0 embedding
heads support comparative model studies [@szwarcman2024prithvi].

# Statement of need

Farm- and parcel-scale land-cover work often sits between two extremes:
scripted cloud notebooks (for example Google Earth Engine) that are powerful
but hard to hand to collaborators who want a map UI, and general desktop GIS
tools that do not ship a published spectro-temporal pipeline with run history
and model comparison. Full scene downloads remain heavy when only a small
polygon matters. Comparing classical Random Forests with transformer or
foundation-model embeddings usually means separate scripts and ad-hoc overlays.

TERRA targets remote-sensing and agronomy researchers (and students) who need
**reproducible, AOI-scale classification** on a local machine: clip COGs on
demand, run a documented spectral Random Forest (and optional deep models),
inspect confidence / phenology / MapBiomas context for Brazilian AOIs, and save
or compare analyses — without operating a hosted app backend.

# State of the field

Related ecosystems include cloud platforms and Python GIS stacks (Google Earth
Engine and helpers such as `geemap`; openEO; notebook-centric COG/STAC
workflows) and general desktop GIS (for example QGIS) or ESA SNAP for
Sentinel processing [@gorelick2017gee; @wu2019geemap; @qgis]. Those tools are
excellent for interactive analysis and large-area production, but they do not
package TERRA’s specific research workflow: an offline-first desktop shell
around a fixed spectro-temporal feature set and trained artifacts, MapBiomas
Collection–aligned reference inspection, phenology summaries, and a compare
view for two saved runs.

Building a dedicated application, rather than only contributing notebooks,
makes the SBrT reference method operable by non-programmers while keeping the
inference code in Python for scientific continuity. Foundation-model options
(Prithvi-EO) are exposed as alternate heads for ablation-style comparison, not
as a replacement for the published spectral baseline [@szwarcman2024prithvi;
@melo2026sbrt].

# Software design

TERRA uses a three-layer desktop architecture:

1. A **React + Leaflet** map UI in a native WebView for AOI editing, scene
   preview, analysis, and compare.
2. A **Wails / Go** shell that owns window lifecycle, progress events, optional
   local SQLite persistence, and process supervision.
3. A **Python sidecar** that performs STAC queries, COG windowing
   (`rasterio` / GDAL `/vsicurl`), feature or embedding construction,
   classification, and PNG/GeoTIFF export, communicating over JSON on
   standard I/O.

This split keeps the published sklearn/rasterio stack intact while giving a
native UI and installable releases. Design trade-offs include: distribution
still depends on Python (mitigated by FULL release bundles that embed
python-build-standalone for the spectral path); online access is required for
STAC (and optionally Hugging Face for Prithvi); and large AOIs or Prithvi
pixel mode can be slow. LITE/FULL packaging and SemVer release policy are
documented for reproducible installs without forcing torch into the default
bundle.

# Research impact statement

The spectral Random Forest path implements the spectro-temporal method and
study areas described in the SBrT 2026 conference paper, which reports spatial
block cross-validation agreement with MapBiomas (overall accuracy 0.7625,
Cohen’s $\kappa$ 0.6195) and temporal coherence checks against landowner crop
calendars on three western Paraná properties [@melo2026sbrt]. TERRA turns that
pipeline into a distributable research tool: tagged GitHub releases (LITE and
FULL installers for macOS, Windows, and Linux), user and architecture
documentation, a public wiki, offline automated tests (Go store/sidecar path
checks and pytest coverage of vegetation indices, phenology, LULC helpers, and
Random Forest smoke tests), and continuous integration on `main`.

Near-term significance is therefore concrete for method reproduction,
classroom or lab demos of AOI-scale Sentinel-2 classification, and controlled
comparison of classical versus foundation-model heads on the same polygon and
date stack. Broader external adoption metrics should be updated as the public
repository and citation record mature; this manuscript is prepared ahead of
JOSS submission so that software citation and archival (for example Zenodo DOI
on acceptance) can accompany the next suitable release after repository-age and
review criteria are met.

# AI usage disclosure

Generative AI coding assistants (including Cursor) were used to help implement
features, tests, packaging scripts, and documentation, and to draft portions of
this paper. All AI-assisted code and text were reviewed, edited, and verified
by the author against the repository behavior, offline tests, and the SBrT
reference method. Scientific claims about classification performance are taken
from the cited conference paper and were not generated as unverified results by
AI.

# Acknowledgements

We thank Dimmy Karson Soares Magalhães, Javier Ernesto Kolodziej, and Eduardo
Vinícius Kuhn for collaboration on the spectro-temporal classification method
described in [@melo2026sbrt]. Sentinel-2 data are provided through the
Copernicus programme and accessed via the Microsoft Planetary Computer.
MapBiomas products are used as reference context where available. No dedicated
grant number is claimed for the TERRA desktop software at the time of writing.

# References
