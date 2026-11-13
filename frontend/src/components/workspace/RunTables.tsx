/**
 * A run's own tables, in the studio, at the width a table needs.
 *
 * The components have existed all along: `DataTableView` sorts, copies and
 * downloads, and `analysisTables` builds around twenty-eight tables keyed on
 * which payloads a run actually carries -- the same builders the research pack
 * writes to disk. What was missing was somewhere to read them. Reading a
 * table meant exporting it and opening the file.
 *
 * NOTHING NEW IS BUILT HERE. This is a chooser over `allAnalysisTables` and a
 * mount of `DataTableView`. A second table component would be a second set of
 * column names to disagree with the first, which is the failure this codebase
 * has already had with a palette and with a set of table columns.
 */
import { useState } from "react"
import { DataTableView } from "@/components/DataTableView"
import { RunPills, titled } from "@/components/workspace/readingParts"
import { allAnalysisTables } from "@/lib/analysisTables"
import type { PredictResult } from "@/lib/types"

export function RunTables({
  runs,
}: {
  /** The selected planes' runs, in selection order. */
  runs: Array<{ id: string; label: string; result: PredictResult }>
}) {
  const [runIdx, setRunIdx] = useState(0)
  const [tableIdx, setTableIdx] = useState(0)

  if (!runs.length) {
    return (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        Pick a plane to read the tables its run produced.
      </p>
    )
  }

  const run = runs[Math.min(runIdx, runs.length - 1)]
  // Built per run rather than cached: the builders are keyed on payload
  // presence, so two runs of different products do not carry the same set.
  const tables = allAnalysisTables(run.result)
  const table = tables[Math.min(tableIdx, Math.max(0, tables.length - 1))]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {/* Which run, only where more than one is linked. */}
        {runs.length > 1 && (
          <RunPills
            runs={runs}
            value={Math.min(runIdx, runs.length - 1)}
            onChange={(i) => {
              setRunIdx(i)
              // The other run may not carry the table being read, and an
              // index past the end would show the last one silently.
              setTableIdx(0)
            }}
          />
        )}
        <select
          value={table?.id ?? ""}
          onChange={(e) =>
            setTableIdx(
              Math.max(
                0,
                tables.findIndex((t) => t.id === e.target.value)
              )
            )
          }
          aria-label="Table"
          className="field-input h-8 w-auto max-w-full px-2 text-label"
        >
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.csvName} · {t.rows.length} {t.rows.length === 1 ? "row" : "rows"}
            </option>
          ))}
        </select>
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-4">
        {table ? (
          <DataTableView
            table={table}
            // The file is named once by the view; the run it came from beside it.
            caption={titled(run.label)}
          />
        ) : (
          <p className="text-meta text-muted-foreground">This run carries no tables.</p>
        )}
      </div>
    </div>
  )
}
