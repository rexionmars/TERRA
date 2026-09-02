/**
 * Overland routing over the area on the board, stated as a graph.
 *
 * A temporary module. It routes water across the AOI's terrain and reports
 * what the flow leaves behind, which is a different question from the flood
 * envelope: that one is static and measures how much of a HAND extent follows
 * from the choice of DEM, this one moves water over a single DEM.
 *
 * THE SHAPE IS THE REQUEST'S, as it is for every other run on this canvas. The
 * area, the rain and how it is routed are three inputs to one run; none
 * consumes another, so they fan in rather than chain.
 *
 * A second mode routed a breach hydrograph and is gone. Not for want of
 * hydraulics -- the equations are the same either way -- but because nothing
 * could reliably decide WHERE a channel enters a drawn polygon, and a breach
 * whose inlet lands on the outlet reports arithmetic rather than flood. It
 * returns when the inlet is a point the reader places. Rain needs no point,
 * which is why it is what remains.
 *
 * WHY THE CONTROLS ARE HERE AND NOT ON A RUN BAND. A run of this is a member
 * of a parameter sweep, where the object of interest is the comparison and not
 * any single run. A band along the foot carries the parameters of THE run, one
 * set for the whole board; the panel holds its own instead.
 *
 * WHAT IT ROUTES OVER IS THE LIVE AREA. Two of these panels open on two panes
 * currently answer about the same ground: a pane owns no area of its own until
 * it holds a pin for one, as the comparison editor does. Their parameters are
 * already separate, so the missing half is the pin and not the state.
 *
 * WHAT IS NOT SHOWN, AND WHY. There is no accuracy figure. Nothing here has
 * been compared against an observed flood and a number in that shape would be
 * read as one. What the result card shows instead are the two things that say
 * whether the run is self-consistent at all: the lake-at-rest residual, which
 * is the scheme's well-balancing check run on this terrain before any flow,
 * and the share of water that reached a boundary and left. A run that stores
 * everything it was given never found an outlet, and its depths are a filling
 * level rather than a routed wave -- said in words when it happens.
 */
import { useCallback, useMemo, useState } from "react"
import {
  CloudRain,
  Gauge,
  Pentagon,
  Play,
  Upload,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react"

import { AnalyzeFloodRouting } from "../../../wailsjs/go/main/App"
import type { analysis } from "../../../wailsjs/go/models"
import { NumberField } from "@/components/ui/NumberField"
import { cn } from "@/lib/utils"
import { NodeCanvas, type CanvasNode } from "./NodeCanvas"
import { Head } from "./nodeCard"
import { COL_GAP, NODE_W, ROW_GAP, type Place } from "./runGraph"

type Geometry = { type: string; coordinates: unknown } | null

/*
  Placed here rather than through runGraph's SPEC table. That table is the
  shape of a CLASSIFICATION, composition or solar request and its node ids are
  a closed union; adding routing's cards to it would widen a type four other
  surfaces read, to describe a graph none of them can draw. The geometry
  constants are shared, which is what keeps the columns and the wire curves
  identical to the run graph's.
*/
const NODE: Record<string, { label: string; icon: PhosphorIcon; h: number; col: number }> = {
  area: { label: "Area", icon: Pentagon, h: 74, col: 0 },
  rain: { label: "Rain", icon: CloudRain, h: 150, col: 0 },
  routing: { label: "Routing", icon: Gauge, h: 200, col: 1 },
  run: { label: "Route", icon: Play, h: 96, col: 2 },
}

function columnX(id: string): number {
  return NODE[id].col * (NODE_W + COL_GAP)
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span className="telemetry text-foreground">{value}</span>
    </div>
  )
}

/** Median, 90th and max on one line, or a word where nothing wetted. */
function Spread({
  label,
  spread,
  unit,
  digits = 1,
}: {
  label: string
  spread?: analysis.FloodRoutingSpread
  unit: string
  digits?: number
}) {
  const has = spread?.median !== undefined && spread?.median !== null
  const fmt = (v: number | undefined | null) =>
    v === undefined || v === null ? "--" : v.toFixed(digits)
  return (
    <Row
      label={label}
      value={
        has ? (
          <>
            {fmt(spread?.median)}
            <span className="text-muted-foreground">
              {" "}
              {fmt(spread?.p90)} {fmt(spread?.max)} {unit}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">not reached</span>
        )
      }
    />
  )
}

const num = (min: number) => (t: string) => {
  const n = Number.parseFloat(t)
  return Number.isFinite(n) && n >= min ? n : null
}

export function FloodRoutingPanel({
  geometry,
  areaLabel,
  onResult,
  onImport,
}: {
  geometry: Geometry
  areaLabel?: string
  /**
   * The routed depths, for the board to put on the map.
   *
   * The panel does not own map layers and should not: every other overlay on
   * this board is placed by the surface that owns the stack, and a second
   * placement path is how two surfaces come to disagree about what is drawn.
   * It hands the result up and the board decides.
   *
   * Called with null when a run starts, so the previous run's overlay does not
   * sit under a set of controls that no longer produced it.
   */
  onResult?: (result: analysis.FloodRoutingAnalysis | null) => void
  /**
   * Put a shape from a file on the map as the active AOI.
   *
   * The same handler the run graph's own area card offers, reached from here
   * because this panel is often the first surface a reader opens: a board with
   * nothing drawn shows "nothing drawn" and no way forward, and sending them
   * to another editor to import is a step the card can take itself.
   */
  onImport?: () => void
}) {
  const [rainMMH, setRainMMH] = useState(60)
  const [rainMinutes, setRainMinutes] = useState(30)
  const [minutes, setMinutes] = useState(60)
  const [manning, setManning] = useState(0.05)
  const [resolutionM, setResolutionM] = useState(90)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<analysis.FloodRoutingAnalysis | null>(null)
  const [places, setPlaces] = useState<Record<string, Place>>({})

  const run = useCallback(async () => {
    if (!geometry) return
    setBusy(true)
    setError(null)
    onResult?.(null)
    try {
      const req = {
        polygon_geojson: geometry,
        minutes,
        manning,
        resolution_m: resolutionM,
        rain_mm_h: rainMMH,
        rain_minutes: rainMinutes,
      }
      // The binding is generated against the Go request type, whose fields are
      // pointers so absence selects the sidecar's default. An object carrying
      // only what this panel sets is what that expects.
      const res = await AnalyzeFloodRouting(req as never)
      setResult(res)
      onResult?.(res)
    } catch (e) {
      // The sidecar refuses by name -- a headwater AOI with no inflow, an area
      // too large for the cell size it was given -- and those messages say what
      // to change. Passing them through unedited is the point.
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
      onResult?.(null)
    } finally {
      setBusy(false)
    }
  }, [geometry, minutes, manning, resolutionM, rainMMH, rainMinutes, onResult])

  const nodes: CanvasNode[] = useMemo(() => {
    const ids = ["area", "rain", "routing", "run"]
    // Default placement: two stacked in the first column, two in the second,
    // the run alone in the third. Measured off NODE spec heights so a first
    // draw needs no measuring, exactly as runGraph's defaultPlaces does.
    const stackY: Record<string, number> = {
      area: 0,
      rain: NODE.area.h + ROW_GAP,
      routing: 0,
      run: 0,
    }
    const card = (id: string, header: React.ReactNode, body: React.ReactNode,
                  tone?: "action" | "held"): CanvasNode => ({
      id,
      place: places[id] ?? { x: columnX(id), y: stackY[id] },
      h: NODE[id].h,
      header,
      children: body,
      tone,
    })

    return [
      card(
        "area",
        <Head icon={NODE.area.icon} label={NODE.area.label} lit={!!geometry} />,
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-foreground">
            {geometry ? (areaLabel ?? "this area") : (
              <span className="text-muted-foreground">nothing drawn</span>
            )}
          </span>
          {onImport && (
            <button
              type="button"
              onClick={onImport}
              disabled={busy}
              title="Import an area from a .geojson, .json or .kml file"
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors",
                "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                busy
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
              )}
            >
              <Upload className="size-3" />
            </button>
          )}
        </div>
      ),
      card(
        "rain",
        <Head icon={NODE.rain.icon} label={NODE.rain.label} lit />,
        <div className="flex flex-col gap-1.5">
          <NumberField label="Rate" value={rainMMH} min={1} max={500} step={5}
            format={(v) => `${v.toFixed(0)} mm/h`} parse={num(1)}
            disabled={busy} onChange={setRainMMH} />
          <NumberField label="Falls for" value={rainMinutes} min={1} max={720} step={5}
            format={(v) => `${v.toFixed(0)} min`} parse={num(1)}
            disabled={busy} onChange={setRainMinutes} />
          <p className="text-[9px] leading-snug text-muted-foreground">
            Uniform on every cell, with the terrain organising where it goes.
            Nothing infiltrates, so the depths are an upper bound.
          </p>
        </div>
      ),
      card(
        "routing",
        <Head icon={NODE.routing.icon} label={NODE.routing.label} lit />,
        <div className="flex flex-col gap-1.5">
          <NumberField label="Simulated" value={minutes} min={5} max={720} step={5}
            format={(v) => `${v.toFixed(0)} min`} parse={num(5)}
            disabled={busy} onChange={setMinutes} />
          <NumberField label="Cell" value={resolutionM} min={30} max={500} step={10}
            format={(v) => `${v.toFixed(0)} m`} parse={num(30)}
            disabled={busy} onChange={setResolutionM} />
          <NumberField label="Manning n" value={manning} min={0.01} max={0.2} step={0.005}
            format={(v) => v.toFixed(3)} parse={num(0.01)}
            disabled={busy} onChange={setManning} />
          <p className="text-[9px] leading-snug text-muted-foreground">
            Cost is cells times timesteps, so a finer cell is quadratically
            slower. n is one lumped value for sediment and bed together.
          </p>
        </div>
      ),
      card(
        "run",
        <Head icon={NODE.run.icon} label={result ? "Routed" : "Route"} lit={!busy} />,
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={run}
            disabled={!geometry || busy}
            className={cn(
              "inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-sm text-meta transition-colors",
              "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
              !geometry || busy
                ? "cursor-not-allowed bg-surface-raised text-muted-foreground/50"
                : "bg-accent text-accent-foreground hover:bg-accent/90"
            )}
          >
            <Play className="size-3" />
            {busy ? "Routing…" : geometry ? "Route" : "No area"}
          </button>
          {error && (
            <p className="text-[9px] leading-snug text-destructive-quiet">{error}</p>
          )}
          {result && (
            <div className="flex flex-col gap-0.5 pt-0.5">
              <Row label="Flooded"
                   value={`${result.aoi.flooded_km2.toFixed(2)} km²`} />
              <Spread label="Depth" spread={result.depth_m} unit="m" />
              <Spread label="Speed" spread={result.speed_ms} unit="m/s" />
              <Spread label="Arrival" spread={result.arrival_min} unit="min" digits={0} />
              <Row label="Left"
                   value={`${(result.volume.left_fraction * 100).toFixed(0)}%`} />
              <Row label="On edge"
                   value={`${(result.aoi.on_boundary_fraction * 100).toFixed(0)}%`} />
              <Row label="At rest"
                   value={result.lake_at_rest_residual_ms.toExponential(0)} />
              <p className="text-[9px] leading-snug text-muted-foreground">
                median 90th max, over the cells inside the polygon. Terrain{" "}
                {result.dem_id} at {result.resolution_m.toFixed(0)} m.
              </p>
              {result.aoi.on_boundary_fraction > 0.5 && (
                <p className="text-[9px] leading-snug text-foreground">
                  Most of the flow is on the boundary, so this area clips the
                  valley rather than holding it. The routing followed the real
                  channel; what is reported is the fragment that fell inside the
                  drawing. Redraw around the reach to read a flood.
                </p>
              )}
              {result.volume.left_fraction < 0.1 && (
                <p className="text-[9px] leading-snug text-foreground">
                  Almost nothing reached a boundary, so these depths are a
                  filling level and not a routed wave. The outlet is likely
                  outside the polygon.
                </p>
              )}
            </div>
          )}
        </div>,
        "action"
      ),
    ].filter((n) => ids.includes(n.id))
  }, [
    places, geometry, areaLabel, busy, error, result, run, onImport,
    rainMMH, rainMinutes, minutes, manning, resolutionM,
  ])

  const edges = useMemo(
    () =>
      [
        ["area", "run"],
        ["rain", "run"],
        ["routing", "run"],
      ] as const,
    []
  )

  return (
    <NodeCanvas
      nodes={nodes}
      edges={edges}
      onMove={(id, place) => setPlaces((p) => ({ ...p, [id]: place }))}
      className="h-full w-full"
    />
  )
}
