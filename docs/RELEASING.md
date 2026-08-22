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
5. Pick the release's still and code name — see below.
6. Tag and push:

```bash
git checkout main && git pull
git tag -a v0.3.0 -m "TERRA v0.3.0 — short reason"
git push origin v0.3.0
```

7. Confirm the Release workflow finished and assets appear on
   [Releases](https://github.com/rexionmars/TERRA/releases).

## Code names and the splash still

Each release has a code name, fixed for the version the way Sierra and Sonoma
are. It is shown on the splash under the wordmark, beside the version number,
and does not change from launch to launch.

The stills carry names from the same set, and the release is named for one of
them. The manifest currently holds a single still, `Amazon`, so the splash is
fixed and the release is named for the only photograph there is. Add a second
entry and the rotation resumes on its own: the featured still is what the first
launch after an update shows and what every second launch after it shows, and
the walk covers the rest. The correspondence is deliberate but not a dependency
— the release keeps its name whichever photograph the rotation lands on.

Names come from one set: **what is observable from orbit**. `Amazon`, and
before it `Meander`, `Terraces`, `Vortex`, `Windfarm`, `Ember`, `Soybean` —
those six are in the history of `splashBackground.ts` with their sources, and
their files are still in `frontend/public/terra-splash-images`. The coherence is the point — a
set is what makes the names read as deliberate rather than arbitrary — and it
does not run out. Pick a name that fits the image, and an image that fits what
the release is about: a version focused on solar and wind ships turbines at
dusk.

### Adding one

Images are photographs from [Pexels](https://www.pexels.com), which needs no
attribution. The manifest records the photographer and URL anyway: it is the
only route back to the original if the file ever needs re-encoding.

Downloads are full-resolution — 24 megapixels is normal — and the splash window
is 420x280. Resize and convert before committing, or the binary grows by
megabytes for an image shown for about a second:

```bash
sips -Z 1600 original.jpg --out /tmp/resized.jpg
cwebp -q 82 /tmp/resized.jpg -o frontend/public/terra-splash-images/<name>.webp
```

1600px and q82 are what the existing stills use; keeping to them keeps the set
consistent. Check the result by eye before committing — skies and open water
are where WebP bands first, and every one of these is mostly sky.

Then add an entry to `SPLASH_STILLS` in
[`splashBackground.ts`](../frontend/src/lib/splashBackground.ts), point
`FEATURED_STILL` at it, and set `RELEASE_NAME` in
[`brand.ts`](../frontend/src/lib/brand.ts) to match. Nothing else needs
editing: `index.html` receives both at build time, and a path with no file on
disk fails the build.

## Current line

Latest published tags (see GitHub for the full list): `v0.1.0`, `v0.2.0`.
The LITE/FULL packaging work on `main` is a **MINOR** when you next cut binaries
(e.g. `v0.3.0`), not a jump to `1.0.0`.
