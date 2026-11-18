import { useEffect, useState } from "react"

import { DataTableView } from "@/components/DataTableView"
import { CaretLeft, CaretRight, CircleNotch, Table } from "@/components/icons"
import { btnGhost } from "@/components/ui/buttons"
import { ShellPanel } from "@/components/shell/ShellPanel"
import type { CellValue, DataTable } from "@/lib/analysisTables"
import { fileRows } from "@/lib/fileFeature"
import type { FileLayer, OpenedFile } from "@/lib/fileLayers"

/**
 * Rows read at a time. A table of a quarter of a million rows laid out whole
 * would stop the page; a thousand is more than a table of what each layer is,
 * the usual table without geometry in a GeoPackage, ever holds.
 */
export const TABLE_PAGE = 1000

type Page =
  | { state: "reading" }
  | { state: "read"; table: DataTable; total: number }
  | { state: "failed"; message: string }

/** A cell as the table holds it: text and numbers as they are, anything else empty. */
function cell(v: unknown): CellValue {
  return typeof v === "string" || typeof v === "number" ? v : null
}

/**
 * The rows of a table without geometry from an opened file: what QGIS opens as
 * its attribute table. The map draws nothing of it, so it is read here, a page
 * at a time, with its columns named as the file names them.
 */
export function TablePanel({
  file,
  layer,
  url,
  onBack,
  onClose,
}: {
  file: OpenedFile
  layer: FileLayer
  /** The layer's URL made absolute, which the worker that reads it needs. */
  url: string
  onBack: () => void
  onClose: () => void
}) {
  const [from, setFrom] = useState(0)
  const [page, setPage] = useState<Page>({ state: "reading" })

  useEffect(() => {
    let live = true
    setPage({ state: "reading" })
    fileRows(url, from, TABLE_PAGE).then(
      ({ rows, total }) => {
        if (!live) return
        const columns = layer.columns.map((key) => ({
          key,
          // Right-aligned when every value on the page that is not empty is a number.
          numeric:
            rows.some((r) => typeof r[key] === "number") &&
            rows.every((r) => r[key] === null || typeof r[key] === "number"),
        }))
        setPage({
          state: "read",
          total,
          table: {
            id: layer.key,
            csvName: layer.name,
            columns,
            rows: rows.map((r) => layer.columns.map((c) => cell(r[c]))),
          },
        })
      },
      (e: unknown) => {
        if (live) {
          setPage({
            state: "failed",
            message: e instanceof Error ? e.message : String(e),
          })
        }
      }
    )
    return () => {
      live = false
    }
  }, [url, layer.key, layer.name, layer.columns, from])

  const total = page.state === "read" ? page.total : layer.drawn
  const paged = total > TABLE_PAGE
  const to = Math.min(from + TABLE_PAGE, total)
  const title = layer.title || layer.name
  return (
    <ShellPanel
      wide
      bare
      crumbs={[{ label: "Layers", onClick: onBack }, { label: title }]}
      onClose={onClose}
      footer={
        paged ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={from === 0 || page.state === "reading"}
              onClick={() => setFrom(Math.max(0, from - TABLE_PAGE))}
              className={btnGhost}
            >
              <CaretLeft className="size-4" />
              Previous
            </button>
            <span className="flex-1 text-center text-label text-muted-foreground">
              Rows {(from + 1).toLocaleString("en")} to {to.toLocaleString("en")} of{" "}
              {total.toLocaleString("en")}
            </span>
            <button
              type="button"
              disabled={to >= total || page.state === "reading"}
              onClick={() => setFrom(from + TABLE_PAGE)}
              className={btnGhost}
            >
              Next
              <CaretRight className="size-4" />
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-3">
        <p className="flex items-center gap-2 text-label text-muted-foreground">
          <Table className="size-4 shrink-0" />A table without geometry in {file.name}:
          the map draws nothing of it.
        </p>
        {layer.drawn < layer.count && (
          <p className="text-label text-muted-foreground">
            The file holds {layer.count.toLocaleString("en")} rows; the first{" "}
            {layer.drawn.toLocaleString("en")} are read.
          </p>
        )}
        {paged && (
          <p className="text-label text-muted-foreground">
            Sorting orders the rows of this page only.
          </p>
        )}
        {layer.columns.length === 0 ? (
          <p className="text-read text-muted-foreground">The table has no columns.</p>
        ) : page.state === "reading" ? (
          <p className="flex items-center gap-2 text-label text-muted-foreground">
            <CircleNotch className="size-3.5 animate-spin" />
            Reading the table
          </p>
        ) : page.state === "failed" ? (
          <p className="text-label text-destructive-quiet">
            The table could not be read: {page.message}
          </p>
        ) : (
          <DataTableView table={page.table} namesAsStored fill />
        )}
      </div>
    </ShellPanel>
  )
}
