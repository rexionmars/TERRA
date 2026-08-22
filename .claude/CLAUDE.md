# TERRA — project guidelines

The guidelines in `../.claude/CLAUDE.md` apply to this repository, with the one
exception recorded below. Everything there on scientific language, plotting,
mock data, documentation files and commit style holds unchanged.

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
