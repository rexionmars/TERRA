/**
 * One source against every target: divergence read against agreement.
 *
 * THE FIGURE THE QUESTION RESOLVES TO. A classifier is fitted on one region and
 * the operational question is whether it applies elsewhere. That set of areas
 * is not symmetric -- one of them is the training region and every other is
 * measured against it -- so for N areas the analysis is N-1 comparisons, not
 * the N(N-1)/2 a pairwise device offers. With six areas, five comparisons carry
 * the study and ten of the fifteen possible pairs answer nothing.
 *
 * Ben-David et al. (2010) bound the target error by the source error plus a
 * divergence between the two marginals plus the error of the best joint
 * hypothesis. The bound says divergence constrains the error gap; it does not
 * say the constraint is tight, and whether it is tight for a given model and
 * sensor is empirical. Plotting divergence against observed agreement for all
 * targets at once is what answers it, and three readings come straight off the
 * arrangement:
 *
 *   - points near a descending trend: divergence accounts for the degradation,
 *     and the bound is informative for this model;
 *   - far and accurate: transfer despite distance, which suggests the measure
 *     is capturing variation the classifier is invariant to;
 *   - near and inaccurate: the cause is elsewhere -- label definitions,
 *     reference quality, resolution -- and not distributional distance.
 *
 * The figure scales linearly in the number of areas, which the pairwise device
 * does not.
 *
 * WHAT IS NOT PLOTTED, AND WHY THAT IS THE DESIGN. A target whose fingerprint
 * is not in the source's feature space, or which carries no training scaler,
 * has a distance built from other quantities. Placing it on this axis is not a
 * rough answer, it is a confident wrong one -- so it is listed instead, with
 * the reason. A Prithvi run in the cohort is a legible exclusion, not an
 * outlier.
 *
 * MMD IS A PROXY. The divergence in the bound is a hypothesis-class divergence;
 * what is computed here is a maximum mean discrepancy with a Gaussian kernel.
 * The substitution is standard practice and is not licensed by the bound
 * itself, which is why the axis is labelled with what it holds.
 *
 * AND IT SATURATES, which is why the axis can be changed. A Gaussian kernel is
 * bounded, so once two samples barely overlap the cross terms vanish and the
 * statistic stops moving. Measured on synthetic pairs at 20 features and 40
 * rows a side, MMD² reads 0.246 at one training standard deviation of
 * separation, 0.866 at three, and then 0.892, 0.908 and 0.891 at five, eight
 * and twelve -- flat to three decimal places while the change-vector magnitude
 * over the same pairs goes 4.3, 13.9, 23.5, 37.3, 55.8. A cohort whose targets
 * are all far from the source therefore plots as one vertical line under MMD
 * and orders correctly under CVA. Neither is the better axis in general: MMD is
 * a distribution distance and answers the bound's question, CVA is a distance
 * between means and keeps resolving after MMD has stopped.
 */
import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"
import { DataTableView } from "@/components/DataTableView"
import { Segmented } from "@/components/shell/settingsParts"
import { Callout, ReadingSection, titled } from "@/components/workspace/readingParts"
import { cohortTable } from "@/lib/cohortTables"
import type { DomainShiftCohort, DomainShiftCohortRow } from "@/lib/types"

function fmt(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

type Axis = "mmd" | "cva"

const AXES: Record<Axis, { label: string; title: string }> = {
  mmd: {
    label: "MMD²",
    title: "MMD² from source (standardised)",
  },
  cva: {
    label: "CVA",
    title: "Change-vector magnitude from source (training SD)",
  },
}

/** The divergence a row contributes to the axis, or null if it has none. */
function divergenceOf(row: DomainShiftCohortRow, axis: Axis): number | null {
  const v = axis === "mmd" ? row.mmd_rbf?.mmd2 : row.cva_magnitude_sd
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * Whether MMD has stopped resolving over the plotted set.
 *
 * The knee is around three training standard deviations of separation, where
 * the statistic reaches roughly 0.87 and then moves in the third decimal. A
 * set that sits entirely above it is a set the axis cannot order.
 */
function saturated(values: number[]): boolean {
  return values.length > 1 && values.every((v) => v > 0.85)
}

function agreementOf(row: DomainShiftCohortRow): number | null {
  const pct = row.agreement_b?.overall_pct
  return typeof pct === "number" && Number.isFinite(pct) ? pct : null
}

/** Why a row cannot sit on the shared axis, in the reader's terms. */
function exclusionReason(row: DomainShiftCohortRow, axis: Axis): string {
  if (!row.same_space) {
    return `A different feature space: ${row.space_b ?? "unknown"} against ${row.space_a ?? "unknown"}.`
  }
  if (!row.standardised) return "No training scaler, so its distance is in raw units."
  if (divergenceOf(row, axis) == null) return "No divergence was computed."
  return "No agreement against the reference."
}

export function DomainCohort({
  cohort,
  skipped,
  onPick,
}: {
  cohort: DomainShiftCohort
  /** Targets dropped before the call for carrying no fingerprint at all. */
  skipped?: string[]
  /** Selecting a point names the target; the caller decides what that means. */
  onPick?: (id: string) => void
}) {
  const [axis, setAxis] = useState<Axis>("mmd")

  const { plotted, excluded } = useMemo(() => {
    const plotted: {
      id: string
      label: string
      x: number
      y: number
      row: DomainShiftCohortRow
    }[] = []
    const excluded: DomainShiftCohortRow[] = []
    for (const row of cohort.targets) {
      const x = divergenceOf(row, axis)
      const y = agreementOf(row)
      // Both qualifiers AND both figures: a comparable row with no reference
      // agreement has no y, and half a point is not a point.
      if (row.comparable && x != null && y != null) {
        plotted.push({ id: row.id, label: row.label, x, y, row })
      } else {
        excluded.push(row)
      }
    }
    return { plotted, excluded }
  }, [cohort, axis])

  // Only worth saying on the axis that has the ceiling.
  const atCeiling = axis === "mmd" && saturated(plotted.map((p) => p.x))

  const sourceAgreement = cohort.source.agreement?.overall_pct ?? null
  const table = useMemo(() => cohortTable(cohort), [cohort])

  return (
    <div className="flex min-w-0 flex-col">
      <ReadingSection
        flush
        title="Divergence against agreement"
        caption={
          <>
            From {titled(cohort.source.label)}
            {sourceAgreement != null
              ? `, which agrees with the reference on ${sourceAgreement.toFixed(1)}%,`
              : ""}{" "}
            to each target.{" "}
            {plotted.length > 0 &&
              "One point per target. A descending trend means divergence accounts for the loss; a point far right and high transfers despite distance; one near the axis and low fails for another reason."}
          </>
        }
        aside={
          /*
            Which distance is on the x-axis. Two options and not a menu, because
            neither is a default the other corrects: MMD answers the bound's
            question and stops resolving past about three standard deviations,
            CVA keeps resolving and is a distance between means rather than
            between distributions.
          */
          <Segmented
            label="Distance on the axis"
            value={axis}
            options={(Object.keys(AXES) as Axis[]).map((id) => ({
              value: id,
              label: AXES[id].label,
            }))}
            onChange={setAxis}
          />
        }
      >
        {plotted.length === 0 ? (
          <Callout tone="info">
            No target can be placed on this axis, so there is no figure. Each is listed
            under Not on the axis with the reason.
          </Callout>
        ) : (
          <>
            {atCeiling && (
              <div className="mb-3">
                <Callout title="MMD² has stopped separating these targets">
                  Every target is at the top of its range, where a bounded kernel stops
                  separating: past roughly three training standard deviations the
                  statistic moves in the third decimal while the domains keep moving
                  apart. Read this set on CVA, which has no ceiling.
                </Callout>
              </div>
            )}
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid
                    stroke="rgb(var(--p-line) / 0.25)"
                    strokeDasharray="2 3"
                  />
                  {/*
                    Both axes carry quantities here, unlike the pair's projection,
                    so a grid helps rather than misleads.
                  */}
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={AXES[axis].label}
                    tick={{ fontSize: 10 }}
                    stroke="rgb(var(--p-line-strong))"
                    tickCount={5}
                    label={{
                      value: AXES[axis].title,
                      position: "insideBottom",
                      offset: -2,
                      style: { fontSize: 10, fill: "rgb(var(--p-muted))" },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Agreement"
                    unit="%"
                    tick={{ fontSize: 10 }}
                    stroke="rgb(var(--p-line-strong))"
                    tickCount={5}
                    domain={["dataMin - 5", "dataMax + 5"]}
                  />
                  <ZAxis range={[70, 70]} />
                  <Tooltip
                    cursor={{ stroke: "rgb(var(--p-line-strong))" }}
                    contentStyle={{
                      background: "var(--s-float)",
                      border: "1px solid rgb(var(--p-line) / 0.4)",
                      borderRadius: 5,
                      fontSize: 11,
                    }}
                    formatter={(value: number, name: string) => [
                      name === "Agreement" ? `${value.toFixed(1)}%` : fmt(value, 4),
                      name,
                    ]}
                    labelFormatter={() => ""}
                    itemSorter={(i) => (i.name === "Agreement" ? -1 : 1)}
                  />
                  <Scatter
                    data={plotted}
                    fill="rgb(var(--p-accent))"
                    onClick={(p: { id?: string }) => p.id && onPick?.(p.id)}
                  >
                    {plotted.map((p) => (
                      <Cell key={p.id} cursor={onPick ? "pointer" : undefined} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            {/*
              The labels, under the figure rather than on it. Recharts labels
              collide at this size and a scatter of N points with N overlapping
              names is less readable than the plot alone.
            */}
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {plotted.map((p) => (
                <li
                  key={p.id}
                  className="text-label text-muted-foreground"
                  title={`${AXES[axis].label} ${fmt(p.x, 4)} · agreement ${p.y.toFixed(1)}%`}
                >
                  {titled(p.label)}
                </li>
              ))}
            </ul>
          </>
        )}
      </ReadingSection>

      {(excluded.length > 0 || (skipped?.length ?? 0) > 0) && (
        /*
          Named rather than dropped. A target missing from a figure with no
          account of why reads as a target that was not run.
        */
        <ReadingSection
          title="Not on the axis"
          caption="Placing these would put a distance built from other quantities beside the rest."
        >
          <ul className="divide-y divide-[rgb(var(--p-line)/0.25)]">
            {excluded.map((row) => (
              <li key={row.id} className="flex flex-col gap-0.5 py-2 first:pt-0">
                <span className="text-label text-foreground">{titled(row.label)}</span>
                <span className="text-label text-muted-foreground">
                  {exclusionReason(row, axis)}
                </span>
              </li>
            ))}
            {skipped?.map((label) => (
              <li
                key={`skipped-${label}`}
                className="flex flex-col gap-0.5 py-2 first:pt-0"
              >
                <span className="text-label text-foreground">{titled(label)}</span>
                <span className="text-label text-muted-foreground">
                  No domain fingerprint; classify it again to include it.
                </span>
              </li>
            ))}
          </ul>
        </ReadingSection>
      )}

      {table && (
        <ReadingSection
          title="Figures"
          caption="Every area of the cohort, the source first."
        >
          <DataTableView table={table} />
        </ReadingSection>
      )}
    </div>
  )
}
