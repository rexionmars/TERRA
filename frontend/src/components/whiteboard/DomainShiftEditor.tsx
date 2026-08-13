/**
 * The domain-shift editor's two readings, and the fetch each needs.
 *
 * WHY TWO. A pair and a cohort answer different questions over the same runs.
 * The pair carries the NDVI histogram, the feature-space projection and the
 * feature-shift table -- WHERE two domains differ, which is what makes a
 * distance actionable, and none of which is defined for N subjects at once.
 * The cohort carries divergence against agreement over every target, which is
 * the figure the transferability study resolves to and which a pairwise device
 * cannot express however many times it is invoked.
 *
 * Neither is a better version of the other, so this is a pane selector in the
 * area header -- the device the outliner already uses for its three trees --
 * and not a replacement.
 *
 * The pair's own fetch stays inside `DomainShiftSection`, which has owned it
 * all along. Only the cohort's is here, because it is the reading this
 * component introduced.
 */
import { useEffect, useState } from "react"
import { DomainShiftSection } from "@/components/DomainShiftSection"
import { DomainCohort } from "@/components/whiteboard/DomainCohort"
import type { PredictionCompareSide } from "@/components/whiteboard/BoardSolarDetail"
import { cohortDomainShift } from "@/lib/domainShift"
import type { DomainShiftCohort } from "@/lib/types"

export type DomainShiftMode = "pair" | "cohort"

export function DomainShiftEditor({
  mode,
  sides,
  available,
  sourceId,
  onPickTarget,
}: {
  mode: DomainShiftMode
  /** The pinned or selected pair, for the pair reading. */
  sides: [PredictionCompareSide, PredictionCompareSide] | null
  /** Every prediction plane on the board, for the cohort. */
  available: readonly PredictionCompareSide[]
  /** The centre of the star; without one the cohort says so. */
  sourceId?: string
  onPickTarget?: (boardAreaId: string) => void
}) {
  const [cohort, setCohort] = useState<DomainShiftCohort | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const source = available.find((s) => s.areaId === sourceId) ?? null
  const targets = source
    ? available.filter((s) => s.areaId !== source.areaId)
    : []
  // Identity of the request, so a re-render that changes nothing does not
  // re-spawn the sidecar. The board areas and the source are what the answer
  // depends on.
  const requestKey =
    mode === "cohort" && source
      ? `${source.areaId}|${targets.map((t) => t.areaId).join(",")}`
      : ""

  useEffect(() => {
    if (!requestKey || !source) {
      setCohort(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void cohortDomainShift(
      { id: source.areaId, label: source.label, result: source.result },
      targets.map((t) => ({
        id: t.areaId,
        label: t.label,
        result: t.result,
      }))
    )
      .then((r) => {
        if (cancelled) return
        setCohort(r.cohort)
        setSkipped(r.skipped)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setCohort(null)
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // requestKey stands for source and targets together; listing the arrays
    // themselves would re-run on every render that rebuilds them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  if (mode === "cohort") {
    return (
      <div className="panel-scroll h-full w-full overflow-auto p-3">
        {!source ? (
          <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
            {available.length < 2
              ? "Add at least two runs to the board to measure a cohort against a source."
              : "Choose the source area — the region the model was fitted on — from the header."}
          </p>
        ) : !targets.length ? (
          <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
            {source.label} is the only prediction on the board, so there is
            nothing to measure against it.
          </p>
        ) : loading && !cohort ? (
          <p className="text-meta text-muted-foreground">
            Measuring {targets.length} target
            {targets.length === 1 ? "" : "s"} against {source.label}…
          </p>
        ) : error ? (
          <p className="text-meta text-amber-500/90">{error}</p>
        ) : cohort ? (
          <DomainCohort
            cohort={cohort}
            skipped={skipped}
            onPick={onPickTarget}
          />
        ) : null}
      </div>
    )
  }

  return sides ? (
    // px-2 py-1.5, as `BoardSolarDetail`'s own area placement uses: every other
    // editor owns its scroll container and its inset, and this one was the
    // exception with a p-3 wrapper around a component that also drew a p-4 card.
    <div className="panel-scroll h-full w-full overflow-auto px-2 py-1.5">
      <DomainShiftSection
        placement="area"
        resultA={sides[0].result}
        resultB={sides[1].result}
        labelA={sides[0].label}
        labelB={sides[1].label}
      />
    </div>
  ) : (
    <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
      Pick two prediction planes to measure how far their domains sit apart.
    </p>
  )
}
