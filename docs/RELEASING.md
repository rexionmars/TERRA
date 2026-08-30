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

### One repository setting this depends on

`release-please` opens the proposal as GitHub Actions, and Actions cannot open
pull requests unless the repository allows it. The setting is off by default,
and the first run failed on it after having done everything else correctly --
it parsed 120 commits, computed the bump, created the branch and wrote the
commit, then stopped at `GitHub Actions is not permitted to create or approve
pull requests`.

    Settings -> Actions -> General -> Workflow permissions
    [x] Allow GitHub Actions to create and approve pull requests

or, the same thing over the API:

```bash
gh api -X PUT repos/rexionmars/TERRA/actions/permissions/workflow \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=true
```

`default_workflow_permissions` stays `read`: the workflow declares the write
scopes it needs in its own `permissions:` block, which is narrower than raising
the default for every workflow in the repository. The checkbox covers approving
as well as creating, which is worth knowing but gates nothing here -- `main`
has no branch protection and no rulesets, so there is no required review for a
workflow's approval to satisfy. Adding one later is the point at which this
setting starts to matter.

It is written down because nothing in the repository records it: the workflow
file, the config and the manifest can all be correct while the release still
does not happen, and the only symptom is a failed run.

### The procedure

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
3. **On a MINOR, pick the code name and the still** — see below.
   `RELEASE_NAME` in [`brand.ts`](../frontend/src/lib/brand.ts) is edited in
   the same commit as the What's New entry, and for the same reason: neither
   can be generated. A PATCH keeps the name it has and skips this step.
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
and does not change from launch to launch. It also opens the release's What's
New entry and titles the GitHub release.

Names come from one set: **what is observable from orbit**. `Ember`, `Amazon`
and `Stockpile` have been used; `Meander`, `Terraces`, `Vortex`, `Windfarm` and
`Soybean` are in the history of `splashBackground.ts` with their sources, and
their files are still in `frontend/public/terra-splash-images`. The coherence is
the point — a set is what makes the names read as deliberate rather than
arbitrary — and it does not run out.

### The name identifies the release; it does not describe it

This section used to say: *pick a name that fits the image, and an image that
fits what the release is about*. That instruction is gone, for two reasons.

It was not being followed. `v0.4.0` is **Amazon** and shipped the energy result
as a column of its own — a rainforest does not describe that. One release out of
the two that had names at the time.

And it worked against the trigger above. That trigger exists to separate
releasing from finishing a feature: ship the fix when the fix is worth shipping.
A name that has to describe a theme joins them back together, because a release
of thirty-one refactors and twenty-five fixes has no theme to name. It then gets
a name that lies, or it waits for a theme to arrive — and waiting is the
behaviour the trigger was written to end.

Every naming scheme that lasts works this way. macOS ships places in California
and Mojave brought no desert features; Ubuntu ships an adjective and an animal
in alphabetical order; Debian ships Toy Story characters. None of them describe
the release, because none of them can promise a theme per release. The changelog
describes the release. The name identifies it.

So take the next name from the set. It does not have to mean anything about what
shipped, and a release of pure maintenance is named exactly like any other.

### A MINOR takes the next name; a PATCH keeps the one it has

The code name belongs to the MINOR line. `v0.5.0` and `v0.5.1` carry the same
name and the same still, the way 14.0 through 14.7 are all Sonoma.

This is the part that matters in practice: a release carrying only fixes needs
no naming decision at all, and no image sourced, resized and committed. Those
are most releases, and under the old rule each of them was a small blocked
decision standing between a fix and the user who needed it.

### The still it is named for

`RELEASE_NAME` in [`brand.ts`](../frontend/src/lib/brand.ts) and
`FEATURED_STILL` in
[`splashBackground.ts`](../frontend/src/lib/splashBackground.ts) name the same
entry, and `npm run check:version` fails when they do not. They disagreed once,
silently, which is why it is now checked rather than described: the splash would
have printed one release's name over another release's photograph, and nothing
in the build had an opinion about it.

With one entry in the manifest the splash is fixed. Add a second and the
rotation resumes on its own: the featured still is what the first launch after
an update shows and what every second launch after it shows, and the walk covers
the rest. Which photograph a given launch lands on is not the release's name —
the name is fixed for the version.

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
editing: `index.html` receives both at build time, a path with no file on disk
fails the build, and `npm run check:version` fails if the two names differ.

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
