# Releasing TERRA

TERRA uses [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
Git tags use a `v` prefix (`v0.3.0`); the version itself is `0.3.0`.

Pushing a tag matching `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml)
and publishes LITE/FULL zip assets. The tag is normally created by merging the
release pull request that
[`release-please.yml`](../.github/workflows/release-please.yml) keeps open —
see [Cutting a release](#cutting-a-release). What each release contained is in
[`CHANGELOG.md`](../CHANGELOG.md).

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

## When to release

The section above says which number to move. This one says when to move it,
which the document did not say for its first four releases and which is the
gap that showed: `v0.4.0` shipped 60 commits, and the eight days after it
accumulated 116 without anything asking to be released. The number was never
the hard part.

**The rule.** Merge the standing release pull request when either is true:

- it contains a `fix` or `feat` a user would notice, and the last release was
  more than a week ago; or
- it contains anything at all, and the last release was more than three weeks
  ago.

Neither is a deadline. They are the two conditions under which not releasing
needs a reason, which is the opposite of today, where releasing needs one.

**What does not trigger anything.** Docs-only work, CI changes, and internal
refactoring accumulate in the proposal and ship with whatever goes next. A
release whose whole content is `refactor` is a release nobody can read notes
for.

- Batch several small fixes into one **PATCH** instead of daily micro-releases.
- Uncertain builds → prerelease tags: `v0.3.0-rc.1` (still matches `v*`).

## Cutting a release

Most of this is done for you. `release-please` reads the Conventional Commits
on `main` and keeps a pull request open that carries the next version, the
CHANGELOG entry, and the bump in `version.go`, `wails.json` and `CITATION.cff`.
Merging that pull request tags the release, and the tag is what
[`release.yml`](../.github/workflows/release.yml) already watches to build and
publish the LITE and FULL zips.

So the procedure is:

1. **Read the proposal.** It says which bump it computed and why — the CHANGELOG
   entry is the list of `feat`, `fix` and `perf` commits since the last tag.
   If the bump looks wrong, the commit types are wrong, and the fix is in the
   commits rather than in the proposal.
2. **Write the What's New entry.** This is the one step nothing can do for you,
   and the proposal's CI stays red until it is done: `npm run check:version`
   requires the newest entry in
   [`whatsNew.ts`](../frontend/src/lib/whatsNew.ts) to carry the version the
   other three files now carry. That red is the reminder, and it is deliberate
   — a release that ships without telling users what changed is a release whose
   notes are a commit log.
3. **Pick the code name and the still** — see below. `RELEASE_NAME` in
   [`brand.ts`](../frontend/src/lib/brand.ts) is edited in the same commit as
   the What's New entry, and for the same reason: neither can be generated.
4. **Merge it.** The tag, the GitHub release and the assets follow.

`main` must be green before you merge, which CI enforces on the proposal like
any other pull request.

### The one number release-please does not touch

`whatsNew.ts` carries an entry per release, and each entry's `version` records
the release it describes. Bumping it automatically would attach this release's
number to the previous release's prose, which is worse than leaving it to fail
the check. It fails the check.

### If you have to tag by hand

Nothing prevents it — `release.yml` triggers on any `v*` tag. Bump
`version.go` first and run `npm run check:version` in `frontend/`, which names
any of the four places that disagree. `version.go` is the authority; change the
others to match it, not the other way round.

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

`v0.4.0` is the latest published tag. The line so far, with what each shipped:

| Tag | Date | Commits | Named for |
|---|---|---|---|
| `v0.1.0` | 2026-06-27 | — | — |
| `v0.2.0` | 2026-07-31 | 51 | — |
| `v0.3.0` | 2026-08-16 | 383 | Ember |
| `v0.4.0` | 2026-08-22 | 60 | Amazon |

THIS TABLE WAS TWO RELEASES STALE when the trigger above was written: it said
the latest tags were `v0.1.0` and `v0.2.0` and described `v0.3.0` as future, on
a day when `v0.4.0` had already shipped. A section that records the current
state and is updated by hand goes stale by default, so this one is here to be
read rather than trusted — [the tag list](https://github.com/rexionmars/TERRA/tags)
is the authority, and the CHANGELOG carries what each release contained.
