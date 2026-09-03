/**
 * The published series, named once.
 *
 * Mirrors sidecar/terra/grid/figures/spec.py. Kept here as well because the
 * run graph has to offer a figure BEFORE the sidecar has answered, and a label
 * spelled in two places is a label that can disagree with itself -- so the two
 * are compared by a test rather than trusted.
 */

export interface SeriesFigure {
  number: number
  /** Short enough for a card 208 px wide. */
  label: string
  scope: "site" | "system"
  /** Whether this application computes it yet. */
  ready: boolean
}

export const SERIES_FIGURES: readonly SeriesFigure[] = [
  { number: 1, label: "Curtailment in the SIN", scope: "system", ready: true },
  { number: 2, label: "Distributed generation", scope: "system", ready: false },
  { number: 3, label: "Paired case study", scope: "site", ready: false },
  { number: 4, label: "Chronology", scope: "site", ready: false },
  { number: 5, label: "Climate control", scope: "site", ready: false },
  { number: 6, label: "Reference bias", scope: "site", ready: false },
  { number: 7, label: "Construction detection", scope: "site", ready: false },
  { number: 8, label: "Out-of-merit dispatch", scope: "system", ready: false },
  { number: 9, label: "Subsystem decomposition", scope: "system", ready: false },
  { number: 10, label: "Network topology", scope: "system", ready: false },
  { number: 11, label: "Wind replication", scope: "system", ready: false },
  { number: 12, label: "Robustness", scope: "system", ready: false },
]

export function seriesFigure(n: number): SeriesFigure | undefined {
  return SERIES_FIGURES.find((f) => f.number === n)
}
