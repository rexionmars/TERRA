/**
 * Domain Shift diagnosis panel for Compare analyses (and studio summary).
 *
 * Metrics follow the study-guide distances: KL on NDVI histograms, CVA
 * magnitude (and red–NIR angle), RBF MMD on feature samples, F1 / outside-
 * legend rates from MapBiomas agreement when present. PCA scatter by default;
 * t-SNE on demand.
 */
import { useEffect, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  canStandardise,
  compareDomainShift,
  hasDomainFingerprint,
} from "@/lib/domainShift"
import { mapbiomasCoverName } from "@/lib/mapbiomasCovers"
import type { DomainShiftReport, PredictResult } from "@/lib/types"
import { cn } from "@/lib/utils"
import { SideTag } from "@/components/workspace/AgreementCharts"
import {
  Callout,
  FigureCard,
  ReadingSection,
  titled,
} from "@/components/workspace/readingParts"
import { btnGhostDense } from "@/components/ui/buttons"

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

/** The fingerprint's feature space, named for a reader. */
function spaceName(space?: string | null): string {
  if (space === "spectral_rf") return "spectral features"
  if (space === "ndvi_only") return "NDVI only"
  return space ?? "unknown"
}

/** One run against the reference: four figures and the classes behind them. */
function AgreementBlock({
  letter,
  label,
  block,
}: {
  letter: string
  label: string
  block: NonNullable<DomainShiftReport["agreement_a"]>
}) {
  const classes = (block.per_class_f1 ?? []).filter((c) => c.f1 != null)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SideTag letter={letter} label={label} />
      <div className="grid grid-cols-2 gap-2">
        <FigureCard
          label="Agreement"
          value={block.overall_pct != null ? `${block.overall_pct.toFixed(1)}%` : "—"}
        />
        <FigureCard
          label="Macro F1"
          value={block.macro_f1 != null ? fmt(block.macro_f1, 3) : "—"}
        />
        <FigureCard
          label="Outside the legend"
          value={
            block.outside_legend_pct != null
              ? `${block.outside_legend_pct.toFixed(1)}%`
              : "—"
          }
          sub={`${block.n_outside_legend.toLocaleString()} cells`}
        />
        <FigureCard
          label="Disagreement"
          value={`${fmt(block.quantity_disagreement_pct, 1)} / ${fmt(block.allocation_disagreement_pct, 1)}`}
          sub="quantity / allocation, %"
        />
      </div>

      {/*
        The classes behind the macro average. A macro F1 says the run got worse
        and stops there; these say which class carries it, and precision
        against recall says which way it fails. Rows with no F1 are dropped: a
        class with neither predictions nor reference cells is not a measurement.
      */}
      {classes.length > 0 && (
        <table className="w-full table-fixed text-label">
          <thead>
            <tr className="text-meta text-muted-foreground">
              <th className="pb-1 text-left font-normal">Class</th>
              <th className="w-12 pb-1 text-right font-normal" title="Precision">
                Prec.
              </th>
              <th className="w-12 pb-1 text-right font-normal" title="Recall">
                Recall
              </th>
              <th className="w-10 pb-1 text-right font-normal">F1</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--p-line)/0.25)]">
            {classes.map((c) => (
              <tr key={c.class_id ?? c.index}>
                <td className="truncate py-1 text-foreground">
                  {c.class_id != null
                    ? mapbiomasCoverName(c.class_id)
                    : `Class at ${c.index}`}
                </td>
                <td className="telemetry py-1 text-right text-muted-foreground tabular-nums">
                  {fmt(c.precision, 2)}
                </td>
                <td className="telemetry py-1 text-right text-muted-foreground tabular-nums">
                  {fmt(c.recall, 2)}
                </td>
                <td className="telemetry py-1 text-right text-foreground tabular-nums">
                  {fmt(c.f1, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function DomainShiftSection({
  resultA,
  resultB,
  labelA = "A",
  labelB = "B",
}: {
  resultA: PredictResult
  resultB: PredictResult
  labelA?: string
  labelB?: string
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
        const pick = (parts: string[]) => differing.map((i) => parts[i]).join(" · ")
        return [pick(pa), pick(pb)]
      }
    }
    // Different shapes, or identical labels: nothing can be safely dropped, so
    // nothing is.
    return [labelA, labelB]
  })()

  const ready = hasDomainFingerprint(resultA) && hasDomainFingerprint(resultB)
  /*
    WHICH side cannot be standardised, and WHY -- because the two causes call
    for different actions and only one of them is worth acting on.

    A fingerprint whose space is `ndvi_only` came from a run with no spectral
    feature matrix, which is Prithvi or the temporal transformer. There is no
    training scaler to carry and re-running the same model will not produce
    one.

    A fingerprint whose space is `spectral_rf` and which still has no moments
    came from a run classified before the fingerprint carried them. Every run
    stored before that fix is in this state, and for those re-classifying is
    exactly the fix -- which is the opposite of the advice the other case
    deserves, so the panel must not give one message for both.
  */
  const unstandardisable = (
    [
      [resultA, labelA],
      [resultB, labelB],
    ] as const
  )
    .filter(([r]) => !canStandardise(r))
    .map(([r, label]) => ({
      label,
      byConstruction: r.domain_fingerprint?.space === "ndvi_only",
    }))
  const staleRuns = unstandardisable.filter((s) => !s.byConstruction)
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

  if (!ready) {
    return (
      <ReadingSection flush title="Domain shift">
        <Callout tone="info" title="Both runs need a domain fingerprint">
          A run records one when it classifies. Classify each area again to measure how
          far the two sit apart.
        </Callout>
      </ReadingSection>
    )
  }

  const hist = report ? histSeries(report) : []
  const pointsA = report?.projection?.points.filter((p) => p.domain === "A") ?? []
  const pointsB = report?.projection?.points.filter((p) => p.domain === "B") ?? []
  /*
    A PROJECTION OF ONE FEATURE IS A LINE. An NDVI-only fingerprint has a single
    column, so its second component is zero everywhere, and drawn on two axes
    it was a row of dots along the floor of an empty plot. It is drawn as the
    strip it is.
  */
  const flat =
    pointsA.length + pointsB.length > 0 &&
    [...pointsA, ...pointsB].every((p) => Math.abs(p.y) < 1e-9)
  const nameA = titled(shortA)
  const nameB = titled(shortB)

  return (
    <div className="flex flex-col">
      <ReadingSection
        flush
        title="How far apart"
        caption={`From ${titled(labelA)} to ${titled(labelB)}, in what each run fed the model.`}
        aside={
          <button
            type="button"
            onClick={() => void runTsne()}
            disabled={tsneBusy || loading}
            title="Project the two feature samples with t-SNE instead of PCA"
            className={btnGhostDense}
          >
            {tsneBusy ? "Projecting…" : "t-SNE projection"}
          </button>
        }
      >
        {loading && <p className="text-label text-muted-foreground">Comparing…</p>}
        {error && <Callout title="The two could not be compared">{error}</Callout>}

        {report && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {/*
                The symmetrised KL leads, and the two directions travel under it:
                KL(A||B) above KL(B||A) means B covers NDVI A never saw, the
                reverse that B is the narrower of the two.
              */}
              <FigureCard
                label="KL, NDVI"
                value={fmt(report.kl_ndvi)}
                sub={
                  report.kl_ndvi_a_to_b != null && report.kl_ndvi_b_to_a != null
                    ? `${fmt(report.kl_ndvi_a_to_b, 2)} A to B, ${fmt(report.kl_ndvi_b_to_a, 2)} B to A`
                    : "symmetrised histogram divergence"
                }
              />
              {/*
                The standardised magnitude leads where it exists: the raw one
                mixes reflectance with acquisition indices, which carried 99.7%
                of the raw squared distance on the shipped model.
              */}
              <FigureCard
                label={report.cva_magnitude_sd != null ? "CVA |M|, SD" : "CVA |M|"}
                value={fmt(report.cva_magnitude_sd ?? report.cva_magnitude)}
                sub={
                  report.cva_angle_red_nir_deg != null
                    ? `ϕ ${fmt(report.cva_angle_red_nir_deg, 0)}° red to NIR`
                    : report.cva_magnitude_sd != null
                      ? "training standard deviations"
                      : "mean feature distance, raw units"
                }
              />
              {/* MMD is not comparable across bandwidths, so its gamma travels with it. */}
              <FigureCard
                label="MMD²"
                value={fmt(report.mmd_rbf?.mmd2)}
                sub={
                  report.mmd_rbf?.gamma != null
                    ? `RBF, γ ${fmt(report.mmd_rbf.gamma, 3)}, n ${report.mmd_rbf.n_a} and ${report.mmd_rbf.n_b}`
                    : "not computed"
                }
              />
            </div>
            <p className="mt-2 text-label text-muted-foreground">
              Feature space:{" "}
              {report.space_a === report.space_b
                ? `${spaceName(report.space_a)} in both.`
                : `${spaceName(report.space_a)} in A, ${spaceName(report.space_b)} in B.`}
            </p>

            {/*
              The qualifier, stated rather than implied by a dash. Both refusals
              produce distances, and those mean different things or nothing.
            */}
            {report.same_space === false ? (
              <div className="mt-3">
                <Callout title="Not comparable">
                  The two fingerprints describe different feature spaces, so the
                  distances above come from quantities that are not the same.
                </Callout>
              </div>
            ) : report.standardised === false ? (
              /*
                WHICH run, and WHY, because the remedy differs: a run with no
                spectral matrix cannot have a scaler, a run classified before the
                fingerprint carried one gains it by classifying again.
              */
              <div className="mt-3">
                <Callout title="Distances in raw units">
                  {unstandardisable.map((s) => titled(s.label)).join(" and ")}{" "}
                  {unstandardisable.length === 1 ? "carries" : "carry"} no training
                  scaler, so the acquisition-index features dominate and the figures
                  describe when the scenes were taken more than how the ground differs.{" "}
                  {staleRuns.length > 0
                    ? `${staleRuns.map((s) => titled(s.label)).join(" and ")} was classified before the fingerprint carried the scaler: classify it again and these figures standardise.`
                    : "They were classified without the spectral feature matrix, by Prithvi or the Temporal Transformer, so classifying again with the same model will not add one."}
                </Callout>
              </div>
            ) : null}
          </>
        )}
      </ReadingSection>

      {report && (report.agreement_a || report.agreement_b) && (
        <ReadingSection
          title="Each against MapBiomas"
          caption="Agreement with the reference, and the classes behind the average."
        >
          <div className="grid grid-cols-2 gap-4">
            {report.agreement_a && (
              <AgreementBlock letter="A" label={nameA} block={report.agreement_a} />
            )}
            {report.agreement_b && (
              <AgreementBlock letter="B" label={nameB} block={report.agreement_b} />
            )}
          </div>
        </ReadingSection>
      )}

      {/*
        Where the shift is, not only how large: which features moved, by how
        many training standard deviations, and whether the model weighs them.
        Sorted by displacement, as the sidecar returns it; `weighted` is the
        column to read when deciding whether the shift reaches the prediction.
      */}
      {report?.feature_shift && report.feature_shift.length > 0 && (
        <ReadingSection
          title="Where the shift is"
          caption={`The ${report.feature_shift.length} features that moved most, in training standard deviations, and how much the model weighs each.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-label">
              <thead>
                <tr className="text-meta text-muted-foreground">
                  <th className="pb-1.5 text-left font-normal">Feature</th>
                  <th className="pb-1.5 text-right font-normal">z in A</th>
                  <th className="pb-1.5 text-right font-normal">z in B</th>
                  <th className="pb-1.5 text-right font-normal">Gap (SD)</th>
                  <th className="pb-1.5 text-right font-normal">Importance</th>
                  <th className="pb-1.5 text-right font-normal">Weighted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--p-line)/0.25)]">
                {report.feature_shift.map((r) => (
                  <tr key={r.feature}>
                    <td className="telemetry py-1.5 text-foreground">{r.feature}</td>
                    <td className="telemetry py-1.5 text-right text-muted-foreground tabular-nums">
                      {fmt(r.z_a, 2)}
                    </td>
                    <td className="telemetry py-1.5 text-right text-muted-foreground tabular-nums">
                      {fmt(r.z_b, 2)}
                    </td>
                    <td className="telemetry py-1.5 text-right text-foreground tabular-nums">
                      {r.gap_sd > 0 ? "+" : ""}
                      {fmt(r.gap_sd, 2)}
                    </td>
                    <td className="telemetry py-1.5 text-right text-muted-foreground tabular-nums">
                      {r.importance == null ? "—" : fmt(r.importance, 4)}
                    </td>
                    <td className="telemetry py-1.5 text-right text-foreground tabular-nums">
                      {fmt(r.weighted, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReadingSection>
      )}

      {hist.length > 0 && (
        <ReadingSection
          title="NDVI distribution"
          caption="The share of each run's pixels at each NDVI."
        >
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                {/* Horizontal rules only: the reading is two curves' heights. */}
                <CartesianGrid
                  horizontal
                  vertical={false}
                  stroke="rgb(var(--p-line) / 0.35)"
                />
                {/*
                  A NUMERIC axis with declared ticks; as a category axis every
                  bin printed its own tick, collapsing onto repeated labels.
                */}
                <XAxis
                  dataKey="bin"
                  type="number"
                  domain={[-0.2, 1]}
                  ticks={[-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]}
                  tick={{ fontSize: 10 }}
                  stroke="rgb(var(--p-line-strong))"
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="rgb(var(--p-line-strong))"
                  width={34}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--s-float)",
                    border: "1px solid rgb(var(--p-line-strong) / 0.6)",
                    borderRadius: 5,
                    fontSize: 11,
                  }}
                  labelFormatter={(v: number) => `NDVI ${Number(v).toFixed(2)}`}
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                />
                <Line
                  type="monotone"
                  dataKey="a"
                  name={nameA}
                  stroke="rgb(var(--p-accent))"
                  dot={false}
                  strokeWidth={1.5}
                />
                <Line
                  type="monotone"
                  dataKey="b"
                  name={nameB}
                  stroke="rgb(var(--p-line-strong))"
                  dot={false}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <SeriesKey a={nameA} b={nameB} />
        </ReadingSection>
      )}

      {report?.projection && (
        /*
          The space is named because the two are different pictures: on raw
          features the clouds separate largely by when the scenes were taken,
          which reads exactly like a domain difference and is not one.
        */
        <ReadingSection
          title="Feature space"
          caption={
            flat
              ? `${report.projection.method.toUpperCase()} of one feature, so each pixel sits on a line. Two runs from one domain overlap along it.`
              : `${report.projection.method.toUpperCase()} of ${report.projection.space ? spaceName(report.projection.space) : "the features"}. Two runs from one domain overlap.`
          }
        >
          <div className={cn("w-full", flat ? "h-20" : "h-52")}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {/*
                  No grid. A projection's axes carry no units, so a ruled
                  background invites reading a position as a value.
                */}
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Component 1"
                  tick={{ fontSize: 10 }}
                  stroke="rgb(var(--p-line-strong))"
                  tickCount={5}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Component 2"
                  hide={flat}
                  domain={flat ? [-1, 1] : ["auto", "auto"]}
                  tick={{ fontSize: 10 }}
                  stroke="rgb(var(--p-line-strong))"
                  width={34}
                  tickCount={5}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{
                    background: "var(--s-float)",
                    border: "1px solid rgb(var(--p-line-strong) / 0.6)",
                    borderRadius: 5,
                    fontSize: 11,
                  }}
                />
                <Scatter
                  name={nameA}
                  data={pointsA}
                  fill="rgb(var(--p-accent))"
                  fillOpacity={0.45}
                  shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                    <circle cx={props.cx} cy={props.cy} r={2.6} fill={props.fill} />
                  )}
                />
                <Scatter
                  name={nameB}
                  data={pointsB}
                  fill="rgb(var(--p-line-strong))"
                  fillOpacity={0.45}
                  shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                    <circle cx={props.cx} cy={props.cy} r={2.6} fill={props.fill} />
                  )}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <SeriesKey a={nameA} b={nameB} />
        </ReadingSection>
      )}
    </div>
  )
}

/** Which colour is which run, under a figure, in the text's own size. */
function SeriesKey({ a, b }: { a: string; b: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded-full bg-[rgb(var(--p-accent))]" />A · {a}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded-full bg-[rgb(var(--p-line-strong))]" />B ·{" "}
        {b}
      </span>
    </div>
  )
}
