/**
 * An orchard module, its shading, and the numbers that explain the shading.
 *
 * WHAT IT IS FOR. The same leaf area arranged two ways transmits very
 * differently, and the difference is not small: an orchard whose leaves sit in
 * crowns passes between two and thirteen times the light of a uniform canopy
 * holding the same area, because Beer-Lambert is not linear in density. That
 * ratio is what this editor exists to make visible -- the picture shows where
 * the light falls, and the readout says how far the arrangement moves the
 * answer away from the slab a coarser model would assume.
 *
 * WHERE THE PARAMETERS LIVE. In the body, not the header. The studio's header
 * carries chrome -- how a thing is shown, what is visible -- and these are not
 * that: an orchard IS its spacing, leaf area and crown shape, so they are the
 * editor's subject rather than a view of it. Keeping them here also makes two
 * canopies side by side work by construction, since each component holds its
 * own, rather than by threading a record keyed on area id through the surface.
 *
 * NO SLIDERS, which in this project is a rule rather than a preference:
 * `components/whiteboard/` contains none, and NumberField's own docblock argues
 * the case -- a slider spends a row on a value it cannot show, and returning to
 * an exact figure is a matter of aim.
 *
 * COST. Building the field is a sidecar round trip of well under a second, and
 * it is debounced so dragging a value does not queue one request per pixel.
 * The scene holds the second WebGL context in the application and releases it
 * when this unmounts; see canopyScene.ts for why that differs from the board.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"

import { NumberField } from "@/components/ui/NumberField"
import { cn } from "@/lib/utils"
import type { CanopyFieldMeta } from "@/lib/canopyShader"
import { BuildCanopyField } from "../../../wailsjs/go/main/App"

import { createCanopyScene, type CanopyHandle, type CanopyView } from "./canopyScene"

/** The orchard the user is describing. */
interface Orchard {
  spacing: number
  lai: number
  cell: number
  crownA: number
  crownB: number
  crownZ: number
}

const DEFAULT_ORCHARD: Orchard = {
  spacing: 6,
  lai: 2,
  // 6 / 0.3 is 20 cells across. The builder refuses a cell that does not divide
  // the module, because the march's periodic wrap needs a whole number of them.
  cell: 0.3,
  crownA: 1.8,
  crownB: 1.2,
  crownZ: 1.6,
}

interface FieldState {
  meta: CanopyFieldMeta
  grid: Float32Array
  againstUniform: Array<{ cos_zenith: number; field: number; uniform: number; ratio: number | null }>
}

function decodeGrid(base64: string): Float32Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

/** Sun direction from elevation and azimuth in degrees, in the field's frame. */
function sunVector(elevationDeg: number, azimuthDeg: number): [number, number, number] {
  const e = (elevationDeg * Math.PI) / 180
  const a = (azimuthDeg * Math.PI) / 180
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]
}

export function CanopyEditor() {
  const [orchard, setOrchard] = useState<Orchard>(DEFAULT_ORCHARD)
  const [elevation, setElevation] = useState(50)
  const [azimuth, setAzimuth] = useState(35)
  const [gain, setGain] = useState(1)
  const [mode, setMode] = useState<CanopyView["mode"]>("shadow")

  const [field, setField] = useState<FieldState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CanopyHandle | null>(null)

  // --- the field -----------------------------------------------------------

  const request = useMemo(
    () => ({
      source: "ellipsoid",
      spacing: orchard.spacing,
      lai: orchard.lai,
      cell: orchard.cell,
      crown_a: orchard.crownA,
      crown_b: orchard.crownB,
      crown_z: orchard.crownZ,
    }),
    [orchard]
  )

  useEffect(() => {
    let cancelled = false
    // Debounced because NumberField scrubs: dragging one value would otherwise
    // queue a Python process per pixel of travel.
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const built = await BuildCanopyField(request as never)
        if (cancelled) return
        setField({
          meta: built.field as unknown as CanopyFieldMeta,
          grid: decodeGrid(built.field_base64),
          againstUniform: built.against_uniform as never,
        })
        setError(null)
      } catch (e) {
        if (cancelled) return
        // The builder refuses geometry it cannot represent -- a cell that does
        // not divide the module, a crown containing no cell centre, a field
        // needing more marching steps than a fragment shader runs -- and every
        // refusal names what to change. Showing it is the whole point.
        setError(e instanceof Error ? e.message : String(e))
        setField(null)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request])

  // --- the scene -----------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let scene: CanopyHandle | null = null
    try {
      scene = createCanopyScene(host, {
        view: { sun: sunVector(elevation, azimuth), gain, mode },
      })
    } catch {
      // A context can fail even where the capability exists -- too many live
      // contexts, or a driver reset. The body says so rather than sitting
      // blank, because a blank surface says nothing.
      setError("This area could not open a WebGL context. Close another 3D area and reopen it.")
      return
    }
    sceneRef.current = scene
    return () => {
      sceneRef.current = null
      scene?.dispose()
    }
    // Created once per mount. Every parameter below reaches it through a
    // setter, never by rebuilding -- which would drop the camera and spend a
    // context on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (field) sceneRef.current?.setField(field.meta, field.grid)
  }, [field])

  useEffect(() => {
    sceneRef.current?.setView({ sun: sunVector(elevation, azimuth), gain, mode })
  }, [elevation, azimuth, gain, mode])

  const set = useCallback(
    <K extends keyof Orchard>(key: K) =>
      (v: number) =>
        setOrchard((prev) => ({ ...prev, [key]: v })),
    []
  )

  // --- the readout ---------------------------------------------------------

  const atSun = useMemo(() => {
    if (!field?.againstUniform.length) return null
    const target = Math.sin((elevation * Math.PI) / 180)
    return field.againstUniform.reduce((best, row) =>
      Math.abs(row.cos_zenith - target) < Math.abs(best.cos_zenith - target) ? row : best
    )
  }, [field, elevation])

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

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/*
        Each field is the width of its own label and value rather than a shared
        one. A uniform width has to be set for the longest name, which wastes it
        on "LAI" and still truncated "Spacing" -- and a truncated label on a
        control whose whole job is to say which quantity it holds is worse than
        an uneven row. The strip wraps at narrow widths instead of eliding.
      */}
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1 border-b border-line/60 px-2 py-1">
        <div className="shrink-0">
          <NumberField
            label="Spacing"
            value={orchard.spacing}
            min={1}
            max={20}
            step={0.5}
            format={metres}
            parse={readMetres}
            onChange={set("spacing")}
          />
        </div>
        <div className="shrink-0">
          <NumberField
            label="LAI"
            value={orchard.lai}
            min={0.1}
            max={8}
            step={0.1}
            // Leaf area per unit ground, so it is a ratio and carries no unit.
            format={(v) => v.toFixed(2)}
            parse={(t) => {
              const v = parseFloat(t)
              return Number.isFinite(v) ? v : null
            }}
            onChange={set("lai")}
          />
        </div>
        <div className="shrink-0">
          <NumberField
            label="Crown"
            value={orchard.crownA}
            min={0.2}
            max={8}
            step={0.1}
            format={metres}
            parse={readMetres}
            onChange={set("crownA")}
          />
        </div>
        <div className="shrink-0">
          <NumberField
            label="Height"
            value={orchard.crownZ}
            min={0.3}
            max={12}
            step={0.1}
            format={metres}
            parse={readMetres}
            onChange={set("crownZ")}
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

        <span className="flex-1" />

        {/*
          A closed set of two, so buttons rather than a field -- the rule the
          brush radius follows in BoardSolarDetail.
        */}
        <div className="flex gap-0.5">
          {(
            [
              ["shadow", "Ground"],
              ["volume", "Volume"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[9px] transition-colors",
                mode === id
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:bg-surface-raised/40"
              )}
              title={
                id === "shadow"
                  ? "Direct light reaching the orchard floor"
                  : "The leaf-area density itself, shaded by what reaches each cell"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="shrink-0">
          <NumberField
            label="Gain"
            value={gain}
            min={0.2}
            max={4}
            step={0.1}
            format={(v) => `${v.toFixed(1)}x`}
            parse={(t) => {
              const v = parseFloat(t.replace("x", "").trim())
              return Number.isFinite(v) ? v : null
            }}
            onChange={setGain}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" />

        {busy ? (
          <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 text-meta text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            building
          </span>
        ) : null}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/80 px-6">
            <p className="flex max-w-[26rem] items-start gap-2 text-center text-meta text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
              <span className="text-left">{error}</span>
            </p>
          </div>
        ) : null}
      </div>

      {field ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line/60 px-2 py-1 text-meta text-muted-foreground">
          <span>
            {field.meta.n_xy}&times;{field.meta.n_xy}&times;{field.meta.n_z} cells
          </span>
          <span>
            {(field.meta.occupancy * 100).toFixed(0)}% occupied at{" "}
            {field.meta.density_in_crown.toFixed(1)} m&sup2;/m&sup3;
          </span>
          {atSun?.ratio != null ? (
            <span title="Beer-Lambert is not linear in density, so the same leaf area gathered into crowns passes more light than a slab of it. The figure is the whole reason for modelling the arrangement rather than the average.">
              passes {atSun.ratio.toFixed(1)}&times; a uniform canopy of the same
              leaf area
            </span>
          ) : null}
          <span className="opacity-60">
            {field.meta.source === "ellipsoid" ? "ellipsoid crowns" : "grown leaves"}
          </span>
        </div>
      ) : null}
    </div>
  )
}
