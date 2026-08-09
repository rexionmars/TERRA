# Installation

TERRA is a desktop app (Wails + React) with a Python sidecar for inference.
Releases ship two flavors:

| Flavor | Download name | Experience |
|--------|---------------|------------|
| **FULL** | `TERRA-*-full.zip` | Unzip and run — embeds Python 3.12 + spectral RF dependencies |
| **LITE** | `TERRA-*-lite.zip` | Smaller UI + models; you provide Python 3.12 |

Both include `sidecar/`, `areas/`, and `model/` next to the app binary.

**FULL** covers spectral Random Forest, MapBiomas LULC, and phenology without a
system Python. Temporal Transformer and Prithvi still need torch — use LITE (or
FULL + override) with [`requirements-prithvi.txt`](../requirements-prithvi.txt).

## Option A — FULL (recommended for most users)

1. Download the **full** asset for your OS from
   [GitHub Releases](https://github.com/rexionmars/TERRA/releases)
   (`TERRA-macOS-arm64-full.zip`, `TERRA-Windows-amd64-full.zip`, or
   `TERRA-Linux-amd64-full.zip`).
2. Unzip and launch (`TERRA.app` / `Terra.exe` / `Terra`).
3. Classify with model **spectral**.

> macOS FULL is **Apple Silicon (arm64)**. Intel Macs should use LITE + a local
> Python, or run from source.

To run on a different interpreter than the bundled one — to add torch for
Prithvi, for instance — choose it in **Settings → System**. `GEOSENSE_PYTHON`
does the same for a launch from a terminal.

## Option B — LITE (+ system Python)

1. Download the **lite** asset
   (`TERRA-macOS-universal-lite.zip`, `TERRA-Windows-amd64-lite.zip`, or
   `TERRA-Linux-amd64-lite.zip`).
2. Install Python **3.12** or newer, if the machine does not have it.
3. Unzip and launch the app. It opens **Settings → System** by itself when it
   cannot run an analysis, which on a fresh LITE install is the normal case.
4. Pick a Python from the list and press **Build environment**. TERRA creates
   its own environment, installs the dependencies with pip output shown as it
   goes, and verifies the result before adopting it.

The environment is built beside TERRA's database, not inside the application,
so replacing the app on update does not discard it.

**Use as is** is the other button on each row. It selects an interpreter you
have already prepared, and is refused if that interpreter cannot import what the
sidecar needs — the check runs before the choice is saved, rather than surfacing
mid-analysis.

### Preparing an environment by hand (optional)

Only needed to control the environment yourself; **Build environment** above
covers the same ground.

```bash
python3.12 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -U pip
pip install -r requirements.txt
```

Then point TERRA at `.venv/bin/python` with **Use as is** in Settings → System.

Optional Prithvi / Temporal Transformer path (large; first Prithvi run also
downloads backbone weights):

```bash
pip install -r requirements-prithvi.txt
```

For unit tests / CI-style checks:

```bash
pip install -r requirements-dev.txt
```

### Pointing TERRA at Python

Resolution order:

1. `GEOSENSE_PYTHON` — absolute path to the interpreter
2. The interpreter chosen in **Settings → System**, saved in `config.json`
   beside TERRA's database
3. Bundled `python/` inside the app (FULL builds)
4. `.venv` at the parent of the app directory (dev / monorepo layout)
5. `python3` / `python` on `PATH`

Settings → System is the way to set this. `GEOSENSE_PYTHON` reaches only a
process launched from a shell that exported it, and an app opened from Finder or
the Start menu inherits the session environment rather than a shell profile — so
the variable frequently has no effect on the way the application is actually
opened. It stays supported for launching from a terminal, and overrides the UI
when set:

```bash
export GEOSENSE_PYTHON="$HOME/venvs/terra/bin/python"
# then launch TERRA from that same shell
```

When it is set, Settings → System says so, because a selection made there is
saved and then overruled by it.

## Option C — From source (development)

### Dependencies

| Tool | Version |
|------|---------|
| Go | 1.23+ |
| Node.js | 18+ (20 recommended) |
| Python | 3.12 + `requirements.txt` |
| [Wails CLI](https://wails.io) | `go install github.com/wailsapp/wails/v2/cmd/wails@latest` |

Linux builds also need WebKit/GTK development packages (see CI:
`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`).

### Setup

```bash
git clone https://github.com/rexionmars/TERRA.git
cd TERRA
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd frontend && npm ci && cd ..
wails dev
```

Production-style local binary:

```bash
wails build
# then optionally:
scripts/package_release.sh --flavor lite --os darwin --artifact TERRA-local-lite.zip
# or FULL (downloads python-build-standalone):
scripts/package_release.sh --flavor full --os darwin --arch aarch64 --artifact TERRA-local-full.zip
```

### Configuration

| Variable | Purpose |
|----------|---------|
| `GEOSENSE_PYTHON` | Python interpreter for the sidecar. Overrides Settings → System |
| `GEOSENSE_APP_DIR` | Directory containing `sidecar/`, `areas/`, `model/` |
| `GEOSENSE_MODEL_DIR` | Override trained model directory (default `model/`) |
| `GEOSENSE_ROOT` | Parent repo root used for legacy MapBiomas paths |

These suit a launch from a terminal, where a shell exports them. For an app
opened from Finder or the Start menu, the interpreter is set in Settings →
System and recorded in `config.json` beside the database.

### Checking an environment

Settings → System reports what the active interpreter can and cannot do: the
Python version, each dependency the sidecar imports, and what a missing one
stops working. The same check runs directly:

```bash
/path/to/python sidecar/doctor.py
```

## scikit-learn compatibility

Serialized Random Forest artifacts in `model/` were produced with
**scikit-learn 1.8.x**. Install a matching version (`requirements.txt` pins
`>=1.8,<1.9`) or deserialization may warn or fail. FULL builds install that pin
into the bundled interpreter.

## Next steps

- [User guide](USER_GUIDE.md) — first classification
- [Troubleshooting](TROUBLESHOOTING.md) — common errors
- [Releasing](RELEASING.md) — SemVer / when to tag
- [Contributing](../CONTRIBUTING.md) — tests and PRs
