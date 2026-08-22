/**
 * The compare tables' row logic, checked against the rules the module states
 * rather than against what it currently returns.
 *
 * Three of these four functions fold two independently ordered class lists
 * into one set of rows, and the failures that produces are silent ones: a
 * class only one run measured losing its row, a delta computed from a value of
 * 0 coming out blank because absence and zero were tested with the same
 * operator, or the two opposite absence rules -- unknown in the accuracy
 * table, zero in the share table -- collapsing into one. None of those changes
 * a figure already on screen. They change which rows reach the CSV, which is
 * the one thing no panel above the table can contradict.
 *
 * Every expected value below is arithmetic done here from the inputs beside
 * it. Nothing was read off the module's output.
 */
import { describe, expect, it } from "vitest"
import {
  compareAccuracyDeltaTable,
  compareBlockAgreementTable,
  compareOverallDeltaTable,
  compareShareDeltaTable,
} from "./compareTables"
import type { DataTable } from "./analysisTables"
import type {
  ClassStat,
  LULCAgreement,
  LULCAgreementBlock,
  LULCAgreementBlocks,
  LULCClassAccuracy,
} from "./types"

/**
 * The fields a table reads, stated by the caller; the rest filled in.
 *
 * `n_reference` and `n_predicted` reach no column, so writing them out in
 * every case would put the reader's attention on the numbers that cannot
 * affect the assertion.
 */
type AccuracyFields = Pick<
  LULCClassAccuracy,
  "class_id" | "name" | "color" | "producers_pct" | "users_pct"
>

function accuracy(fields: AccuracyFields): LULCClassAccuracy {
  return { n_reference: 0, n_predicted: 0, ...fields }
}

type StatFields = Pick<ClassStat, "class_id" | "name" | "color" | "pct">

function stat(fields: StatFields): ClassStat {
  return { pixels: 0, area_ha: 0, ...fields }
}

function agreement(over: Partial<LULCAgreement> = {}): LULCAgreement {
  return {
    n_reference_cells: 0,
    overall_pct: 0,
    overall_ci: [0, 0],
    quantity_disagreement_pct: 0,
    allocation_disagreement_pct: 0,
    per_class: [],
    n_outside_legend: 0,
    matrix: [],
    matrix_classes: [],
    ...over,
  }
}

/** Only `min_cells` and `cells` are read; the summary figures are the panel's. */
function blocks(
  min_cells: number,
  cells: LULCAgreementBlock[]
): LULCAgreementBlocks {
  return {
    rows: 2,
    cols: 2,
    min_cells,
    cells,
    n_measured: cells.length,
    median_pct: 0,
    iqr_pct: 0,
    min_pct: 0,
    max_pct: 0,
  }
}

/** Narrows the nullable return, and fails naming the table that went missing. */
function built(id: string, t: DataTable | null): DataTable {
  if (!t) throw new Error(`expected ${id} to be built, got null`)
  return t
}

/**
 * Every row carries one cell per column.
 *
 * The CSV writer and DataTableView both address cells by position, so a row of
 * the wrong length does not fail -- it shifts every value after the gap into
 * the neighbouring column and writes a file that reads as valid.
 */
function expectRectangular(t: DataTable): void {
  for (const row of t.rows) expect(row).toHaveLength(t.columns.length)
}

describe("compareAccuracyDeltaTable", () => {
  it("returns null when neither run measured a class", () => {
    // Arrange
    const a = agreement()
    const b = agreement()

    // Act
    const result = compareAccuracyDeltaTable(a, b)

    // Assert
    expect(result).toBeNull()
  })

  it("keeps the single class of a run whose counterpart measured none, with the other side's cells blank", () => {
    // Arrange
    const a = agreement()
    const b = agreement({
      per_class: [
        accuracy({
          class_id: 24,
          name: "Urban",
          color: "#d4271e",
          producers_pct: 40,
          users_pct: 33.5,
        }),
      ],
    })

    // Act
    const t = built("compare_accuracy_delta", compareAccuracyDeltaTable(a, b))

    // Assert
    expect(t.rows).toEqual([
      [24, "Urban", "#d4271e", null, 40, null, null, 33.5, null],
    ])
    expectRectangular(t)
  })

  it("pairs classes by id and orders run A's classes before the classes only run B carries", () => {
    // Arrange: 15 is in both, 3 only in A, 24 only in B, and B lists 24 first
    // so that a function ordering by B's array would be caught.
    const a = agreement({
      per_class: [
        accuracy({
          class_id: 3,
          name: "Forest",
          color: "#1f8d49",
          producers_pct: 82.5,
          users_pct: 90,
        }),
        accuracy({
          class_id: 15,
          name: "Pasture",
          color: "#edde8e",
          producers_pct: 60,
          users_pct: null,
        }),
      ],
    })
    const b = agreement({
      per_class: [
        accuracy({
          class_id: 24,
          name: "Urban",
          color: "#d4271e",
          producers_pct: 40,
          users_pct: 33.5,
        }),
        accuracy({
          class_id: 15,
          name: "Pasture",
          color: "#edde8e",
          producers_pct: 72.25,
          users_pct: 55,
        }),
      ],
    })

    // Act
    const t = built("compare_accuracy_delta", compareAccuracyDeltaTable(a, b))

    // Assert: 72.25 - 60 = 12.25. A class held by both sides is one row, not
    // two, so three distinct ids give three rows.
    expect(t.rows).toEqual([
      [3, "Forest", "#1f8d49", 82.5, null, null, 90, null, null],
      [15, "Pasture", "#edde8e", 60, 72.25, 12.25, null, 55, null],
      [24, "Urban", "#d4271e", null, 40, null, null, 33.5, null],
    ])
    expectRectangular(t)
  })

  it("subtracts an accuracy of 0 rather than reading it as not measured", () => {
    // Arrange: 0 is a measurement -- the class was looked for and never found.
    // A truthiness test in place of a type test would blank both deltas here.
    const a = agreement({
      per_class: [
        accuracy({
          class_id: 33,
          name: "Water",
          color: "#2532e4",
          producers_pct: 0,
          users_pct: 0,
        }),
      ],
    })
    const b = agreement({
      per_class: [
        accuracy({
          class_id: 33,
          name: "Water",
          color: "#2532e4",
          producers_pct: 0,
          users_pct: 12.5,
        }),
      ],
    })

    // Act
    const t = built("compare_accuracy_delta", compareAccuracyDeltaTable(a, b))

    // Assert: 0 - 0 = 0 and 12.5 - 0 = 12.5, and the zero cells stay 0.
    expect(t.rows).toEqual([
      [33, "Water", "#2532e4", 0, 0, 0, 0, 12.5, 12.5],
    ])
  })

  it("blanks only the delta of the accuracy one side left null, keeping the accuracy the other side has", () => {
    // Arrange: a class present in both runs, each missing the measure the
    // other has. Producer's accuracy is null where no reference cell of the
    // class exists, user's where nothing was called it.
    const a = agreement({
      per_class: [
        accuracy({
          class_id: 3,
          name: "Forest",
          color: "#1f8d49",
          producers_pct: 82.5,
          users_pct: null,
        }),
      ],
    })
    const b = agreement({
      per_class: [
        accuracy({
          class_id: 3,
          name: "Forest",
          color: "#1f8d49",
          producers_pct: null,
          users_pct: 44,
        }),
      ],
    })

    // Act
    const t = built("compare_accuracy_delta", compareAccuracyDeltaTable(a, b))

    // Assert
    expect(t.rows).toEqual([
      [3, "Forest", "#1f8d49", 82.5, null, null, null, 44, null],
    ])
  })

  it("names a class the runs left unnamed after its id and gives it no colour", () => {
    // Arrange: per_class is decoded from the sidecar's JSON, where a field the
    // writer omits arrives as undefined whatever the interface says. The cast
    // is what that looks like from inside a typed test.
    const nameless = {
      class_id: 24,
      producers_pct: 40,
      users_pct: null,
      n_reference: 0,
      n_predicted: 0,
    } as unknown as LULCClassAccuracy
    const a = agreement()
    const b = agreement({ per_class: [nameless] })

    // Act
    const t = built("compare_accuracy_delta", compareAccuracyDeltaTable(a, b))

    // Assert: a blank swatch rather than the string "undefined" painted as a
    // colour, and a label that still identifies the row.
    expect(t.rows[0][1]).toBe("Class 24")
    expect(t.rows[0][2]).toBe("")
  })

  it("carries the CSV header the compare pack is read by, with the colour column marked as a swatch", () => {
    // Arrange
    const a = agreement({
      per_class: [
        accuracy({
          class_id: 3,
          name: "Forest",
          color: "#1f8d49",
          producers_pct: 82.5,
          users_pct: 90,
        }),
      ],
    })
    const b = agreement()

    // Act
    const t = built("compare_accuracy_delta", compareAccuracyDeltaTable(a, b))

    // Assert: the key order is the cell order, so these two are one contract.
    expect(t.id).toBe("compare_accuracy_delta")
    expect(t.csvName).toBe("compare_accuracy_delta.csv")
    expect(t.columns).toEqual([
      { key: "class_id", numeric: true },
      { key: "name" },
      { key: "color", swatch: true },
      { key: "producers_pct_a", numeric: true },
      { key: "producers_pct_b", numeric: true },
      { key: "producers_delta_pp", numeric: true },
      { key: "users_pct_a", numeric: true },
      { key: "users_pct_b", numeric: true },
      { key: "users_delta_pp", numeric: true },
    ])
  })
})

describe("compareShareDeltaTable", () => {
  it("returns null when both runs list no classes", () => {
    // Arrange
    const statsA: ClassStat[] = []
    const statsB: ClassStat[] = []

    // Act
    const result = compareShareDeltaTable(statsA, statsB)

    // Assert
    expect(result).toBeNull()
  })

  it("reads a class absent from a run as a share of zero, so its delta is a figure in either direction", () => {
    // Arrange: class_stats lists what is in the raster, so an omitted class
    // covers none of it. 9 disappeared between the runs, 15 appeared.
    const statsA = [
      stat({ class_id: 3, name: "Forest", color: "#1f8d49", pct: 40 }),
      stat({ class_id: 9, name: "Water", color: "#2532e4", pct: 5 }),
    ]
    const statsB = [
      stat({ class_id: 3, name: "Forest", color: "#1f8d49", pct: 25.5 }),
      stat({ class_id: 15, name: "Pasture", color: "#edde8e", pct: 10.25 }),
    ]

    // Act
    const t = built("compare_share_delta", compareShareDeltaTable(statsA, statsB))

    // Assert: 25.5 - 40 = -14.5, 0 - 5 = -5, 10.25 - 0 = 10.25. No cell is
    // blank here, which is what separates this table from the accuracy one.
    expect(t.rows).toEqual([
      [3, "Forest", "#1f8d49", 40, 25.5, -14.5],
      [9, "Water", "#2532e4", 5, 0, -5],
      [15, "Pasture", "#edde8e", 0, 10.25, 10.25],
    ])
    expectRectangular(t)
  })

  it("orders run A's classes in run A's order before the classes only run B carries", () => {
    // Arrange: B lists 2 before the shared 7, so an implementation walking B
    // first would put 2 at the top.
    const statsA = [stat({ class_id: 7, name: "Crop", color: "#e974ed", pct: 12 })]
    const statsB = [
      stat({ class_id: 2, name: "Rock", color: "#ffaa5f", pct: 3 }),
      stat({ class_id: 7, name: "Crop", color: "#e974ed", pct: 12 }),
    ]

    // Act
    const t = built("compare_share_delta", compareShareDeltaTable(statsA, statsB))

    // Assert
    expect(t.rows.map((row) => row[0])).toEqual([7, 2])
  })

  it("reports a delta of zero for the one class whose share did not move", () => {
    // Arrange: the single-class boundary, and the case a reader is most likely
    // to mistake for a missing figure if it came back blank.
    const statsA = [stat({ class_id: 3, name: "Forest", color: "#1f8d49", pct: 33.25 })]
    const statsB = [stat({ class_id: 3, name: "Forest", color: "#1f8d49", pct: 33.25 })]

    // Act
    const t = built("compare_share_delta", compareShareDeltaTable(statsA, statsB))

    // Assert
    expect(t.rows).toEqual([[3, "Forest", "#1f8d49", 33.25, 33.25, 0]])
  })

  it("takes the name and colour of the run that has the class when the other does not", () => {
    // Arrange
    const statsA: ClassStat[] = []
    const statsB = [stat({ class_id: 15, name: "Pasture", color: "#edde8e", pct: 10 })]

    // Act
    const t = built("compare_share_delta", compareShareDeltaTable(statsA, statsB))

    // Assert
    expect(t.rows).toEqual([[15, "Pasture", "#edde8e", 0, 10, 10]])
  })

  it("carries the CSV header the compare pack is read by, with the colour column marked as a swatch", () => {
    // Arrange
    const statsA = [stat({ class_id: 3, name: "Forest", color: "#1f8d49", pct: 40 })]
    const statsB: ClassStat[] = []

    // Act
    const t = built("compare_share_delta", compareShareDeltaTable(statsA, statsB))

    // Assert
    expect(t.id).toBe("compare_share_delta")
    expect(t.csvName).toBe("compare_share_delta.csv")
    expect(t.columns).toEqual([
      { key: "class_id", numeric: true },
      { key: "name" },
      { key: "color", swatch: true },
      { key: "pct_a", numeric: true },
      { key: "pct_b", numeric: true },
      { key: "delta_pp", numeric: true },
    ])
  })
})

describe("compareBlockAgreementTable", () => {
  it("returns null when neither run reported a block grid", () => {
    // Arrange: blocks is absent when no block held enough reference cells.
    const a = agreement()
    const b = agreement({ blocks: null })

    // Act
    const result = compareBlockAgreementTable(a, b, "run-a", "run-b")

    // Assert
    expect(result).toBeNull()
  })

  it("returns null when both grids are present but hold no cells", () => {
    // Arrange
    const a = agreement({ blocks: blocks(30, []) })
    const b = agreement({ blocks: blocks(30, []) })

    // Act
    const result = compareBlockAgreementTable(a, b, "run-a", "run-b")

    // Assert
    expect(result).toBeNull()
  })

  it("emits one row per block per run, run A's blocks first, each tagged with its side and label", () => {
    // Arrange: the two grids differ in length, which is the reason the table
    // is long rather than one row per block position.
    const a = agreement({
      blocks: blocks(30, [
        { row: 0, col: 0, n_reference_cells: 120, overall_pct: 78.5 },
        { row: 0, col: 1, n_reference_cells: 96, overall_pct: 61.25 },
      ]),
    })
    const b = agreement({
      blocks: blocks(30, [{ row: 1, col: 1, n_reference_cells: 88, overall_pct: 70 }]),
    })

    // Act
    const t = built(
      "compare_block_agreement",
      compareBlockAgreementTable(a, b, "2020 run", "2024 run")
    )

    // Assert: the label is the row's only tie back to the run it came from
    // once the file is out of the editor.
    expect(t.rows).toEqual([
      ["A", "2020 run", 0, 0, 120, 78.5],
      ["A", "2020 run", 0, 1, 96, 61.25],
      ["B", "2024 run", 1, 1, 88, 70],
    ])
    expectRectangular(t)
  })

  it("keeps the row of a block under the cell floor, with its percentage left empty", () => {
    // Arrange: 12 cells against a floor of 30. The count is a measurement and
    // stays; the percentage the backend refused to derive from it does not
    // become a 0, which would read as a block the classifier got entirely
    // wrong rather than one nothing can be said about.
    const a = agreement({
      blocks: blocks(30, [{ row: 2, col: 0, n_reference_cells: 12, overall_pct: null }]),
    })
    const b = agreement()

    // Act
    const t = built(
      "compare_block_agreement",
      compareBlockAgreementTable(a, b, "run-a", "run-b")
    )

    // Assert
    expect(t.rows).toEqual([["A", "run-a", 2, 0, 12, null]])
  })

  it("keeps the percentage of a block sitting exactly on the cell floor", () => {
    // Arrange: n_reference_cells equal to min_cells. The floor is applied
    // upstream, so this function must not re-apply it and drop the figure --
    // the panel above the table shows this block as measured.
    const a = agreement({
      blocks: blocks(30, [{ row: 1, col: 1, n_reference_cells: 30, overall_pct: 64 }]),
    })
    const b = agreement()

    // Act
    const t = built(
      "compare_block_agreement",
      compareBlockAgreementTable(a, b, "run-a", "run-b")
    )

    // Assert
    expect(t.rows).toEqual([["A", "run-a", 1, 1, 30, 64]])
  })

  it("skips the run whose grid is null and still emits the other run's blocks", () => {
    // Arrange
    const a = agreement({ blocks: null })
    const b = agreement({
      blocks: blocks(30, [{ row: 0, col: 0, n_reference_cells: 45, overall_pct: 51.5 }]),
    })

    // Act
    const t = built(
      "compare_block_agreement",
      compareBlockAgreementTable(a, b, "run-a", "run-b")
    )

    // Assert: side B, and no placeholder row standing in for A.
    expect(t.rows).toEqual([["B", "run-b", 0, 0, 45, 51.5]])
  })

  it("carries the CSV header the compare pack is read by", () => {
    // Arrange
    const a = agreement({
      blocks: blocks(30, [{ row: 0, col: 0, n_reference_cells: 45, overall_pct: 51.5 }]),
    })
    const b = agreement()

    // Act
    const t = built(
      "compare_block_agreement",
      compareBlockAgreementTable(a, b, "run-a", "run-b")
    )

    // Assert
    expect(t.id).toBe("compare_block_agreement")
    expect(t.csvName).toBe("compare_block_agreement.csv")
    expect(t.columns).toEqual([
      { key: "side" },
      { key: "label" },
      { key: "block_row", numeric: true },
      { key: "block_col", numeric: true },
      { key: "n_reference_cells", numeric: true },
      { key: "overall_pct", numeric: true },
    ])
  })
})

describe("compareOverallDeltaTable", () => {
  it("reports the four whole-map measures in a fixed order as B minus A", () => {
    // Arrange
    const a = agreement({
      overall_pct: 71.5,
      quantity_disagreement_pct: 8.25,
      allocation_disagreement_pct: 20.25,
      n_reference_cells: 4000,
    })
    const b = agreement({
      overall_pct: 80,
      quantity_disagreement_pct: 5.25,
      allocation_disagreement_pct: 14.75,
      n_reference_cells: 4120,
    })

    // Act
    const t = built("compare_overall_delta", compareOverallDeltaTable(a, b))

    // Assert: 80 - 71.5 = 8.5, 5.25 - 8.25 = -3, 14.75 - 20.25 = -5.5,
    // 4120 - 4000 = 120.
    expect(t.rows).toEqual([
      ["overall_pct", 71.5, 80, 8.5],
      ["quantity_disagreement_pct", 8.25, 5.25, -3],
      ["allocation_disagreement_pct", 20.25, 14.75, -5.5],
      ["n_reference_cells", 4000, 4120, 120],
    ])
    expectRectangular(t)
  })

  it("leaves a fall in disagreement negative rather than reversing the sign to read as a gain", () => {
    // Arrange: run B disagrees less than run A on both Pontius components.
    const a = agreement({
      quantity_disagreement_pct: 12,
      allocation_disagreement_pct: 9.5,
    })
    const b = agreement({
      quantity_disagreement_pct: 4,
      allocation_disagreement_pct: 2.5,
    })

    // Act
    const t = built("compare_overall_delta", compareOverallDeltaTable(a, b))

    // Assert: 4 - 12 = -8 and 2.5 - 9.5 = -7. Flipping these would put the
    // column at odds with its own name for a reader outside the editor.
    expect(t.rows[1][3]).toBe(-8)
    expect(t.rows[2][3]).toBe(-7)
  })

  it("returns a table of zero deltas rather than null when a run is compared with itself", () => {
    // Arrange: the rows of this table do not come from the data, so there is
    // no input for which it is empty -- including two runs of all zeros.
    const a = agreement()
    const b = agreement()

    // Act
    const t = built("compare_overall_delta", compareOverallDeltaTable(a, b))

    // Assert
    expect(t.rows).toHaveLength(4)
    for (const row of t.rows) expect(row[3]).toBe(0)
  })

  it("carries the CSV header the compare pack is read by", () => {
    // Arrange
    const a = agreement()
    const b = agreement()

    // Act
    const t = built("compare_overall_delta", compareOverallDeltaTable(a, b))

    // Assert
    expect(t.id).toBe("compare_overall_delta")
    expect(t.csvName).toBe("compare_overall_delta.csv")
    expect(t.columns).toEqual([
      { key: "measure" },
      { key: "a", numeric: true },
      { key: "b", numeric: true },
      { key: "delta_pp", numeric: true },
    ])
  })
})
