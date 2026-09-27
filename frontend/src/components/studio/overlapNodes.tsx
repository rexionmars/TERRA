/**
 * The card of the Socio-environmental overlap node: an area against the public
 * registers, as read on one day.
 *
 * For one run it lists every register the run tried -- read, not published
 * where the area is, or not read -- with its hectares inside the area, and
 * opens one register's features on a press. Under a field set it is one row
 * per field. The figures come from lib/overlap.ts; what is here is how they are
 * drawn in a card.
 */
import { useState } from "react"

import { Choice } from "./nodeCard"
import { Figure, Note, Swatch } from "./nodeParts"
import type { OverlapValue } from "@/lib/compositorEval"
import { carGapHa, formatHa, periodHa, registerHa, registers } from "@/lib/overlap"
import type { OverlapAnalysis, OverlapLayer } from "@/lib/types"

/** "26 Sep 2026, 20:55 UTC": when the registers were read. */
function readAt(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso || "unknown"
  const d = new Date(t)
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
  return `${date}, ${time} UTC`
}

function registerText(l: OverlapLayer, areaHa: number): string {
  if (l.status === "not_covered") return "not covered"
  if (l.status === "failed") return "not read"
  if (l.id === "car") {
    const gap = Math.max(0, areaHa - l.overlap_ha)
    return `${l.n_features} reg. · ${formatHa(gap)} outside`
  }
  if (l.overlap_ha <= 0) return "none"
  const share = areaHa > 0 ? ` · ${((100 * l.overlap_ha) / areaHa).toFixed(1)}%` : ""
  return `${formatHa(l.overlap_ha)}${share}`
}

function FeatureList({ layer }: { layer: OverlapLayer }) {
  if (layer.status !== "read") return <Note>{layer.note || "Not read."}</Note>
  if (!layer.features.length) return <Note>No feature of this register shares ground with the area.</Note>
  return (
    <div className="panel-scroll flex max-h-[12rem] flex-col gap-1 overflow-y-auto">
      {layer.features.map((f, i) => {
        const what = [f.category, f.status, f.date].filter(Boolean).join(" · ")
        return (
          <div key={`${f.ref}:${i}`} className="flex flex-col border-t pt-0.5 text-meta" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-foreground" title={f.ref}>
                {f.name || f.ref}
              </span>
              <span className="telemetry shrink-0 text-foreground">{formatHa(f.overlap_ha)}</span>
            </div>
            <span className="truncate text-micro text-muted-foreground" title={[f.ref, what, f.detail].filter(Boolean).join("\n")}>
              {[f.name ? f.ref : "", what].filter(Boolean).join(" · ")}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function OverlapReading({ report }: { report: OverlapAnalysis | null }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!report) return null
  const list = registers(report)
  const opened = list.find((l) => l.id === open) ?? null
  const prodes = report.layers.find((l) => l.id === "prodes")
  return (
    <div className="flex flex-col gap-1">
      <Figure label="Read" value={readAt(report.read_at)} />
      <Figure label="Area" value={formatHa(report.area_ha)} />
      <div className="flex flex-col gap-0.5">
        {list.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setOpen(open === l.id ? null : l.id)}
            title={[l.publisher, l.layers.join(", "), l.note].filter(Boolean).join("\n")}
            className="flex items-center gap-1.5 rounded-sm px-0.5 text-left text-meta transition-colors hover:bg-hover"
            aria-expanded={open === l.id}
          >
            <Swatch color={l.colour} />
            <span className="min-w-0 flex-1 truncate text-foreground">{l.title}</span>
            <span className={l.status === "failed" ? "telemetry shrink-0 text-destructive-quiet" : "telemetry shrink-0 text-foreground"}>
              {registerText(l, report.area_ha)}
            </span>
          </button>
        ))}
      </div>
      {opened && <FeatureList layer={opened} />}
      {prodes?.status === "read" && prodes.overlap_ha > 0 && (
        <div className="flex flex-col gap-0.5 pt-0.5">
          {report.periods.map((p) => (
            <Figure key={p.id} label={p.label.split(":")[0]} value={p.ha > 0 ? formatHa(p.ha) : "none"} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Every field's hectares on the registers that most often decide a sale or a loan. */
function OverlapTable({ rows }: { rows: { name: string; report: OverlapAnalysis | null }[] }) {
  const cell = (v: number | null) => (v == null ? "n/r" : v > 0 ? v.toFixed(v < 10 ? 2 : 1) : "")
  const cols: { head: string; title: string; value: (r: OverlapAnalysis | null) => number | null }[] = [
    {
      head: "PRODES",
      title: "PRODES clearing from 2009, after 22 Jul 2008, ha",
      value: (r) => {
        const parts = ["forest_code_to_eudr", "straddles_eudr", "after_eudr"].map((id) => periodHa(r, id))
        return parts.some((x) => x == null) ? null : parts.reduce<number>((s, x) => s + (x ?? 0), 0)
      },
    },
    {
      head: "Emb.",
      title: "IBAMA and ICMBio embargoes, ha (each union; the two summed)",
      value: (r) => {
        const a = registerHa(r, "embargo_ibama")
        const b = registerHa(r, "embargo_icmbio")
        return a == null || b == null ? null : a + b
      },
    },
    { head: "TI", title: "Indigenous lands, ha", value: (r) => registerHa(r, "indigenous") },
    { head: "UC", title: "Conservation units, ha", value: (r) => registerHa(r, "conservation") },
    { head: "No CAR", title: "Part of the field no CAR registration covers, ha", value: (r) => carGapHa(r) },
  ]
  return (
    <div className="panel-scroll max-h-[16rem] overflow-auto">
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="text-micro text-muted-foreground">
            <th className="px-1 text-left font-normal">Field</th>
            {cols.map((c) => (
              <th key={c.head} className="px-1 text-right font-normal" title={c.title}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
              <td className="max-w-[5rem] truncate px-1 text-foreground" title={r.name}>
                {r.name}
              </td>
              {r.report ? (
                cols.map((c) => (
                  <td key={c.head} className="telemetry px-1 text-right text-foreground">
                    {cell(c.value(r.report))}
                  </td>
                ))
              ) : (
                <td colSpan={cols.length} className="px-1 text-right text-muted-foreground">
                  no run
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function OverlapCard({
  focused,
  fields,
}: {
  focused: OverlapValue | null
  fields: { name: string; overlap: OverlapValue | null }[] | null
}) {
  const [all, setAll] = useState(true)
  return (
    <div className="flex flex-col gap-1.5">
      {fields && (
        <div className="flex items-center gap-1">
          <Choice label={`All ${fields.length} fields`} chosen={all} onPick={() => setAll(true)} />
          <Choice label="This field" chosen={!all} onPick={() => setAll(false)} />
        </div>
      )}
      {fields && all ? (
        <>
          <OverlapTable rows={fields.map((f) => ({ name: f.name, report: f.overlap?.report ?? null }))} />
          <Note>Hectares; n/r where the register was not read or is not published there. The CSV of a Field table carries every column.</Note>
        </>
      ) : (
        <OverlapReading report={focused?.report ?? null} />
      )}
      <Note>
        An overlap is not a finding of irregularity: a clearing can be authorised, an embargo lifted after publication.
        A check holds for the moment it was read. APP and legal-reserve polygons are not published by WFS and are not read.
      </Note>
    </div>
  )
}
