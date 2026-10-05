# Roadmap

This roadmap describes work that is still open. The application already ships
the Studio, compositor, land-cover comparison and domain-shift diagnostics,
water, field delineation, vegetation health, public-register overlap,
Sentinel-1, management zones, EMIT mineral products and PDF reports. See
[README.md](../README.md) for the delivered products and their interpretation
limits, and [TODO.md](../TODO.md) for the product inventory and research
backlog.

Order below is a product priority, not a delivery schedule. Track implementation
and proposals through [GitHub Issues](https://github.com/rexionmars/TERRA/issues)
(`enhancement`, `packaging`, `analysis`).

## Product priorities

### 1. Make existing results more trustworthy

- [ ] Add reference sampling and labeling, error-adjusted class-area estimates
      with confidence intervals, and user's and producer's accuracy.
- [ ] Evaluate land-cover and confidence outputs on independent areas and
      seasons; make the supported geography and fixed legend explicit in the
      result workflow.
- [ ] Validate field delineation on local fields and allow review, split and
      merge before running field-level products.
- [ ] Preserve the limitations of health, radar, zones and register overlap
      next to their results so screening indicators are not mistaken for
      diagnoses, causes or legal findings.

### 2. Make the research workflow easier to enter and reproduce

- [ ] Update the user guide to the current Studio-first workflow, including
      project/area/run setup, task workspaces, compositor and reports.
- [ ] Provide a task-based first-use path for a complete area-to-report
      workflow, without requiring users to assemble editors before they know
      what each one answers.
- [ ] Extend exports with accuracy and domain-shift outputs and a manifest of
      selected scenes, model/version, parameters, geometry and data sources.
- [ ] Publish the general and academic/researcher manuals after the short guide
      matches the shipped interface.

### 3. Advance methods only with a validation plan

Methods are prototyped and evaluated in research work before becoming product
claims. Current candidates include:

- [ ] Field event detection from time series, validated against event records.
- [ ] User-labeled classifier adaptation with spatially independent validation.
- [ ] HLS imagery where denser observations demonstrably improve seasonal
      products.
- [ ] Within-area change detection, distinct from comparing classified runs.
- [ ] Class-conditional phenology and a temporal index explorer where they
      answer a defined research question.
- [ ] Yield-related estimates only with matched, locally calibrated harvest
      data.

## Distribution and quality

- [ ] macOS FULL build for Intel (x86_64); current FULL guidance targets Apple
      Silicon, while LITE is available for Intel Macs.
- [ ] Evaluate DMG packaging and macOS notarization; zip remains the current
      release format.
- [ ] Improve offline and recovery messaging when STAC or geocoding services
      are unavailable.
- [ ] Add sidecar integration fixtures and a release packaging dry run in CI.
- [ ] Improve accessibility and PT/EN localization for primary workflows.
- [ ] Add contributor issue templates for bugs, packaging and product proposals.

Optional dependencies are already managed from Settings: users can install or
remove torch and the field-segmentation package without rebuilding the base
environment. The FULL/LITE release workflow is also implemented; current
platform limitations are listed in [INSTALL.md](INSTALL.md).

## Known defect

- [ ] **Python verification can time out after a successful environment build.**
      `InspectPython` applies a 25-second deadline to `doctor.py` for candidate
      discovery, but the same check is used after `EnvBuilder.Build`. A cold
      interpreter can exceed that deadline while loading native modules, so the
      UI reports verification failure even when pip installed the environment
      successfully. Separate the candidate-list bound from post-build
      verification and retain a bounded, user-visible recovery path.

## Out of scope

- Cloud-hosted multi-user backend; TERRA remains local-first.
- Replacing Microsoft Planetary Computer STAC as the default imagery source.

## Contributing

Open an issue with the user problem, the workflow it affects and any research
prototype or validation data. Keep changes reviewable and follow
[CONTRIBUTING.md](../CONTRIBUTING.md) and [RELEASING.md](RELEASING.md). For
research-method proposals, use the research contacts in the README as well as
GitHub Issues.
