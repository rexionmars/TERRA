/**
 * One analysis of the published research series, drawn at this interface's
 * scale.
 *
 * THE FINDING FIRST, THEN WHAT RETIRES IT. Four of the twelve correct an
 * earlier one, and the series' own value is largely in those corrections: a
 * reader shown Fig. 10 without Fig. 12 is reading a result demoted to one
 * robustness test in three. `supersedes` is therefore drawn above the figure
 * rather than in a footnote, and the caveats are drawn at all.
 *
 * The panels are per figure and are chosen by number, because the panels ARE
 * the figure — a generic table renderer over the same payload would say what
 * was measured and not what it means.
 */
import { useRef } from "react"

import { Chip, Stat, WaterFigure } from "@/components/analysisPrimitives"
import { LineFigure, ScatterMap } from "@/components/grid/figurePrimitives"
import { useFigureWidth } from "@/lib/useFigureSize"
import type { GridFigureAnalysis, GridFigureTable } from "@/lib/types"

/** A payload table as rows of objects, keyed by its own column names. */
function rows(t: GridFigureTable | undefined): Record<string, never>[] {
  if (!t) return []
  return t.rows.map(
    (r) =>
      Object.fromEntries(t.columns.map((c, i) => [c, r[i]])) as Record<
        string,
        never
      >
  )
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : NaN

const mw = (v: number) => `${Math.round(v).toLocaleString()}`
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`

/**
 * The red ramp the published figure uses, sampled rather than interpolated.
 *
 * Four stops from the series' own palette. Taken from the paper because the
 * point of a ported figure is that a reader who knows the published one
 * recognises this — the type scale is this interface's, the colour is the
 * research's.
 */
const RED = ["#FFFFFF", "#F6CFCB", "#E9A6A1", "#B64342"]
function redAt(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RED.length - 1)
  return RED[Math.round(x)]
}

function Figure1({ result }: { result: GridFigureAnalysis }) {
  /*
    The panel measures itself and the figure derives its height from that
    width. Never both: useFigureSize.ts records what happened when a figure was
    given the height of the box it fills -- the height it produced became the
    height next measured, and the spectral figure grew without bound.
  */
  const host = useRef<HTMLDivElement>(null)
  const width = useFigureWidth(host)
  const diurnal = rows(result.tables.diurnal)
  const monthly = rows(result.tables.monthly)
  const attribution = rows(result.tables.attribution)
  const plants = rows(result.tables.plants)
  const h = (result.headline ?? {}) as Record<string, number | string[]>

  const subsystems = [...new Set(monthly.map((r) => String(r.id_subsistema)))]
  const SUB_COLOR: Record<string, string> = {
    NE: "#B64342",
    SE: "#767676",
    S: "#3775BA",
    N: "#42949E",
  }
  const peakRate = Math.max(...plants.map((p) => num(p.taxa_corte)).filter(Number.isFinite), 0.0001)

  return (
    <div ref={host} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <WaterFigure
          dense
          label="Curtailment rate"
          value={pct(num(h.curtailment_rate), 1)}
          sub={`${h.curtailed_twh} TWh of ${h.generated_twh} generated`}
        />
        <WaterFigure
          dense
          label="Peak cut"
          value={`${mw(num(h.peak_cut_mw))} MW`}
          sub={`at ${String(h.peak_hour)}h · ${pct(num(h.peak_share_of_available), 0)} of what was available`}
        />
      </div>

      {width > 0 && (
        <>
          {/*
            (a) The diurnal profile, stacked so the upper bound is what the
            fleet COULD have delivered and the band between the two is the
            loss. Two independent areas would read as two unrelated quantities
            sharing an axis.
          */}
          <div className="flex flex-col gap-1">
            <div className="eyebrow">a · the solar window</div>
            <LineFigure
              width={width}
              height={150}
              stack
              xTitle="hour of the day"
              xFormat={(v) => `${String(Math.round(v)).padStart(2, "0")}h`}
              yFormat={(v) => mw(v)}
              series={[
                {
                  id: "ger",
                  label: "generated (MW)",
                  color: "#0F4D92",
                  points: diurnal.map((r) => [num(r.hora), num(r.geracao_mw)]),
                },
                {
                  id: "cut",
                  label: "withheld (MW)",
                  color: "#B64342",
                  points: diurnal.map((r) => [num(r.hora), num(r.corte_mw)]),
                },
              ]}
            />
          </div>

          {/* (b) monthly rate, one line per subsystem */}
          <div className="flex flex-col gap-1">
            <div className="eyebrow">b · monthly rate, by subsystem</div>
            <LineFigure
              width={width}
              height={130}
              xTitle="month"
              xFormat={(v) => {
                const r = monthly[Math.round(v)]
                return r ? String(r.period).slice(2) : ""
              }}
              yFormat={(v) => pct(v, 0)}
              series={subsystems.map((s) => {
                const seen = monthly.filter(
                  (r) => String(r.id_subsistema) === s
                )
                const periods = [...new Set(monthly.map((r) => String(r.period)))].sort()
                return {
                  id: s,
                  label: s,
                  color: SUB_COLOR[s] ?? "#767676",
                  points: periods.map((p) => {
                    const hit = seen.find((r) => String(r.period) === p)
                    return [periods.indexOf(p), hit ? num(hit.taxa) : null]
                  }),
                }
              })}
            />
          </div>
        </>
      )}

      {/*
        (c) Reason by origin. Bars rather than a chart, for the reason
        AgreementCharts states about its own: these are three magnitudes on one
        axis, which is a div and a width.
      */}
      <div className="flex flex-col gap-1">
        <div className="eyebrow">c · reason and origin, GWh</div>
        {attribution
          .slice()
          .sort((a, b) => num(b.SIS) + num(b.LOC) - num(a.SIS) - num(a.LOC))
          .map((r) => {
            const total = num(r.SIS) + num(r.LOC)
            const peak = Math.max(
              ...attribution.map((x) => num(x.SIS) + num(x.LOC))
            )
            return (
              <div key={String(r.cod_razaorestricao)} className="flex items-center gap-2">
                <span className="telemetry w-8 shrink-0 text-micro text-muted-foreground">
                  {String(r.cod_razaorestricao)}
                </span>
                <div className="flex h-3 min-w-0 flex-1 bg-sunk">
                  <div
                    className="h-full bg-accent/70"
                    style={{ width: `${(num(r.SIS) / peak) * 100}%` }}
                    title="systemic"
                  />
                  <div
                    className="h-full bg-accent/30"
                    style={{ width: `${(num(r.LOC) / peak) * 100}%` }}
                    title="local"
                  />
                </div>
                <span className="telemetry w-16 shrink-0 text-right text-micro text-foreground">
                  {mw(total)}
                </span>
              </div>
            )
          })}
        <p className="mt-1 text-meta text-muted-foreground">
          Darker is systemic, lighter is local. The energetic reason carries no
          local share at all — a zero that is the finding, not a gap.
        </p>
      </div>

      {/* (d) where the plants are, and how much each loses */}
      {width > 0 && plants.some((p) => Number.isFinite(num(p.lat))) && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">d · where, and how much</div>
          <ScatterMap
            width={width}
            height={Math.min(width, 300)}
            points={plants
              .filter((p) => Number.isFinite(num(p.lat)))
              .map((p) => ({
                lon: num(p.lon),
                lat: num(p.lat),
                size: num(p.cap_mw),
                value: num(p.taxa_corte) / peakRate,
              }))}
            colorOf={redAt}
          />
          <p className="mt-1 text-meta text-muted-foreground">
            Radius is installed capacity, colour is the cut rate. No state
            outlines: the published panel draws them as context, and the
            measurement is the points.
          </p>
        </div>
      )}
    </div>
  )
}

export function GridFigureReading({
  result,
}: {
  result: GridFigureAnalysis | null
}) {
  if (!result) {
    return (
      <div className="p-3 text-meta text-muted-foreground">
        No figure read yet. Choose one in the run graph and read it.
      </div>
    )
  }

  const integrity = (result.integrity ?? {}) as Record<string, number>
  return (
    <div className="panel-scroll flex flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="accent">Fig. {result.number}</Chip>
          <Chip>{result.scope}</Chip>
        </div>
        <p className="text-body leading-relaxed text-foreground">
          {result.title}
        </p>
      </div>

      {/*
        What retires this reading, above the figure and not below it. Four of
        the twelve correct an earlier one, and the series' own value is largely
        in those corrections.
      */}
      {result.supersedes.length > 0 && (
        <p className="text-meta leading-relaxed text-accent-quiet">
          Corrects or delimits Fig.{" "}
          {result.supersedes.map((n) => n).join(", ")}.
        </p>
      )}

      {result.number === 1 ? (
        <Figure1 result={result} />
      ) : (
        <p className="text-meta text-muted-foreground">
          Figure {result.number} has no panel yet.
        </p>
      )}

      {Object.keys(integrity).length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">Integrity</div>
          <Stat label="Rows read" value={Number(integrity.rows).toLocaleString()} />
          <Stat
            label="Carrying a restriction"
            value={`${Number(integrity.restricted).toLocaleString()} · ${pct(
              integrity.restricted / integrity.rows,
              1
            )}`}
          />
          <Stat
            label="Reference below verified"
            value={`${Number(
              integrity.reference_below_verified
            ).toLocaleString()} · clipped to zero`}
          />
        </div>
      )}

      {result.caveats.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">What this does not say</div>
          {result.caveats.map((c, i) => (
            <p key={i} className="text-meta leading-relaxed text-muted-foreground">
              {c}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
