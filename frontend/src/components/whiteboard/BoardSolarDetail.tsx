/**
 * Prediction / solar / brush readout on the whiteboard.
 *
 * Default placement is the foot band above the run controls — legends and
 * multi-AOI land-cover stats live in the right sidebar (BoardStatsBar). The
 * left column still names planes; this surface reads the selected product.
 * Preview tiles from the Analysis page are omitted: the plane is already on
 * the board.
 *
 * `sidebar` keeps the older full-height right column when a call site needs it.
 */
import { ChevronDown, Paintbrush, Sun, Layers } from "lucide-react"
import { BOARD_LEFT_REM, BOARD_RIGHT_REM } from "@/lib/boardPartition"
import { useMemo, useState } from "react"
import {
  ContinuousRamp,
  PowerProvenanceNote,
  WaterFigure,
} from "@/components/analysisPrimitives"
import {
  CoverChipList,
  SkyViewFigures,
} from "@/components/solar/SolarDetailFigures"
import {
  AgreementDelta,
  BlockAgreementPair,
  ReferenceConfusionPair,
} from "@/components/whiteboard/AgreementCharts"
import { PlotSwipeView } from "@/components/AnalysisPlotModal"
import { cn } from "@/lib/utils"
import type { BrushRadiusPx, ClassMapCompare, ClassProbeSample } from "@/lib/boardProbe"
import { FALLBACK_PIXEL_SIZE_M, brushFootprint } from "@/lib/boardProbe"
import type {
  ClassStat,
  ModelKind,
  PredictResult,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
} from "@/lib/types"
import { modelLabel } from "@/lib/runAssets"

/** Same width as BoardSidebar — one number said on both edges. */

export type BoardDetailFocus = "terrain" | "siting" | "prediction"

function TerrainBody({
  terrain,
  compact = false,
}: {
  terrain: SolarTerrainAnalysis
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "min-w-max flex-row items-start" : "flex-col"
      )}
    >
      <div className={cn("flex flex-col gap-2", compact && "w-[14rem] shrink-0")}>
        <div className="flex flex-col gap-0.5">
          <p className="eyebrow !text-[9px]">
            Terrain irradiation · {terrain.season}
          </p>
          <p className="telemetry truncate text-[9px] text-muted-foreground">
            {terrain.dem_source} · {terrain.hourly_years} years
          </p>
        </div>

        <ContinuousRamp
          palette={terrain.scale.palette}
          lowLabel={terrain.scale.min.toFixed(terrain.scale.decimals)}
          highLabel={terrain.scale.max.toFixed(terrain.scale.decimals)}
        />

        <div className="grid grid-cols-2 gap-2">
          <WaterFigure label="Minimum" value={terrain.poa_min.toFixed(0)} />
          <WaterFigure label="Maximum" value={terrain.poa_max.toFixed(0)} />
          <WaterFigure
            label="Mean"
            value={terrain.poa_mean.toFixed(0)}
            sub={terrain.unit}
          />
          <WaterFigure
            label="Spatial spread"
            value={`${terrain.poa_std_pct.toFixed(1)}%`}
            sub="standard deviation"
          />
          <WaterFigure
            label="Mean slope"
            value={`${terrain.slope_mean_deg.toFixed(1)}°`}
            sub={`max ${terrain.slope_max_deg.toFixed(1)}°`}
          />
          {terrain.shading_mean_pct != null && (
            <WaterFigure
              label="Horizon shading"
              value={`${terrain.shading_mean_pct.toFixed(2)}%`}
              sub={
                terrain.shading_max_pct != null
                  ? `max ${terrain.shading_max_pct.toFixed(1)}% of beam`
                  : "of beam irradiance"
              }
            />
          )}
        </div>

        {terrain.beam_fraction > 0 && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            <span className="telemetry">
              Beam share {(terrain.beam_fraction * 100).toFixed(0)}%
            </span>{" "}
            of horizontal · shading applies to this component
          </p>
        )}
      </div>

      {(terrain.sky_view || terrain.power_provenance) && (
        <div className={cn("flex flex-col gap-2", compact && "w-[16rem] shrink-0")}>
          {terrain.sky_view && <SkyViewFigures sky={terrain.sky_view} />}
          <PowerProvenanceNote provenance={terrain.power_provenance} />
        </div>
      )}
    </div>
  )
}

function SitingBody({
  siting,
  compact = false,
}: {
  siting: SolarSitingAnalysis
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "min-w-max flex-row items-start" : "flex-col"
      )}
    >
      <div className={cn("flex flex-col gap-2", compact && "w-[14rem] shrink-0")}>
        <p className="eyebrow !text-[9px]">Photovoltaic siting</p>

        <div className="grid grid-cols-2 gap-2">
          <WaterFigure
            label="Suitable, no conflict"
            value={`${siting.suitable_no_conflict_ha.toFixed(1)} ha`}
          />
          <WaterFigure
            label="Suitable, on cropland"
            value={`${siting.suitable_cropland_ha.toFixed(1)} ha`}
            sub="never summed"
          />
        </div>

        <p className="text-[10px] leading-snug text-muted-foreground">
          <span className="telemetry">
            Slope limits {siting.thresholds.slope_acceptable_deg}° /{" "}
            {siting.thresholds.slope_restrictive_deg}°
          </span>{" "}
          · legal constraints not checked
        </p>
      </div>

      {/*
        Withheld in the band. legendFor("solar:siting") builds the same list
        from the same classes, and the right column draws it -- so a siting
        plane painted its composition twice, once per surface. PredictionBody
        already conceded this for its own class list; this one had not.
      */}
      <ul
        className={cn(
          "flex flex-col gap-1.5",
          compact ? "hidden" : undefined
        )}
      >
        {siting.classes.map((c) => (
          <li key={c.code} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: c.color }}
            />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="telemetry w-14 shrink-0 text-right">
              {c.area_ha.toFixed(1)} ha
            </span>
            <span className="telemetry w-10 shrink-0 text-right text-muted-foreground">
              {c.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>

      <div className={cn("flex flex-col gap-2", compact && "w-[12rem] shrink-0")}>
        <CoverChipList
          label="Excluded cover"
          codes={siting.thresholds.excluded_cover}
        />
        <CoverChipList
          label="Cropland cover"
          codes={siting.thresholds.cropland_cover}
        />
      </div>
    </div>
  )
}

function CompactMatrix({
  title = "Confusion matrix",
  rowLabel = "Rows = reference",
  colLabel = "columns = predicted",
  rowClasses,
  colClasses,
  matrix,
}: {
  title?: string
  rowLabel?: string
  colLabel?: string
  rowClasses: { id: number; name: string; color: string }[]
  colClasses: { id: number; name: string; color: string }[]
  matrix: number[][]
}) {
  if (!rowClasses.length || !colClasses.length || !matrix.length) return null
  const max = Math.max(1, ...matrix.flat())
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="eyebrow !text-[9px]">{title}</p>
        <p className="text-[9px] leading-snug text-muted-foreground">
          {rowLabel} · {colLabel}
        </p>
      </div>
      <div className="overflow-x-auto rounded-sm border p-1.5" style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}>
        <table className="w-full border-separate border-spacing-0.5 text-[9px]">
          <thead>
            <tr>
              <th className="p-0.5" />
              {colClasses.map((c) => (
                <th key={c.id} className="p-0.5 font-normal" title={c.name}>
                  <span
                    className="mx-auto flex size-3 items-center justify-center rounded-[2px] text-[7px] text-white"
                    style={{ backgroundColor: c.color }}
                  >
                    {c.id}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={rowClasses[i]?.id ?? i}>
                <th className="p-0.5 text-left font-normal" title={rowClasses[i]?.name}>
                  <span className="flex items-center gap-1">
                    <span
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: rowClasses[i]?.color }}
                    />
                    <span className="telemetry text-muted-foreground">
                      {rowClasses[i]?.id}
                    </span>
                  </span>
                </th>
                {row.map((cell, j) => {
                  const diag =
                    rowClasses[i]?.id != null &&
                    rowClasses[i]?.id === colClasses[j]?.id
                  const t = cell / max
                  return (
                    <td key={j} className="p-0">
                      <div
                        className={cn(
                          "telemetry flex min-h-[1.35rem] min-w-[1.35rem] items-center justify-center rounded-[2px] px-0.5",
                          diag && "ring-1 ring-primary/50"
                        )}
                        style={{
                          background:
                            cell > 0
                              ? `rgb(var(--p-accent) / ${0.15 + t * 0.65})`
                              : "rgb(var(--p-line) / 0.08)",
                        }}
                        title={`${rowClasses[i]?.name ?? "?"} → ${colClasses[j]?.name ?? "?"}: ${cell.toLocaleString()}`}
                      >
                        <span
                          className={cn(
                            "telemetry",
                            t > 0.55 ? "text-background" : "text-foreground"
                          )}
                        >
                          {cell > 0 ? cell : "·"}
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PredictionBody({
  result,
  modelKind,
  period,
  brushOn,
  onBrushOnChange,
  brushRadius,
  onBrushRadiusChange,
  pixelSizeM,
  probe,
  probeIdle,
  compact = false,
}: {
  result: PredictResult
  modelKind?: ModelKind | string | null
  period?: string | null
  brushOn: boolean
  /** Absent where the caller offers no brush; the switch is then withheld. */
  onBrushOnChange?: (on: boolean) => void
  brushRadius: BrushRadiusPx
  onBrushRadiusChange: (r: BrushRadiusPx) => void
  /** The run's own grid, so the brush states ground and not texels. */
  pixelSizeM: number
  probe: ClassProbeSample | null
  probeIdle: boolean
  /** Foot band: land-cover shares live in the sidebar — omit the class list. */
  compact?: boolean
}) {
  const classes = result.class_stats ?? []
  const agreement = result.lulc?.agreement
  const floor = result.confidence_floor

  const probeStat: ClassStat | undefined = useMemo(() => {
    if (!probe?.entry) return undefined
    return classes.find((c) => c.class_id === probe.entry!.id)
  }, [probe, classes])

  const summary = (
    <div className={cn("flex flex-col gap-2", compact && "w-[13rem] shrink-0")}>
      <div className="flex flex-col gap-0.5">
        <p className="eyebrow !text-[9px]">
          {modelKind
            ? modelLabel(modelKind as ModelKind)
            : "Classification"}
        </p>
        {period && (
          <p className="telemetry truncate text-[9px] text-muted-foreground">
            {period}
          </p>
        )}
      </div>

      {/*
        Also withheld. layerLegend.ts reports mean confidence with its floor and
        the scene count as the column's qualifier rows, above the class shares.
        Drawing them here too put the same two numbers on both surfaces for
        every prediction selected -- the most common selection there is.
      */}
      <div className={cn("grid grid-cols-2 gap-2", compact && "hidden")}>
        <WaterFigure
          label="Mean vote share"
          value={`${(result.mean_confidence * 100).toFixed(1)}%`}
          sub={
            floor != null
              ? `floor ${(floor * 100).toFixed(1)}%`
              : "not calibrated"
          }
        />
        <WaterFigure
          label="Scenes"
          value={String(result.n_dates)}
          sub={
            result.date_range?.length === 2
              ? `${result.date_range[0]} → ${result.date_range[1]}`
              : undefined
          }
        />
      </div>
    </div>
  )

  const brush = brushOn ? (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-sm border px-2 py-2",
        compact && "w-[14rem] shrink-0"
      )}
      style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow !text-[9px]">Brush rover</p>
        {/*
          Sized in metres, because the question is about ground.

          S, M and L named nothing a reader could act on, and the tooltips
          behind them were wrong in the same direction: the radius is a disc in
          texels, dx^2 + dy^2 <= r^2, so radius 2 spans five pixels and covers
          thirteen -- the tooltip said three. The span in metres comes off the
          run's own grid, so a run on a grid that is not 10 m says so.
        */}
        <div className="flex gap-0.5">
          {([0, 1, 2, 4] as const).map((r) => {
            const fp = brushFootprint(r, pixelSizeM)
            return (
            <button
              key={r}
              type="button"
              onClick={() => onBrushRadiusChange(r)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[9px] transition-colors",
                brushRadius === r
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:bg-surface-raised/40"
              )}
              title={
                r === 0
                  ? `One predicted pixel · ${fp.spanM} m · ${fp.areaHa.toFixed(2)} ha`
                  : `Majority over ${fp.texels} pixels · ${fp.spanM} m across · ${fp.areaHa.toFixed(2)} ha`
              }
            >
              {fp.spanM} m
            </button>
            )
          })}
        </div>
      </div>
      {probe?.entry ? (
        <div className="flex items-center gap-2">
          <span
            className="size-3 shrink-0 rounded-[2px]"
            style={{ backgroundColor: probe.entry.color }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-meta text-foreground">
              {probe.entry.name}
            </p>
            {/*
              Two lines, because one was two statements wearing one.

              This read `1234.5 ha · 45.2%`, which is the class's share of the
              WHOLE AOI, printed directly under a sample covering 0.13 of a
              hectare -- and it replaced the neighbour count, so at any radius
              above zero the reader lost the one number that says how firm the
              sample is. What the brush covered and what the class covers are
              different quantities and now say which they are.
            */}
            <p className="telemetry text-[9px] text-muted-foreground">
              {(() => {
                const fp = brushFootprint(brushRadius, pixelSizeM)
                const here =
                  probe.examined > 1
                    ? `${fp.spanM} m · ${probe.votes}/${probe.examined} px agree`
                    : `${fp.spanM} m · one pixel`
                return here
              })()}
            </p>
            {probeStat && (
              <p className="telemetry text-[9px] text-muted-foreground">
                class is {probeStat.pct.toFixed(1)}% of the AOI
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {probeIdle
            ? "Move the rover over the prediction plane."
            : "Outside the classified area."}
        </p>
      )}
    </div>
  ) : null

  const classList =
    !compact && classes.length > 0 ? (
      <ul className="flex flex-col gap-1.5">
        {classes.map((c) => (
          <li key={c.class_id} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: c.color }}
            />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="telemetry w-14 shrink-0 text-right">
              {c.area_ha.toFixed(1)} ha
            </span>
            <span className="telemetry w-10 shrink-0 text-right text-muted-foreground">
              {c.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    ) : null

  const agreementBlock = null

  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "min-w-max flex-row items-start" : "flex-col"
      )}
    >
      {summary}
      {brush}
      {classList}
      {agreementBlock}
    </div>
  )
}

/**
 * What differs between the two runs, and nothing that does not.
 *
 * A delta is uninterpretable without it. The identity blocks named the area,
 * the model and the period, which is what a reader would have set deliberately
 * -- but a run also carries how many scenes it found, over what dates, and
 * which reference year it was scored against, and none of those were on screen.
 * The last one matters most and is the easiest to miss: two runs measured
 * against different MapBiomas years have an accuracy delta that is partly the
 * reference moving rather than the model, and nothing said so.
 *
 * Only the differing rows are drawn. A list of six facets of which five agree
 * is five rows asking to be checked and discarded; what a reader needs is the
 * short list of things that are not the same. This is the device QGIS's
 * Processing History supplies for expensive asynchronous work -- and a TERRA
 * run costs minutes and quota, so re-running one to find out what it used is
 * not a way of asking.
 */
function WhatDiffers({
  a,
  b,
}: {
  a: PredictionCompareSide
  b: PredictionCompareSide
}) {
  const span = (dates: string[] | null | undefined) =>
    dates?.length ? `${dates[0]} – ${dates[dates.length - 1]}` : null
  const reference = (s: PredictionCompareSide) =>
    s.result.lulc ? `${s.result.lulc.source} ${s.result.lulc.year}` : null

  const facets: { label: string; a: string | null; b: string | null }[] = [
    { label: "Area", a: a.label, b: b.label },
    {
      label: "Model",
      a: a.model ? modelLabel(a.model as ModelKind) : null,
      b: b.model ? modelLabel(b.model as ModelKind) : null,
    },
    { label: "Period", a: a.period ?? null, b: b.period ?? null },
    {
      label: "Scenes",
      a: String(a.result.n_dates),
      b: String(b.result.n_dates),
    },
    { label: "Acquired", a: span(a.result.date_range), b: span(b.result.date_range) },
    { label: "Reference", a: reference(a), b: reference(b) },
  ]
  const differing = facets.filter((f) => f.a !== f.b)
  if (!differing.length) return null

  return (
    <div className="flex flex-col gap-1">
      <p className="eyebrow !text-[9px]">What differs</p>
      <ul className="flex flex-col gap-0.5">
        {differing.map((f) => (
          <li key={f.label} className="flex flex-col">
            <span className="telemetry text-[9px] text-muted-foreground">
              {f.label}
            </span>
            <span className="truncate text-[10px] text-foreground" title={`${f.a ?? "—"} → ${f.b ?? "—"}`}>
              {f.a ?? "—"} <span className="text-muted-foreground">&rarr;</span>{" "}
              {f.b ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface PredictionCompareSide {
  areaId: string
  label: string
  model?: string | null
  period?: string | null
  result: PredictResult
  uri: string
  /** Class maps are drawn unfiltered; a bilinear sample invents a class. */
  pixelated?: boolean
}

function PredictionCompareBody({
  sides,
  compare,
  compareError,
  compact = false,
}: {
  sides: [PredictionCompareSide, PredictionCompareSide]
  compare: ClassMapCompare | null
  compareError: string | null
  compact?: boolean
}) {
  /*
    THE SHARED COLOUR DOMAIN, and why there is no control for it.

    Two rasters set side by side are not comparable by eye unless they share a
    colour mapping: rescaled each to its own range, one presents two different
    values in the same colour, and the reading is confident and wrong. It is
    the precondition the design record raises against every side-by-side
    arrangement, and ParaView's answer -- a transfer function decoupled from
    the view, with rescaling stated rather than implicit -- is the mechanism it
    asks for.

    Checked against what this editor actually draws, and it is already met at
    the source rather than needing a control here:

      - Class rasters take their colour from `MAPBIOMAS_COLORS` in
        `sidecar/class_palette.py`, a fixed map keyed by class id. The same
        class is the same colour in every run by construction.
      - `write_confidence_png` and `write_ndvi_mean_png` clip to [0, 1] and ramp
        over that absolute domain. Neither is rescaled to the run's own range.

    So a basis selector here would be chrome for a condition this application
    does not produce, and the geometric budget is the reason that matters: at
    the 1000x700 minimum the chrome already takes half the width. The one place
    a per-instance scale did exist was the confusion grids, which shaded against
    their own maxima -- reconciled in `ReferenceConfusionPair` against 0..100
    and said on screen, since a reconciliation a reader cannot see is one they
    cannot check.
  */
  const [a, b] = sides
  // Where the divider stands. Local, because it is a way of looking rather
  // than a property of either raster.
  const [swipe, setSwipe] = useState(0.5)
  const statsA = a.result.class_stats ?? []
  const statsB = b.result.class_stats ?? []
  // Present only where the run was measured against a reference; a run with no
  // MapBiomas cells behind it has nothing to be more or less accurate than.
  const agreementA = a.result.lulc?.agreement ?? null
  const agreementB = b.result.lulc?.agreement ?? null

  /*
    The share delta over the UNION of the two legends, not over A's.

    Iterating A alone drops a class B found and A did not, which is the finding
    the row would have carried. `AgreementDelta` was made to keep those rows for
    that reason and this list, in the same panel, was still discarding them.

    Absence means something different here than it does there, though, and the
    two are not fixed the same way. `per_class` absent is NOT MEASURED, so its
    delta is unknown and the row says `only B`. `class_stats` absent is a share
    of ZERO -- the class is not in the raster -- so the delta is a real figure in
    both directions: -pct for a class only A has, +pct for one only B has.
  */
  const byIdA = new Map(statsA.map((c) => [c.class_id, c]))
  const byIdB = new Map(statsB.map((c) => [c.class_id, c]))
  const shareRows = [
    ...statsA.map((ca) => ({
      classId: ca.class_id,
      name: ca.name,
      color: ca.color,
      delta: (byIdB.get(ca.class_id)?.pct ?? 0) - ca.pct,
    })),
    // A's order first, so a reader who knows one legend still reads it in the
    // order they know; what only B has lands after it rather than interleaved.
    ...statsB
      .filter((cb) => !byIdA.has(cb.class_id))
      .map((cb) => ({
        classId: cb.class_id,
        name: cb.name,
        color: cb.color,
        delta: cb.pct,
      })),
  ]

  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "min-w-max flex-row items-start" : "flex-col"
      )}
    >
      <div className={cn("flex flex-col gap-2", compact && "w-[14rem] shrink-0")}>
        <p className="eyebrow !text-[9px]">Prediction difference</p>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Two prediction planes in the selection path. Shared pixels are compared
          class-to-class; the matrix is how A’s labels land on B’s.
        </p>

        <div className="flex flex-col gap-2">
          {[a, b].map((s, i) => (
            <div key={s.areaId + i} className="flex flex-col gap-0.5">
              <p className="telemetry text-[9px] text-muted-foreground">
                {i === 0 ? "A" : "B"} · {s.label}
              </p>
              <p className="truncate text-meta text-foreground">
                {s.model ? modelLabel(s.model as ModelKind) : "Classification"}
              </p>
              {s.period && (
                <p className="telemetry truncate text-[9px] text-muted-foreground">
                  {s.period}
                </p>
              )}
            </div>
          ))}
        </div>

        <WhatDiffers a={a} b={b} />

        {compareError && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            {compareError}
          </p>
        )}

        {compare && (
          <div className="grid grid-cols-2 gap-2">
            <WaterFigure
              label="Agreement"
              value={`${compare.pct.toFixed(1)}%`}
              sub={`${compare.same.toLocaleString()} / ${compare.shared.toLocaleString()} px`}
            />
            <WaterFigure
              label="Differ"
              value={`${(100 - compare.pct).toFixed(1)}%`}
              sub="same ground, other class"
            />
          </div>
        )}
      </div>

      {/*
        THE SWIPE, where the two cover the same ground.

        It lived in a dialog that covered the board the arrow was pointing at,
        which is the contradiction the compare editor was made to end. Here it
        sits beside what it is being read against: slide it and the figures to
        its right do not move.

        Only with `compare`, which is non-null exactly when the two rasters
        share a grid -- sliding one footprint over another puts unrelated
        pixels in one rectangle and invites reading a difference that is only
        two different fields.
      */}
      {compare && (
        <div
          className={cn(
            "min-h-0 overflow-hidden rounded-sm",
            compact ? "aspect-[4/3] h-full shrink-0" : "h-[18rem] w-full"
          )}
          style={{ background: "rgb(var(--p-surface))" }}
        >
          <PlotSwipeView
            left={{
              id: "a",
              title: sides[0].label,
              uri: sides[0].uri,
              exportPngName: "",
              pixelated: sides[0].pixelated ?? true,
            }}
            right={{
              id: "b",
              title: sides[1].label,
              uri: sides[1].uri,
              exportPngName: "",
              pixelated: sides[1].pixelated ?? true,
            }}
            ratio={swipe}
            onRatioChange={setSwipe}
          />
        </div>
      )}

      {/*
        WHERE THE TWO COVER DIFFERENT GROUND, which is every comparison of two
        areas: each run's own confusion against the reference, side by side.

        This slot used to hold the transition matrix or, failing that, the
        sentence saying why it could not run -- and the failing case is the one
        the studio exists for. The two readings are not alternatives dressed as
        one: A-to-B says where A's labels went in B and needs shared pixels;
        this says where each run's labels went against ground and needs none.
      */}
      {!compare && agreementA && agreementB && (
        <div className={cn(compact && "shrink-0")}>
          <ReferenceConfusionPair
            a={agreementA}
            b={agreementB}
            labelA={sides[0].label}
            labelB={sides[1].label}
          />
        </div>
      )}

      {compare && (
        <div className={cn(compact && "shrink-0")}>
          <CompactMatrix
            title="Class transitions"
            rowLabel="Rows = A"
            colLabel="columns = B"
            rowClasses={compare.legendA.map((e) => ({
              id: e.id,
              name: e.name,
              color: e.color,
            }))}
            colClasses={compare.legendB.map((e) => ({
              id: e.id,
              name: e.name,
              color: e.color,
            }))}
            matrix={compare.transitions}
          />
        </div>
      )}

      {/*
        Which of the two gets a class right, which is the question a reader
        opens this editor to ask and the one nothing here answered. Both runs
        already carried it: a producer's and a user's accuracy per class,
        measured against MapBiomas. Reading them against each other meant
        opening one run, remembering, and opening the other.

        Offered wherever BOTH were measured, same ground or not: two areas
        classified by one model is exactly the comparison this studio exists
        for, and it needs no shared pixels.
      */}
      {agreementA && agreementB && (
        <div className={cn(compact && "w-[16rem] shrink-0")}>
          <AgreementDelta
            a={agreementA}
            b={agreementB}
            labelA={sides[0].label}
            labelB={sides[1].label}
          />
        </div>
      )}

      {/*
        Offered whether or not the grids match: a block breakdown is computed
        inside each run against its own reference, so it needs no shared pixel
        -- the same property that makes the confusion pair work for two areas.
      */}
      {agreementA && agreementB && (
        <div className={cn(compact && "shrink-0")}>
          <BlockAgreementPair
            a={agreementA}
            b={agreementB}
            labelA={sides[0].label}
            labelB={sides[1].label}
          />
        </div>
      )}

      {statsA.length > 0 && statsB.length > 0 && (
        <div
          className={cn(
            "flex flex-col gap-1.5",
            compact && "w-[12rem] shrink-0"
          )}
        >
          <p className="eyebrow !text-[9px]">Share delta (A → B)</p>
          <ul className="flex flex-col gap-1">
            {shareRows.map((r) => (
              <li
                key={r.classId}
                className="flex items-center gap-2 text-[10px]"
              >
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: r.color }}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {r.name}
                </span>
                <span
                  className={cn(
                    "telemetry shrink-0",
                    r.delta > 0.05
                      ? "text-emerald-400"
                      : r.delta < -0.05
                        ? "text-rose-400"
                        : "text-foreground"
                  )}
                >
                  {r.delta > 0 ? "+" : ""}
                  {r.delta.toFixed(1)} pp
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Domain shift is not here any more. Under `compact` this band drew four
        figures and withheld the histogram and the t-SNE that justify the
        analysis -- they need width, and this band is what is left of the row
        after a 15rem column. It moved to the compare modal, whole.

        What stays in the band is what the band is for: the A-to-B relation.
        Composition delta above, class transitions below.
      */}
    </div>
  )
}

export function BoardSolarDetail({
  focus,
  terrain,
  siting,
  prediction,
  modelKind,
  period,
  brushOn = false,
  onBrushOnChange,
  heightRem,
  onResize,
  collapsed = false,
  onToggleCollapsed,
  brushRadius = 2,
  onBrushRadiusChange,
  pixelSizeM = FALLBACK_PIXEL_SIZE_M,
  probe = null,
  probeIdle = true,
  compareSides = null,
  compare = null,
  compareError = null,
  placement = "band",
  leftOffset = `${BOARD_LEFT_REM}rem`,
  rightOffset = `${BOARD_RIGHT_REM}rem`,
}: {
  focus: BoardDetailFocus | null
  terrain?: SolarTerrainAnalysis | null
  siting?: SolarSitingAnalysis | null
  prediction?: PredictResult | null
  modelKind?: ModelKind | string | null
  period?: string | null
  brushOn?: boolean
  onBrushOnChange?: (on: boolean) => void
  /** Current band height in rem, and where a drag on its edge reports to. */
  heightRem?: number
  onResize?: (rem: number) => void
  /** Folded to its grip, so the studio can be given back its height. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  brushRadius?: BrushRadiusPx
  onBrushRadiusChange?: (r: BrushRadiusPx) => void
  /** Absent on runs saved before the grid was carried; 10 m is assumed then. */
  pixelSizeM?: number
  probe?: ClassProbeSample | null
  /** True when brush is on but the pointer is not over the plane. */
  probeIdle?: boolean
  /** Two prediction planes in the selection — difference readout. */
  compareSides?: [PredictionCompareSide, PredictionCompareSide] | null
  compare?: ClassMapCompare | null
  compareError?: string | null
  /**
   * `band` — foot strip above the run controls (default).
   * `sidebar` — full-height right column.
   */
  /**
   * Where this is drawn.
   *
   * `area` is the one that fills whatever rectangle it is given, which is what
   * an editor in the studio's area tree is. `band` and `sidebar` position
   * themselves and are what the studio used before areas existed.
   */
  placement?: "band" | "sidebar" | "area"
  leftOffset?: string
  rightOffset?: string
}) {
  const comparing = !!compareSides && compareSides.length === 2
  const body = comparing ? (
    <PredictionCompareBody
      sides={compareSides}
      compare={compare}
      compareError={compareError}
      compact={placement !== "sidebar"}
    />
  ) : focus === "terrain" && terrain ? (
    <TerrainBody terrain={terrain} compact={placement !== "sidebar"} />
  ) : focus === "siting" && siting ? (
    <SitingBody siting={siting} compact={placement !== "sidebar"} />
  ) : focus === "prediction" && prediction ? (
    <PredictionBody
      result={prediction}
      modelKind={modelKind}
      period={period}
      brushOn={brushOn}
      onBrushOnChange={onBrushOnChange}
      brushRadius={brushRadius}
      onBrushRadiusChange={(r) => onBrushRadiusChange?.(r)}
      // The run in hand decides the grid, not the caller's default.
      pixelSizeM={prediction.pixel_size_m || pixelSizeM}
      probe={probe}
      probeIdle={probeIdle}
      compact={placement !== "sidebar"}
    />
  ) : (
    <p className="text-meta leading-snug text-muted-foreground">
      Select a prediction or solar plane to read its figures. Shift-select a
      second prediction to compare.
    </p>
  )

  const title = comparing
    ? "Compare"
    : focus === "terrain"
      ? "Irradiation"
      : focus === "siting"
        ? "Siting"
        : focus === "prediction"
          ? "Prediction"
          : "Detail"

  const TitleIcon = focus === "prediction" || comparing ? Layers : Sun
  const showBrushToggle =
    !comparing &&
    focus === "prediction" &&
    !!prediction &&
    !!onBrushOnChange

  const header = (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5"
      style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <TitleIcon className="size-3 shrink-0 text-primary" strokeWidth={1.75} />
        <span className="eyebrow !text-foreground">{title}</span>
      </div>
      {showBrushToggle && (
        <button
          type="button"
          onClick={() => onBrushOnChange!(!brushOn)}
          className={cn(
            "flex items-center gap-1 rounded-sm px-1.5 py-1 text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            brushOn
              ? "bg-surface-raised text-foreground"
              : "text-muted-foreground hover:bg-surface-raised/40"
          )}
          title={
            brushOn
              ? "Turn off brush rover"
              : "Brush rover — class under the lens on the prediction plane"
          }
          aria-pressed={brushOn}
        >
          <Paintbrush className="size-3" strokeWidth={1.75} />
          Brush
        </button>
      )}
    </div>
  )

  /*
    An area fills what it is given. No anchor, no grip and no recesses: the
    area tree decides the rectangle and the division between areas is dragged
    on the seam, so a second resize handle inside the body would be a second
    way to say the same thing.
  */
  if (placement === "area") {
    return (
      <div className="panel-scroll h-full w-full overflow-auto px-2 py-1.5">
        {body}
      </div>
    )
  }

  if (placement === "band") {
    return (
      <div
        /*
          Height from the CONTENT, bounded, rather than a fixed 8rem.

          A fixed box for a body that ranges from a three-column comparison to a
          matrix is the whole complaint: the short case left a strip of unused
          ink and the tall case scrolled, in the same box. `max-height` with an
          auto height lets each say how much it needs; only past the bound does
          anything scroll.

          The bound is the reservation, so the band can never eat more foot than
          --map-foot accounts for. That variable keeps its value either way --
          boardScene parses it to lift the axis gizmo and MapScreen derives it
          from FOOT_REM -- and what varies is the painted box inside it.
        */
        className="app-no-drag absolute z-[20] flex flex-col overflow-hidden border-t"
        style={{
          left: leftOffset,
          right: rightOffset,
          bottom: "var(--map-band, 4rem)",
          maxHeight: "var(--map-stats, 8rem)",
          /*
            A floor when collapsed, or the band takes its own grip down with it.

            The box is max-height over an automatic height, so it is as tall as
            its content. Collapsed, the content is gone and the only child left
            is the grip -- which is absolutely positioned and therefore
            contributes no height at all. The box measured zero, painted
            nothing, and the control that unfolds it went with it.
          */
          minHeight: collapsed ? "var(--map-stats, 0.75rem)" : undefined,
          /*
            Collapsed it needs to be SEEN, or the fold reads as a disappearance.
            Ink is the studio's own ground, so a folded band painted in it is
            invisible against the surface behind it -- the strip was there and
            nothing said so. Raised surface separates it from the board without
            making a fixed piece of furniture loud.
          */
          background: collapsed
            ? "rgb(var(--p-surface-raised))"
            : "rgb(var(--p-ink))",
          borderColor: "rgb(var(--p-line) / 0.28)",
        }}
      >
        {/*
          The top edge is the grip, and it says so.

          It was a bare two-pixel target: draggable, and indistinguishable from
          a border. A gesture nobody can see is a gesture nobody uses -- so the
          strip carries a short rule, the way a resizable edge is marked, and
          the chevron beside it collapses the band outright.

          The band is FIXED, not dismissible: this studio holds land cover,
          solar and wind, and each fills it differently. Collapsing leaves the
          grip in place, so the surface that was folded is the surface that
          unfolds it.

          Pointer capture, so a drag that leaves the strip -- which every drag
          does, since the band moves out from under the pointer -- keeps
          reporting to the element that started it.
        */}
        {onResize && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize the detail band"
            className={cn(
              "group absolute inset-x-0 top-0 z-[1] flex cursor-ns-resize items-center justify-center",
              // Collapsed the strip IS the band, so it takes the whole height
              // rather than leaving the lower half inert.
              collapsed ? "bottom-0" : "h-2.5"
            )}
            onPointerDown={(e) => {
              // Not from the collapse button, which is a click and not a drag.
              if ((e.target as HTMLElement).closest("button")) return
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              const startY = e.clientY
              const startRem = heightRem ?? 0
              const root =
                parseFloat(
                  getComputedStyle(document.documentElement).fontSize
                ) || 16
              const move = (ev: PointerEvent) => {
                // Upward is taller: the band grows from the foot, so the
                // pointer's rise is the height it gains.
                onResize(startRem + (startY - ev.clientY) / root)
              }
              const up = () => {
                window.removeEventListener("pointermove", move)
                window.removeEventListener("pointerup", up)
              }
              window.addEventListener("pointermove", move)
              window.addEventListener("pointerup", up)
            }}
          >
            {/*
              The rule sits where the band's own width centres it, which with
              the left column at 15rem is not the window's centre. It marks the
              middle of the surface it resizes rather than the middle of the
              screen.
            */}
            <span
              className={cn(
                "h-0.5 w-8 rounded-full transition-colors group-hover:bg-line-strong",
                // Folded, the rule is the only mark that the band is there, so
                // it does not wait for a hover to be seen.
                collapsed ? "bg-line-strong/80" : "bg-line-strong/50"
              )}
              aria-hidden
            />
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title={collapsed ? "Expand the band" : "Collapse the band"}
                aria-label={collapsed ? "Expand the band" : "Collapse the band"}
                className="absolute left-1.5 flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    collapsed && "rotate-180"
                  )}
                  strokeWidth={1.75}
                />
              </button>
            )}
          </div>
        )}
        {/*
          No header row. It spent about a quarter of the band's height saying
          "Compare" -- which the arrow the reader pressed to open it already
          said -- and the sections below carry their own eyebrows. The brush
          toggle it also held moves in beside them.
        */}
        {!collapsed && (
          <div className="panel-scroll min-h-0 flex-1 overflow-x-auto px-2 py-1.5">
            {body}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      className="app-no-drag absolute bottom-0 right-0 top-0 z-[10] flex flex-col border-l"
      style={{
        // From the shared constant, like the stats column: the band recesses by
        // BOARD_RIGHT_REM, so a literal here reopens the gap between them the
        // moment the constant moves.
        width: `${BOARD_RIGHT_REM}rem`,
        // Same ink / no-blur rule as BoardSidebar — see the note there.
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      {header}
      <div className="panel-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
        {body}
      </div>
    </aside>
  )
}
