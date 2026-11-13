# AGENTS.md

Instructions for coding agents working in this repository. People start from
[CONTRIBUTING.md](CONTRIBUTING.md). The rules both follow, with the reason for each, are
in [docs/CODE_STYLE.md](docs/CODE_STYLE.md).

## The project

TERRA is a desktop application for geospatial analysis. A Wails (Go) binary hosts a React
map interface and runs a Python sidecar for the analyses. It has one user and one
machine, and no server. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) gives the whole
picture.

| Path | What it is |
|---|---|
| `*.go` at the root | the Wails application; `app_<subject>.go` holds the methods bound to the frontend |
| `internal/` | Go packages, one subject each: `analysis`, `pyenv`, `store`, `jobs`, `geocode`, `research` |
| `frontend/` | React 19, TypeScript, Vite, Tailwind v4; `docs/DESIGN.md` holds its tokens |
| `sidecar/` | Python 3.12; `infer.py` is the entry point and `terra/` the package |
| `model/` | sources of the model packages, and `catalog.json`, the catalogue of published models; the sidecar runs installed packages, not these files |

## Before writing code

Read the section of docs/CODE_STYLE.md for the language you are about to change, and the
configuration of the tool that checks it: `.golangci.yml`,
`frontend/eslint.config.mjs`, `sidecar/pyproject.toml`. Inside a file, follow that file:
its conventions win over your defaults.

Two contracts cross languages, and a change to one side changes the other side in the
same commit:

- **Go and TypeScript.** `frontend/src/lib/types.ts` mirrors by hand the JSON names in
  `internal/analysis/types*.go`, and `npm run check:types` compares the two. The build
  generates the bound methods into `frontend/wailsjs/`.
- **Go and Python.** `internal/analysis/runner.go` runs `sidecar/infer.py` with a JSON
  request on stdin. The result comes back as one JSON object on stdout. Progress and
  errors are JSON lines on stderr, written by `sidecar/terra/protocol.py`.

## Checks

Run the checks for every area you touched. Each must pass before you report the work as
done, and the report says what you ran and what it printed.

Go, from the root. `main.go` embeds `frontend/dist`, so on a fresh clone run
`npm run build` in `frontend/` first:

```bash
gofmt -l .                # must print nothing
go vet ./...
golangci-lint run ./...
go test -race ./...
```

Frontend, from `frontend/`:

```bash
npm run check:format      # npm run format writes what this compares against
npm run lint
npx tsc --noEmit
npm test
npm run check:types       # when a Go type or types.ts changed
```

`check:contrast`, `check:icons`, `check:cursors` and `check:version` also run in CI. Run
the matching one when you touch colours, icons, cursors or the version.

Sidecar, from `sidecar/`, with the dependencies from `requirements-dev.lock.txt`
installed. Without them mypy reads numpy as `Any` and passes code that CI refuses:

```bash
ruff check .
mypy terra
lint-imports --config pyproject.toml
pytest tests -q
```

The application: `wails build` at the root produces `build/bin/TERRA.app`.

## Seeing a change in the application

A change to what is drawn is looked at, not only tested.

- Never run the application against the user's own data. The store lives under the
  user's config directory (`~/Library/Application Support/terra` on macOS). Start with
  `HOME=<scratch> wails dev`, and copy the store into the scratch home first if the check
  needs real projects.
- `wails dev` opens a native window. Tell the user before starting it, because closing
  the window ends the run.
- The dev server at `http://localhost:34115` serves the real bindings to a browser. A
  page can be driven and captured there, before and after the change, and the two
  compared.
- Do not edit Go files while `wails dev` is running. It rebuilds and restarts the
  application partway through the check.

## Never

- Edit a generated file: `frontend/wailsjs/`, `frontend/src/components/icons.tsx`,
  `frontend/src/cursors.css`, `frontend/src/lib/palettes.ts`, `model/catalog.json`,
  `CHANGELOG.md`, the lock files. Change what generates it; docs/CODE_STYLE.md lists each generator.
- Write to stdout from `sidecar/terra/`. Stdout carries the result.
- Silence a check to make it pass. A suppression is a last resort, and gives its reason
  on the line above it.
- Generate data to stand in for a result that shipping code could not get.
- Stage with `git add -A` or `git add .`. Name each path, because the working tree often
  holds untracked files that belong to other work.
- Commit, push, tag or release unless asked. Releases are cut by release-please
  ([docs/RELEASING.md](docs/RELEASING.md)).
- Add a dependency without asking. Propose it, and say what it is for.
- Create documentation files that nobody asked for: change summaries, audit notes,
  `FIX_*.md`. What changed and why goes in the commit message.
- Add a line crediting a tool or a model to a commit or a pull request.
- Commit `.env` or any credential.

## Commits

Conventional Commits, in the form `type(scope): subject`. The subject says what is true
after the change, in lower case and with no final period. For example:
`fix(map): a raster is pinned to its corners rather than stretched over a box`. The body
says why. One subject per commit, and a refactor goes apart from any change in
behaviour.

## Writing

Code, comments, commit messages and interface text are in English. Keep the text plain
and specific, with no emojis or superlatives and with SI units. A comment states the rule
and why it holds; the story of a bug goes in the commit message.
