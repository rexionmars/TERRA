# Canopy time-of-day handoff — implementation brief

Brief for adding an hour control to the canopy stand view, so the sun travels a
real day instead of standing at one representative direction.

The data side is done and shipped. The sidecar already emits everything this
needs; the Go types already carry it; the scene already accepts a sky and casts
shadows. **What is missing is a control and the wiring from it.** Nothing in
this document requires touching Python or Go.

Source of truth for the surfaces described here:
[`sidecar/solar.py`](../sidecar/solar.py),
[`backend/types.go`](../backend/types.go),
[`frontend/src/components/whiteboard/standScene.ts`](../frontend/src/components/whiteboard/standScene.ts),
[`frontend/src/components/whiteboard/canopyWorkflow.tsx`](../frontend/src/components/whiteboard/canopyWorkflow.tsx).

---

## 1. Why this is worth building

The scene is currently lit by the window's **mean** sun: one direction, one
diffuse share, one clearness. Those are averages over a 21-day day-of-year
window across three years, and they flatten a curve that is already measured.

Taken from the cached POWER record for the cell this was developed against
(-42.5, -4.5), one real day of the February window:

| h UTC | elevation | air mass | diffuse/hour | clearness |
|------:|----------:|---------:|-------------:|----------:|
| 9     | 7°        | 7.8      | 0.80         | 0.89      |
| 11    | 37°       | 1.7      | 0.35         | 0.78      |
| 15    | 81°       | 1.0      | 0.44         | 0.84      |
| 18    | 39°       | 1.6      | 0.49         | 0.54      |
| 20    | 9°        | 6.3      | 0.96         | 0.49      |

Three things to read off it:

- **The diffuse share runs 0.31 to 0.96 inside one day.** The seasonal range
  the scene currently animates over is 0.293 to 0.447. The intraday signal is
  roughly three times larger, and it is being averaged away.
- **Clearness falls from 0.89 to 0.49 across the afternoon.** That is the
  ordinary tropical pattern — convective cloud building after noon — and it is
  the difference between a hard-shadowed morning and a flat, hazy evening.
- **Air mass runs 1.0 to 7.8.** `beamColour` in `standScene.ts` already turns
  that into a colour, and at 7° elevation it returns `(1.000, 0.807, 0.321)`.
  The scene can already render a sunrise; it is simply never asked to.

So the picture would gain a genuine day, and every frame of it is a measurement
rather than an interpolation between two guesses.

---

## 2. What already exists

### The payload

`canopy_from_aoi` returns `sun.track`: one **real day** of the window, hour by
hour. Not an hour-of-day average — see §5 for why that distinction is load
bearing. Alongside it, `sun.track_date` names the day, chosen by
`solar.representative_day` as the median day by beam total.

Each entry (`SunHour` in [`backend/types.go`](../backend/types.go)):

```ts
{
  hour_utc: number       // UTC. See §5.
  azimuth_deg: number    // compass bearing, clockwise from north
  elevation_deg: number
  dni: number            // W/m2
  dhi: number
  ghi: number
  diffuse_share?: number // ALREADY divided and clamped to [0,1]. See §5.
  clearness?: number     // ghi / clear-sky ghi, absent on old cached records
}
```

The TypeScript shape is already declared on `AOICanopy["sun"]` in
[`CanopyAOIEditor.tsx`](../frontend/src/components/whiteboard/CanopyAOIEditor.tsx),
so `w.aoi.sun.track` is typed and reachable today.

### The scene

`createStandScene` takes a `StandView`:

```ts
interface StandView {
  elevation: number      // in the SCENE's frame
  azimuth: number        // in the SCENE's frame — convert first, see §4
  sky?: {
    diffuseShare?: number
    clearness?: number
    cover?: number
  }
}
```

`setView` is cheap and idempotent — it repositions one light, sets three
colours and two intensities, and updates the fog. It is safe to call on every
frame of a scrub. It does **not** rebuild geometry or touch the shadow map size.

Exported helpers, all pure and unit-testable:

- `sceneAzimuthFromCompass(compassDeg, rowAzimuthDeg)` — the compass-to-scene
  conversion. **Required**; see §4.
- `airMass(elevationDeg)` — Kasten & Young (1989).
- `beamColour(elevationDeg)` — Rayleigh reddening, normalised to white at
  zenith.

---

## 3. What to build

**A control that picks an hour from `sun.track`, and the effect that applies
it.** Concretely:

1. Hold the chosen hour in `canopyWorkflow`, beside `sun`. It belongs to the
   workflow and not to a panel, for the reason that file's own header gives:
   two Stand panels showing one stand must not disagree about what time it is.

2. Add the control to `CanopyRunBar`, where every other canopy control lives.
   That band is built entirely from `<select>` and `NumberField`, so either
   matches what is already there. A `<select>` over the track's hours has the
   advantage that the track is a short, discrete list — twelve or thirteen
   entries — and the hours are not contiguous when the sun is down.

   (The project does use `type="range"` elsewhere, in `ControlPanel` and
   `OverlayToolsPanel`, so a slider is not forbidden — it simply is not what
   this band is made of.)

3. In `CanopyEditor`, derive the view from the selected hour instead of from
   `w.sun` and `w.aoi.sun`:

```ts
const hour = w?.trackHour == null ? null
  : w?.aoi?.sun?.track?.find((h) => h.hour_utc === w.trackHour) ?? null

const view = hour
  ? {
      elevation: hour.elevation_deg,
      azimuth: sceneAzimuthFromCompass(
        hour.azimuth_deg,
        w?.aoi?.light?.row_azimuth_deg ?? 0
      ),
      sky: {
        // Per hour, not the window mean. This is the whole point.
        // Read the field; do NOT divide dhi by ghi yourself (see §5).
        diffuseShare: hour.diffuse_share,
        clearness: hour.clearness,
        cover: w?.aoi?.light?.cover,
      },
    }
  : /* the current mean-sun view, unchanged */ null
```

4. **Keep the mean sun as a state, not delete it.** With no hour selected the
   scene should light exactly as it does today. The mean direction is what the
   faPAR beside it was integrated from, so it is the honest default; an hour is
   a reader asking a narrower question.

5. **Decide precedence against the read, and clear the hour on it.** This is the
   only part of the task that changes code already written rather than adding
   to it, and it is easy to leave broken in a way that looks like nothing.

   `canopyWorkflow.readArea` writes `sun` from `aoi.sun.direction` on every
   successful read. With an hour selected, pressing *Read area* relights the
   scene by the mean sun while the control still reads "09h" — the picture and
   the control disagree and neither is wrong on its own.

   Worse if the hour is held in `useKeptState` like the rest: reading a
   different area brings a different `track_date` and a different set of hours,
   the lookup in §3 falls through to `?? null`, and the scene silently reverts
   to the mean sun with the control still marked. Clear the hour on read,
   where `setSourceId` already clears what a new source invalidates.

   Suggested rule, stated so it is a decision rather than an accident: **a
   selected hour wins; with no hour, the seeded mean wins.**

---

## 4. The one thing that will be wrong if you skip it

`sun.track[].azimuth_deg` is a **compass bearing, clockwise from north**.
`StandView.azimuth` is measured **anticlockwise from the scene's +x**. They are
different conventions and the numbers are not interchangeable.

Pass a compass bearing straight into `setView` and the shadows will point
somewhere plausible and wrong — which is the expensive failure here, because
nothing looks broken. Use `sceneAzimuthFromCompass`, which mirrors
`canopy_field._canopy_azimuth` on the sidecar side so the picture and the number
are lit by one sun. The pairing is pinned by
`test_canopy_azimuth_is_mirrored_by_the_scene_in_typescript` in
`sidecar/tests/test_light_under_sun.py`, since the frontend has no test runner.

It takes the row azimuth as its second argument, because what joins a compass to
a field is the direction the rows run. Read it from `w.aoi.light.row_azimuth_deg`
rather than passing 0, even though the sidecar currently always sends 0 — when
that stops being true, this should not need finding again.

It carries one assumption, stated in its docstring and repeated here because it
is not verifiable from the frontend: **the loaded mesh has its rows along the
scene's +x.**

---

## 5. Three smaller traps

**The diffuse ratio is not bounded by 1, so do not compute it.** An earlier
draft of this brief told you to divide `dhi` by `ghi`. That ratio exceeds 1 in
the POWER record: over three years on this cell it reaches **1.531**, and
**4.2 percent of daylight hours exceed 1**, all at a median elevation of 3.3
degrees and none above 14.7. POWER's own components do not close there —
`(DHI + DNI·cos z)/GHI` has a median of 1.17 across those hours — so it is a
grazing-sun artefact in the source rather than an arithmetic slip.

`applyView` clamps, so the scene would not have broken; a caption would have
read "120% diffuse". The sidecar now emits `diffuse_share` per hour, already
divided and already clamped to [0, 1]. **Read the field.** It is absent for an
hour with no global irradiance, which is the correct answer rather than an
infinity.

**Hours are UTC, and the field name says so.** This module asks POWER for
`time-standard=UTC` explicitly; the API's default is Local Solar Time. At
longitude -42.5 solar noon falls near **14.8h UTC**, so the peak elevation lands
in the 14h or the 15h bin depending on the day — which is itself a reason not to
key anything on the label. A control captioned "12:00" that
selects `hour_utc === 12` will show a reader a mid-morning sun and call it noon.
Either convert for display using the AOI's longitude, or caption the control
"UTC" — but do not label a UTC hour as local. The scene itself does not care:
it is driven by azimuth and elevation, and the hour is only a caption.

**The track is one real day, not an average day.** This matters if you are
tempted to smooth or interpolate between hours. `representative_day` picks the
median day by beam total precisely to avoid averaging, because averaging
degenerates where these AOIs are: at latitude -4.5 the noon sun passes within
ten degrees of the zenith for much of the year, azimuth swings tens of degrees
in half an hour there, and a per-hour mean of azimuth produces a direction no
sun ever occupied. Interpolating *elevation* between adjacent hours is fine;
interpolating *azimuth* near the zenith is not, and a slerp of the direction
vectors is the safe form if smooth motion is wanted.

---

## 6. The grazing hours, and what the scene can actually draw

The track's ends are very low sun — 0.8° and 2.5° elevation on the day measured
above. A shadow at elevation *e* is `height / tan(e)`, and the shadow-catcher
plane spans four times the stand's footprint, about 6.4 m for the default stand,
so 3.2 m from the centre:

| elevation | shadow of a 1 m plant | fits the 3.2 m half-span? |
|----------:|----------------------:|:--------------------------|
| 2.5°      | 22.9 m                | no                        |
| 5°        | 11.4 m                | no                        |
| 10°       | 5.7 m                 | no                        |
| **20°**   | **2.7 m**             | **yes**                   |

So the shadow runs off the plane below roughly 20 degrees, not below 5. There is
a second limit behind it: the shadow *camera* is fitted to the stand's bounding
sphere with half a radius of padding, so a long shadow is clipped by the frustum
before the plane even matters. Widening either spreads the same 2048 map over
more ground and coarsens every shadow, including the ones at useful elevations.

None of this affects what ships today, because the mean sun on this cell sits at
56° in June and 80° in February — comfortably inside. It is the hour control
that introduces low sun, which is why the decision belongs to whoever builds it.
Three defensible answers:

- **Offer every hour and accept the clipping.** At 2° the whole scene is in
  shade anyway, which is approximately the truth, and a shadow that reaches the
  edge of a small ground plane is not obviously wrong to a reader.
- **Start the control above about 15–20°.** Loses the reddest, most striking
  hours — which is a real loss, since `beamColour` returns (1.000, 0.807, 0.321)
  at 7° and the scene can already render a sunrise.
- **Fit the shadow camera and the plane to the sun's own elevation** in
  `applyView`, capped so the map does not degrade past some floor. The most
  correct and the most work.

Measure before choosing: the beam at those hours is 23 to 80 W/m² against 754 at
noon, so they carry almost none of the day's energy. They are worth showing
because they are *legible*, not because they are *important*.

---

## 7. Optional, if the control lands well

`sun.track` carries `dni`, `dhi` and `ghi` per hour, so the same selection
supports a small day profile beside the viewport — the shape of the day, with
the selected hour marked. `EnergyModelSection.tsx` already has the
month-by-hour table that establishes the precedent for a diurnal figure, and
`allAnalysisTables` is where any new table has to live
(`StudioTables.tsx` forbids a new one outside it).

Cheaper and worth more: `sun.direction.concentration` says how well a single
direction represents the record at all. Near 1 the beam effectively arrived
from one place; low means the mean sun is a poor summary and the hour control
is the more honest reading. That number is a good candidate for the caption on
the control itself.

---

## 8. What is done and needs nothing

For avoidance of doubt, none of the following is part of this task:

- The seasonal window that dates the sky (`solar.doy_window_mask`).
- The mean beam direction, the track, the clearness (`sidecar/solar.py`).
- The Go types that carry them (`SunDirection`, `SunHour`, `CanopySun`).
- Shadow casting, the shadow-catcher plane, the fitted shadow camera.
- Diffuse-share light balance, Rayleigh beam colour, clearness sky colour,
  cover-driven ground bounce.
- The regression test that fails when the sidecar emits a key no Go struct
  declares (`backend/canopy_aoi_decode_test.go`).
