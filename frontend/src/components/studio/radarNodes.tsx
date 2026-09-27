/**
 * The card of the Radar series node: a field's Sentinel-1 VH and cross ratio
 * through the period, one line per relative orbit, its canopy losses shaded,
 * and the open water of the latest pass.
 *
 * Under a field set it is one row per field. The figures come from
 * lib/radar.ts; what is here is how they are drawn in a card.
 */
import { useState } from "react"

import { Choice } from "./nodeCard"
import { Figure, Note, Swatch } from "./nodeParts"
import type { RadarValue } from "@/lib/compositorEval"
import { byOrbit, lastLoss, latestPass, type OrbitSeries } from "@/lib/radar"
import { shortDate } from "@/lib/season"
import type { RadarAnalysis } from "@/lib/types"

// Okabe and Ito (2008): one colour per relative orbit, distinguishable under
// the common colour-vision deficiencies. Orbits past the third reuse them.
const ORBIT_INK = ["#0072b2", "#e69f00", "#009e73", "#cc79a7"]
const LOSS_INK = "rgb(var(--p-kind-radar))"

const at = (d: string) => Date.parse(`${d}T00:00:00Z`)

/** One quantity through the period, a line per orbit, the losses shaded behind. */
function OrbitChart({
  orbits,
  report,
  value,
  lo,
  hi,
  label,
}: {
  orbits: OrbitSeries[]
  report: RadarAnalysis
  value: (p: OrbitSeries["points"][number]) => number
  lo: number
  hi: number
  label: string
}) {
  const W = 300
  const H = 76
  const all = orbits.flatMap((o) => o.points)
  if (all.length < 2) return null
  const t0 = Math.min(...all.map((p) => at(p.date)))
  const t1 = Math.max(...all.map((p) => at(p.date)))
  const x = (d: string) => 26 + ((at(d) - t0) / Math.max(1, t1 - t0)) * (W - 30)
  const y = (v: number) => 4 + (1 - Math.max(0, Math.min(1, (v - lo) / (hi - lo)))) * (H - 10)
  return (
    <svg width={W} height={H} role="img" aria-label={label} className="block">
      {report.losses.map((l) => (
        <rect
          key={l.date_from}
          x={x(l.date_from)}
          y={2}
          width={Math.max(1, x(l.date_to) - x(l.date_from))}
          height={H - 6}
          fill={LOSS_INK}
          opacity={0.22}
        />
      ))}
      <text x={0} y={10} className="fill-muted-foreground" fontSize={8}>
        {hi}
      </text>
      <text x={0} y={H - 4} className="fill-muted-foreground" fontSize={8}>
        {lo}
      </text>
      {orbits.map((o, k) => (
        <polyline
          key={o.relativeOrbit}
          points={o.points.map((p) => `${x(p.date)},${y(value(p))}`).join(" ")}
          fill="none"
          stroke={ORBIT_INK[k % ORBIT_INK.length]}
          strokeWidth={1.25}
        />
      ))}
    </svg>
  )
}

function RadarReading({ report }: { report: RadarAnalysis | null }) {
  if (!report) return null
  const orbits = byOrbit(report)
  const latest = latestPass(report)
  return (
    <div className="flex flex-col gap-1">
      <Figure label="Passes" value={`${report.series.length} in ${orbits.length} ${orbits.length === 1 ? "orbit" : "orbits"}`} />
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-micro text-muted-foreground">
        {orbits.map((o, k) => (
          <span key={o.relativeOrbit} className="flex items-center gap-1">
            <Swatch color={ORBIT_INK[k % ORBIT_INK.length]} />
            {o.relativeOrbit} {o.orbitState.slice(0, 4)} · {o.points.length}
          </span>
        ))}
      </div>
      <span className="text-micro text-muted-foreground">VH, dB</span>
      <OrbitChart orbits={orbits} report={report} value={(p) => p.vh_db} lo={-22} hi={-8} label="VH by orbit through the period" />
      <span className="text-micro text-muted-foreground">Cross ratio VH/VV, dB</span>
      <OrbitChart orbits={orbits} report={report} value={(p) => p.cr_db} lo={-12} hi={-3} label="Cross ratio by orbit through the period" />
      {report.losses.length ? (
        report.losses.map((l) => (
          <Figure
            key={l.date_from}
            label="Canopy loss"
            value={`${shortDate(l.date_from)}–${shortDate(l.date_to)} · VH −${l.drop_db.toFixed(1)} dB · ${l.n_orbits} ${l.n_orbits === 1 ? "orbit" : "orbits"}${l.orbits_agree ? "" : ", disagree"}`}
          />
        ))
      ) : (
        <Figure label="Canopy loss" value="none found" />
      )}
      {latest && (
        <Figure label={`Open water, ${shortDate(latest.date)}`} value={`${(100 * latest.water_fraction).toFixed(1)}%`} />
      )}
    </div>
  )
}

function RadarTable({ rows }: { rows: { name: string; report: RadarAnalysis | null }[] }) {
  return (
    <div className="panel-scroll max-h-[16rem] overflow-auto">
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="text-micro text-muted-foreground">
            <th className="px-1 text-left font-normal">Field</th>
            <th className="px-1 text-right font-normal" title="Passes read">
              n
            </th>
            <th className="px-1 text-right font-normal" title="The last canopy loss of the period">
              Last loss
            </th>
            <th className="px-1 text-right font-normal" title="Share read as open water on the latest pass">
              Water
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const l = lastLoss(r.report)
            const p = latestPass(r.report)
            return (
              <tr key={r.name} className="border-t" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
                <td className="max-w-[5rem] truncate px-1 text-foreground" title={r.name}>
                  {r.name}
                </td>
                {r.report ? (
                  <>
                    <td className="telemetry px-1 text-right text-muted-foreground">{r.report.series.length}</td>
                    <td className="telemetry px-1 text-right text-foreground">
                      {l ? `${shortDate(l.date_from)}–${shortDate(l.date_to)}` : "none"}
                    </td>
                    <td className="telemetry px-1 text-right text-foreground">
                      {p ? `${(100 * p.water_fraction).toFixed(1)}%` : ""}
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

export function RadarCard({
  focused,
  fields,
}: {
  focused: RadarValue | null
  fields: { name: string; radar: RadarValue | null }[] | null
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
        <RadarTable rows={fields.map((f) => ({ name: f.name, report: f.radar?.report ?? null }))} />
      ) : (
        <RadarReading report={focused?.report ?? null} />
      )}
      <Note>
        A canopy loss is a VH drop the cross ratio follows: a harvest most often, but a lodged, hail-struck or desiccated
        canopy reads the same way. The thresholds were not calibrated against harvest records.
      </Note>
    </div>
  )
}
