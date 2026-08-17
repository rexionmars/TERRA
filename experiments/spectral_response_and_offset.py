"""
Per-pixel spectral response, the baseline 04.00 offset, and matching against a
spectral library.

WHAT THIS IS FOR. Three questions, in the order they have to be answered:

  1. Is the Sentinel-2 BOA_ADD_OFFSET applied? Since processing baseline 04.00
     (25 January 2022) L2A products carry a band-dependent offset of -1000, so
     reflectance is (DN + offset) / 10000. sidecar/infer.py divides by 10000
     with no offset term. Nothing downstream is trustworthy until this is
     settled, because every normalised index compresses toward zero when a
     constant is added to both of its bands.

  2. What does the spectrum of each predicted class look like, and how wide is
     it within one AOI? This is the reading the application does not currently
     expose, and it is what would explain a domain-shift number band by band
     rather than as a single distance.

  3. Can a pixel be matched against a spectral library? Only after the library
     spectrum is convolved with the Sentinel-2 spectral response functions,
     since a library is hyperspectral and this sensor has a handful of broad
     bands.

WHAT IT WRITES. CSV only, into experiments/data. Plotting is plot_spectral.R,
which is the split docs/DESIGN and the project conventions ask for: Python
computes and exports, R draws. Nothing here writes into the app.

    .venv/bin/python experiments/spectral_response_and_offset.py
    Rscript experiments/plot_spectral.R

CLASS NAMES, NOT CODES. Every table carries class_name beside class_id. The
five integers the classifier emits are MapBiomas codes, and 39 means nothing to
a reader who has not memorised that legend.
"""
# %%
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
# The sidecar's modules import each other flat (`from class_palette import ...`),
# so it is that directory that goes on the path, not the repository root.
sys.path.insert(0, str(REPO / "sidecar"))

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)

from infer import (  # noqa: E402
    list_stac_products,
    load_band_to_reference_grid,
    load_and_clip_band,
)
from class_palette import CLASSIFIER_LEGEND, CLASSIFIER_COLORS  # noqa: E402
from shapely.geometry import shape  # noqa: E402
import joblib  # noqa: E402

# The offset the baseline introduced. Reflectance is (DN + BOA_ADD_OFFSET) / QV.
BOA_ADD_OFFSET = -1000.0
QUANTIFICATION_VALUE = 10000.0

# Band centres in nm, so a spectrum can be drawn in wavelength order rather
# than in the order band names happen to sort in.
BAND_NM = {
    "B02": 492.4, "B03": 559.8, "B04": 664.6, "B05": 704.1, "B06": 740.5,
    "B07": 782.8, "B08": 832.8, "B8A": 864.7, "B11": 1613.7, "B12": 2202.4,
}
# What the sidecar reads today: four at 10 m, three at 20 m.
TERRA_BANDS = [("B02", "10m"), ("B03", "10m"), ("B04", "10m"), ("B08", "10m"),
               ("B8A", "20m"), ("B11", "20m"), ("B12", "20m")]
BAND_ORDER = [b for b, _ in TERRA_BANDS]

NO_OFFSET, WITH_OFFSET = "DN / 10000", "offset applied"

# A study area in Cascavel, Parana, where the shipped models were fitted. Any
# polygon works; this one keeps the test on ground the classifier is entitled
# to speak about.
AOI = shape({
    "type": "Polygon",
    "coordinates": [[
        [-53.52, -24.92], [-53.46, -24.92], [-53.46, -24.87],
        [-53.52, -24.87], [-53.52, -24.92],
    ]],
})
START, END = "2025-08-16", "2026-08-16"
MAX_CLOUD = 40.0
MODEL = REPO / "model"


def band_frame(mapping, value_name):
    """A band-keyed dict as a tidy frame, wavelength-ordered."""
    return pd.DataFrame([
        {"band": b, "wavelength_nm": BAND_NM[b], value_name: mapping[b]}
        for b in BAND_ORDER
    ]).sort_values("wavelength_nm")


# The legend, written out so R never has to know a MapBiomas code.
legend = pd.DataFrame([
    {"class_id": cid, "class_name": CLASSIFIER_LEGEND[cid],
     "color": CLASSIFIER_COLORS[cid]}
    for cid in sorted(CLASSIFIER_LEGEND)
])
legend.to_csv(DATA / "class_legend.csv", index=False)
NAME = dict(zip(legend.class_id, legend.class_name))
print(legend.to_string(index=False))


# %%
# ---------------------------------------------------------------- discovery
products = list_stac_products(AOI, START, END, max_cloud=MAX_CLOUD,
                              monthly_best=True)
scenes = pd.DataFrame([{
    "scene_id": p.get("id", "?"),
    "date": str(p.get("datetime", ""))[:10],
    "cloud_cover_pct": round(float(p.get("cloud_cover", float("nan"))), 1),
} for p in products])
scenes.to_csv(DATA / "scenes.csv", index=False)
print(f"\n{len(products)} scenes over the AOI")


# %%
# ------------------------------------------------- 1. is the offset applied?
def read_stack(product, bands=TERRA_BANDS):
    """
    Raw DN for one scene on a common grid, as the sidecar reads it.

    Returned as DN rather than reflectance on purpose: the whole question is
    what the conversion should be, so the conversion is not done here.
    """
    _, ref_prof = load_and_clip_band(product, "B04", AOI, "10m")
    out = {name: load_band_to_reference_grid(product, name, AOI, ref_prof,
                                            resolution=res).astype("float64")
           for name, res in bands}
    return out, ref_prof


def to_reflectance(dn, apply_offset):
    """Both conventions, so they can be compared rather than argued about."""
    return ((dn + BOA_ADD_OFFSET) / QUANTIFICATION_VALUE if apply_offset
            else dn / QUANTIFICATION_VALUE)


scene = products[len(products) // 2]
stack, prof = read_stack(scene)
print(f"scene {scene.get('id')}")

valid = np.ones_like(stack["B04"], dtype=bool)
for a in stack.values():
    valid &= np.isfinite(a) & (a > 0)
print(f"{valid.sum()} valid pixels of {valid.size}")

rows = []
for band in BAND_ORDER:
    v = stack[band][valid]
    for convention, on in ((NO_OFFSET, False), (WITH_OFFSET, True)):
        rows.append({
            "band": band, "wavelength_nm": BAND_NM[band],
            "dn_median": float(np.median(v)), "convention": convention,
            "reflectance": float(np.median(to_reflectance(v, on))),
        })
aoi_spectrum = pd.DataFrame(rows).sort_values(["convention", "wavelength_nm"])
aoi_spectrum.to_csv(DATA / "aoi_spectrum.csv", index=False)
print("\n" + aoi_spectrum.pivot_table(index="band", columns="convention",
                                      values="reflectance")
      .reindex(BAND_ORDER).to_string(float_format=lambda x: f"{x:6.3f}"))


# %%
# ------------------------------------------- the effect on a normalised index
def ndvi(red, nir):
    d = nir + red
    return np.where(d > 0, (nir - red) / d, np.nan)


n_no = ndvi(to_reflectance(stack["B04"], False),
            to_reflectance(stack["B08"], False))[valid]
n_yes = ndvi(to_reflectance(stack["B04"], True),
             to_reflectance(stack["B08"], True))[valid]

# Adding a constant c to both bands leaves the numerator alone and inflates the
# denominator by 2c, so the compression is worst where NDVI is highest. A
# subsample is enough to show that and keeps the file small.
idx = np.random.default_rng(0).choice(n_no.size, size=min(20000, n_no.size),
                                      replace=False)
pd.DataFrame({"ndvi_no_offset": n_no[idx],
              "ndvi_with_offset": n_yes[idx]}).to_csv(
    DATA / "ndvi_pairs.csv", index=False)

pd.DataFrame([{
    "convention": c,
    "ndvi_median": float(np.median(v)),
    "ndvi_p05": float(np.percentile(v, 5)),
    "ndvi_p95": float(np.percentile(v, 95)),
} for c, v in ((NO_OFFSET, n_no), (WITH_OFFSET, n_yes))]).to_csv(
    DATA / "ndvi_summary.csv", index=False)
print(f"\nNDVI median {np.median(n_no):.3f} -> {np.median(n_yes):.3f}"
      f" | p95 {np.percentile(n_no, 95):.3f} -> {np.percentile(n_yes, 95):.3f}")


# %%
# ------------------------------ 2. spectrum per class, with its own dispersion
# Classes come from the shipped model, so what is described is what the
# application would report, not an independent segmentation.
rf = joblib.load(MODEL / "rf_classifier.joblib")
scaler = joblib.load(MODEL / "scaler.joblib")
le = joblib.load(MODEL / "label_encoder.joblib")
feature_names = joblib.load(MODEL / "feature_names.joblib")
# 22 raw NDVI dates. infer.py derives it as len(feature_names) - 58, which
# follows the shipped artifact rather than a literal.
n_dates_model = len(feature_names) - 58

from infer import build_feature_matrix  # noqa: E402

X, mask = build_feature_matrix(products, AOI, prof, n_dates_model)
if X is None:
    raise SystemExit("no feature matrix; widen the period or raise MAX_CLOUD")
Xs = scaler.transform(X)
pred = le.inverse_transform(rf.predict(Xs))
conf = rf.predict_proba(Xs).max(axis=1)
print(f"\n{len(pred)} classified pixels; mean confidence {conf.mean():.3f}")
pd.DataFrame({"mean_confidence": [float(conf.mean())],
              "n_pixels": [int(len(pred))],
              "n_scenes": [len(products)],
              "n_dates_model": [int(n_dates_model)]}).to_csv(
    DATA / "classification_summary.csv", index=False)

rows = []
flat_valid = mask.reshape(-1)
for band in BAND_ORDER:
    dn_flat = stack[band].reshape(-1)[flat_valid]
    for convention, on in ((NO_OFFSET, False), (WITH_OFFSET, True)):
        rho = to_reflectance(dn_flat, on)
        for cls in np.unique(pred):
            sel = (pred == cls) & np.isfinite(rho)
            if sel.sum() < 30:
                continue
            rows.append({
                "class_id": int(cls), "class_name": NAME[int(cls)],
                "band": band, "wavelength_nm": BAND_NM[band],
                "convention": convention, "n_pixels": int(sel.sum()),
                "mean": float(np.mean(rho[sel])),
                "sd": float(np.std(rho[sel])),
                "p05": float(np.percentile(rho[sel], 5)),
                "p95": float(np.percentile(rho[sel], 95)),
            })

class_spectra = pd.DataFrame(rows)
class_spectra.to_csv(DATA / "class_spectra.csv", index=False)
print("\n" + class_spectra[class_spectra.convention == WITH_OFFSET]
      .pivot_table(index="class_name", columns="band", values="mean")
      .reindex(columns=BAND_ORDER).to_string(float_format=lambda x: f"{x:6.3f}"))


# %%
# --------------------------------- 3. the sensor's own spectral response
# A library spectrum is hyperspectral and this sensor is not, so the two are
# not comparable until the library is passed through the sensor's response.
# ESA publishes those functions; the file is fetched rather than transcribed,
# because transcribing thirteen response curves by hand is how a silent error
# enters.
SRF_URLS = [
    "https://sentinels.copernicus.eu/documents/247904/685211/"
    "S2-SRF_COPE-GSEG-EOPG-TN-15-0007_3.1.xlsx",
    "https://landsat.usgs.gov/landsat/spectral_viewer/bands/"
    "Sentinel-2A%20MSI%20Spectral%20Responses.xlsx",
]
SRF_PATH = HERE / "s2_srf.xlsx"


def fetch(urls, path, timeout=300):
    """
    Download to `path`, or return None having said why not.

    Several sources are tried because ESA reorganises its document library and
    direct links rot. Nothing is substituted on failure: without the real
    curves there is no honest convolution, so the section declines to run.
    """
    if path.exists():
        return path
    import urllib.request
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r, \
                    open(path, "wb") as f:
                f.write(r.read())
            print(f"  fetched from {url.split('/')[2]}")
            return path
        except Exception as exc:  # noqa: BLE001
            print(f"  {url.split('/')[2]}: {type(exc).__name__}: {exc}")
    return None


def srf_column(band, satellite="S2A"):
    """The sheet drops the leading zero: B02 is B2, while B8A and B11 keep theirs."""
    short = f"B{int(band[1:])}" if band[1:].isdigit() else band
    return f"{satellite}_SR_AV_{short}"


def convolve(wavelength_nm, reflectance, srf_df, band, satellite="S2A"):
    """
    What this sensor would report looking at a hyperspectral spectrum.

        rho_band = integral(rho(l) S(l) dl) / integral(S(l) dl)

    The band is refused when the library does not span it, since a partially
    covered band is a number with no defined meaning.
    """
    col = srf_column(band, satellite)
    if col not in srf_df.columns:
        raise KeyError(f"{col} not in the SRF sheet")
    s_wl = srf_df["SR_WL"].to_numpy(float)
    s = srf_df[col].to_numpy(float)
    keep = s > 1e-6
    s_wl, s = s_wl[keep], s[keep]
    if s_wl.min() < np.min(wavelength_nm) or s_wl.max() > np.max(wavelength_nm):
        raise ValueError(f"library does not cover {band}")
    r = np.interp(s_wl, wavelength_nm, reflectance)
    return float(np.trapezoid(r * s, s_wl) / np.trapezoid(s, s_wl))


def spectral_angle(a, b):
    """
    Spectral Angle Mapper, in radians. Scale-invariant, which is why it is the
    standard choice: a material in shadow differs from the same material in sun
    by a multiplier, and the angle ignores exactly that.
    """
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(np.arccos(np.clip(
        np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)), -1, 1)))


print("\nspectral response functions:")
srf_file = fetch(SRF_URLS, SRF_PATH)
srf = None
if srf_file is not None:
    srf = pd.read_excel(srf_file, sheet_name="Spectral Responses (S2A)")

    # Prove the convolution rather than assert it. A flat spectrum at r must
    # come back as r in every band, whatever the response shape, because the
    # integral is normalised by the response's own area.
    wl = np.arange(380.0, 2500.0, 1.0)
    checks = []
    for r in (0.25, 0.60):
        got = {b: convolve(wl, np.full_like(wl, r), srf, b) for b in BAND_ORDER}
        dev = max(abs(v - r) for v in got.values())
        checks.append({"flat_reflectance": r, "max_deviation": dev})
        assert dev < 1e-9, got
    pd.DataFrame(checks).to_csv(DATA / "convolution_check.csv", index=False)
    print(f"  flat-spectrum check: max deviation {checks[-1]['max_deviation']:.1e}")

    # The width each reading integrates over, which is why a library cannot be
    # compared to these numbers channel by channel.
    bw = []
    w = srf["SR_WL"].to_numpy(float)
    for band in BAND_ORDER:
        s = srf[srf_column(band)].to_numpy(float)
        keep = s > 0.01 * s.max()
        bw.append({"band": band, "wavelength_nm": BAND_NM[band],
                   "lower_nm": float(w[keep].min()),
                   "upper_nm": float(w[keep].max()),
                   "width_nm": float(w[keep].max() - w[keep].min())})
    pd.DataFrame(bw).to_csv(DATA / "band_widths.csv", index=False)


# %%
# ------------------------- 4. the cross-reference, against real leaf spectra
# EcoSIS serves open vegetation libraries over HTTP. The package below is
# soybean, the crop class the shipped model is most exercised on.
ECOSIS_ID = "cdbb6b09-b481-4022-a0da-ad95a8b085d8"
ECOSIS_CSV = HERE / "ecosis_soybean.csv"

if srf is not None:
    lib_file = fetch([f"https://ecosis.org/api/package/{ECOSIS_ID}"
                      f"/export?metadata=true"], ECOSIS_CSV)
if srf is not None and lib_file is not None:
    lib = pd.read_csv(lib_file)
    wl_cols = [c for c in lib.columns if str(c).strip().replace(".", "").isdigit()]
    lib_wl = np.array([float(c) for c in wl_cols])
    R = lib[wl_cols].to_numpy(dtype=float)
    # Served as a percentage in this package: a leaf NIR plateau sits near 0.45,
    # not 45.
    if np.nanmedian(R) > 1.5:
        R = R / 100.0
    mean_leaf = np.nanmean(R, axis=0)
    print(f"\nEcoSIS soybean: {len(lib)} spectra, "
          f"{lib_wl.min():.0f}-{lib_wl.max():.0f} nm")

    lib_band = {b: convolve(lib_wl, mean_leaf, srf, b) for b in BAND_ORDER}
    ref_frame = band_frame(lib_band, "reflectance")
    ref_frame["source"] = "soybean leaf (EcoSIS)"
    ref_frame.to_csv(DATA / "library_reference.csv", index=False)

    # The full hyperspectral mean too, so the plot can show what the seven
    # broad readings are a summary OF.
    pd.DataFrame({"wavelength_nm": lib_wl,
                  "reflectance": mean_leaf}).to_csv(
        DATA / "library_hyperspectral.csv", index=False)

    ref = np.array([lib_band[b] for b in BAND_ORDER])
    ang = []
    for cls in sorted(class_spectra.class_id.unique()):
        for convention in (NO_OFFSET, WITH_OFFSET):
            v = (class_spectra[(class_spectra.class_id == cls)
                               & (class_spectra.convention == convention)]
                 .set_index("band").loc[BAND_ORDER, "mean"].to_numpy())
            ang.append({"class_id": int(cls), "class_name": NAME[int(cls)],
                        "convention": convention,
                        "angle_rad": spectral_angle(v, ref)})
    angles = pd.DataFrame(ang)
    angles.to_csv(DATA / "spectral_angles.csv", index=False)
    print("\n" + angles.pivot_table(index="class_name", columns="convention",
                                    values="angle_rad")
          .to_string(float_format=lambda x: f"{x:6.3f}"))

print(f"\nCSV written to {DATA}")
print("Draw with:  Rscript experiments/plot_spectral.R")


# %%
# ------------------- 5. what the library comparison can and cannot establish
# Everything below feeds one figure about a single claim: the convolution is
# right, and the leaf library still cannot identify a canopy pixel.
if srf is not None and lib_file is not None:
    # The response curves themselves, so the figure can show what the seven
    # readings are an integral OF rather than assert it.
    curves = []
    for band in BAND_ORDER:
        s = srf[srf_column(band)].to_numpy(float)
        keep = s > 1e-4
        curves.append(pd.DataFrame({
            "band": band, "wavelength_nm": srf["SR_WL"].to_numpy(float)[keep],
            "response": s[keep] / s.max(),
        }))
    pd.concat(curves).to_csv(DATA / "srf_curves.csv", index=False)

    # Leaf against canopy, band by band, with the ratio that names the gap.
    canopy = (class_spectra[class_spectra.convention == WITH_OFFSET]
              .pivot_table(index="class_name", columns="band", values="mean"))
    gap = []
    for cls in canopy.index:
        for band in BAND_ORDER:
            gap.append({"class_name": cls, "band": band,
                        "wavelength_nm": BAND_NM[band],
                        "canopy": float(canopy.loc[cls, band]),
                        "leaf": lib_band[band],
                        "canopy_over_leaf": float(canopy.loc[cls, band]) / lib_band[band]})
    pd.DataFrame(gap).to_csv(DATA / "leaf_vs_canopy.csv", index=False)

    # SAM is scale-invariant, so it compares unit vectors. Exporting those
    # makes the angle legible: what survives normalisation is shape, and the
    # shape still differs, which is why the gap is not merely brightness.
    def unit(v):
        v = np.asarray(v, float)
        return v / np.linalg.norm(v)

    shapes = [{"series": "soybean leaf (EcoSIS)", "band": b,
               "wavelength_nm": BAND_NM[b], "unit_reflectance": u}
              for b, u in zip(BAND_ORDER, unit(ref))]
    for cls in canopy.index:
        for b, u in zip(BAND_ORDER,
                        unit(canopy.loc[cls, BAND_ORDER].to_numpy())):
            shapes.append({"series": cls, "band": b,
                           "wavelength_nm": BAND_NM[b], "unit_reflectance": u})
    pd.DataFrame(shapes).to_csv(DATA / "unit_shapes.csv", index=False)

    print("\nleaf against canopy, ratio by band:")
    soy = canopy.loc["Soybean"]
    for b in BAND_ORDER:
        print(f"  {b}: canopy {soy[b]:.3f} / leaf {lib_band[b]:.3f}"
              f" = {soy[b] / lib_band[b]:.2f}")
