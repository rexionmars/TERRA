/**
 * Domain Shift diagnosis panel for Compare analyses (and whiteboard summary).
 *
 * Metrics follow the study-guide distances: KL on NDVI histograms, CVA
 * magnitude (and red–NIR angle), RBF MMD on feature samples, F1 / outside-
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
  canStandardise,
  compareDomainShift,
  hasDomainFingerprint,
} from "@/lib/domainShift"
import { mapbiomasCoverName } from "@/lib/mapbiomasCovers"
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

      {/*
        The classes behind the macro average.

        A macro F1 says the run got worse and stops there. These say which
        class carries it, and precision against recall says which way it
        fails -- a class the model finds everywhere it is not reads low
        precision, one it misses reads low recall, and the average of the two
        is the same number for both.

        Rows with no F1 at all are dropped: a class with neither predictions
        nor reference cells is not a measurement, and the macro average skips
        it for the same reason.
      */}
      {block.per_class_f1 && block.per_class_f1.some((c) => c.f1 != null) && (
        <ul className="flex flex-col gap-0.5">
          {block.per_class_f1
            .filter((c) => c.f1 != null)
            .map((c) => (
              <li
                key={c.class_id ?? c.index}
                className="flex items-baseline gap-1.5 text-[10px]"
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {c.class_id != null
                    ? mapbiomasCoverName(c.class_id)
                    : `Class at ${c.index}`}
                </span>
                <span
                  className="telemetry w-[2.5rem] shrink-0 text-right text-[9px] tabular-nums text-muted-foreground"
                  title={`Precision ${fmt(c.precision, 3)}`}
                >
                  {fmt(c.precision, 2)}
                </span>
                <span
                  className="telemetry w-[2.5rem] shrink-0 text-right text-[9px] tabular-nums text-muted-foreground"
                  title={`Recall ${fmt(c.recall, 3)}`}
                >
                  {fmt(c.recall, 2)}
                </span>
                <span
                  className="telemetry w-[2.5rem] shrink-0 text-right text-[9px] tabular-nums text-foreground"
                  title={`F1 ${fmt(c.f1, 3)}`}
                >
                  {fmt(c.f1, 2)}
                </span>
              </li>
            ))}
          {/* The key, said once, in the order the columns stand. */}
          <li className="telemetry flex items-baseline justify-end gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-[2.5rem] text-right">prec.</span>
            <span className="w-[2.5rem] text-right">recall</span>
            <span className="w-[2.5rem] text-right">F1</span>
          </li>
        </ul>
      )}
    </div>
  )
}

export function DomainShiftSection({
  resultA,
  resultB,
  labelA = "A",
  labelB = "B",
  placement = "card",
}: {
  resultA: PredictResult
  resultB: PredictResult
  labelA?: string
  labelB?: string
  /**
   * Where this is mounted, in `BoardSolarDetail`'s vocabulary.
   *
   * "card" is the analysis page and the modal, where the section is one plate
   * among several. "area" is a studio area, which already draws the border, the
   * background and a header naming the editor.
   */
  placement?: "card" | "area"
}) {
  // Every branch below asked the same question of the old flag; the flag is
  // gone and the question is now about where this is drawn.
  const inArea = placement === "area"
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

  /*
    The plate belongs to the PAGE, not to the section.

    `placement` decides it, which is the distinction `BoardSolarDetail` already
    draws with the same word. On the analysis page this is one card among
    several and the border is what separates it from its neighbours. In a studio
    area there is no neighbour to separate from: `StudioArea` already draws the
    border, the ink background and a 26px header carrying the editor's name, so
    a second border and a second tint inside it are one box drawn inside
    another.

    This used to hang off `compact`, which the foot band passed. The editor left
    the band and nothing passes it any more, so every mount took the card branch
    -- including the one placement the comment above it said should be flush.
  */
  const shell = cn(
    "flex flex-col",
    placement === "area"
      ? "gap-3"
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
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          {/*
            The title only where nothing else carries it. In an area the header
            above already reads "Domain shift", and the paragraph explaining what
            the section is for is written for a page a reader arrives at, not for
            a pane they chose by name from a type menu.

            What the area DOES need is which two runs are being read, since its
            header names the editor and not the subjects.
          */}
          {inArea ? (
            <p className="telemetry truncate text-[9px] text-muted-foreground">
              {labelA} → {labelB}
            </p>
          ) : (
            <>
              <p className="eyebrow !text-foreground">Domain shift</p>
              <p className="mt-1 max-w-xl text-[10px] leading-snug text-muted-foreground">
                Distance between source ({labelA}) and target ({labelB}) feature
                domains — KL on NDVI, CVA magnitude, RBF MMD. High values with
                high confidence usually mean the fixed crop legend is out of
                domain, not that the map is right.
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runTsne()}
          disabled={tsneBusy || loading}
          className="shrink-0 rounded-sm border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {tsneBusy ? "Projecting…" : "t-SNE project"}
        </button>
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
              "grid-cols-2 sm:grid-cols-4"
            )}
          >
            {/*
              The symmetrised figure leads, and the two directions travel under
              it. KL is not symmetric, and which direction is larger is a
              different finding from how large the average is: KL(A||B) above
              KL(B||A) means B's histogram covers ground A's does not -- the
              target spreading into NDVI the source never saw -- while the
              reverse means the target is the narrower of the two. The average
              alone cannot separate a target that moved from one that spread,
              and both directions reached this component unread.
            */}
            <WaterFigure
              label="KL (NDVI)"
              value={fmt(report.kl_ndvi)}
              sub={
                report.kl_ndvi_a_to_b != null && report.kl_ndvi_b_to_a != null
                  ? `${fmt(report.kl_ndvi_a_to_b, 2)} → · ← ${fmt(report.kl_ndvi_b_to_a, 2)}`
                  : "sym. histogram divergence"
              }
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
            {/*
              The escape is spelled out rather than written `\u00b2`: JSX does
              not process escapes in an attribute value, so that form reached
              the screen as its own source text. The occurrences a few lines up
              sit inside template literals, which is why the same spelling
              worked there and not here.
            */}
            <WaterFigure
              label="MMD²"
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
            /*
              WHICH run, and WHY, because the remedy differs.

              This read "one of the runs carries no training scaler" and was
              shown on every comparison ever made, because the request builder
              stripped the moments in transit rather than either run lacking
              them. With that fixed the banner is rare -- and the two remaining
              causes want opposite advice, so naming the side is not enough.
            */
            <p className="mt-2 text-[10px] leading-snug text-amber-500/90">
              Not standardised:{" "}
              {unstandardisable.map((s) => s.label).join(" and ")} carr
              {unstandardisable.length === 1 ? "ies" : "y"} no training scaler,
              so the distances are in raw feature units — and on this model the
              acquisition-index features dominate a raw distance, so the figures
              above describe acquisition more than ground.{" "}
              {staleRuns.length > 0 ? (
                <>
                  {staleRuns.map((s) => s.label).join(" and ")} still holds a
                  spectral fingerprint, so it was classified before the
                  fingerprint carried the scaler: re-classify it and these
                  figures populate.
                </>
              ) : (
                <>
                  Classified without the spectral feature matrix — Prithvi or
                  the temporal transformer — so there is no scaler to carry and
                  re-running the same model will not produce one.
                </>
              )}
            </p>
          ) : null}

          {(report.agreement_a || report.agreement_b) && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {report.agreement_a && (
                <AgreementBlock title={`${labelA} · vs MapBiomas`} block={report.agreement_a} />
              )}
              {report.agreement_b && (
                <AgreementBlock title={`${labelB} · vs MapBiomas`} block={report.agreement_b} />
              )}
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
          {report.feature_shift && report.feature_shift.length > 0 && (
            <div className="mt-4">
              {/* Same reason as the MMD label: JSX text is not a JS literal. */}
              <p className="eyebrow mb-2">
                Feature shift · top {report.feature_shift.length} by displacement
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

          {hist.length > 0 && (
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

          {report.projection && (
            <div className="mt-4">
              {/*
                The space is named because the two are different pictures. On
                raw features the geometry is set by the acquisition indices,
                which span 0..21 against reflectances near 0.1, so the clouds
                separate largely by when the scenes were taken -- which reads
                exactly like a domain difference and is not one.
              */}
              <p className="eyebrow mb-2">
                Feature space · {report.projection.method.toUpperCase()}
                {report.projection.space ? ` · ${report.projection.space}` : ""}
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
