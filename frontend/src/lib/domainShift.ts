/**
 * Helpers for Domain Shift diagnostics between two saved PredictResults.
 */
import { AnalyzeDomainShift } from "../../wailsjs/go/main/App"
import type {
  DomainFingerprint,
  DomainShiftReport,
  LULCAgreement,
  PredictResult,
} from "@/lib/types"

function fingerprintPayload(
  fp: DomainFingerprint
): Record<string, unknown> {
  return {
    space: fp.space,
    n_features: fp.n_features,
    n_pixels: fp.n_pixels,
    n_sample: fp.n_sample,
    mean: fp.mean,
    var: fp.var,
    ndvi_hist: fp.ndvi_hist ?? undefined,
    red_nir: fp.red_nir ?? undefined,
    sample: fp.sample ?? undefined,
  }
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
