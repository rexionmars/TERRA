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
import { allAnalysisTables } from "@/lib/analysisTables"
import type { PredictResult } from "@/lib/types"
import { cn } from "@/lib/utils"

export function StudioTables({
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
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        {/* Which run, only where more than one is selected. */}
        {runs.length > 1 &&
          runs.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setRunIdx(i)
                // The other run may not carry the table being read, and an
                // index past the end would show the last one silently.
                setTableIdx(0)
              }}
              className={cn(
                "max-w-[12rem] truncate rounded-sm px-1.5 py-0.5 text-meta transition-colors",
                i === runIdx
                  ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        {runs.length > 1 && (
          <span className="hairline mx-1 h-4 w-px self-center border-l" aria-hidden />
        )}
        <select
          value={table?.id ?? ""}
          onChange={(e) =>
            setTableIdx(Math.max(0, tables.findIndex((t) => t.id === e.target.value)))
          }
          className="field-input h-6 w-auto max-w-full px-1 text-meta"
        >
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.csvName} · {t.rows.length}
            </option>
          ))}
        </select>
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-2">
        {table ? (
          <DataTableView
            table={table}
            // Named after the file the exporter writes, so what is read here
            // and what lands on disk map one to one.
            caption={`${run.label} · ${table.csvName}`}
          />
        ) : (
          <p className="text-meta text-muted-foreground">
            This run carries no tables.
          </p>
        )}
      </div>
    </div>
  )
}
