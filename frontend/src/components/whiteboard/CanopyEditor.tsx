/**
 * A stand of plants, grown and drawn.
 *
 * WHAT IT IS FOR. To show the crop. A reader asking to see a canopy means the
 * plants -- stems, blades, the way rows close over as they grow -- and this
 * grows them with Helios and draws the triangles.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO BE REPLACED RATHER THAN IMPROVED. The
 * earlier surface drew a leaf-area density on a voxel grid: a translucent box
 * with a ray-march in it. That is a correct picture of a field of numbers and
 * an unrecognisable one of a crop, and no amount of shading fixes it, because
 * the density has no leaf in it to draw. The architecture is integrated away at
 * the moment the field is built -- feeding the voxeliser a real Helios plant
 * still yields a box, since the voxeliser's whole job is to turn geometry into
 * numbers. So there was no incremental path from that view to this one, and
 * keeping it beside this would only invite the two to be mistaken for each
 * other. The march, the field and the extinction coefficient still exist in
 * sidecar/canopy_field.py, where they answer the question they are good at:
 * how much light gets through. They are not a picture.
 *
 * WHERE THE PARAMETERS LIVE. In the body, not the header, for the reason the
 * previous surface gave and which still holds: a stand IS its species, its age
 * and its sowing geometry, so those are the subject rather than a view of it.
 *
 * NO SLIDERS, which in this project is a rule rather than a preference:
 * `components/whiteboard/` contains none, and NumberField's own docblock argues
 * the case.
 *
 * COST, WHICH IS THE ONE REAL DIFFERENCE FROM THE FIELD. Growing twenty sorghum
 * to day 60 is about two seconds and a few hundred thousand triangles, where
 * building a field was well under a second. So this does not rebuild while a
 * value is being scrubbed: the parameters are staged and a Grow button commits
 * them. Debouncing a two-second job would only make the surface feel broken.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2, Sprout } from "lucide-react"

import { NumberField } from "@/components/ui/NumberField"
import { cn } from "@/lib/utils"
import { BuildCanopyFromAOI, BuildCanopyMesh } from "../../../wailsjs/go/main/App"

import { CanopyFromAOIPanel, type AOICanopy } from "./CanopyFromAOI"
import { createStandScene, type StandHandle } from "./standScene"

/*
  The species plantarchitecture ships, mirrored from sidecar/helios_grow.py.

  Recorded here rather than fetched so the picker can be offered on a machine
  with no toolkit installed, which is the common case: the package is an
  optional extra. A name that disappears upstream fails against helios_grow's
  own list with a message naming what it ships.
*/
const SPECIES = [
  "sorghum", "maize", "wheat", "rice", "soybean", "cowpea", "bean",
  "tomato", "cherrytomato", "capsicum", "strawberry", "sugarbeet",
  "asparagus", "butterlettuce", "grapevine_VSP", "grapevine_Wye",
  "almond", "apple", "apple_fruitingwall", "olive", "pistachio", "walnut",
  "easternredbud", "bougainvillea",
] as const

interface Stand {
  species: string
  days: number
  rows: number
  perRow: number
  interRow: number
  interPlant: number
}

const DEFAULT_STAND: Stand = {
  // Sorghum because it is the crop the numerical studies grew, so a reader can
  // hold this beside the figures in that repository.
  species: "sorghum",
  days: 60,
  // Twelve plants is a stand that reads as a stand and still grows in about a
  // second. The mesh is roughly 264k triangles at day 60, most of it blade.
  rows: 3,
  perRow: 4,
  interRow: 0.8,
  interPlant: 0.25,
}

interface MeshState {
  species: string
  days: number
  plants: number
  leafArea: number
  bytes: number
  organs: Record<string, number>
}

const metres = (v: number) => `${v.toFixed(2)} m`
const readMetres = (t: string) => {
  const v = parseFloat(t.replace("m", "").trim())
  return Number.isFinite(v) ? v : null
}
const degrees = (v: number) => `${Math.round(v)}°`
const readDegrees = (t: string) => {
  const v = parseFloat(t.replace("°", "").trim())
  return Number.isFinite(v) ? v : null
}

/*
  The runs this editor may read, and why the prop is optional.

  The comment beside `canopy:` in BoardSurface says this editor takes no props
  because the orchard is its own subject rather than a view of the studio's
  state -- which is what lets two areas hold two different stands and compare
  them. That is still true and is not being given up: with no run selected the
  editor behaves exactly as it did, and the AOI mode simply is not offered.

  What a run adds is the one thing the reader cannot type: the ground. The
  vegetation-index series is the only input here that was measured rather than
  chosen.
*/
export interface CanopyRun {
  id: string
  label: string
  // Nullable and not merely optional, because that is what the generated
  // binding carries: a run whose acquisitions yielded no index series has
  // `vi_series: null`, and narrowing it away here would put the check in the
  // wrong file.
  result: { vi_series?: Array<{ date: string; ndvi_mean: number }> | null }
}

export function CanopyEditor({ runs }: { runs?: CanopyRun[] } = {}) {
  const [stand, setStand] = useState<Stand>(DEFAULT_STAND)
  const [elevation, setElevation] = useState(50)
  const [azimuth, setAzimuth] = useState(35)

  const [mesh, setMesh] = useState<MeshState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- the AOI mode --------------------------------------------------------
  const withSeries = useMemo(
    () => (runs ?? []).filter((r) => (r.result?.vi_series?.length ?? 0) >= 3),
    [runs]
  )
  const [aoiId, setAoiId] = useState<string | null>(null)
  const [aoi, setAoi] = useState<AOICanopy | null>(null)
  const [aoiBusy, setAoiBusy] = useState(false)
  const selectedRun = withSeries.find((r) => r.id === aoiId) ?? null

  const readAOI = useCallback(async () => {
    if (!selectedRun?.result?.vi_series) return
    setAoiBusy(true)
    try {
      const built = await BuildCanopyFromAOI({
        species: stand.species,
        vi_series: selectedRun.result.vi_series,
        inter_row: stand.interRow,
        inter_plant: stand.interPlant,
      } as never)
      setAoi(built as unknown as AOICanopy)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setAoi(null)
    } finally {
      setAoiBusy(false)
    }
  }, [selectedRun, stand.species, stand.interRow, stand.interPlant])
  // What the drawn stand was grown from, so the button can say whether the
  // staged parameters still describe what is on screen.
  const [drawn, setDrawn] = useState<Stand | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StandHandle | null>(null)

  // --- the scene -----------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let scene: StandHandle | null = null
    try {
      scene = createStandScene(host, { view: { elevation, azimuth } })
    } catch {
      setError("This area could not open a WebGL context. Close another 3D area and reopen it.")
      return
    }
    sceneRef.current = scene
    return () => {
      sceneRef.current = null
      scene?.dispose()
    }
    // Created once per mount, like the board: every parameter reaches it
    // through a setter rather than by rebuilding, which would drop the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setView({ elevation, azimuth })
  }, [elevation, azimuth])

  // --- growing -------------------------------------------------------------

  const grow = useCallback(async () => {
    setBusy(true)
    /*
      Each await is labelled because the failure that took four attempts to
      place -- "Maximum call stack size exceeded" -- carries no stack that
      points anywhere useful and can be thrown by any of three different layers:
      the Wails bridge marshalling a reply, the fetch decoding a payload, or the
      loader walking a scene. Naming the step turns the next report into a
      location instead of a symptom.
    */
    let step = "calling the sidecar"
    try {
      const built = await BuildCanopyMesh({
        species: stand.species,
        days: stand.days,
        rows: stand.rows,
        per_row: stand.perRow,
        inter_row: stand.interRow,
        inter_plant: stand.interPlant,
      } as never)
      step = `fetching and drawing ${built.url} (${(built.bytes / 1e6).toFixed(1)} MB)`
      await sceneRef.current?.setMesh(built.url)
      step = "recording what was drawn"
      setMesh({
        species: built.species,
        days: built.days,
        plants: built.plants,
        leafArea: built.leaf_area,
        bytes: built.bytes,
        organs: (built.organs ?? {}) as Record<string, number>,
      })
      setDrawn(stand)
      setError(null)
    } catch (e) {
      // Every refusal on the way here names what to change -- a missing
      // toolkit, an unknown species, a stand too large to carry -- so the
      // message is shown verbatim. The step is prefixed to it because the one
      // failure that did NOT name anything was a stack overflow, and knowing
      // which of these three layers threw it is the whole difficulty.
      const detail = e instanceof Error ? e.message : String(e)
      setError(`while ${step}: ${detail}`)
    } finally {
      setBusy(false)
    }
  }, [stand])

  // Grown once on mount so the area opens with a canopy in it rather than an
  // empty frame and an instruction.
  useEffect(() => {
    void grow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stale = useMemo(
    () => drawn !== null && JSON.stringify(drawn) !== JSON.stringify(stand),
    [drawn, stand]
  )

  const set = useCallback(
    <K extends keyof Stand>(key: K) =>
      (v: Stand[K]) =>
        setStand((prev) => ({ ...prev, [key]: v })),
    []
  )
  const setNumber = useCallback(
    <K extends keyof Stand>(key: K) =>
      (v: number) =>
        setStand((prev) => ({ ...prev, [key]: v })),
    []
  )
  /*
    Rounded on the way in, for the fields the sidecar types as whole numbers.

    `parse` only runs on text the reader types; scrubbing calls onChange with
    the continuous value under the pointer, so dragging Day produced 89.319…
    and Go refused the request with

        json: cannot unmarshal number 89.3192471590909 into Go struct field
        CanopyMeshRequest.days of type int

    Rounding in the setter rather than at the call site, because the field is
    an integer everywhere it is read -- a day, a row count, plants per row --
    and a float in the state would be wrong even before it reached the bridge.
  */
  const setWholeNumber = useCallback(
    <K extends keyof Stand>(key: K) =>
      (v: number) =>
        setStand((prev) => ({ ...prev, [key]: Math.round(v) })),
    []
  )

  const triangles = useMemo(
    () => Object.values(mesh?.organs ?? {}).reduce((a, b) => a + b, 0),
    [mesh]
  )

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1"
        style={{ background: "rgb(var(--p-ink))" }}
      >
        {busy ? (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded px-2 py-1 text-[11px]"
               style={{ background: "var(--p-surface-raised)", color: "var(--p-text-muted)" }}>
            <Loader2 className="h-3 w-3 animate-spin" />
            growing {stand.species}
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded px-2 py-1.5 text-[11px]"
               style={{ background: "var(--p-surface-raised)", color: "var(--p-text)" }}>
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" style={{ color: "var(--p-warning)" }} />
            <span className="leading-snug">{error}</span>
          </div>
        ) : null}
      </div>

      {/*
        The AOI reading, when a run with a series is selected. Sits between the
        stand and its parameters because it is about the same stand: the sowing
        below is what turns the observed LAI into an age, so the two have to be
        read together.
      */}
      {aoi && (
        <div className="max-h-[46%] shrink-0 overflow-auto border-t"
             style={{ borderColor: "var(--p-line)", background: "var(--p-surface)" }}>
          <CanopyFromAOIPanel data={aoi} />
        </div>
      )}

      {/*
        Offered only when a run carries a series long enough to read. An empty
        picker would promise a mode the studio cannot enter, and the editor's
        own subject -- a stand the reader builds -- is still there without it.
      */}
      {withSeries.length > 0 && (
        <div
          className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-2 border-t px-3 py-2"
          style={{ borderColor: "var(--p-line)", background: "var(--p-surface)" }}
        >
          <div className="shrink-0">
            <label className="block text-[10px] uppercase tracking-wide"
                   style={{ color: "var(--p-text-muted)" }}>
              AOI analisada
            </label>
            <select
              value={aoiId ?? ""}
              onChange={(e) => {
                setAoiId(e.target.value || null)
                setAoi(null)
              }}
              className="mt-0.5 h-6 max-w-[16rem] rounded border bg-transparent px-1 text-[12px] outline-none"
              style={{ borderColor: "var(--p-line)", color: "var(--p-text)" }}
            >
              <option value="">— nenhuma —</option>
              {withSeries.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.result.vi_series?.length} datas)
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void readAOI()}
            disabled={!selectedRun || aoiBusy}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1.5 rounded border px-2 text-[12px]",
              !selectedRun || aoiBusy ? "opacity-50" : "hover:brightness-110"
            )}
            style={{ borderColor: "var(--p-line)", color: "var(--p-text)" }}
          >
            {aoiBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sprout className="h-3 w-3" />
            )}
            {aoiBusy ? "Lendo" : "Ler a AOI"}
          </button>
          <span className="text-[10px]" style={{ color: "var(--p-text-muted)" }}>
            usa a espécie e a semeadura abaixo
          </span>
        </div>
      )}

      <div
        className="flex shrink-0 flex-wrap items-end gap-x-5 gap-y-2 border-t px-3 py-2"
        style={{ borderColor: "var(--p-line)", background: "var(--p-surface)" }}
      >
        <div className="shrink-0">
          <label className="block text-[10px] uppercase tracking-wide"
                 style={{ color: "var(--p-text-muted)" }}>
            Species
          </label>
          <select
            value={stand.species}
            onChange={(e) => set("species")(e.target.value)}
            className="mt-0.5 h-6 rounded border bg-transparent px-1 text-[12px] outline-none"
            style={{ borderColor: "var(--p-line)", color: "var(--p-text)" }}
          >
            {SPECIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="shrink-0">
          <NumberField
            label="Day"
            value={stand.days}
            min={5}
            max={200}
            step={5}
            format={(v) => `${Math.round(v)}`}
            parse={(t) => {
              const v = parseInt(t, 10)
              return Number.isFinite(v) ? v : null
            }}
            onChange={setWholeNumber("days")}
          />
        </div>

        <div className="shrink-0">
          <NumberField
            label="Rows"
            value={stand.rows}
            min={1}
            max={8}
            step={1}
            format={(v) => `${Math.round(v)}`}
            parse={(t) => {
              const v = parseInt(t, 10)
              return Number.isFinite(v) ? v : null
            }}
            onChange={setWholeNumber("rows")}
          />
        </div>

        <div className="shrink-0">
          <NumberField
            label="Per row"
            value={stand.perRow}
            min={1}
            max={10}
            step={1}
            format={(v) => `${Math.round(v)}`}
            parse={(t) => {
              const v = parseInt(t, 10)
              return Number.isFinite(v) ? v : null
            }}
            onChange={setWholeNumber("perRow")}
          />
        </div>

        <div className="shrink-0">
          <NumberField
            label="Row spacing"
            value={stand.interRow}
            min={0.1}
            max={6}
            step={0.05}
            format={metres}
            parse={readMetres}
            onChange={setNumber("interRow")}
          />
        </div>

        <div className="shrink-0">
          <NumberField
            label="In row"
            value={stand.interPlant}
            min={0.05}
            max={4}
            step={0.05}
            format={metres}
            parse={readMetres}
            onChange={setNumber("interPlant")}
          />
        </div>

        <div className="shrink-0">
          <NumberField
            label="Sun"
            value={elevation}
            min={2}
            max={90}
            step={1}
            format={degrees}
            parse={readDegrees}
            onChange={setElevation}
          />
        </div>

        <div className="shrink-0">
          <NumberField
            label="Azimuth"
            value={azimuth}
            min={0}
            max={359}
            step={5}
            format={degrees}
            parse={readDegrees}
            onChange={setAzimuth}
          />
        </div>

        {/*
          A button rather than a debounce, because growing is seconds rather
          than milliseconds: rebuilding while a number is being scrubbed would
          queue jobs the reader has already moved past and make the surface feel
          stuck. It says so when the staged parameters no longer describe what
          is drawn.
        */}
        <button
          type="button"
          onClick={() => void grow()}
          disabled={busy}
          className={cn(
            "ml-auto flex h-6 shrink-0 items-center gap-1.5 rounded border px-2 text-[12px]",
            busy ? "opacity-50" : "hover:brightness-110"
          )}
          style={{
            borderColor: stale ? "var(--p-accent)" : "var(--p-line)",
            color: stale ? "var(--p-accent)" : "var(--p-text)",
          }}
        >
          <Sprout className="h-3 w-3" />
          {busy ? "Growing" : stale ? "Regrow" : "Grow"}
        </button>
      </div>

      {mesh ? (
        <div
          className="flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-1 border-t px-3 py-1.5 text-[11px]"
          style={{ borderColor: "var(--p-line)", background: "var(--p-surface)", color: "var(--p-text-muted)" }}
        >
          <span>
            {mesh.plants} {mesh.species} at day {mesh.days}
          </span>
          {/*
            Helios's own figure for the stand, not one this surface derived. It
            is here because it is the quantity the light calculation would
            consume, so a reader can tell this is the canopy those numbers would
            have described.
          */}
          <span>{mesh.leafArea.toFixed(2)} m² of leaf</span>
          <span>{triangles.toLocaleString()} triangles</span>
          <span>{(mesh.bytes / 1e6).toFixed(1)} MB</span>
          <span className="opacity-70">
            {Object.entries(mesh.organs)
              .map(([o, n]) => `${o} ${n.toLocaleString()}`)
              .join(" · ")}
          </span>
        </div>
      ) : null}
    </div>
  )
}
