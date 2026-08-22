/**
 * Helpers for Domain Shift diagnostics between two saved PredictResults.
 */
import {
  AnalyzeDomainShift,
  AnalyzeDomainShiftCohort,
} from "../../wailsjs/go/main/App"
import { analysis } from "../../wailsjs/go/models"
import type {
  DomainFingerprint,
  DomainShiftCohort,
  DomainShiftReport,
  LULCAgreement,
  PredictResult,
} from "@/lib/types"

/**
 * The fingerprint, whole.
 *
 * THIS USED TO ENUMERATE, AND THAT IS WHAT BROKE IT. The list named nine of the
 * thirteen fields and left out `z_mean`, `z_var`, `feature_names` and
 * `feature_importances` -- the four the sidecar gates every standardised figure
 * on. `compare_fingerprints` derives `standardised` from `z_mean` being present
 * on both sides, and without it `cva_magnitude_sd` is null, `feature_shift` is
 * null, and `mmd_rbf` is not computed at all. Classify writes all four, the Go
 * struct carries all four, the panel renders all four -- and the request
 * dropped them on the way back down, so every comparison took the refusing
 * branch and the panel showed the amber "no training scaler" banner over a raw,
 * unit-mixed magnitude that the sidecar documents at length must not be read.
 *
 * `backend/types.go` carries a comment describing this same failure being fixed
 * on the Go struct. This was the remaining occurrence, and the shape of the fix
 * is to stop hand-listing: the keys of `DomainFingerprint` are exactly the keys
 * `build_fingerprint` emits, so a pass-through cannot drift from them. An
 * enumeration here bought nothing and cost the whole diagnosis.
 *
 * `agreementPayload` below stays a projection on purpose -- there the sidecar
 * reads only `matrix` for the F1, and the rest of `LULCAgreement` is a large
 * payload it has no use for.
 */
function fingerprintPayload(
  fp: DomainFingerprint
): Record<string, unknown> {
  return { ...fp }
}

function agreementPayload(
  a: LULCAgreement | undefined | null
): Record<string, unknown> | undefined {
  if (!a) return undefined
  return {
    n_reference_cells: a.n_reference_cells,
    n_outside_legend: a.n_outside_legend,
    overall_pct: a.overall_pct,
    quantity_disagreement_pct: a.quantity_disagreement_pct,
    allocation_disagreement_pct: a.allocation_disagreement_pct,
    matrix: a.matrix,
    matrix_classes: a.matrix_classes,
  }
}

export function hasDomainFingerprint(
  result: PredictResult | null | undefined
): boolean {
  return !!(result?.domain_fingerprint?.mean?.length)
}

/**
 * Whether this run's fingerprint can carry a standardised distance.
 *
 * A separate question from having one at all, and the two were conflated. A
 * Prithvi or Temporal Transformer run has no spectral feature matrix, so
 * `build_fingerprint` takes its NDVI-only branch and sets `z_mean` to null
 * deliberately -- that null is what stops an NDVI fingerprint being
 * standardised against a spectral one. Such a run passes
 * `hasDomainFingerprint`, reaches the panel, and produces a KL-only report.
 *
 * Asking this before the comparison is what lets the surface say WHICH run
 * cannot be standardised and why, rather than leaving the reader with a report
 * whose three main figures are blank for reasons it does not give.
 */
export function canStandardise(
  result: PredictResult | null | undefined
): boolean {
  const fp = result?.domain_fingerprint
  return !!(fp?.z_mean?.length && fp?.z_var?.length)
}

/**
 * One source measured against every target, in one sidecar call.
 *
 * The transferability question is a star: one region the model was fitted on,
 * and every other measured against it. For N areas that is N-1 comparisons, and
 * running them as N-1 separate calls would spawn N-1 Python processes, each
 * paying the numpy and sklearn import before doing arithmetic on 512 rows.
 *
 * Targets with no fingerprint are dropped here rather than sent, since the
 * sidecar would refuse the whole request over one of them -- and the caller
 * needs to name them, which is why they come back rather than vanishing.
 */
export async function cohortDomainShift(
  source: { id: string; label: string; result: PredictResult },
  targets: readonly { id: string; label: string; result: PredictResult }[]
): Promise<{ cohort: DomainShiftCohort; skipped: string[] }> {
  const fp = source.result.domain_fingerprint
  if (!fp) {
    throw new Error(
      `${source.label} has no domain fingerprint — re-classify it to use it as the source.`
    )
  }
  const usable = targets.filter((t) => !!t.result.domain_fingerprint)
  const skipped = targets
    .filter((t) => !t.result.domain_fingerprint)
    .map((t) => t.label)
  if (!usable.length) {
    throw new Error("No target carries a domain fingerprint.")
  }
  /*
    Through `createFrom` rather than as a literal.

    The pair request is a flat struct of maps, so wails generates it as a shape
    a literal satisfies. This one nests a struct, so the generated class carries
    a `convertValues` method and a literal is not assignable. Constructing it is
    the generated API's own answer, and it keeps the field names checked against
    the Go tags rather than cast past them.
  */
  const cohort = await AnalyzeDomainShiftCohort(
    analysis.DomainShiftCohortRequest.createFrom({
      source: {
        id: source.id,
        label: source.label,
        fingerprint: fingerprintPayload(fp),
        agreement: agreementPayload(source.result.lulc?.agreement),
      },
      targets: usable.map((t) => ({
        id: t.id,
        label: t.label,
        fingerprint: fingerprintPayload(t.result.domain_fingerprint!),
        agreement: agreementPayload(t.result.lulc?.agreement),
      })),
    })
  )
  return { cohort, skipped }
}

/** Compare two runs' fingerprints via the sidecar (KL / CVA / MMD / F1). */
export async function compareDomainShift(
  resultA: PredictResult,
  resultB: PredictResult,
  opts?: { includeTsne?: boolean }
): Promise<DomainShiftReport> {
  const fpA = resultA.domain_fingerprint
  const fpB = resultB.domain_fingerprint
  if (!fpA || !fpB) {
    throw new Error(
      "Both runs need a domain fingerprint — re-classify to enable this diagnosis."
    )
  }
  return AnalyzeDomainShift({
    fingerprint_a: fingerprintPayload(fpA),
    fingerprint_b: fingerprintPayload(fpB),
    agreement_a: agreementPayload(resultA.lulc?.agreement),
    agreement_b: agreementPayload(resultB.lulc?.agreement),
    include_tsne: opts?.includeTsne ?? false,
  })
}
