# TERRA — project guidelines

The guidelines in `/Users/fox/estudos/lucertae-research/.claude/CLAUDE.md` apply to
this repository, with the two exceptions recorded below. Everything there on scientific
language, plotting, mock data, documentation files and commit style holds unchanged.

## Section 15 (Backend Architecture) does not apply here

That section prescribes Clean Architecture with four layers — `domain`,
`application`, `infrastructure`, `presentation` — the dependency rule pointing
inward, SOLID applied per class, and service boundaries defined by business
capability. It is written for a hosted, multi-tenant service. TERRA is not one.

TERRA is a single binary. One user, one machine, no server, no HTTP API, no
deployment, no second consumer of any of its logic. The heavy work is not even
in Go: it is behind a subprocess boundary with a serialised JSON contract, which
is already the strongest separation in the system and one no amount of Go
layering would strengthen.

Applying section 15 here would cost indirection and buy nothing. It also
conflicts with the guidance Go itself publishes:

- The Google Go Style Guide names the package names to avoid, and `model` is on
  the list: "Avoid uninformative package names like `util`, `utility`, `common`,
  `helper`, `model`, `testhelper`." A package named for its layer is the same
  mistake as a package named `util` — both describe a position rather than a
  subject.
- On interfaces it is explicit: "Avoid creating interfaces until a real need
  exists", and "The consumer of the interface should define it (not the package
  implementing the interface)". Declaring ports up front, as hexagonal layering
  asks, is the practice that guidance exists to prevent.
- The Go blog on package names: "Work to eliminate meaningless package names
  from your projects."

Sources: <https://google.github.io/styleguide/go/decisions>,
<https://go.dev/blog/package-names>.

## What applies instead

**Name a package for what it provides.** `internal/analysis` holds the analyses
and the boundary that produces them; `internal/pyenv` answers whether anything
can run; `internal/store` is the local database. The package this replaced was
called `backend`, which named its position in a diagram and carried four
unrelated subjects — four of its seven files had no consumer inside their own
package at all.

**Introduce an interface when a consumer needs one, not before.** Concrete
types are the default. A test that is hard to write is evidence worth acting
on; an abstraction added in advance of one is not.

**`internal/` is the boundary.** Nothing outside this module imports these
packages, so the compiler enforces what convention would only ask for.

**Prefer a shape a reader can follow to one that satisfies a pattern.** This
repository already argues for its decisions in prose comments. A structure that
needs a diagram to explain it, in a program of this size, is a cost.

## Section 20 (Frontend Architecture) applies in part

20.1 prescribes Atomic Design directories and 20.2 a server-state library and a client
store. Both are written for a hosted application talking to an API. TERRA's frontend
talks to one Go process through generated bindings, and has one window.

Still in force: a component does one thing, state stays as close to its use as it can,
`any` is not used. The semicolons in 20.3's examples are not: the formatter decides.

## Frontend code style

`frontend/prettier.config.mjs` and `frontend/eslint.config.mjs` are the style guide for
everything a tool can decide. Each states why it holds what it holds. What follows is
what a tool cannot decide, written from what the code already does.

**A component is a function declaration with a named export.** Its props are typed
inline, unless another module needs the type.

**A `.tsx` file holding one component is named for it,** in PascalCase. A module of
several, or of none, is camelCase: `fieldNodes.tsx`, `icons.tsx`.

**Imports.** `@/` across directories, `./` beside the file. `wailsjs` is outside `src`
and is reached relatively.

**An async handler says who deals with its failure.** `void fn()` where it reports its
own. Where the caller awaits it, as `AreasPanel` awaits a deletion before announcing
it, the prop's type returns the promise.

**Sizes come from `docs/DESIGN.md`.** The linter refuses a size, a radius or a layer
written by hand, so a new step is a change to that table, not to one component.

**A comment states the rule as it stands and why it holds.** The story of the bug that
taught it belongs in the commit message, where it can say what happened on what date
without going stale. An `eslint-disable` says why on the line above it.

**Dead code is found by excluding the tests.** A test is a caller, so a function only
tests reach looks alive. `tsc` sees what nothing calls inside a module, and nothing in
CI sees what nothing imports across modules.

## Verification

Before reporting Go work complete, all of these must pass:

```bash
gofmt -l .            # must print nothing
go vet ./...
golangci-lint run ./...
go test -race ./...
```

The `.golangci.yml` check set is chosen per defect, not per popularity: each
entry names in a comment the specific failure it prevents from returning.

Before reporting frontend work complete, from `frontend/`:

```bash
npm run check:format
npm run lint
npx tsc --noEmit
npm test
```

A change to what is drawn is also looked at, in the running app. `HOME=<scratch> wails
dev` keeps the real store out of it, and the dev server at `localhost:34115` serves the
real bindings to a browser, so a page can be captured before and after.
