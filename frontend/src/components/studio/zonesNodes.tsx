/**
 * The card of the Management zones node: the number of zones chosen, the zones
 * of that partition, how clearly each number separates, and the GeoJSON
 * export for variable-rate application.
 *
 * Under a field set it is one row per field, and the export is one file with
 * every field's zones. The figures come from lib/zones.ts.
 */
import { useState } from "react"
import { DownloadSimple } from "@phosphor-icons/react"

import { Choice } from "./nodeCard"
import { ActionButton, Figure, Note, Swatch } from "./nodeParts"
import type { ZonesValue } from "@/lib/compositorEval"
import { chosenPartition } from "@/lib/zones"
import type { ZonesAnalysis } from "@/lib/types"

const COUNTS = [3, 4, 5] as const

function ZonesReading({ report, k }: { report: ZonesAnalysis | null; k: number | null }) {
  const p = chosenPartition(report, k)
  if (!report || !p) return null
  const used = report.seasons.filter((s) => s.used)
  return (
    <div className="flex flex-col gap-1">
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="text-micro text-muted-foreground">
            <th className="px-1 text-left font-normal">Zone</th>
            <th className="px-1 text-right font-normal">ha</th>
            <th className="px-1 text-right font-normal">share</th>
            <th className="px-1 text-right font-normal" title="Mean of the seasons' 90th-percentile NDVI">
              NDVI
            </th>
          </tr>
        </thead>
        <tbody>
          {p.zones.map((z) => (
            <tr key={z.zone} className="border-t" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
              <td className="px-1">
                <span className="flex items-center gap-1 text-foreground">
                  <Swatch color={z.colour} />
                  {z.zone}
                </span>
              </td>
              <td className="telemetry px-1 text-right text-foreground">{z.area_ha.toFixed(1)}</td>
              <td className="telemetry px-1 text-right text-muted-foreground">{(100 * z.share).toFixed(0)}%</td>
              <td className="telemetry px-1 text-right text-foreground">{z.ndvi_mean != null ? z.ndvi_mean.toFixed(2) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="text-micro text-muted-foreground">
            <th className="px-1 text-left font-normal">Zones</th>
            <th className="px-1 text-right font-normal" title="Fuzziness performance index: 0 crisp, 1 no structure">
              FPI
            </th>
            <th className="px-1 text-right font-normal" title="Normalised classification entropy: lower is clearer">
              NCE
            </th>
          </tr>
        </thead>
        <tbody>
          {report.partitions.map((q) => (
            <tr key={q.k} className="border-t" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
              <td className="px-1 text-foreground">
                {q.k}
                {q.k === report.suggested_k ? " · suggested" : ""}
              </td>
              <td className="telemetry px-1 text-right text-foreground">{q.fpi.toFixed(3)}</td>
              <td className="telemetry px-1 text-right text-foreground">{q.nce.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Figure
        label="Seasons"
        value={used.length ? used.map((s) => `${s.start.slice(0, 4)}/${s.end.slice(2, 4)}`).join(", ") : "none"}
      />
      {report.seasons.length > used.length && (
        <Note>
          {report.seasons.length - used.length} season(s) not used: under half the field had three clear acquisitions.
        </Note>
      )}
    </div>
  )
}

function ZonesTable({ rows, k }: { rows: { name: string; report: ZonesAnalysis | null }[]; k: number | null }) {
  return (
    <div className="panel-scroll max-h-[16rem] overflow-auto">
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="text-micro text-muted-foreground">
            <th className="px-1 text-left font-normal">Field</th>
            <th className="px-1 text-right font-normal" title="The number of zones the run suggests">
              Sugg.
            </th>
            <th className="px-1 text-right font-normal" title="FPI of the partition exported">
              FPI
            </th>
            <th className="px-1 text-left font-normal" title="Area of each zone, ha, zone 1 the lowest NDVI">
              Zones, ha
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = chosenPartition(r.report, k)
            return (
              <tr key={r.name} className="border-t" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
                <td className="max-w-[5rem] truncate px-1 text-foreground" title={r.name}>
                  {r.name}
                </td>
                {r.report && p ? (
                  <>
                    <td className="telemetry px-1 text-right text-muted-foreground">{r.report.suggested_k}</td>
                    <td className="telemetry px-1 text-right text-foreground">{p.fpi.toFixed(3)}</td>
                    <td className="telemetry px-1 text-foreground">
                      <span className="flex items-center gap-1">
                        {p.zones.map((z) => (
                          <span key={z.zone} className="flex items-center gap-0.5" title={`zone ${z.zone}`}>
                            <Swatch color={z.colour} />
                            {z.area_ha.toFixed(0)}
                          </span>
                        ))}
                      </span>
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-1 text-right text-muted-foreground">
                    no run
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ZonesCard({
  k,
  onK,
  focused,
  fields,
  onExport,
}: {
  k: number | null
  onK: (k: number | null) => void
  focused: ZonesValue | null
  fields: { name: string; zones: ZonesValue | null }[] | null
  /** Saves the chosen partition, of every field under a set, as one GeoJSON file. */
  onExport: (all: boolean) => void
}) {
  const [all, setAll] = useState(true)
  const suggested = focused?.report.suggested_k
  const exportAll = !!fields && all
  const count = exportAll ? (fields?.filter((f) => f.zones).length ?? 0) : focused ? 1 : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-meta text-muted-foreground">Zones</span>
        <Choice label="Suggested" chosen={k == null} onPick={() => onK(null)} />
        {COUNTS.map((c) => (
          <Choice key={c} label={`${c}${c === suggested ? "*" : ""}`} chosen={k === c} onPick={() => onK(c)} />
        ))}
      </div>
      {fields && (
        <div className="flex items-center gap-1">
          <Choice label={`All ${fields.length} fields`} chosen={all} onPick={() => setAll(true)} />
          <Choice label="This field" chosen={!all} onPick={() => setAll(false)} />
        </div>
      )}
      {exportAll ? (
        <ZonesTable rows={fields!.map((f) => ({ name: f.name, report: f.zones?.report ?? null }))} k={k} />
      ) : (
        <ZonesReading report={focused?.report ?? null} k={k} />
      )}
      <ActionButton
        label={`GeoJSON, ${count} ${count === 1 ? "field" : "fields"}`}
        icon={<DownloadSimple className="size-3.5" />}
        disabled={!count}
        onClick={() => onExport(exportAll)}
      />
      <Note>
        Zones are where the canopy differed over the seasons, not why: soil, drainage, compaction or a past management
        line draw the same boundary. Zone 1 is the lowest NDVI.
      </Note>
    </div>
  )
}
