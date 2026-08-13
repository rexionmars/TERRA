/**
 * The cohort as a table: one row per target, the figures the scatter selects
 * from.
 *
 * The design record asks for exactly this beside the figure -- one row per AOI,
 * sortable by divergence, accuracy, quantity and allocation disagreement -- and
 * notes that the table component and its builders already exist; what was
 * missing was a surface that routes to them. `DataTableView` supplies sorting
 * and the clipboard, so this file only has to shape the rows.
 *
 * Not in `analysisTables.ts`, for the reason `compareTables.ts` gives: that
 * module is the mirror of `backend/export_research.go` and its parity test
 * checks both directions, while the research pack is built from ONE run. A
 * cohort is a statement about several and has no file there to be in parity
 * with.
 *
 * THE QUALIFIERS ARE COLUMNS, not a filter. The scatter drops what it cannot
 * place; the table keeps every target and says why, because a row missing from
 * a table is a target that looks unexamined.
 */
import type { CellValue, DataTable, TableColumn } from "@/lib/analysisTables"
import type { DomainShiftCohort } from "@/lib/types"

const num = (key: string): TableColumn => ({ key, numeric: true })

export function cohortTable(cohort: DomainShiftCohort): DataTable | null {
  const rows: CellValue[][] = cohort.targets.map((t) => [
    t.label,
    // The divergence the figure plots, and the two that qualify it. MMD is
    // reported with its bandwidth elsewhere; here the estimate is the column
    // and the row is only comparable to others of the same cohort, which share
    // one source and therefore one kernel per pair.
    t.mmd_rbf?.mmd2 ?? null,
    t.cva_magnitude_sd ?? null,
    t.kl_ndvi ?? null,
    t.agreement_b?.overall_pct ?? null,
    t.agreement_b?.macro_f1 ?? null,
    t.agreement_b?.quantity_disagreement_pct ?? null,
    t.agreement_b?.allocation_disagreement_pct ?? null,
    // Written as words rather than booleans: a column of true/false in a table
    // read beside percentages invites being sorted as though it were a score.
    t.comparable ? "yes" : "no",
    t.same_space ? "yes" : "no",
    t.standardised ? "yes" : "no",
  ])
  if (!rows.length) return null

  // The source as its own row, so the figure's reference point is in the table
  // the figure was selected from. Its distance to itself is zero by definition
  // and is left empty rather than written, which would read as a measurement.
  const source = cohort.source
  rows.unshift([
    `${source.label} (source)`,
    null,
    null,
    null,
    source.agreement?.overall_pct ?? null,
    source.agreement?.macro_f1 ?? null,
    source.agreement?.quantity_disagreement_pct ?? null,
    source.agreement?.allocation_disagreement_pct ?? null,
    "—",
    "—",
    "—",
  ])

  return {
    id: "domain_cohort",
    csvName: "domain_cohort.csv",
    columns: [
      { key: "area" },
      num("mmd2"),
      num("cva_sd"),
      num("kl_ndvi"),
      num("agreement_pct"),
      num("macro_f1"),
      num("quantity_pct"),
      num("allocation_pct"),
      { key: "comparable" },
      { key: "same_space" },
      { key: "standardised" },
    ],
    rows,
  }
}
