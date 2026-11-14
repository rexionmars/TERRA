# Code style

How code in this repository is written, for the people and the coding agents who change
it. [AGENTS.md](../AGENTS.md) holds the commands and the boundaries; this page holds the
rules and the reasons for them.

Every rule here was measured from the code before it was written down. Where a published
guide says the same thing it is cited, and where the code departs from one the reason is
given. The counts are from November 2026.

The guide follows the order of precedence that PEP 8 sets out: "Consistency with this
style guide is important. Consistency within a project is more important. Consistency
within one module or function is the most important." A file that does something its own
way is followed inside that file until a change decides the question for the whole
project, and that change also updates this page.

## What the tools decide

Formatting, and every defect a tool can find, is left to the tool. This page covers only
what a tool cannot decide. Each configuration file says in its comments why it holds what
it holds, and where it disagrees with this page the configuration wins.

| | Format | Lint | Types | Also in CI |
|---|---|---|---|---|
| Go | `gofmt` | `golangci-lint` ([.golangci.yml](../.golangci.yml)), `go vet` | compiler | `go test -race` |
| TypeScript | Prettier ([prettier.config.mjs](../frontend/prettier.config.mjs)) | ESLint ([eslint.config.mjs](../frontend/eslint.config.mjs)) | `tsc`, strict | vitest, `check:types`, `check:contrast`, `check:icons`, `check:cursors`, `check:version` |
| Python | none yet, see [Open](#open) | Ruff ([pyproject.toml](../sidecar/pyproject.toml)) | mypy | import-linter, `compileall`, pytest |

**A check is added for the defect it prevents, and its comment names that defect.** A
check enabled because it exists is one that nobody can defend when it fires, and a check
that nobody can defend gets switched off. When ESLint was adopted, a broad preset flagged
1,821 findings, and 1,269 of them were the code's own idioms.

**A suppression gives its reason on the line above.** That covers `//nolint`,
`// eslint-disable-next-line`, `# noqa` and `# type: ignore`. Fixing the finding comes
before silencing it. ESLint reports a disable directive that no longer suppresses
anything, and golangci-lint reports an exclusion that no longer matches, so a suppression
that has outlived its reason gets found.

## Every language

**A name says what a thing is, in the terms of its field.** Examples: `occurrence`,
`footprint`, `delineation`, `MineralPositionClass`. Promotional or comparative names are
not used: `Improved`, `Enhanced`, `Better`, `New`, `V2`, `Final`, `Simple`. A name that
compares a thing with an earlier version stops meaning anything once that version is
deleted. A symbol taken from a paper keeps the paper's spelling.

**A package, module or folder is named for its subject, not for its position.** Avoid
`util`, `helpers`, `common`, `misc`, `model`, `backend`. The Google Go Style Guide lists
these among the names to avoid, and the reason holds in every language: a name that
describes a position collects unrelated subjects. The `backend` package that
`internal/` replaced held four, and four of its seven files had no consumer inside their
own package. `frontend/src/lib/` predates this rule. New modules in it are still named
for their subject: `compareGrid.ts`, not `gridHelpers.ts`.

**A comment states the rule as it stands and why it holds.** What the code does can be
read from the code. A comment carries what cannot: the constraint, the measured value,
the failure that a given shape prevents, the source of a formula. "Without the tag the
linter type-checks a different set of files than the build compiles" is a reason. The
story of how that was found, on which date and in which run, belongs in the commit
message, which can be dated without going stale. Commented-out code and `TODO` markers
are not kept in the tree, and there are none today. Open work goes in
[TODO.md](../TODO.md) or an issue.

**Text a user reads is plain and specific.** This covers labels, error messages, progress
lines and reports. Each one says what happened, in the user's terms, and what they can
do about it. "sidecar failed: exit status 1" tells a user nothing. "… needs PyTorch,
which is not installed in this environment. Install it there, or choose the Random
Forest …" tells them what to do. No emojis (the tree has none), no exclamation marks, no
superlatives. Quantities carry SI units: `12.4 ha`, `30 m`. Code, comments, commit
messages and the interface are in English.

**Nothing is invented to fill a gap.** Shipping code never generates data to stand in for
a result it could not get. That rules out random values, a hard-coded sample shown as if
it were measured, and a fallback to fake data when the sidecar fails. A missing result is
shown as missing, with the reason. A test builds its fixture inside the test, in the
shape of the real thing, and anything shown for demonstration says so in its name.

**A failure reaches the user as a reason.** Each layer adds what it was doing and passes
the cause on. Go wraps with `%w`, the sidecar raises an exception type that `terra/cli.py`
turns into a message, and the frontend shows that message. A failure turned into silence,
an empty list or a default value later surfaces as a different bug.

**A generated file is changed by changing what generates it.**

| File | Generated by | Compared by |
|---|---|---|
| `frontend/wailsjs/` | `wails build` / `wails dev`, from the methods bound in Go | the build |
| `frontend/src/components/icons.tsx` | `npm run build:icons`, from `frontend/vendor/breeze-icons` | `check:icons` |
| `frontend/src/cursors.css` | `npm run build:cursors`, from `frontend/vendor/aosp-pointers` | `check:cursors` |
| `frontend/src/lib/palettes.ts` | `python sidecar/tools/gen_palettes.py`, from the sidecar's `CONTINUOUS_STOPS` | `sidecar/tests/test_palette_sync.py` |
| `CHANGELOG.md`, the version in `version.go`, `CITATION.cff` and `wails.json` | release-please, from the commit messages | `check:version` |
| `requirements*.lock.txt` | `uv pip compile`, with the command in each file's header | pip `--require-hashes` |
| `model/catalog.json` | `python3 scripts/package_models.py`, from `model/packages/`, `model/upcoming/` and the weights | `TestTheBuiltInCatalogueOffersOnlyWhatThisVersionInstalls`, `TestTheBuiltInCatalogueShowsEveryModelInPreparationItLists`, and the SHA-256 of each published zip |
| `frontend/dist/` | `npm run build`, never committed | |

**Dead code is removed, and it is found with the tests excluded.** A test counts as a
caller, so a function that only tests reach looks alive. CI sees what is unused inside a
module: `tsc` with `noUnusedLocals`, and golangci-lint's `unused`. It does not see an
export that nothing imports. A removal is therefore checked with a tool run in
production mode, such as `npx knip --production` in `frontend/`.

**One change, one subject.** A refactor that changes no behaviour goes in its own commit,
so a reviewer can confirm that it changes nothing. A commit that only reformats is also
listed in [.git-blame-ignore-revs](../.git-blame-ignore-revs).

**A test is named for the behaviour it guards, as a sentence.** In Go that is
`TestRenameRefusesWhenBothTablesHoldRows`, and in Python
`test_a_masked_observation_is_not_usable`. A failing test then names the broken
behaviour without anyone opening the file. Tests run offline and give the same result
every time. They use the temporary directories the framework provides: `t.TempDir`,
pytest's `tmp_path`.

## Go

**Layout.** `package main` at the root is the Wails application. `app.go` and the
`app_<subject>.go` files hold the methods bound to the frontend, one subject per file:
`app_areas.go`, `app_jobs.go`, `app_mineral.go`. Platform code is split by file suffix
and build tag (`focus_darwin.go`, `focus_stub.go`). Everything else sits in
`internal/<subject>`:

- `analysis` holds the analyses and the boundary with the sidecar.
- `pyenv` answers whether anything can run.
- `store` is the local database.
- `jobs`, `geocode` and `research` are what their names say.

Nothing outside the module imports `internal/`, and the compiler enforces that.

**No layers.** TERRA is one binary for one user on one machine, with no server, no HTTP
API and no second consumer of its logic. The heavy work sits behind a subprocess
boundary with a serialised JSON contract, which is already the strongest separation in
the system. Packages named `domain`, `application`, `infrastructure` or `presentation`
would add indirection and buy nothing. The Go guides say the same: "Avoid
uninformative package names like `util`, `utility`, `common`, `helper`, `model`,
`testhelper`" (Google Go Style Guide), and "Work to eliminate meaningless package names
from your projects" (the Go blog).

**An interface is introduced when a consumer needs one.** Concrete types are the default.
In the words of the Google guide: "Avoid creating interfaces until a real need exists",
and "The consumer of the interface should define it (not the package implementing the
interface)". A test that is hard to write is evidence worth acting on. An abstraction
added before any such test exists is not.

**Errors.** Error strings start in lower case and end without punctuation. All 341 in
the tree do, as Go Code Review Comments asks, "since they are usually printed following
other context". A wrapped error names the operation that failed and wraps with `%w`, as
in `fmt.Errorf("mkdir data dir: %w", err)`; 150 of the 151 wraps do. Errors are compared
with `errors.Is` and `errors.As`, never `==`. The sidecar teardown tells its own closed
pipe apart from a real read failure through a wrapped `os.ErrClosed`, and an equality
check there would report an ordinary shutdown to the user as an error.

**`panic` is for a programmer's mistake that can be detected before any user action.**
There are two in the tree, and each fires only when a constant or a table written in the
code is wrong. A panic in a bound method closes the window.

**A call that starts a process or reaches the network takes its caller's context.** A
`context.Background()` in that path compiles and passes every test, and leaves a Python
process alive after the window has closed. `contextcheck` and `noctx` look for it.

**The bindings are a contract with the frontend.** Every exported method on `*App` is
generated into `frontend/wailsjs`. The JSON names of the structs in
`internal/analysis/types*.go` are snake_case (all 475 multi-word tags), and
`frontend/src/lib/types.ts` mirrors them by hand. `npm run check:types` compares the two
sides, and a rename changes both in the same commit.

**Tests** use the standard library's `testing` package and nothing else. None of the 208
test names contains an underscore. `-race` is part of the command, because the
concurrency tests are what make the race detector worth running.

## TypeScript and React

**Layout.** In `frontend/src/`:

- `pages/` holds a screen each.
- `components/<area>/` holds what a screen is drawn from: `shell`, `globe`, `mineral`,
  `ui`, `workspace`.
- `session/` holds the application's state as one hook per domain, composed in
  `App.tsx`.
- `lib/` holds logic that mostly runs without React, with its tests beside it.

Folders are organised by what the code is for, not by how large a component is (the
atoms, molecules and organisms of Atomic Design). State is kept in plain hooks, with no
server-state library and no client store. Both of those patterns are written for an
application that talks to a remote API. This one talks to a single Go process through
generated bindings, in a single window, so there is no server cache to keep coherent.

**A component is a function declaration with a named export.** Its props are typed
inline, unless another module needs the type. 127 components are exported this way, and
`App` alone is a default export. The Google TypeScript Style Guide asks for the same, "Do
not use default exports", so that a component has one name at every import.

**A `.tsx` file holding one component is named for it,** in PascalCase. A module of
several components, or of none, is camelCase: `fieldNodes.tsx`, `icons.tsx`.

**Imports.** `@/` across directories, `./` beside the file. `wailsjs` sits outside `src`
and is reached by a relative path.

**State stays as close to its use as it can.** State that several screens share lives in
a `session/` hook named for its domain (`useSurfaceWater`, `useMineralMap`). The hook
returns the props its consumers spread, and `MapShell` receives `{...water.props}` rather
than twenty separate values.

**`any` is not used.** There are no instances in `src/` today, and `tsc` runs in strict
mode. A value of unknown shape is `unknown` and gets narrowed.

**An async handler says who deals with its failure.** Write `void fn()` where the
function reports its own failure. Where the caller awaits it, as `AreasPanel` awaits a
deletion before announcing it, the prop's type returns the promise.

**Sizes come from [DESIGN.md](DESIGN.md).** Type, radius and layer are tokens, and ESLint
refuses one written by hand, so a new step is a change to that table rather than to one
component. Classes are merged with `cn()`, which knows the custom type scale.

**Tests** are vitest files beside their module (`compareGrid.test.ts`). They cover
`lib/` and `session/`. Components are checked in the running application, where what they
draw can be seen and compared before and after; [AGENTS.md](../AGENTS.md) says how.

## Python (`sidecar/`)

**Layout.** `sidecar/infer.py` is the path the Go side runs, and what the process does is
in `terra/cli.py`. Each product is a package: `terra/water`, `terra/landcover`,
`terra/mineral`, `terra/fields` and the others. import-linter enforces the layers, from
top to bottom:

1. `cli`
2. `registry`
3. the products
4. `imagery`
5. `stac` and `mapbiomas`
6. `aoi` and `phenology`
7. `protocol`

Products do not import each other. Something two products need moves down a layer.
`tools/` holds standalone scripts that are run by hand.

**The three streams are the contract.** The request arrives as JSON on stdin. The result
leaves on stdout as exactly one JSON object. Progress lines and the error go to stderr as
JSON through `terra.protocol` (`emit_progress`, `fail`). A `print()` anywhere under
`terra/` corrupts the result, so there is none, and no `logging` either. Scripts in
`tools/` may print.

**Failures are raised, and exit only at the edge.** Raise `MissingDependency` when TERRA
can install what is missing. Raise `Unavailable` when the user has to act in the world
(a token, a service, a file a catalogue lists but does not serve), and name which thing
in the message. A bug raises an ordinary exception and leaves a traceback. Product
modules raise rather than exit, because a module that exits cannot be called by a test,
and `fail` in `protocol.py` is the only place the process exits.

**Types.** 77 of the 95 Python files begin with `from __future__ import annotations`. mypy
checks the whole package at its default level, and stricter on the modules listed in
`pyproject.toml`. That list only grows: "a module joins it in the commit that touches
it". mypy has to run with the dependencies installed. Without them numpy is read as
`Any`, and the check passes code it would otherwise refuse.

**Strings and docstrings.** Strings use single quotes; double-quoted literals are about
a fifth of the total. No formatter has been adopted, so the file being edited sets the
quotes. Docstrings follow PEP 257. A one-line docstring stays on one line. A longer one
opens with the quotes alone, then gives a summary line, a blank line and prose saying
what the signature cannot. `Args:` and `Returns:` sections are not used; there are two in
the tree.

**A method is implemented as published, and cites where.** The docstring names the
paper, the equation or the band positions (20 files cite one). A simplification
says what it leaves out and why. It is never presented as the method. Units go in the
name or the docstring. A symbol keeps the paper's spelling even where PEP 8 would object,
which is why Ruff's E741 is off: `l` is a documented symbol in several radiative-transfer
papers.

**Tests** live in `sidecar/tests` and run offline, without the network and without
PyTorch. PyTorch is optional (`requirements-prithvi.txt`), and a path that needs it calls
`require_torch` first.

**Dependencies.** `requirements.txt` holds the floors, and the lock files hold the
resolved set with hashes. A change to the floors is followed by regenerating the locks.

## Commits, branches and pull requests

**Branches** start from `main`, prefixed by kind: `feat/`, `fix/`, `docs/`, `refactor/`.

**Commit messages follow Conventional Commits 1.0.0:** `type(scope): subject`.
release-please turns `feat`, `fix` and `perf` into the sections of
[CHANGELOG.md](../CHANGELOG.md) and leaves the other types out. Choose the type by what
someone using the application would notice: a refactor that changes behaviour is a `fix`
or a `feat`. The scope is the part of the product affected: `map`, `shell`, `sidecar`,
`store`, `compositor`, `globe`.

**The subject says what is true after the change**, as the changelog will put it to
someone deciding whether to update. For example: `fix(map): a raster is pinned to its
corners rather than stretched over a box`. Subjects are lower case with no final period.
It is a statement about the product, not an instruction. Of the last 300 subjects, 186
begin with "the" or "a".

**The body says why, and tells the story.** That means what failed, how it was found and
what was measured. A comment in the code cannot carry this without going stale.

**No attribution trailers.** Commit messages and pull requests carry no line crediting a
tool or a model (`Co-Authored-By` for an assistant, "Generated with ..."). The message
ends at its last line of content.

**A pull request** has one theme, says why it exists, and says how it was verified.

## Open

Decisions not yet taken. Each one, once taken, changes this page.

- **A formatter for Python.** `ruff format` would rewrite 57 files, which is a decision
  of its own. If it is adopted, `quote-style = "single"` keeps the quotes the code
  already uses.
- **The frontend's leftovers.** z-index has 19 values and no scale. `CompositorEditor`
  and `GlobeSurface` are each still one large function. The
  `studio` and `board` vocabulary survives in names, along with the
  `components/workspace/` folder.
- **Cross-module dead code** in the frontend is not checked in CI.

## Sources

- PEP 8, Style Guide for Python Code: <https://peps.python.org/pep-0008/>
- PEP 257, Docstring Conventions: <https://peps.python.org/pep-0257/>
- Google Go Style Guide, Decisions: <https://google.github.io/styleguide/go/decisions>
- Go Code Review Comments: <https://go.dev/wiki/CodeReviewComments>
- The Go Blog, Package names: <https://go.dev/blog/package-names>
- The Go Blog, Working with Errors in Go 1.13: <https://go.dev/blog/go1.13-errors>
- Google TypeScript Style Guide: <https://google.github.io/styleguide/tsguide.html>
- Conventional Commits 1.0.0: <https://www.conventionalcommits.org/en/v1.0.0/>
- AGENTS.md: <https://agents.md/>
- Claude Code, memory and project instructions: <https://code.claude.com/docs/en/memory>
