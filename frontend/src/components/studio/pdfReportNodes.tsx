/**
 * The PDF report node's card: the document's identification and question, what
 * reaches the node, and the export.
 *
 * What the report says is built in lib/pdfReport.ts from the node's inputs;
 * this card holds only what a reader types. Text is kept in the card while it
 * is typed and written to the graph when the field is left, so a title is one
 * step of the compositor's undo rather than one per letter.
 */
import { useEffect, useState } from "react"
import { FilePdf } from "@phosphor-icons/react"

import { Choice } from "./nodeCard"
import { ActionButton, Figure, Note } from "./nodeParts"
import { PDF_REPORT_MAX_MAPS } from "@/lib/compositorGraph"
import type { PdfReportSettings } from "@/lib/pdfReportSettings"

type TextKey = Exclude<keyof PdfReportSettings, "released">

function TextField({
  label,
  value,
  placeholder,
  multiline,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  const props = {
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    className: "field-input min-w-0 flex-1 px-1 text-meta",
    "aria-label": label,
  }
  return (
    <label className={`flex gap-1.5 text-meta ${multiline ? "flex-col" : "items-center"}`}>
      <span className="w-[4.5rem] shrink-0 text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea rows={2} {...props} className={`${props.className} resize-y py-0.5`} />
      ) : (
        <input
          type="text"
          {...props}
          className={`${props.className} h-[1.375rem]`}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          }}
        />
      )}
    </label>
  )
}

export function PdfReportCard({
  settings,
  onSettings,
  products,
  fields,
  maps,
  missing,
  busy,
  onExport,
}: {
  settings: PdfReportSettings
  onSettings: (next: PdfReportSettings) => void
  /** The products whose figures reach the node, in the report's words. */
  products: string[]
  /** Rows the report will carry: fields of a set, or the one run. */
  fields: number
  maps: number
  /** Inputs not linked, named, so a report without a section says why. */
  missing: string[]
  busy: boolean
  onExport: () => void
}) {
  const set = (k: TextKey) => (v: string) => onSettings({ ...settings, [k]: v })
  return (
    <div className="flex flex-col gap-1.5">
      <TextField label="Title" value={settings.title} placeholder="Report on …" onCommit={set("title")} />
      <TextField label="Number" value={settings.number} placeholder="TERRA-RA-2026-001" onCommit={set("number")} />
      <TextField label="Revision" value={settings.revision} onCommit={set("revision")} />
      <TextField label="Author" value={settings.author} onCommit={set("author")} />
      <TextField label="Recipient" value={settings.recipient} onCommit={set("recipient")} />
      <TextField label="Owner" value={settings.owner} onCommit={set("owner")} />
      <TextField label="Approved by" value={settings.approver} onCommit={set("approver")} />
      <TextField
        label="Question"
        value={settings.question}
        placeholder="What the reader asked, and what depends on it"
        multiline
        onCommit={set("question")}
      />
      <TextField label="Scope" value={settings.scope} placeholder="What the report does not cover" multiline onCommit={set("scope")} />
      <div className="flex gap-1">
        <Choice label="Draft" chosen={!settings.released} onPick={() => onSettings({ ...settings, released: false })} />
        <Choice label="Released" chosen={settings.released} onPick={() => onSettings({ ...settings, released: true })} />
      </div>
      <Figure label="Fields" value={String(fields)} />
      <Figure label="Maps" value={`${maps} of ${PDF_REPORT_MAX_MAPS}`} />
      {products.length > 0 ? (
        <Note>Sections: {products.join(", ")}.</Note>
      ) : (
        <Note>
          Link a class map, a Season, or a Health, Overlap, Radar or Zones report: each adds its table and its method.
          Any raster linked to a Map input is drawn as a figure, and a new Map input opens for the next.
        </Note>
      )}
      {missing.length > 0 && products.length > 0 && <Note>Not linked: {missing.join(", ")}.</Note>}
      <ActionButton
        label={busy ? "Laying out" : "Export PDF"}
        icon={<FilePdf className="size-3.5" />}
        busy={busy}
        disabled={busy || !products.length}
        onClick={onExport}
      />
    </div>
  )
}
