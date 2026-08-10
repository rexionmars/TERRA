# Releasing TERRA

TERRA uses [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
Git tags use a `v` prefix (`v0.3.0`); the version itself is `0.3.0`.

Pushing a tag matching `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml)
and publishes LITE/FULL zip assets.

## What counts as the “public API”

For this desktop app, treat as user-facing surface:

- Documented workflows (AOI → Classify → Analysis → Compare)
- Install flavors (LITE / FULL) and layout of release zips
- Environment variables (`TERRA_*`) and sidecar JSON contracts
- Documented model choices and runtime requirements

Internal refactors, tests, and CI that do not change the above are not release-worthy by themselves.

## When to bump

| Bump | Tag example | Use when |
|------|-------------|----------|
| **PATCH** | `v0.2.1` | Bug fixes, packaging fixes, critical doc fixes for install — no new capability |
| **MINOR** | `v0.3.0` | New backward-compatible capability (e.g. FULL installer, Compare, new optional model) |
| **MAJOR** | `v1.0.0` | Breaking change to install/use contracts (removed env vars, incompatible sidecar/zip layout) |

Precedence: if a release mixes types, use the **highest** bump (MAJOR > MINOR > PATCH).

### Still in `0.y.z`

Pre-1.0 means the product may evolve quickly. Prefer **MINOR** for features and
**PATCH** for fixes. Reserve **`1.0.0`** for a stability milestone (e.g. after
JOSS acceptance / production-ready install story).

## Do not tag for every merge

- Docs-only, wiki, CONTRIBUTING, or CI tweaks that do not change binaries →
  **merge to `main` without a release tag**.
- Batch several small fixes into one **PATCH** instead of daily micro-releases.
- Uncertain builds → prerelease tags: `v0.3.0-rc.1` (still matches `v*`).

## Checklist before `git tag`

1. `main` is green (CI) and contains only what you intend to ship.
2. Decide PATCH / MINOR / MAJOR with the table above.
3. Update release notes mentally: what should users download (LITE vs FULL)?
4. Bump embedded `AppVersion` in [`version.go`](../version.go) to match the tag
   (or pass `-ldflags "-X main.AppVersion=X.Y.Z"` in the release build), and add a
   matching entry in [`frontend/src/lib/whatsNew.ts`](../frontend/src/lib/whatsNew.ts)
   if the release should show a What’s New modal.
5. Tag and push:

```bash
git checkout main && git pull
git tag -a v0.3.0 -m "TERRA v0.3.0 — short reason"
git push origin v0.3.0
```

6. Confirm the Release workflow finished and assets appear on
   [Releases](https://github.com/rexionmars/TERRA/releases).

## Current line

Latest published tags (see GitHub for the full list): `v0.1.0`, `v0.2.0`.
The LITE/FULL packaging work on `main` is a **MINOR** when you next cut binaries
(e.g. `v0.3.0`), not a jump to `1.0.0`.
