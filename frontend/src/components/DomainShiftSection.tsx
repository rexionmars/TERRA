/**
 * Domain Shift diagnosis panel for Compare analyses (and whiteboard summary).
 *
 * Metrics follow the study-guide distances: KL on NDVI histograms, CVA
 * magnitude (and red–NIR angle), linear MMD on feature samples, F1 / outside-
 * legend rates from MapBiomas agreement when present. PCA scatter by default;
 * t-SNE on demand.
 */
import { useEffect, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { WaterFigure } from "@/components/analysisPrimitives"
import {
  compareDomainShift,
  hasDomainFingerprint,
} from "@/lib/domainShift"
import type { DomainShiftReport, PredictResult } from "@/lib/types"
import { cn } from "@/lib/utils"

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

function histSeries(
  report: DomainShiftReport
): { bin: number; a: number; b: number }[] {
  const edges = report.ndvi_hist_a?.edges ?? report.ndvi_hist_b?.edges ?? []
  const pa = report.ndvi_hist_a?.probs ?? []
  const pb = report.ndvi_hist_b?.probs ?? []
  const n = Math.max(pa.length, pb.length)
  const out: { bin: number; a: number; b: number }[] = []
  for (let i = 0; i < n; i++) {
    const lo = edges[i] ?? i
    const hi = edges[i + 1] ?? lo
    out.push({
      bin: (lo + hi) / 2,
      a: (pa[i] ?? 0) * 100,
      b: (pb[i] ?? 0) * 100,
    })
  }
  return out
}

function AgreementBlock({
  title,
  block,
}: {
  title: string
  block: NonNullable<DomainShiftReport["agreement_a"]>
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow !text-[9px]">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        <WaterFigure
          label="Overall"
          value={
            block.overall_pct != null ? `${block.overall_pct.toFixed(1)}%` : "—"
          }
        />
        <WaterFigure
          label="Macro F1"
          value={block.macro_f1 != null ? fmt(block.macro_f1, 3) : "—"}
        />
        <WaterFigure
          label="Outside legend"
          value={
            block.outside_legend_pct != null
              ? `${block.outside_legend_pct.toFixed(1)}%`
              : "—"
          }
          sub={`${block.n_outside_legend.toLocaleString()} cells`}
        />
        <WaterFigure
          label="Quantity / alloc."
          value={`${fmt(block.quantity_disagreement_pct, 1)} / ${fmt(block.allocation_disagreement_pct, 1)}`}
          sub="Pontius disagreement %"
        />
      </div>
    </div>
  )
}

export function DomainShiftSection({
  resultA,
  resultB,
  labelA = "A",
  labelB = "B",
  compact = false,
}: {
  resultA: PredictResult
  resultB: PredictResult
  labelA?: string
  labelB?: string
  /** Whiteboard: fewer charts, same metrics. */
  compact?: boolean
}) {
  /*
    The legend's names, shortened to the segment that tells them apart.

    The caller passes the full label -- estimator, layer and area -- because the
    section's prose uses it. A legend is two entries at 9px under a figure, and
    there the full string is the modal's own header said twice.

    Which segment to keep depends on what the two sides differ by, and both
    cases are real: two areas under one model differ in the last segment (the
    area), while two models over one area differ in the first (the estimator)
    and share the last. Taking a fixed position would collapse one of them into
    two identical entries, so the differing segment is found rather than
    assumed.
  */
  const [shortA, shortB] = (() => {
    const pa = labelA.split(" · ").filter(Boolean)
    const pb = labelB.split(" · ").filter(Boolean)
    if (pa.length > 1 && pa.length === pb.length) {
      const differing = pa
        .map((seg, i) => (seg !== pb[i] ? i : -1))
        .filter((i) => i >= 0)
      if (differing.length) {
        const pick = (parts: string[]) =>
          differing.map((i) => parts[i]).join(" · ")
        return [pick(pa), pick(pb)]
      }
    }
    // Different shapes, or identical labels: nothing can be safely dropped, so
    // nothing is.
    return [labelA, labelB]
  })()

  const ready =
    hasDomainFingerprint(resultA) && hasDomainFingerprint(resultB)
  const [report, setReport] = useState<DomainShiftReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tsneBusy, setTsneBusy] = useState(false)

  useEffect(() => {
    if (!ready) {
      setReport(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void compareDomainShift(resultA, resultB)
      .then((r) => {
        if (!cancelled) setReport(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setReport(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resultA, resultB, ready])

  async function runTsne() {
    if (!ready) return
    setTsneBusy(true)
    try {
      const r = await compareDomainShift(resultA, resultB, {
        includeTsne: true,
      })
      setReport(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTsneBusy(false)
    }
  }

  const shell = cn(
    "flex flex-col",
    // Compare page: plate. Whiteboard foot: flush with the band — no card.
    compact
      ? "min-w-[16rem] shrink-0 gap-1.5"
      : "gap-3 rounded-sm border border-border bg-secondary/50 p-4"
  )

  if (!ready) {
    return (
      <section className={shell}>
        <p className="eyebrow mb-1">Domain shift</p>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Both runs need a domain fingerprint from classify. Re-run prediction
          on each AOI to enable KL / CVA / MMD diagnosis.
        </p>
      </section>
    )
  }

  const hist = report ? histSeries(report) : []
  const pointsA =
    report?.projection?.points.filter((p) => p.domain === "A") ?? []
  const pointsB =
    report?.projection?.points.filter((p) => p.domain === "B") ?? []

  return (
    <section className={shell}>
      <div
        className={cn(
          "flex flex-wrap items-end justify-between gap-2",
          !compact && "mb-0"
        )}
      >
        <div>
          <p className="eyebrow !text-foreground">Domain shift</p>
          {!compact && (
            <p className="mt-1 max-w-xl text-[10px] leading-snug text-muted-foreground">
              Distance between source ({labelA}) and target ({labelB}) feature
              domains — KL on NDVI, CVA magnitude, linear MMD. High values with
              high confidence usually mean the fixed crop legend is out of
              domain, not that the map is right.
            </p>
          )}
          {compact && (
            <p className="telemetry mt-0.5 truncate text-[9px] text-muted-foreground">
              {labelA} → {labelB}
            </p>
          )}
        </div>
        {!compact && (
          <button
            type="button"
            onClick={() => void runTsne()}
            disabled={tsneBusy || loading}
            className="rounded-sm border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {tsneBusy ? "Projecting…" : "t-SNE project"}
          </button>
        )}
      </div>

      {loading && (
        <p className="text-[10px] text-muted-foreground">Comparing domains…</p>
      )}
      {error && (
        <p className="text-[10px] leading-snug text-amber-500/90">{error}</p>
      )}

      {report && (
        <>
          <div
            className={cn(
              "grid gap-2",
              compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
            )}
          >
            <WaterFigure
              label="KL (NDVI)"
              value={fmt(report.kl_ndvi)}
              sub="sym. histogram divergence"
            />
            {/*
              The standardised magnitude leads where it exists. The raw one is
              measured in reflectance units mixed with acquisition indices, and
              on the shipped model six index features carried 99.7% of the raw
              squared distance while the sixteen reflectance features carried
              none -- so the raw figure mostly reports when the scenes were
              taken, not how the ground differs.
            */}
            <WaterFigure
              label={report.cva_magnitude_sd != null ? "CVA |M| (SD)" : "CVA |M|"}
              value={fmt(report.cva_magnitude_sd ?? report.cva_magnitude)}
              sub={
                report.cva_angle_red_nir_deg != null
                  ? `\u03d5 ${fmt(report.cva_angle_red_nir_deg, 0)}\u00b0 red\u2013NIR`
                  : report.cva_magnitude_sd != null
                    ? "training standard deviations"
                    : "mean feature L2, unstandardised"
              }
            />
            {/*
              MMD is not comparable across bandwidths, so the gamma the median
              heuristic chose is reported with it rather than dropped.
            */}
            <WaterFigure
              label="MMD\u00b2"
              value={fmt(report.mmd_rbf?.mmd2)}
              sub={
                report.mmd_rbf?.gamma != null
                  ? `RBF, \u03b3 ${fmt(report.mmd_rbf.gamma, 3)}, n ${report.mmd_rbf.n_a}/${report.mmd_rbf.n_b}`
                  : "not computed"
              }
            />
            <WaterFigure
              label="Spaces"
              value={`${report.space_a ?? "\u2014"} / ${report.space_b ?? "\u2014"}`}
              sub="fingerprint kind"
            />
          </div>

          {/*
            The qualifier, stated rather than implied by a dash.

            Both refusals produce a report with distances in it, and those
            distances mean different things -- or nothing. Comparing an
            80-feature spectral fingerprint against a one-column NDVI one is a
            number from two different quantities; comparing without the
            training scaler is a number in mixed units. Saying so is the
            difference between a missing figure and a misleading one.
          */}
          {report.same_space === false ? (
            <p className="mt-2 text-[10px] leading-snug text-amber-500/90">
              These fingerprints describe different feature spaces
              ({report.space_a ?? "?"} against {report.space_b ?? "?"}). The
              distances above are computed from quantities that are not the
              same, and are not comparable.
            </p>
          ) : report.standardised === false ? (
            <p className="mt-2 text-[10px] leading-snug text-amber-500/90">
              Not standardised: one of the runs carries no training scaler, so
              the distances are in raw feature units. On this model the
              acquisition-index features dominate a raw distance, so the figures
              above describe acquisition more than ground.
            </p>
          ) : null}

          {(report.agreement_a || report.agreement_b) && !compact && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {report.agreement_a && (
                <AgreementBlock title={`${labelA} · vs MapBiomas`} block={report.agreement_a} />
              )}
              {report.agreement_b && (
                <AgreementBlock title={`${labelB} · vs MapBiomas`} block={report.agreement_b} />
              )}
            </div>
          )}

          {compact && (report.agreement_a?.macro_f1 != null || report.agreement_b?.macro_f1 != null) && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <WaterFigure
                label={`${labelA} F1`}
                value={fmt(report.agreement_a?.macro_f1)}
              />
              <WaterFigure
                label={`${labelB} F1`}
                value={fmt(report.agreement_b?.macro_f1)}
              />
            </div>
          )}

          {/*
            Where the shift is, not only how large it is.

            A scalar distance says two domains differ and gives the analyst
            nothing to act on. This says which features moved, by how many
            training standard deviations, and whether the forest weighs them --
            a large displacement in a feature of negligible importance is not
            the same finding as a small one in a feature the model leans on,
            and the two are indistinguishable in any single number.

            Sorted by displacement, as the sidecar returns it. `weighted` is
            the product of the two, which is the column to read when deciding
            whether the shift reaches the prediction.
          */}
          {!compact && report.feature_shift && report.feature_shift.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow mb-2">
                Feature shift \u00b7 top {report.feature_shift.length} by displacement
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] border-separate border-spacing-0 text-[10px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2 font-normal">Feature</th>
                      <th className="py-1 pr-2 text-right font-normal">z(A)</th>
                      <th className="py-1 pr-2 text-right font-normal">z(B)</th>
                      <th className="py-1 pr-2 text-right font-normal">gap (SD)</th>
                      <th className="py-1 pr-2 text-right font-normal">importance</th>
                      <th className="py-1 text-right font-normal">weighted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.feature_shift.map((r) => (
                      <tr
                        key={r.feature}
                        className="border-t"
                        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
                      >
                        <td className="telemetry py-1 pr-2 text-foreground">
                          {r.feature}
                        </td>
                        <td className="telemetry py-1 pr-2 text-right tabular-nums text-muted-foreground">
                          {fmt(r.z_a, 2)}
                        </td>
                        <td className="telemetry py-1 pr-2 text-right tabular-nums text-muted-foreground">
                          {fmt(r.z_b, 2)}
                        </td>
                        <td className="telemetry py-1 pr-2 text-right tabular-nums text-foreground">
                          {r.gap_sd > 0 ? "+" : ""}
                          {fmt(r.gap_sd, 2)}
                        </td>
                        <td className="telemetry py-1 pr-2 text-right tabular-nums text-muted-foreground">
                          {r.importance == null ? "\u2014" : fmt(r.importance, 4)}
                        </td>
                        <td className="telemetry py-1 text-right tabular-nums text-foreground">
                          {fmt(r.weighted, 4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!compact && hist.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow mb-2">NDVI histogram · A vs B</p>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    {/*
                      Horizontal rules only, and no dashes. The reading is the
                      height of two curves against a share axis; vertical
                      dashes cross the curves without helping that, and are the
                      largest source of non-data ink in the figure.
                    */}
                    <CartesianGrid
                      horizontal
                      vertical={false}
                      stroke="rgb(var(--p-line) / 0.35)"
                    />
                    {/*
                      A NUMERIC axis, not a categorical one. Without
                      `type="number"` recharts treats every bin as its own
                      category and prints a tick per bin -- forty of them, run
                      through toFixed(1), which collapses neighbouring bins onto
                      repeated labels: the "-0.1 -0.1 -0.1" the axis was
                      showing. Declaring the domain and the ticks makes the
                      spacing mean the value.
                    */}
                    <XAxis
                      dataKey="bin"
                      type="number"
                      domain={[-0.2, 1]}
                      ticks={[-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]}
                      tick={{ fontSize: 9 }}
                      stroke="rgb(var(--p-line-strong))"
                      tickFormatter={(v: number) => v.toFixed(1)}
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      stroke="rgb(var(--p-line-strong))"
                      width={34}
                      label={{
                        value: "share of pixels (%)",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          fontSize: 9,
                          fill: "rgb(var(--p-muted))",
                          textAnchor: "middle",
                        },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgb(var(--p-surface-raised))",
                        border: "1px solid rgb(var(--p-line-strong) / 0.6)",
                        fontSize: 11,
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 9 }}
                      iconSize={8}
                      formatter={(v: string) => (
                        <span style={{ color: "rgb(var(--p-muted))" }}>{v}</span>
                      )}
                    />
                    <Line
                      type="monotone"
                      dataKey="a"
                      name={shortA}
                      stroke="rgb(var(--p-accent))"
                      dot={false}
                      strokeWidth={1.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="b"
                      name={shortB}
                      stroke="rgb(var(--p-line-strong))"
                      dot={false}
                      strokeWidth={1.5}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {!compact && report.projection && (
            <div className="mt-4">
              <p className="eyebrow mb-2">
                Feature space · {report.projection.method.toUpperCase()}
              </p>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    {/*
                      No grid. A projection's axes carry no units -- component 1
                      and component 2 are directions, not quantities -- so a
                      ruled background invites reading a position as a value.
                      What the figure says is whether the two clouds overlap.
                    */}
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Component 1"
                      tick={{ fontSize: 9 }}
                      stroke="rgb(var(--p-line-strong))"
                      tickCount={5}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Component 2"
                      tick={{ fontSize: 9 }}
                      stroke="rgb(var(--p-line-strong))"
                      width={34}
                      tickCount={5}
                      label={{
                        value: "component 2",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          fontSize: 9,
                          fill: "rgb(var(--p-muted))",
                          textAnchor: "middle",
                        },
                      }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      contentStyle={{
                        background: "rgb(var(--p-surface-raised))",
                        border: "1px solid rgb(var(--p-line-strong) / 0.6)",
                        fontSize: 11,
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 9 }}
                      iconSize={8}
                      formatter={(v: string) => (
                        <span style={{ color: "rgb(var(--p-muted))" }}>{v}</span>
                      )}
                    />
                    <Scatter
                      name={shortA}
                      data={pointsA}
                      fill="rgb(var(--p-accent))"
                      fillOpacity={0.4}
                      shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                        <circle
                          cx={props.cx}
                          cy={props.cy}
                          r={2.4}
                          fill={props.fill}
                        />
                      )}
                    />
                    <Scatter
                      name={shortB}
                      data={pointsB}
                      fill="rgb(var(--p-line-strong))"
                      fillOpacity={0.4}
                      shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                        <circle
                          cx={props.cx}
                          cy={props.cy}
                          r={2.4}
                          fill={props.fill}
                        />
                      )}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
