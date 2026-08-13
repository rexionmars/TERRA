# Roadmap

Planned improvements and new capabilities for TERRA. Order is indicative, not a
commitment; items may move as research and user needs evolve.

Track progress and proposals via [GitHub Issues](https://github.com/rexionmars/TERRA/issues)
(label suggestions: `enhancement`, `packaging`, `analysis`).

## Shipped recently

Desktop product shell updates already on `main` (see gallery in the README):

- [x] **Projects** hub, map project switcher, AOI vs `run-*` naming
- [x] **Compositions** dock + **Overlay Tools** (visibility, swipe, opacity, export)
- [x] Dark Modern **Analysis** / **Compare** / **Settings** workspaces
- [x] **What’s New** modal after product version bumps
- [x] Dual **LITE / FULL** installer packaging workflow (tag a MINOR to publish)

## Near term (packaging & distribution)

- [ ] Cut a **MINOR** release (`v0.3.0`) that publishes LITE and FULL zip assets
      from the dual-installer workflow ([RELEASING.md](RELEASING.md)).
- [ ] macOS **FULL for Intel (x86_64)** in addition to Apple Silicon.
- [ ] Optional **DMG** (macOS) / clearer desktop installers — still secondary to
      zip; Gatekeeper **notarization** as a follow-up.
- [ ] Optional FULL variant (or documented path) that bundles **torch** for
      Temporal Transformer / Prithvi without a separate venv.
- [ ] Keep wiki Install/User guide in sync when install story changes.
- [ ] Publish the two long-form user manuals (general + academic/researcher).

## Product analysis (desktop)

Research-grade methods (change detection, crop diagnostics, topography-related
workflows, segmentation, and similar) advance in a **private research
repository** under literature review → implementation → tests, then export into
TERRA when ready. To discuss those themes, contact the emails listed in the
README research notice — not only GitHub Issues.

| Theme | Direction |
|-------|-----------|
| **Change detection** | Pairwise / multi-date spectral and NDVI change maps on the AOI (gain/loss of vegetation), with thresholds and export |
| **Domain-shift diagnostics** | **Shipped (v1):** KL / CVA / MMD / F1 between two runs from cached fingerprints (Analysis Compare + whiteboard). Adversarial adaptation remains research. |
| **Crop / canopy diagnostics** | Per-date answers on stress, phenological stage, water-stress proxies, and growth vs expected calendar — surfaced in Analysis |
| **Surface water / flood** | NDWI / MNDWI / AWEI-style masks and time series of water fraction over the AOI |
| **Richer LULC storytelling** | Deeper MapBiomas composition views (groups, diversity) already partially in-app; more export and compare hooks |
| **Phenology by class** | Class-conditional NDVI/EVI/SAVI profiles (e.g. soybean vs other temporary crops) alongside AOI-mean curves |
| **Temporal index explorer** | Interactive NDVI/EVI/SAVI timelines for custom AOIs (beyond the post-classify series) |

## Models & methods

- [ ] Clearer UX when torch / Prithvi deps are missing (guided install or disable).
- [ ] Additional heads or ablations (e.g. MLP on embeddings) once packaging and
      UX for heavy deps are solid.
- [ ] Spatial block validation summaries in Compare (agreement with MapBiomas
      reference when available).

## Platform & quality

- [ ] Stronger offline messaging when STAC/Nominatim are unreachable.
- [ ] Broader automated tests (sidecar smoke with fixtures; packaging dry-run in CI).
- [ ] Accessibility and i18n (PT/EN) for primary UI strings.
- [ ] Contributor-facing issue templates for bugs vs enhancements.

## Out of scope (for now)

- Cloud-hosted multi-user backend (TERRA stays local-first).
- Replacing Planetary Computer STAC as the default imagery source.

## How to contribute ideas

Open an issue describing the user problem, a sketch of the UI/flow, and whether
a research prototype already exists. Prefer small, reviewable PRs aligned with
[CONTRIBUTING.md](../CONTRIBUTING.md) and SemVer ([RELEASING.md](RELEASING.md)).
For research-method feature requests (crop change, segmentation, etc.), email
the contacts in the README instead of (or in addition to) opening an issue.
