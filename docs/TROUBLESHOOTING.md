# Troubleshooting

## Sidecar / Python

### “Python not found” or boot never becomes ready

- Prefer a **FULL** release (`*-full.zip`), which embeds Python.
- For **LITE**: install Python 3.12 and `pip install -r requirements.txt`.
- Set `TERRA_PYTHON` to the absolute path of that interpreter if needed.
- Confirm: `"$TERRA_PYTHON" -c "import rasterio, sklearn, pystac_client; print('ok')"`.

### `InconsistentVersionWarning` or joblib load errors

Artifacts in `model/` expect **scikit-learn 1.8.x**. Reinstall with the pin in
[`requirements.txt`](../requirements.txt):

```bash
pip install 'scikit-learn>=1.8,<1.9'
```

### Import errors for Prithvi / Temporal Transformer

- Spectral RF does **not** need torch.
- Prithvi: `pip install -r requirements-prithvi.txt` and wait for the Hugging
  Face backbone download (~1.2 GB) on first use.
- Temporal Transformer needs `torch` and `model/tt_mapbiomas.pt` present.

## Imagery / STAC

### Zero scenes in the data cube or Classify fails with no products

- Widen the date range or raise max cloud cover.
- Disable monthly-best temporarily to see all candidates.
- Confirm the AOI intersects Sentinel-2 L2A coverage for that period.
- Check network access to Planetary Computer (corporate proxies can block STAC).

### Classification is very slow

- Shrink the AOI.
- Prefer spectral RF for interactive work; use Prithvi **patch** mode rather
  than **pixel** on large areas.
- Prefer monthly-best so the stack stays near one scene per month.

## MapBiomas / LULC

### No reference layer for a custom AOI

- MapBiomas COG fetch is intended for AOIs inside Brazil.
- Embedded areas A/B/C may also look for local TIFFs under a sibling
  `global/data/mapbiomas/` tree (`TERRA_ROOT`); without those files, COG
  fetch is used when possible.
- Classification still works without a reference overlay.

## Desktop / OS

### macOS: app won’t open (Gatekeeper)

Right-click → Open the first time, or clear quarantine on the unzipped app if
you trust the release build.

### Wrong model directory or missing `sidecar/infer.py`

Set `TERRA_APP_DIR` to the directory that contains `sidecar/`, `areas/`, and
`model/` (the repo root when developing from source).

### Saved analyses missing after reinstall

Runs live under the OS user config directory for `geosense-infer` (legacy name),
not inside the `.app` bundle. Clearing Application Support removes history.

## The interface feels slow

### Everything is slow, including other applications

Check whether it is this application at all: run a benchmark in another app —
Safari on <https://webglsamples.org/aquarium/aquarium.html> shows its own frame
rate — on the same macOS space, and then on a different one. If the other
application is also slow beside TERRA and fast away from it, the cause is the
window rather than anything on screen inside it. That symptom had one cause
here, and it is fixed; see [Performance](PERFORMANCE.md).

### The studio stutters while orbiting

Switch on **Profile → Telemetry → Page frame rate** first. It measures how fast
the browser is delivering frames at all, which is what says whether the studio
is the cause. A low page rate with the frame work near zero means nothing being
drawn in the studio is the reason.

Leave it off afterwards: it is the one figure that costs something to have on.

### It is slow when run from source but not from a build

Expected, and worth measuring past. `wails dev` serves modules one at a time,
runs React's development build, keeps a hot-reload socket open and watches the
whole repository tree — `.venv` and `node_modules` included. Measure a
`wails build` binary before concluding anything about performance.

## Still stuck?

Open an issue at https://github.com/rexionmars/TERRA/issues with OS, TERRA
version/commit, Python version, and the full error text from the UI or terminal.
