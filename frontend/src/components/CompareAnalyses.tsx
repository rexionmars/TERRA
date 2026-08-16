import { ArrowLeft, ArrowLeftRight } from "lucide-react"
import { PageBody, PageShell } from "@/components/ui/PageShell"
import { btnGhost, btnGhostDense, btnPrimary, btnPrimaryCommit } from "@/components/ui/buttons"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Label,
} from "recharts"
import type {
  ClassStat,
  InferenceRun,
  PhenologyMetrics,
  PredictResult,
} from "@/lib/types"
import { displayRunLabel } from "@/lib/aoiLabel"
import {
  gapLimitMs,
  dateToMs,
  insertTimeGaps,
  timeAxisProps,
  timeLabelFormatter,
  timeTickFormatter,
} from "@/lib/chartAxis"
import { DomainShiftSection } from "@/components/DomainShiftSection"

function modelLabel(kind: string): string {
  if (kind === "temporal_transformer") return "Temporal Transformer"
  if (kind === "prithvi") return "Prithvi-EO 2.0"
  if (kind === "spectral") return "Random Forest"
  return kind || "—"
}

function runTitle(run: InferenceRun): string {
  const t = displayRunLabel(run.label)
  return t === "run-untitled" ? modelLabel(run.model_kind) : t
}

function extentsDiffer(a: PredictResult, b: PredictResult): boolean {
  const ea = a.extent
  const eb = b.extent
  if (!ea || !eb) return false
  const eps = 1e-5
  return (
    Math.abs(ea.lat_min - eb.lat_min) > eps ||
    Math.abs(ea.lat_max - eb.lat_max) > eps ||
    Math.abs(ea.lon_min - eb.lon_min) > eps ||
    Math.abs(ea.lon_max - eb.lon_max) > eps
  )
}

function polygonsDiffer(runA: InferenceRun, runB: InferenceRun): boolean {
  const a = (runA.polygon_geojson || "").trim()
  const b = (runB.polygon_geojson || "").trim()
  if (!a || !b) return false
  return a !== b
}

export function mergeClassStats(
  a: ClassStat[] | null | undefined,
  b: ClassStat[] | null | undefined
): Array<{
  class_id: number
  name: string
  color: string
  pctA: number
  pctB: number
  areaA: number
  areaB: number
}> {
  const map = new Map<
    number,
    {
      class_id: number
      name: string
      color: string
      pctA: number
      pctB: number
      areaA: number
      areaB: number
    }
  >()
  for (const s of a ?? []) {
    map.set(s.class_id, {
      class_id: s.class_id,
      name: s.name,
      color: s.color,
      pctA: s.pct,
      pctB: 0,
      areaA: s.area_ha,
      areaB: 0,
    })
  }
  for (const s of b ?? []) {
    const prev = map.get(s.class_id)
    if (prev) {
      prev.pctB = s.pct
      prev.areaB = s.area_ha
      if (!prev.name) prev.name = s.name
      if (!prev.color) prev.color = s.color
    } else {
      map.set(s.class_id, {
        class_id: s.class_id,
        name: s.name,
        color: s.color,
        pctA: 0,
        pctB: s.pct,
        areaA: 0,
        areaB: s.area_ha,
      })
    }
  }
  return [...map.values()].sort(
    (x, y) => Math.max(y.pctA, y.pctB) - Math.max(x.pctA, x.pctB)
  )
}

function fmtMetric(v: number | null | undefined, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "—"
  return `${Number(v).toFixed(v % 1 === 0 ? 0 : 2)}${suffix}`
}

function RunSummaryCard({
  slot,
  run,
  result,
}: {
  slot: "A" | "B"
  run: InferenceRun
  result: PredictResult
}) {
  const conf =
    result.mean_confidence > 0
      ? `${(result.mean_confidence * 100).toFixed(0)}%`
      : "—"
  return (
    <div className="rounded-sm border border-border bg-secondary/50 p-4">
      <div className="flex items-center gap-2">
        <span className="telemetry shrink-0 rounded-sm bg-primary/20 px-1.5 py-0.5 text-meta text-primary">
          {slot}
        </span>
        <h2 className="truncate font-display text-sm font-semibold tracking-wide">
          {runTitle(run)}
        </h2>
      </div>
      <p className="mt-1 text-body text-muted-foreground">
        {modelLabel(run.model_kind)} · {run.period_start} → {run.period_end}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniStat label="Scenes" value={String(result.n_dates || run.n_dates || "—")} />
        <MiniStat label="Mean conf" value={conf} />
        <MiniStat
          label="Classes"
          value={String(result.class_stats?.length ?? "—")}
        />
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-secondary flex min-h-[4.25rem] flex-col justify-center px-2.5 py-2">
      <div className="eyebrow">{label}</div>
      <div className="telemetry mt-0.5 text-emphasis text-foreground">{value}</div>
    </div>
  )
}

function PanelTile({
  title,
  uri,
  empty,
}: {
  title: string
  uri?: string
  empty: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="eyebrow !text-muted-foreground">{title}</p>
      <div className="rounded-sm border border-border bg-background relative aspect-[4/3] overflow-hidden">
        {uri ? (
          <img src={uri} alt={title} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-meta text-muted-foreground">
            {empty}
          </div>
        )}
      </div>
    </div>
  )
}

function PhenologyCompare({
  a,
  b,
}: {
  a: PhenologyMetrics | undefined
  b: PhenologyMetrics | undefined
}) {
  if (!a && !b) return null
  const rows: Array<{ key: string; label: string; suffix?: string }> = [
    { key: "sos_doy", label: "SOS", suffix: " d" },
    { key: "pos_doy", label: "POS", suffix: " d" },
    { key: "eos_doy", label: "EOS", suffix: " d" },
    { key: "los_days", label: "LOS", suffix: " d" },
    { key: "peak", label: "Peak" },
    { key: "base", label: "Base" },
    { key: "amplitude", label: "Amp" },
  ]
  return (
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <p className="eyebrow mb-3">Phenology metrics · A vs B</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead>
            <tr
              className="border-b text-meta text-muted-foreground"
              style={{ borderColor: "var(--border)" }}
            >
              <th className="py-1.5 pr-3 font-normal">Metric</th>
              <th className="py-1.5 pr-3 font-normal">A</th>
              <th className="py-1.5 font-normal">B</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="py-1.5 pr-3 text-muted-foreground">{r.label}</td>
                <td className="telemetry py-1.5 pr-3">
                  {fmtMetric(
                    a?.[r.key as keyof PhenologyMetrics] as number | null,
                    r.suffix
                  )}
                </td>
                <td className="telemetry py-1.5">
                  {fmtMetric(
                    b?.[r.key as keyof PhenologyMetrics] as number | null,
                    r.suffix
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function NdviChart({
  slot,
  data,
  stroke,
  domain,
  yDomain,
}: {
  slot: "A" | "B"
  data: PredictResult["vi_series"]
  stroke: string
  /**
   * The time span BOTH panels are drawn on.
   *
   * Each panel scaled to its own dates before, so two runs over different
   * periods were drawn the same width and read as directly comparable. The
   * whole point of this view is comparing them, and the axis was the one thing
   * making that impossible: a run over three months and a run over a year
   * looked like the same season.
   */
  domain: [number, number]
  /** Shared for the same reason, so a difference in height is a difference. */
  yDomain: [number, number]
}) {
  const points = (data ?? []).map((p) => ({
    t: dateToMs(p.date),
    ndvi_mean: p.ndvi_mean,
  }))
  // Per panel, from that run's own cadence: the two runs being compared may
  // have been sampled differently, and one threshold for both would break the
  // sparser series or join across a real absence in the denser one.
  const rows = insertTimeGaps(points, gapLimitMs(points.map((r) => r.t)))
  return (
    <div>
      <p className="mb-1 text-meta text-muted-foreground">{slot}</p>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={rows} margin={{ top: 4, right: 10, left: 2, bottom: 18 }}>
          <XAxis
            {...timeAxisProps}
            domain={domain}
            allowDataOverflow
            tickFormatter={timeTickFormatter(domain[1] - domain[0])}
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickMargin={6}
            minTickGap={26}
          >
            <Label
              value="Acquisition date"
              position="insideBottom"
              offset={-12}
              style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            />
          </XAxis>
          <YAxis
            domain={yDomain}
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(v: number) => v.toFixed(2)}
            width={46}
          >
            <Label
              value="NDVI (dimensionless)"
              angle={-90}
              position="insideLeft"
              style={{
                fontSize: 12,
                fill: "var(--muted-foreground)",
                textAnchor: "middle",
              }}
            />
          </YAxis>
          <Tooltip
            labelFormatter={timeLabelFormatter}
            formatter={(v: number) => v.toFixed(2)}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontSize: 11,
            }}
          />
          <Line
            type="linear"
            dataKey="ndvi_mean"
            name="NDVI"
            stroke={stroke}
            strokeWidth={1.6}
            dot={{ r: 1.6, strokeWidth: 0, fill: stroke }}
            activeDot={{ r: 3 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface CompareAnalysesProps {
  runA: InferenceRun
  runB: InferenceRun
  resultA: PredictResult
  resultB: PredictResult
  onBack: () => void
  onSwap: () => void
}

export function CompareAnalyses({
  runA,
  runB,
  resultA,
  resultB,
  onBack,
  onSwap,
}: CompareAnalysesProps) {
  const differentAoi =
    polygonsDiffer(runA, runB) || extentsDiffer(resultA, resultB)
  const merged = mergeClassStats(resultA.class_stats, resultB.class_stats)
  const hasVi =
    (resultA.vi_series?.length ?? 0) > 0 && (resultB.vi_series?.length ?? 0) > 0

  /**
   * One pair of axes for both panels.
   *
   * Each scaled to its own data before, which is the failure mode this whole
   * screen exists to avoid: two runs over different periods drew the same
   * width, so a three-month season and a full year looked alike, and a
   * difference in curve height was as likely to be a difference in axis as a
   * difference in vegetation.
   */
  const viTimes = [...(resultA.vi_series ?? []), ...(resultB.vi_series ?? [])]
    .map((p) => dateToMs(p.date))
    .filter((t) => Number.isFinite(t))
  const viDomain: [number, number] = viTimes.length
    ? [Math.min(...viTimes), Math.max(...viTimes)]
    : [0, 1]

  const viValues = [...(resultA.vi_series ?? []), ...(resultB.vi_series ?? [])]
    .map((p) => p.ndvi_mean)
    .filter((v) => Number.isFinite(v))
  // Padded by a twentieth so the extremes are not drawn on the frame, and
  // taken from the data rather than forced to 0..1: NDVI is defined on [-1, 1]
  // and a fixed floor of -0.1 silently clipped water and cloud shadow.
  const viYDomain: [number, number] = viValues.length
    ? (() => {
        const lo = Math.min(...viValues)
        const hi = Math.max(...viValues)
        const pad = Math.max(0.02, (hi - lo) / 20)
        return [lo - pad, hi + pad]
      })()
    : [0, 1]
  const hasPheno =
    !!(resultA.phenology || resultB.phenology) &&
    ((resultA.n_dates ?? 0) > 0 ||
      (resultB.n_dates ?? 0) > 0 ||
      !!resultA.overlay_uri ||
      !!resultB.overlay_uri)

  return (
    <PageShell className="flex-col">
      <header className="shrink-0 px-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold tracking-wide xl:text-2xl">
              Compare analyses
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Side-by-side prediction, confidence, and class distribution for two
              saved runs.
            </p>
            {differentAoi && (
              <p className="mt-2 text-body text-amber-500/90">
                Areas of interest differ — maps and stats may not be directly
                comparable.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBack} className={btnGhost}>
              <ArrowLeft className="h-3 w-3" />
              Back to list
            </button>
            <button type="button" onClick={onSwap} className={btnGhost}>
              <ArrowLeftRight className="h-3 w-3" />
              Swap A / B
            </button>
          </div>
        </div>
      </header>

      <PageBody>
        <div className="flex w-full flex-col gap-3 px-5 py-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <RunSummaryCard slot="A" run={runA} result={resultA} />
            <RunSummaryCard slot="B" run={runB} result={resultB} />
          </div>

          <DomainShiftSection
            resultA={resultA}
            resultB={resultB}
            labelA={runTitle(runA)}
            labelB={runTitle(runB)}
          />

          <section className="rounded-sm border border-border bg-secondary/50 p-4">
            <p className="eyebrow mb-3">Overlays · prediction & confidence</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <PanelTile
                title={`Predicted · ${modelLabel(runA.model_kind)}`}
                uri={resultA.overlay_uri}
                empty="No prediction"
              />
              <PanelTile
                title={`Predicted · ${modelLabel(runB.model_kind)}`}
                uri={resultB.overlay_uri}
                empty="No prediction"
              />
              <PanelTile
                title="Confidence · A"
                uri={resultA.confidence_uri}
                empty="No confidence map"
              />
              <PanelTile
                title="Confidence · B"
                uri={resultB.confidence_uri}
                empty="No confidence map"
              />
            </div>
          </section>

          {merged.length > 0 && (
            <section className="rounded-sm border border-border bg-secondary/50 p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <p className="eyebrow !text-foreground">Class distribution · A vs B</p>
                <div className="flex gap-3 text-meta text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-4 rounded-full bg-primary/80" />
                    A
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-4 rounded-full bg-sky-400/80" />
                    B
                  </span>
                </div>
              </div>
              <ul className="flex flex-col gap-2.5">
                {merged.map((row) => (
                  <li key={row.class_id} className="flex flex-col gap-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      <span className="telemetry shrink-0 text-muted-foreground">
                        {row.pctA.toFixed(1)}% / {row.pctB.toFixed(1)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <span className="rounded-sm border border-border bg-background relative h-2 overflow-hidden">
                        <span
                          className="absolute inset-y-0 left-0 rounded-sm bg-primary/80"
                          style={{ width: `${Math.min(100, row.pctA)}%` }}
                        />
                      </span>
                      <span className="rounded-sm border border-border bg-background relative h-2 overflow-hidden">
                        <span
                          className="absolute inset-y-0 left-0 rounded-sm bg-sky-400/80"
                          style={{ width: `${Math.min(100, row.pctB)}%` }}
                        />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(hasPheno || hasVi) && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
              {hasPheno && (
                <PhenologyCompare a={resultA.phenology} b={resultB.phenology} />
              )}
              {hasVi && (
                <section className="rounded-sm border border-border bg-secondary/50 p-4">
                  <p className="eyebrow mb-3">NDVI mean · A vs B</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NdviChart
                      slot="A"
                      data={resultA.vi_series}
                      stroke="var(--series-ndvi)"
                      domain={viDomain}
                      yDomain={viYDomain}
                    />
                    <NdviChart
                      slot="B"
                      data={resultB.vi_series}
                      stroke="var(--series-evi)"
                      domain={viDomain}
                      yDomain={viYDomain}
                    />
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}
