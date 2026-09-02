import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Check, Copy, Table } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { notifyError } from "@/lib/notify"
import { btnGhostDense } from "@/components/ui/buttons"
import {
  formatNumber,
  tableToCSV,
  type CellValue,
  type DataTable,
} from "@/lib/analysisTables"

type SortState = { column: number; direction: "asc" | "desc" } | null

function compare(a: CellValue, b: CellValue): number {
  const aEmpty = a === null || a === undefined || a === ""
  const bEmpty = b === null || b === undefined || b === ""
  // Missing values sort last in either direction rather than as zero.
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/**
 * Renders one analysis table with the same columns and value formatting the
 * research pack writes to CSV, so a figure read here matches the exported file.
 *
 * Sorting is view-only; copy and download always emit the table in its stored
 * order, which is the order the exporter uses.
 */
export function DataTableView({
  table,
  caption,
  onDownload,
}: {
  table: DataTable
  caption?: string
  /** Omit to hide the download action (copy is always available). */
  onDownload?: (table: DataTable) => void
}) {
  const [sort, setSort] = useState<SortState>(null)
  const [copied, setCopied] = useState(false)

  const rows = useMemo(() => {
    if (!sort) return table.rows
    const dir = sort.direction === "asc" ? 1 : -1
    return [...table.rows].sort(
      (a, b) => compare(a[sort.column], b[sort.column]) * dir
    )
  }, [table.rows, sort])

  const toggleSort = (index: number) => {
    setSort((cur) => {
      if (cur?.column !== index) return { column: index, direction: "asc" }
      if (cur.direction === "asc") return { column: index, direction: "desc" }
      return null
    })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tableToCSV(table))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch (e) {
      notifyError("Could not copy the table", e)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="telemetry text-[10px] text-muted-foreground">
          {table.rows.length} {table.rows.length === 1 ? "row" : "rows"}
          {" · "}
          {table.csvName}
          {caption ? ` · ${caption}` : ""}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void copy()}
            className={btnGhostDense}
            title="Copy this table as CSV"
          >
            {copied ? (
              <Check className="h-3 w-3 text-primary" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy CSV"}
          </button>
          {onDownload && (
            <button
              type="button"
              onClick={() => onDownload(table)}
              className={btnGhostDense}
              title={`Save ${table.csvName}`}
            >
              <Table className="h-3 w-3" />
              Save CSV
            </button>
          )}
        </div>
      </div>

      {/* Wide tables scroll inside the section rather than widening the page. */}
      <div className="rounded-sm border border-border bg-background max-h-[22rem] overflow-auto">
        <table className="selectable w-full min-w-max text-left text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr
              className="border-b"
              style={{
                borderColor: "var(--border)",
                background: "var(--secondary)",
              }}
            >
              {table.columns.map((c, i) => {
                const active = sort?.column === i
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      active
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="p-0 font-normal"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(i)}
                      className={cn(
                        "telemetry flex w-full items-center gap-1 px-2.5 py-1.5 text-[10px] hover:text-foreground",
                        c.numeric ? "justify-end" : "justify-start",
                        active ? "text-foreground" : "text-muted-foreground"
                      )}
                      title={`Sort by ${c.key}`}
                    >
                      {c.key}
                      {active &&
                        (sort.direction === "asc" ? (
                          <ArrowUp className="h-2.5 w-2.5" />
                        ) : (
                          <ArrowDown className="h-2.5 w-2.5" />
                        ))}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={r}
                className="border-b last:border-b-0"
                style={{ borderColor: "var(--border)" }}
              >
                {row.map((cell, c) => {
                  const col = table.columns[c]
                  const text = formatNumber(cell)
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        "whitespace-nowrap px-2.5 py-1.5",
                        col.numeric
                          ? "telemetry text-right text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {col.swatch && text ? (
                        <span className="flex items-center gap-1.5">
                          <span
                            className="size-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: text }}
                          />
                          <span className="telemetry">{text}</span>
                        </span>
                      ) : (
                        text
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export type SectionView = "chart" | "table"
