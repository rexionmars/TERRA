import { forwardRef } from "react"
import { motion } from "motion/react"
import {
  ChevronLeft,
  CheckCircle2,
  Loader2,
  LayoutGrid,
  Mountain,
  Play,
  Sun,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { SolarSeason } from "@/lib/types"

function Section({
  step,
  title,
  children,
}: {
  step: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="telemetry text-[10px] text-primary">{step}</span>
        <span className="eyebrow !text-foreground">{title}</span>
      </div>
      {children}
    </div>
  )
}

export interface SolarPanelProps {
  panelOffsetClass?: string
  hasArea: boolean
  climatologyYears: number
  onClimatologyYearsChange: (v: number) => void
  hourlyYears: number
  onHourlyYearsChange: (v: number) => void
  surfaceAzimuth: number
  onSurfaceAzimuthChange: (v: number) => void
  /** Empty applies the reference ratio; a value overrides it. */
  performanceRatio: string
  onPerformanceRatioChange: (v: string) => void
  running: boolean
  progress: number
  progressMsg: string
  hasResult: boolean
  onRun: () => void
  onClear: () => void
  terrainRunning: boolean
  hasTerrain: boolean
  onRunTerrain: () => void
  onClearTerrain: () => void
  season: SolarSeason
  onSeasonChange: (v: SolarSeason) => void
  sitingRunning: boolean
  hasSiting: boolean
  slopeAcceptable: number
  slopeRestrictive: number
  onSlopeAcceptableChange: (v: number) => void
  onSlopeRestrictiveChange: (v: number) => void
  onRunSiting: () => void
  onClearSiting: () => void
  onCollapse: () => void
}

const SEASONS: { id: SolarSeason; label: string }[] = [
  { id: "annual", label: "Annual" },
  { id: "winter", label: "Winter" },
  { id: "summer", label: "Summer" },
  { id: "winter_crop", label: "Winter crop" },
  { id: "anisotropy", label: "Winter / summer" },
]

/**
 * Solar resource at the AOI.
 *
 * Physics with no trained head, so it carries no fixed legend and, unlike every
 * Sentinel-2 product, cannot fail on scene availability.
 */
export const SolarPanel = forwardRef<HTMLDivElement, SolarPanelProps>(
  function SolarPanel(props, ref) {
    const {
      hasArea,
      climatologyYears,
      onClimatologyYearsChange,
      hourlyYears,
      onHourlyYearsChange,
      surfaceAzimuth,
      onSurfaceAzimuthChange,
      performanceRatio,
      onPerformanceRatioChange,
      running,
      progress,
      progressMsg,
      hasResult,
      onRun,
      onClear,
      terrainRunning,
      hasTerrain,
      onRunTerrain,
      onClearTerrain,
      season,
      onSeasonChange,
      sitingRunning,
      hasSiting,
      slopeAcceptable,
      slopeRestrictive,
      onSlopeAcceptableChange,
      onSlopeRestrictiveChange,
      onRunSiting,
      onClearSiting,
      onCollapse,
    } = props

    return (
      <motion.div
        ref={ref}
        className={`panel app-no-drag panel-scroll absolute ${props.panelOffsetClass ?? "left-3"} top-3 bottom-3 z-[1000] flex w-[19rem] flex-col gap-4 overflow-y-auto rounded-md p-4`}
        initial={{ opacity: 0, x: -28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -28 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold">Solar resource</h1>
          <button
            type="button"
            onClick={onCollapse}
            className="text-muted-foreground hover:text-foreground"
            title="Hide panel"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>

        <Section step="01" title="Area">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Analysed at the AOI centroid. Radiation resolves on a 1 degree grid,
            so the result describes the cell the AOI sits in, not structure
            within it.
          </p>
          <div
            className={cn(
              "flex items-center gap-2 rounded-sm border px-3 py-2 text-xs",
              hasArea
                ? "border-primary/40 text-foreground"
                : "border-border/60 text-muted-foreground"
            )}
          >
            <CheckCircle2
              className={cn("size-3.5", hasArea ? "text-primary" : "opacity-40")}
            />
            {hasArea ? "AOI ready" : "No AOI defined"}
          </div>
        </Section>

        <Section step="02" title="Period">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Climatology years
            <input
              type="number"
              min={5}
              max={40}
              value={climatologyYears}
              onChange={(e) => onClimatologyYearsChange(Number(e.target.value))}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Hourly years (tilt and yield)
            <input
              type="number"
              min={3}
              max={20}
              value={hourlyYears}
              onChange={(e) => onHourlyYearsChange(Number(e.target.value))}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            />
          </label>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The hourly fetch dominates the run time. Shortening it costs
            accuracy for little gain.
          </p>
        </Section>

        <Section step="03" title="Array">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Surface azimuth (0 = north)
            <input
              type="number"
              min={-180}
              max={180}
              value={surfaceAzimuth}
              onChange={(e) => onSurfaceAzimuthChange(Number(e.target.value))}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Performance ratio (blank = reference 0.80)
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.80"
              value={performanceRatio}
              onChange={(e) => onPerformanceRatioChange(e.target.value)}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            />
          </label>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The modelled ratio omits soiling, inter-row shading, degradation,
            availability and cabling, so the yield is reported at a reference
            ratio. Both are shown in the result.
          </p>
        </Section>

        <Section step="04" title="Run">
          {running && (
            <div className="flex flex-col gap-1">
              <div className="ar-track h-1 overflow-hidden rounded-sm">
                <div
                  className="h-full rounded-sm bg-primary transition-[width]"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
              <span className="telemetry text-[10px] text-muted-foreground">
                {progressMsg}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArea || running}
              onClick={onRun}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {running ? "Computing…" : "Analyse solar"}
            </button>
            {hasResult && (
              <button
                type="button"
                onClick={onClear}
                disabled={running}
                className="ar-ghost flex h-9 items-center gap-1.5 rounded-sm border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                Clear
              </button>
            )}
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Season
            <select
              value={season}
              onChange={(e) => onSeasonChange(e.target.value as SolarSeason)}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            >
              {SEASONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The annual map averages a geometry that reverses within the year.
            Winter over summer carries that contrast in one layer.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArea || terrainRunning || running}
              onClick={onRunTerrain}
              className="ar-ghost flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {terrainRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Mountain className="size-3.5" />
              )}
              {terrainRunning ? "Mapping…" : "Map over terrain"}
            </button>
            {hasTerrain && (
              <button
                type="button"
                onClick={onClearTerrain}
                disabled={terrainRunning}
                className="ar-ghost flex h-9 items-center justify-center rounded-sm border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Clear the terrain map"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The terrain map resolves what the point analysis cannot: irradiation
            on an inclined surface varies with slope and aspect, from the
            Copernicus DEM at 30 m.
          </p>
        </Section>

        <Section step="05" title="Siting">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Slope limit
              <input
                type="number"
                min={1}
                max={45}
                value={slopeRestrictive}
                onChange={(e) => onSlopeRestrictiveChange(Number(e.target.value))}
                className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Restrictive from
              <input
                type="number"
                min={1}
                max={45}
                value={slopeAcceptable}
                onChange={(e) => onSlopeAcceptableChange(Number(e.target.value))}
                className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArea || sitingRunning}
              onClick={onRunSiting}
              className="ar-ghost flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {sitingRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <LayoutGrid className="size-3.5" />
              )}
              {sitingRunning ? "Classifying…" : "Map siting"}
            </button>
            {hasSiting && (
              <button
                type="button"
                onClick={onClearSiting}
                disabled={sitingRunning}
                className="ar-ghost flex h-9 items-center justify-center rounded-sm border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Clear the siting map"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Slope limits and the excluded-cover list are project conventions,
            not verified legal restrictions. Legal reserve, permanent
            preservation areas and municipal zoning require the CAR and local
            legislation, which this analysis does not consult.
          </p>
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <Sun className="mt-0.5 size-3 shrink-0 opacity-70" />
            Needs no satellite scene, so it returns an answer for any AOI and
            carries no trained legend.
          </p>
        </Section>
      </motion.div>
    )
  }
)
