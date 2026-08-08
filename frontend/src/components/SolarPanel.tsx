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
  Wind,
  Zap,
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

/**
 * What an action returns, stated before it is run.
 *
 * Two of the five products on this panel draw a raster; three return only
 * figures. Every other workflow in the application -- classification,
 * compositions, surface water -- always draws, so a run button that says
 * nothing is read as promising a layer. This marker is the only place that
 * distinction is declared, and it is verifiable against lib/types.ts: the
 * terrain and siting payloads carry overlay_uri and extent, the other three
 * carry neither.
 */
function OutputKind({ draws }: { draws: boolean }) {
  return (
    <span className="telemetry text-[10px] text-muted-foreground">
      {draws ? "returns a map layer" : "returns figures, no map layer"}
    </span>
  )
}

/**
 * Progress for whichever product is running.
 *
 * Rendered by every action rather than only by the first. The bar used to sit
 * in the Run section alone and to test the solar-resource flag, so the four
 * other products wrote progress that nothing displayed. Only one action runs at
 * a time, so one bar per section is unambiguous.
 */
function RunProgress({
  active,
  progress,
  message,
}: {
  active: boolean
  progress: number
  message: string
}) {
  if (!active) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="ar-track h-1 overflow-hidden rounded-sm">
        <div
          className="h-full rounded-sm bg-primary transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      <span className="telemetry text-[10px] text-muted-foreground">
        {message}
      </span>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
      />
    </label>
  )
}

/**
 * Defaults mirrored from the sidecar module constants.
 *
 * The Python constant and this initial state are duplicated with no link
 * between them, so each control states its default and where the default comes
 * from, and the response echoes back the value actually used under
 * `assumptions`. A field left at its default is still sent explicitly.
 */
export const ENERGY_DECLARED_LOSSES: {
  key: string
  label: string
  defaultPct: number
}[] = [
  { key: "soiling", label: "Soiling", defaultPct: 2.0 },
  { key: "mismatch", label: "DC mismatch", defaultPct: 2.0 },
  { key: "wiring", label: "DC wiring", defaultPct: 2.0 },
  { key: "connections", label: "Connections", defaultPct: 0.5 },
  { key: "nameplate_rating", label: "Nameplate", defaultPct: 1.0 },
  { key: "lid", label: "Light-induced deg.", defaultPct: 1.5 },
]

export const ENERGY_OPTIONAL_LOSSES: {
  key: string
  label: string
  defaultPct: number
  pvwattsSuggestedPct: number
}[] = [
  {
    key: "interrow_shading",
    label: "Inter-row shading",
    defaultPct: 0.0,
    pvwattsSuggestedPct: 3.0,
  },
  {
    key: "availability",
    label: "Availability",
    defaultPct: 0.0,
    pvwattsSuggestedPct: 3.0,
  },
]

/** Keys of the sidecar capacity-density table, with the source of each. */
export const ENERGY_CAPACITY_DENSITY_BASES: { id: string; label: string }[] = [
  {
    id: "bolinger_fixed_total_site",
    label: "Bolinger fixed tilt, total site",
  },
  { id: "bolinger_fixed_direct", label: "Bolinger fixed tilt, direct array" },
  { id: "bolinger_tracking_direct", label: "Bolinger tracking, direct array" },
  { id: "nrel_large_fixed_total", label: "Ong T3, above 20 MW, total site" },
  { id: "nrel_large_fixed_direct", label: "Ong T4, above 20 MW, direct array" },
  { id: "nrel_small_fixed_total", label: "Ong T3, below 20 MW, total site" },
  { id: "nrel_small_fixed_direct", label: "Ong T4, below 20 MW, direct array" },
]

export const ENERGY_DEFAULTS = {
  reportingBasis: "year_one" as "year_one" | "lifetime_mean",
  /** Jordan and Kurtz (2013), crystalline silicon median 0.5 percent per year. */
  degradationRatePctPerYear: 0.5,
  /** Project convention. */
  analysisPeriodYears: 25,
  /**
   * Bolinger and Bolinger (2022) fleet capacity densities of 0.35 and 0.24
   * MW_DC per acre are 0.86487 and 0.59305 MW_DC per hectare, which at 20
   * percent module efficiency imply ground coverage ratios of 0.43243 and
   * 0.29653. The tracker default was 0.35, which follows from no published
   * pair; at the reference site yields of 1507.70 fixed and 1782.41 tracking
   * kWh/kWp/yr that is the difference between a derived per-hectare change of
   * -4.88 and -19.83 percent. Both are editable request parameters.
   */
  gcrFixed: 0.435,
  gcrTracker: 0.295,
  trackerMaxAngleDeg: 60,
  capacityDensityBasis: "bolinger_fixed_total_site",
  /** Bolinger and Bolinger (2022) worked example, not a measured median. */
  buildableFraction: 0.75,
}

export const WIND_DEFAULTS = {
  /** Mirrors the hourly window the solar resource uses. */
  recordYears: 10,
  /** The reference turbine hub. No turbine has been selected for any site. */
  hubHeightM: 110,
  calmThresholdMS: 0.5,
  /** No published basis: a check on a near-surface field whose extremes are absent. */
  recordMaxFloorMS: 10,
  /** Open agricultural land, assumed rather than measured. */
  roughnessLowM: 0.03,
  roughnessHighM: 0.1,
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
  energyRunning: boolean
  hasEnergy: boolean
  energyReportingBasis: "year_one" | "lifetime_mean"
  onEnergyReportingBasisChange: (v: "year_one" | "lifetime_mean") => void
  /** Percent per year. Applies on the lifetime-mean basis only. */
  energyDegradationPct: number
  onEnergyDegradationPctChange: (v: number) => void
  energyAnalysisPeriod: number
  onEnergyAnalysisPeriodChange: (v: number) => void
  energyGcrFixed: number
  onEnergyGcrFixedChange: (v: number) => void
  energyGcrTracker: number
  onEnergyGcrTrackerChange: (v: number) => void
  energyTrackerMaxAngle: number
  onEnergyTrackerMaxAngleChange: (v: number) => void
  energyDensityBasis: string
  onEnergyDensityBasisChange: (v: string) => void
  energyBuildableFraction: number
  onEnergyBuildableFractionChange: (v: number) => void
  /** Blank labels the diurnal profile in UTC. */
  energyUtcOffset: string
  onEnergyUtcOffsetChange: (v: string) => void
  energyApplyShading: boolean
  onEnergyApplyShadingChange: (v: boolean) => void
  /** AOI-mean share of beam blocked, from a terrain run; null without one. */
  energyShadingMeanPct: number | null
  energyDeclaredLoss: Record<string, number>
  onEnergyDeclaredLossChange: (key: string, pct: number) => void
  energyOptionalLoss: Record<string, number>
  onEnergyOptionalLossChange: (key: string, pct: number) => void
  onRunEnergy: () => void
  onClearEnergy: () => void
  windRunning: boolean
  hasWind: boolean
  windRecordYears: number
  onWindRecordYearsChange: (v: number) => void
  windHubHeight: number
  onWindHubHeightChange: (v: number) => void
  windCalmThreshold: number
  onWindCalmThresholdChange: (v: number) => void
  windRecordMaxFloor: number
  onWindRecordMaxFloorChange: (v: number) => void
  windRoughnessLow: number
  onWindRoughnessLowChange: (v: number) => void
  windRoughnessHigh: number
  onWindRoughnessHighChange: (v: number) => void
  onRunWind: () => void
  onClearWind: () => void
  onCollapse: () => void
}

const SEASONS: { id: SolarSeason; label: string }[] = [
  { id: "annual", label: "Annual" },
  { id: "winter", label: "Winter" },
  { id: "summer", label: "Summer" },
  { id: "winter_crop", label: "Winter crop" },
  { id: "anisotropy", label: "Winter / summer" },
  { id: "shading", label: "Horizon shading" },
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
      energyRunning,
      hasEnergy,
      energyReportingBasis,
      onEnergyReportingBasisChange,
      energyDegradationPct,
      onEnergyDegradationPctChange,
      energyAnalysisPeriod,
      onEnergyAnalysisPeriodChange,
      energyGcrFixed,
      onEnergyGcrFixedChange,
      energyGcrTracker,
      onEnergyGcrTrackerChange,
      energyTrackerMaxAngle,
      onEnergyTrackerMaxAngleChange,
      energyDensityBasis,
      onEnergyDensityBasisChange,
      energyBuildableFraction,
      onEnergyBuildableFractionChange,
      energyUtcOffset,
      onEnergyUtcOffsetChange,
      energyApplyShading,
      onEnergyApplyShadingChange,
      energyShadingMeanPct,
      energyDeclaredLoss,
      onEnergyDeclaredLossChange,
      energyOptionalLoss,
      onEnergyOptionalLossChange,
      onRunEnergy,
      onClearEnergy,
      windRunning,
      hasWind,
      windRecordYears,
      onWindRecordYearsChange,
      windHubHeight,
      onWindHubHeightChange,
      windCalmThreshold,
      onWindCalmThresholdChange,
      windRecordMaxFloor,
      onWindRecordMaxFloorChange,
      windRoughnessLow,
      onWindRoughnessLowChange,
      windRoughnessHigh,
      onWindRoughnessHighChange,
      onRunWind,
      onClearWind,
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
          <RunProgress active={running} progress={progress} message={progressMsg} />
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
          <OutputKind draws={false} />
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
            Winter over summer carries that contrast in one layer. Winter and
            summer are drawn on one colour domain, so the two are comparable.
            Horizon shading is the share of beam irradiation the surrounding
            terrain blocks, which is small in the mean and large in valleys.
          </p>
          <RunProgress active={terrainRunning} progress={progress} message={progressMsg} />
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
          <OutputKind draws />
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
          <RunProgress active={sitingRunning} progress={progress} message={progressMsg} />
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
          <OutputKind draws />
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

        <Section step="06" title="Energy model">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Runs on the same radiation chain and the same optimum as step 04,
            at the performance ratio set in step 03, so the two products cannot
            report different yields for one AOI. Adds the loss stack behind
            that ratio, the single-axis tracking comparison, the diurnal
            profile and the plant energy over the suitable area.
          </p>

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Reporting basis
            <select
              value={energyReportingBasis}
              onChange={(e) =>
                onEnergyReportingBasisChange(
                  e.target.value as "year_one" | "lifetime_mean"
                )
              }
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            >
              <option value="year_one">Year one (default)</option>
              <option value="lifetime_mean">Lifetime mean</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Degradation %/yr"
              value={energyDegradationPct}
              onChange={onEnergyDegradationPctChange}
              min={0}
              max={5}
              step={0.1}
            />
            <NumberField
              label="Analysis period (yr)"
              value={energyAnalysisPeriod}
              onChange={onEnergyAnalysisPeriodChange}
              min={1}
              max={50}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Degradation is a basis for the whole chain, not a loss row, so
            every figure carries the basis it was computed on. Year one applies
            none. Defaults: 0.5 %/yr, the crystalline silicon median of Jordan
            and Kurtz (2013); 25 years, a project convention.
          </p>

          <span className="text-[11px] text-muted-foreground">
            Declared losses (%)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {ENERGY_DECLARED_LOSSES.map((term) => (
              <NumberField
                key={term.key}
                label={`${term.label} (${term.defaultPct})`}
                value={energyDeclaredLoss[term.key] ?? term.defaultPct}
                onChange={(v) => onEnergyDeclaredLossChange(term.key, v)}
                min={0}
                max={50}
                step={0.1}
              />
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Terms this chain does not model, entered as declared assumptions.
            The value in brackets is the PVWatts v5 default from Dobos (2014),
            NREL/TP-6A20-62641. They multiply the modelled ratio into the
            derived one; the applied ratio is unaffected.
          </p>

          <span className="text-[11px] text-muted-foreground">
            Optional losses (%)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {ENERGY_OPTIONAL_LOSSES.map((term) => (
              <NumberField
                key={term.key}
                label={`${term.label} (${term.defaultPct})`}
                value={energyOptionalLoss[term.key] ?? term.defaultPct}
                onChange={(v) => onEnergyOptionalLossChange(term.key, v)}
                min={0}
                max={50}
                step={0.1}
              />
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Both default to zero. PVWatts v5 suggests 3 percent for each.
            Applying both multiplies the derived ratio by 0.9409; at the
            reference site that takes it from 0.7825 to 0.7363, which is 7.5 to
            8.1 percent below the Global Solar Atlas implied band of 0.796 to
            0.801, the external reference the applied ratio is calibrated
            against. No row geometry is modelled here, so there is nothing from
            which an inter-row shading loss could be computed.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="GCR fixed (0.435)"
              value={energyGcrFixed}
              onChange={onEnergyGcrFixedChange}
              min={0.05}
              max={0.95}
              step={0.005}
            />
            <NumberField
              label="GCR tracker (0.295)"
              value={energyGcrTracker}
              onChange={onEnergyGcrTrackerChange}
              min={0.05}
              max={0.95}
              step={0.005}
            />
          </div>
          <NumberField
            label="Tracker rotation limit, degrees (60)"
            value={energyTrackerMaxAngle}
            onChange={onEnergyTrackerMaxAngleChange}
            min={10}
            max={90}
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Both defaults follow from the fleet capacity densities of Bolinger
            and Bolinger (2022), 0.35 MW_DC per acre fixed tilt and 0.24 MW_DC
            per acre single-axis tracking, which are 0.865 and 0.593 MW_DC per
            hectare. At 20 percent module efficiency those imply ground
            coverage ratios of 0.432 and 0.297; the defaults 0.435 and 0.295
            sit within 0.6 percent of them. Their ratio sets the sign of the
            per-hectare comparison and the published ranges straddle the parity
            point, so the response reports the parity ratio beside the answer.
            The rotation limit is a project convention. Backtracking is always
            on and is not exposed: without it pvlib ignores the coverage ratio
            and returns a gain no plant would deliver.
          </p>

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Capacity density basis
            <select
              value={energyDensityBasis}
              onChange={(e) => onEnergyDensityBasisChange(e.target.value)}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            >
              {ENERGY_CAPACITY_DENSITY_BASES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Buildable fraction (0.75)"
            value={energyBuildableFraction}
            onChange={onEnergyBuildableFractionChange}
            min={0.05}
            max={1}
            step={0.05}
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Default: Bolinger and Bolinger (2022) fixed tilt, derated to a
            total-site basis by the buildable fraction the paper gives as a
            worked example. The area basis moves the capacity further than the
            exceedance band does, so it is reported with every figure. The
            direct-array entries apply to array area only; using one against a
            whole site overstates capacity by 1/0.75.
          </p>

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            UTC offset for the diurnal profile (blank = UTC)
            <input
              type="text"
              inputMode="decimal"
              placeholder="-3"
              value={energyUtcOffset}
              onChange={(e) => onEnergyUtcOffsetChange(e.target.value)}
              className="ar-inset px-2 py-1 text-xs text-foreground outline-none"
            />
          </label>

          <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={energyApplyShading}
              disabled={energyShadingMeanPct == null}
              onChange={(e) => onEnergyApplyShadingChange(e.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-primary disabled:opacity-40"
            />
            <span>
              Apply horizon shading from the terrain map
              {energyShadingMeanPct == null
                ? " (run one in step 04 first)"
                : ` (${energyShadingMeanPct.toFixed(2)}% of beam, AOI mean)`}
            </span>
          </label>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Off by default. The terrain map measures shading over the whole
            AOI, while the derate applies to the suitable pixels only, so
            carrying it across is a decision the response records rather than
            an automatic step. Left off, the plant figures are reported
            unshaded.
          </p>

          <RunProgress active={energyRunning} progress={progress} message={progressMsg} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArea || energyRunning || running}
              onClick={onRunEnergy}
              className="ar-ghost flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {energyRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Zap className="size-3.5" />
              )}
              {energyRunning ? "Modelling…" : "Run energy model"}
            </button>
            {hasEnergy && (
              <button
                type="button"
                onClick={onClearEnergy}
                disabled={energyRunning}
                className="ar-ghost flex h-9 items-center justify-center rounded-sm border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Clear the energy model"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <OutputKind draws={false} />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            A siting map from step 05 is reused as the classification behind
            the capacity; without one the AOI is classified afresh on the slope
            limits set there. The plant figures are a resource and land
            ceiling, not an interconnectable or permitted capacity.
          </p>
        </Section>

        <Section step="07" title="Wind screening">
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <Wind className="mt-0.5 size-3 shrink-0 opacity-70" />A separate
            product, not part of the solar chain. It resolves on the reanalysis
            grid of 0.5 by 0.625 degrees, which is a different cell from the 1
            degree radiation grid above, and it is saved as its own run kind.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Record years (10)"
              value={windRecordYears}
              onChange={onWindRecordYearsChange}
              min={1}
              max={30}
            />
            <NumberField
              label="Hub height, m (110)"
              value={windHubHeight}
              onChange={onWindHubHeightChange}
              min={10}
              max={200}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The record carries 10 m and 50 m. A hub above 50 m is a power-law
            extrapolation, and the response states the ratio it sits at. The
            110 m default is the reference turbine hub, a project convention;
            no turbine has been selected for any site.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Roughness low, m (0.03)"
              value={windRoughnessLow}
              onChange={onWindRoughnessLowChange}
              min={0.001}
              max={2}
              step={0.01}
            />
            <NumberField
              label="Roughness high, m (0.10)"
              value={windRoughnessHigh}
              onChange={onWindRoughnessHighChange}
              min={0.001}
              max={2}
              step={0.01}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            An assumed land-cover property for open agricultural terrain, not a
            measurement at this AOI. The shear exponent derived from the record
            is inverted to a roughness and checked against this band; a
            disagreement is the strongest single reason not to read the hub
            figures as a measurement.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Calm threshold, m/s (0.5)"
              value={windCalmThreshold}
              onChange={onWindCalmThresholdChange}
              min={0}
              max={5}
              step={0.1}
            />
            <NumberField
              label="Record max floor, m/s (10)"
              value={windRecordMaxFloor}
              onChange={onWindRecordMaxFloorChange}
              min={0}
              max={50}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Both are project conventions with no published basis. The floor
            exists to catch a near-surface field whose extremes are absent;
            read the record maximum and the record length rather than the flag
            alone.
          </p>
          <RunProgress active={windRunning} progress={progress} message={progressMsg} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArea || windRunning}
              onClick={onRunWind}
              className="ar-ghost flex h-9 flex-1 items-center justify-center gap-1.5 rounded-sm border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {windRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wind className="size-3.5" />
              )}
              {windRunning ? "Screening…" : "Screen wind"}
            </button>
            {hasWind && (
              <button
                type="button"
                onClick={onClearWind}
                disabled={windRunning}
                className="ar-ghost flex h-9 items-center justify-center rounded-sm border px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Clear the wind screening"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <OutputKind draws={false} />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Screening indication, gross of losses, unvalidated. The capacity
            factor excludes wake, availability, electrical, icing and
            curtailment losses, and it has no external benchmark of the kind
            the photovoltaic ratio has, which is computed at a performance
            ratio bracketed by the Global Solar Atlas. It is not comparable
            with the photovoltaic capacity factor, and the two are never placed
            in a shared comparison: the analysis page gives each its own
            section and no table, figure row or export column holds both.
          </p>
        </Section>
      </motion.div>
    )
  }
)
