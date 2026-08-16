/**
 * The compare editor's figures as tables, so they can leave the editor.
 *
 * WHY NOT IN `analysisTables.ts`. That module is the mirror of
 * `backend/export_research.go`, and `backend/export_parity_test.go` checks the
 * two both ways: a table defined there and not written by the Go exporter is a
 * test failure, by design. The research pack is built by
 * `BuildResearchPackZIP(meta, result *PredictResult)` -- ONE run -- and a delta
 * is a statement about two. Registering these there would either break that
 * invariant or force the Go writer to grow a second run it has no way to name.
 *
 * They reuse the `DataTable` shape and go through `DataTableView` all the same,
 * so sorting, formatting and clipboard behave as they do everywhere else. What
 * they do not claim is parity with a file on disk, because there is no such
 * file to be in parity with.
 *
 * Rows follow the panels they come from exactly, including the union rule for
 * one-sided classes: a table that quietly held fewer rows than the figures
 * above it would be a second answer to the same question.
 */
import type { CellValue, DataTable, TableColumn } from "@/lib/analysisTables"
import type { ClassStat, LULCAgreement } from "@/lib/types"

const num = (key: string): TableColumn => ({ key, numeric: true })

function table(
  id: string,
  csvName: string,
  columns: TableColumn[],
  rows: CellValue[][]
): DataTable | null {
  return rows.length ? { id, csvName, columns, rows } : null
}

const delta = (x?: number | null, y?: number | null): number | null =>
  typeof x === "number" && typeof y === "number" ? y - x : null

/**
 * Producer's and user's accuracy for both runs, and the difference.
 *
 * Paired by class id, as `AgreementDelta` is: `per_class` is ordered by the
 * legend each run carried, and two runs of different areas do not carry the
 * same classes in the same order. A class only one side measured keeps its row
 * with the other side's cells empty -- not measured is not zero, and a blank
 * cell says so where a 0 would assert something.
 */
export function compareAccuracyDeltaTable(
  a: LULCAgreement,
  b: LULCAgreement
): DataTable | null {
  const byIdA = new Map(a.per_class.map((c) => [c.class_id, c]))
  const byIdB = new Map(b.per_class.map((c) => [c.class_id, c]))
  const ids: number[] = []
  for (const c of [...a.per_class, ...b.per_class])
    if (!ids.includes(c.class_id)) ids.push(c.class_id)

  return table(
    "compare_accuracy_delta",
    "compare_accuracy_delta.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      num("producers_pct_a"),
      num("producers_pct_b"),
      num("producers_delta_pp"),
      num("users_pct_a"),
      num("users_pct_b"),
      num("users_delta_pp"),
    ],
    ids.map((id) => {
      const ca = byIdA.get(id)
      const cb = byIdB.get(id)
      return [
        id,
        ca?.name ?? cb?.name ?? `Class ${id}`,
        ca?.color ?? cb?.color ?? "",
        ca?.producers_pct ?? null,
        cb?.producers_pct ?? null,
        delta(ca?.producers_pct, cb?.producers_pct),
        ca?.users_pct ?? null,
        cb?.users_pct ?? null,
        delta(ca?.users_pct, cb?.users_pct),
      ]
    })
  )
}

/**
 * Class share for both runs, and the difference.
 *
 * Absence means zero here rather than unknown, which is the opposite of the
 * table above and the reason the two are not one function: `class_stats` lists
 * what is in the raster, so a class it omits has a share of zero and its delta
 * is a real figure in either direction.
 */
export function compareShareDeltaTable(
  statsA: readonly ClassStat[],
  statsB: readonly ClassStat[]
): DataTable | null {
  const byIdA = new Map(statsA.map((c) => [c.class_id, c]))
  const byIdB = new Map(statsB.map((c) => [c.class_id, c]))
  const ids: number[] = []
  for (const c of [...statsA, ...statsB])
    if (!ids.includes(c.class_id)) ids.push(c.class_id)

  return table(
    "compare_share_delta",
    "compare_share_delta.csv",
    [
      num("class_id"),
      { key: "name" },
      { key: "color", swatch: true },
      num("pct_a"),
      num("pct_b"),
      num("delta_pp"),
    ],
    ids.map((id) => {
      const ca = byIdA.get(id)
      const cb = byIdB.get(id)
      const pctA = ca?.pct ?? 0
      const pctB = cb?.pct ?? 0
      return [
        id,
        ca?.name ?? cb?.name ?? `Class ${id}`,
        ca?.color ?? cb?.color ?? "",
        pctA,
        pctB,
        pctB - pctA,
      ]
    })
  )
}

/**
 * Every block of both runs, as rows.
 *
 * Long rather than wide -- one row per block per side, with the side named in
 * a column -- because the two runs need not have the same number of measured
 * blocks, and a wide table would have to pad one side with blanks that mean
 * "no block here" rather than "no measurement".
 */
export function compareBlockAgreementTable(
  a: LULCAgreement,
  b: LULCAgreement,
  labelA: string,
  labelB: string
): DataTable | null {
  const rows: CellValue[][] = []
  for (const [side, label, agreement] of [
    ["A", labelA, a],
    ["B", labelB, b],
  ] as const) {
    for (const cell of agreement.blocks?.cells ?? []) {
      rows.push([
        side,
        label,
        cell.row,
        cell.col,
        cell.n_reference_cells,
        // Left empty below the floor rather than filled with a figure the
        // denominator cannot carry.
        cell.overall_pct,
      ])
    }
  }
  return table(
    "compare_block_agreement",
    "compare_block_agreement.csv",
    [
      { key: "side" },
      { key: "label" },
      num("block_row"),
      num("block_col"),
      num("n_reference_cells"),
      num("overall_pct"),
    ],
    rows
  )
}

/**
 * Whole-map figures for both runs, and the difference.
 *
 * The three the panel puts above the per-class rows. Quantity and allocation
 * are disagreement, so a fall in them is an improvement -- the sign is not
 * flipped here, because a table is read with its column name and flipping it
 * would put the panel and the file at odds over what the number means.
 */
export function compareOverallDeltaTable(
  a: LULCAgreement,
  b: LULCAgreement
): DataTable | null {
  const rows: CellValue[][] = [
    ["overall_pct", a.overall_pct, b.overall_pct, delta(a.overall_pct, b.overall_pct)],
    [
      "quantity_disagreement_pct",
      a.quantity_disagreement_pct,
      b.quantity_disagreement_pct,
      delta(a.quantity_disagreement_pct, b.quantity_disagreement_pct),
    ],
    [
      "allocation_disagreement_pct",
      a.allocation_disagreement_pct,
      b.allocation_disagreement_pct,
      delta(a.allocation_disagreement_pct, b.allocation_disagreement_pct),
    ],
    [
      "n_reference_cells",
      a.n_reference_cells,
      b.n_reference_cells,
      delta(a.n_reference_cells, b.n_reference_cells),
    ],
  ]
  return table(
    "compare_overall_delta",
    "compare_overall_delta.csv",
    [{ key: "measure" }, num("a"), num("b"), num("delta_pp")],
    rows
  )
}
