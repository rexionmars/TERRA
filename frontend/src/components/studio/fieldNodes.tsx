/**
 * The cards of the three nodes that read a field's figures rather than its
 * rasters: Season dates, Vegetation health and Field table. The overlap
 * node's card is in overlapNodes.tsx.
 *
 * Each answers for one run, and under a field set (lib/fieldSets.ts) for every
 * field of the area at once: the editor evaluates the graph once per field and
 * hands each card every field's value beside the one in focus. The arithmetic
 * is in lib/season.ts, lib/health.ts and lib/fieldTable.ts; what is here is how
 * it is drawn in a card.
 */
import { useMemo, useState } from "react"
import { DownloadSimple } from "@phosphor-icons/react"

import { Choice } from "./nodeCard"
import { ActionButton, Figure, Note, Swatch } from "./nodeParts"
import type { HealthReference } from "@/lib/compositorGraph"
import type { HealthValue, SeasonValue } from "@/lib/compositorEval"
import { band, neighbourScores } from "@/lib/health"
import { classifiedTotal, dominant, type FieldRow } from "@/lib/fieldTable"
import { daysBetween, shortDate, type Season, type SeasonMark } from "@/lib/season"

const SEASON_INK = "rgb(var(--p-kind-season))"
// The anomaly map's own ends (sidecar/terra/health/actions.py, BrBG), so a bar
// and the map it describes read in one pair of colours.
const BELOW = "#bf812d"
const ABOVE = "#35978f"

const at = (d: string) => Date.parse(`${d}T00:00:00Z`)
const signed = (z: number) => `${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(1)}`

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** All fields or the one in focus: the two readings a set node's card offers. */
function Scope({ count, all, onAll }: { count: number; all: boolean; onAll: (all: boolean) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Choice label={`All ${count} fields`} chosen={all} onPick={() => onAll(true)} />
      <Choice label="This field" chosen={!all} onPick={() => onAll(false)} />
    </div>
  )
}

/* ---- Season dates ------------------------------------------------------- */

function markText(m: SeasonMark | null): string {
  if (!m) return "not found"
  return `${shortDate(m.date)} · ${shortDate(m.from)}–${shortDate(m.to)} (${daysBetween(m.from, m.to)} d)`
}

/** One run's series with its three dates and their windows. */
function SeriesChart({ season }: { season: Season }) {
  const W = 288
  const H = 84
  const obs = season.observations
  if (obs.length < 2) return null
  const t0 = at(obs[0].date)
  const t1 = at(obs[obs.length - 1].date)
  const x = (d: string) => 4 + ((at(d) - t0) / Math.max(1, t1 - t0)) * (W - 8)
  const y = (v: number) => H - 6 - Math.max(0, Math.min(1, v)) * (H - 12)
  const windows = [season.rise, season.fall].filter((m): m is SeasonMark => !!m)
  return (
    <svg width={W} height={H} role="img" aria-label="NDVI series with the season dates" className="block">
      {windows.map((m) => (
        <rect key={m.date} x={x(m.from)} y={2} width={Math.max(1, x(m.to) - x(m.from))} height={H - 4} fill={SEASON_INK} opacity={0.18} />
      ))}
      {[season.rise, season.peak, season.fall].map((m, i) =>
        m ? <line key={i} x1={x(m.date)} x2={x(m.date)} y1={2} y2={H - 2} stroke={SEASON_INK} strokeDasharray="2 2" /> : null
      )}
      <polyline
        points={obs.map((o) => `${x(o.date)},${y(o.ndvi)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        className="text-foreground"
      />
      {obs.map((o) => (
        <circle key={o.date} cx={x(o.date)} cy={y(o.ndvi)} r={1.6} className="fill-foreground" />
      ))}
    </svg>
  )
}

function SeasonReading({ season }: { season: Season | null }) {
  if (!season) return <Note>The run has fewer than four clear dates, too few to draw a season through.</Note>
  return (
    <div className="flex flex-col gap-1">
      <Figure label="Rise" value={markText(season.rise)} />
      <Figure label="Peak" value={markText(season.peak)} />
      <Figure label="Fall" value={markText(season.fall)} />
      {season.lengthDays != null && <Figure label="Rise to fall" value={`${season.lengthDays} days`} />}
      <SeriesChart season={season} />
    </div>
  )
}

/** Every field's season on one time axis, earliest rise first. */
function SeasonChart({ rows }: { rows: { name: string; season: Season | null }[] }) {
  const placed = rows
    .filter((r): r is { name: string; season: Season & { rise: SeasonMark; fall: SeasonMark } } => !!r.season?.rise && !!r.season?.fall)
    .sort((a, b) => a.season.rise.date.localeCompare(b.season.rise.date))
  const missing = rows.length - placed.length
  if (!placed.length) return <Note>No field has a season to place.</Note>
  const t0 = Math.min(...placed.map((r) => at(r.season.rise.from)))
  const t1 = Math.max(...placed.map((r) => at(r.season.fall.to)))
  const W = 316
  const LABEL = 64
  const ROW = 12
  const TOP = 14
  const H = TOP + placed.length * ROW + 2
  const x = (d: string) => LABEL + ((at(d) - t0) / Math.max(1, t1 - t0)) * (W - LABEL - 4)
  const months: string[] = []
  for (let d = new Date(t0); d.getTime() <= t1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10)
    if (at(first) >= t0) months.push(first)
  }
  const rise = median(placed.map((r) => at(r.season.rise.date)))
  const fall = median(placed.map((r) => at(r.season.fall.date)))
  const iso = (t: number | null) => (t == null ? "" : new Date(t).toISOString().slice(0, 10))
  const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
  const rises = placed.map((r) => at(r.season.rise.date))
  const iqr = Math.round((q(rises, 0.75) - q(rises, 0.25)) / 86_400_000)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="panel-scroll max-h-[18rem] overflow-y-auto">
        <svg width={W} height={H} role="img" aria-label="Season of every field" className="block">
          {months.map((m) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={TOP - 2} y2={H} stroke="rgb(var(--p-line) / 0.35)" />
              <text x={x(m) + 2} y={9} className="fill-muted-foreground" style={{ fontSize: 8 }}>
                {shortDate(m).slice(3)}
              </text>
            </g>
          ))}
          {placed.map((r, i) => {
            const cy = TOP + i * ROW + ROW / 2
            const s = r.season
            return (
              <g key={r.name}>
                <text x={0} y={cy + 3} className="fill-foreground" style={{ fontSize: 8 }}>
                  {r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name}
                </text>
                <line x1={x(s.rise.from)} x2={x(s.rise.to)} y1={cy} y2={cy} stroke={SEASON_INK} strokeWidth={1} />
                <line x1={x(s.fall.from)} x2={x(s.fall.to)} y1={cy} y2={cy} stroke={SEASON_INK} strokeWidth={1} />
                <rect x={x(s.rise.date)} y={cy - 2.5} width={Math.max(1, x(s.fall.date) - x(s.rise.date))} height={5} fill={SEASON_INK} opacity={0.75} />
                {s.peak && <circle cx={x(s.peak.date)} cy={cy} r={2} className="fill-foreground" />}
              </g>
            )
          })}
        </svg>
      </div>
      <Figure label="Median rise" value={shortDate(iso(rise))} />
      <Figure label="Median fall" value={shortDate(iso(fall))} />
      <Figure label="Rise, middle half of fields" value={`within ${iqr} days`} />
      {missing > 0 && <Note>{missing} without a season: fewer than four clear dates.</Note>}
    </div>
  )
}

export function SeasonCard({
  focused,
  fields,
}: {
  focused: SeasonValue | null
  fields: { name: string; season: Season | null }[] | null
}) {
  const [all, setAll] = useState(true)
  return (
    <div className="flex flex-col gap-1.5">
      {fields && <Scope count={fields.length} all={all} onAll={setAll} />}
      {fields && all ? <SeasonChart rows={fields} /> : <SeasonReading season={focused?.season ?? null} />}
      <Note>
        NDVI rises at emergence, some days after sowing, and falls at senescence, before harvest. Each date lies
        between the two clear observations beside it.
      </Note>
    </div>
  )
}

/* ---- Vegetation health -------------------------------------------------- */

/** A departure as a bar either side of zero, clamped at four standard deviations. */
function ZRow({ name, z, text }: { name: string; z: number | null; text: string }) {
  const CLAMP = 4
  const f = z == null ? 0 : Math.max(-CLAMP, Math.min(CLAMP, z)) / CLAMP
  return (
    <div className="contents">
      <span className="truncate text-foreground" title={name}>
        {name}
      </span>
      <span className="relative h-1.5 rounded-full" style={{ background: "rgb(var(--p-line) / 0.25)" }}>
        <span className="absolute inset-y-[-2px] left-1/2 w-px" style={{ background: "rgb(var(--p-line) / 0.6)" }} />
        {z != null && (
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              left: f < 0 ? `${50 + f * 50}%` : "50%",
              width: `${Math.abs(f) * 50}%`,
              background: z < 0 ? BELOW : ABOVE,
            }}
          />
        )}
      </span>
      <span className="telemetry text-right text-muted-foreground">{text}</span>
    </div>
  )
}

function HealthChart({ report }: { report: HealthValue["report"] }) {
  const pts = report.anomaly
  if (pts.length < 2) return null
  const W = 288
  const H = 84
  const t0 = at(pts[0].date)
  const t1 = at(pts[pts.length - 1].date)
  const x = (d: string) => 4 + ((at(d) - t0) / Math.max(1, t1 - t0)) * (W - 8)
  const y = (v: number) => H - 6 - Math.max(0, Math.min(1, v)) * (H - 12)
  const ref = pts.filter((p) => p.ndvi_mean != null)
  const upper = ref.map((p) => `${x(p.date)},${y((p.ndvi_mean ?? 0) + (p.ndvi_sd ?? 0))}`)
  const lower = [...ref].reverse().map((p) => `${x(p.date)},${y((p.ndvi_mean ?? 0) - (p.ndvi_sd ?? 0))}`)
  return (
    <svg width={W} height={H} role="img" aria-label="NDVI this season against earlier seasons" className="block">
      {ref.length > 1 && <polygon points={[...upper, ...lower].join(" ")} fill={ABOVE} opacity={0.18} />}
      {ref.length > 1 && (
        <polyline points={ref.map((p) => `${x(p.date)},${y(p.ndvi_mean ?? 0)}`).join(" ")} fill="none" stroke={ABOVE} strokeDasharray="3 2" />
      )}
      <polyline points={pts.map((p) => `${x(p.date)},${y(p.ndvi)}`).join(" ")} fill="none" strokeWidth={1.25} className="stroke-foreground" />
      {pts.map((p) => (
        <circle
          key={p.date}
          cx={x(p.date)}
          cy={y(p.ndvi)}
          r={1.8}
          fill={p.ndvi_z != null && p.ndvi_z <= -1 ? BELOW : undefined}
          className={p.ndvi_z != null && p.ndvi_z <= -1 ? undefined : "fill-foreground"}
        />
      ))}
    </svg>
  )
}

function HealthReading({ report }: { report: HealthValue["report"] | null }) {
  if (!report) return null
  const l = report.latest
  const years = report.baseline_years.length ? report.baseline_years.join(", ") : "none returned a clear date"
  return (
    <div className="flex flex-col gap-1">
      {l ? (
        <>
          <Figure
            label={`NDVI, ${shortDate(l.date)}`}
            value={`${l.ndvi.toFixed(2)} · ${l.ndvi_z != null ? `${signed(l.ndvi_z)} sd, ${band(l.ndvi_z)}` : "no spread"}`}
          />
          <Figure
            label="NDRE"
            value={`${l.ndre.toFixed(2)} · ${l.ndre_z != null ? `${signed(l.ndre_z)} sd, ${band(l.ndre_z)}` : "no spread"}`}
          />
          <Figure label="Against" value={`${l.baseline_n} earlier dates within ${report.window_days} d`} />
        </>
      ) : (
        <Note>No earlier season has two clear dates near these: there is nothing to measure a departure against.</Note>
      )}
      <Figure label="Earlier seasons" value={years} />
      <HealthChart report={report} />
    </div>
  )
}

export function HealthCard({
  reference,
  onReference,
  focused,
  fields,
}: {
  reference: HealthReference
  onReference: (r: HealthReference) => void
  focused: HealthValue | null
  fields: { id: string; name: string; health: HealthValue | null; crop: string | null }[] | null
}) {
  const [all, setAll] = useState(true)
  const neighbours = useMemo(() => {
    if (!fields || reference !== "neighbours") return null
    return neighbourScores(
      fields
        .filter((f): f is typeof f & { health: HealthValue } => !!f.health)
        .map((f) => ({ fieldId: f.id, fieldName: f.name, report: f.health.report, crop: f.crop }))
    )
  }, [fields, reference])

  const list = () => {
    if (!fields) return null
    if (reference === "neighbours" && neighbours) {
      const rows = [...neighbours.scores].sort((a, b) => (a.z ?? Infinity) - (b.z ?? Infinity))
      const groups = [...new Set(neighbours.scores.map((s) => s.group))]
      return (
        <>
          <Figure label="Compared on" value={neighbours.date ? shortDate(neighbours.date) : "no date the fields share"} />
          <Figure label="Within" value={groups.length === 1 && groups[0] === "all" ? "all fields" : groups.join(", ")} />
          <div className="panel-scroll grid max-h-[16rem] grid-cols-[minmax(0,5rem)_minmax(0,1fr)_3rem] items-center gap-x-2 gap-y-1 overflow-y-auto text-meta">
            {rows.map((s) => (
              <ZRow key={s.fieldId} name={s.fieldName} z={s.z} text={s.z != null ? signed(s.z) : s.ndvi == null ? "no date" : "too few"} />
            ))}
          </div>
        </>
      )
    }
    const rows = fields
      .map((f) => ({ f, z: f.health?.report.latest?.ndvi_z ?? null }))
      .sort((a, b) => (a.z ?? Infinity) - (b.z ?? Infinity))
    return (
      <div className="panel-scroll grid max-h-[16rem] grid-cols-[minmax(0,5rem)_minmax(0,1fr)_3rem] items-center gap-x-2 gap-y-1 overflow-y-auto text-meta">
        {rows.map(({ f, z }) => (
          <ZRow key={f.id} name={f.name} z={z} text={z != null ? signed(z) : f.health ? "no spread" : "no run"} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="mr-auto text-meta text-muted-foreground">Against</span>
        <Choice label="Earlier seasons" chosen={reference === "history"} onPick={() => onReference("history")} />
        <Choice
          label="Other fields"
          chosen={reference === "neighbours"}
          onPick={() => onReference("neighbours")}
        />
      </div>
      {fields && <Scope count={fields.length} all={all} onAll={setAll} />}
      {fields && all ? list() : <HealthReading report={focused?.report ?? null} />}
      {reference === "neighbours" && !fields && (
        <Note>Other fields are compared under a field set: choose "Every field of an area" on the Run node.</Note>
      )}
      <Note>A departure is not a diagnosis: a later sowing, another crop or a fallow field departs as a stressed one does.</Note>
    </div>
  )
}

/* ---- Field table ---------------------------------------------------------- */

/**
 * How many registers other than CAR a row's field meets; "?" where one was not
 * read. PRODES counts once, and only for clearing after 22 Jul 2008.
 */
function registersMet(r: FieldRow): string {
  const o = r.overlap
  if (!o) return ""
  const prodes = [o.prodes2009to2020, o.prodes2021, o.prodesFrom2022]
  const ha = [
    prodes.some((x) => x == null) ? null : prodes.reduce<number>((s, x) => s + (x ?? 0), 0),
    o.deter,
    o.embargoIbama,
    o.embargoIcmbio,
    o.indigenous,
    o.conservation,
  ]
  const met = ha.filter((x) => x != null && x > 0).length
  return o.unread.length ? `${met}?` : String(met)
}

function registersTitle(r: FieldRow): string {
  const o = r.overlap
  if (!o) return ""
  return o.unread.length ? `Not read: ${o.unread.join(", ")}` : `Read ${o.readAt}`
}

export function FieldTableCard({
  rows,
  missing,
  onExport,
}: {
  rows: FieldRow[]
  /** The inputs not linked, named, so an empty column says why. */
  missing: string[]
  onExport: () => void
}) {
  const unit = rows.some((r) => r.classes && r.unit === "px") ? "px" : "ha"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="panel-scroll max-h-[18rem] overflow-auto">
        <table className="w-full border-collapse text-meta">
          <thead>
            <tr className="text-micro text-muted-foreground">
              <th className="px-1 text-left font-normal">Field</th>
              <th className="px-1 text-left font-normal">Mostly</th>
              <th className="px-1 text-right font-normal">{unit}</th>
              <th className="px-1 text-right font-normal">Rise</th>
              <th className="px-1 text-right font-normal">Fall</th>
              <th className="px-1 text-right font-normal">NDVI z</th>
              <th
                className="px-1 text-right font-normal"
                title="Public registers the field meets, CAR aside; the CSV carries the hectares of each"
              >
                Reg.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = dominant(r)
              const total = classifiedTotal(r)
              const z = r.health?.ndviZ
              return (
                <tr key={r.field} className="border-t" style={{ borderColor: "rgb(var(--p-line) / 0.2)" }}>
                  <td className="max-w-[5rem] truncate px-1 text-foreground" title={r.field}>
                    {r.field}
                  </td>
                  <td className="px-1">
                    {d ? (
                      <span className="flex min-w-0 items-center gap-1" title={`${d.name}, ${Math.round(d.share * 100)}%`}>
                        <Swatch color={r.classes![0].color} />
                        <span className="telemetry text-muted-foreground">{Math.round(d.share * 100)}%</span>
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="telemetry px-1 text-right text-foreground">
                    {total == null ? "" : unit === "ha" ? total.toFixed(1) : Math.round(total)}
                  </td>
                  <td className="telemetry px-1 text-right text-muted-foreground">
                    {r.season?.rise ? shortDate(r.season.rise.date) : ""}
                  </td>
                  <td className="telemetry px-1 text-right text-muted-foreground">
                    {r.season?.fall ? shortDate(r.season.fall.date) : ""}
                  </td>
                  <td className="telemetry px-1 text-right" style={{ color: z != null && z <= -1 ? BELOW : undefined }}>
                    {z != null ? signed(z) : ""}
                  </td>
                  <td className="telemetry px-1 text-right text-muted-foreground" title={registersTitle(r)}>
                    {registersMet(r)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && <Note>Link {missing.join(", ")} to fill {missing.length === 1 ? "its column" : "their columns"}.</Note>}
      <ActionButton
        label={`CSV, ${rows.length} ${rows.length === 1 ? "field" : "fields"}`}
        icon={<DownloadSimple className="size-3.5" />}
        disabled={!rows.length}
        onClick={onExport}
      />
    </div>
  )
}
