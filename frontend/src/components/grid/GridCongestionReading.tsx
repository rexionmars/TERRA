/**
 * The network an area could reach, and what it is already joined to.
 *
 * ATTACHMENT FIRST, PROXIMITY SECOND, AND THEY ARE NOT THE SAME CLAIM. Where a
 * plant joins the network is published; how far the nearest bus is, is
 * measured. At the first site anyone checked the two disagree by a voltage
 * level -- Sol do Cerrado's array is 9.01 km from a station named JAIBA, and
 * "nearest substation" answers JAIBA 500 kV because ONS publishes that
 * station's 500, 230 and 138 kV buses at one coordinate. The plant is wired to
 * MGJAB-230-A. Every headroom figure taken from the 500 is about the wrong
 * circuit.
 *
 * So attachment leads where there is one, and proximity is what ground with no
 * plant has instead.
 *
 * OCCUPANCY AND CURTAILMENT SIT APART AND ARE NEVER SUMMED. The measurement
 * says why: across the 29 connection points where both are known their
 * correlation is -0.025. Barreiras II carries 350 MW on 3,475 MVA of line --
 * ten percent -- and the plants there lose 37 percent of their output, because
 * the binding constraint is upstream of the bus. A panel that combined them
 * into a score would assert a relationship the record does not contain.
 */
import { Chip, Stat, StatGrid, WaterFigure } from "@/components/analysisPrimitives"
import type { GridCongestionAnalysis } from "@/lib/types"

const km = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toFixed(1)} km`
const mw = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString()} MW`
const kv = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(v)} kV`

export function GridCongestionReading({
  result,
}: {
  result: GridCongestionAnalysis | null
}) {
  if (!result) {
    return (
      <div className="p-3 text-meta text-muted-foreground">
        No network read yet. Draw an area, choose Connection in the run graph,
        and read the record.
      </div>
    )
  }
  const c = result.connection
  if (!c.reachable && c.attachment.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className="text-body leading-relaxed text-foreground">{c.note}</p>
      </div>
    )
  }

  const joined = c.attachment
  const headroom = c.attached_bus_headroom

  return (
    <div className="panel-scroll flex flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">
          {joined.length
            ? "attached"
            : (c.neighbours?.length ?? 0) > 0
              ? "neighbours"
              : "proximity"}
        </Chip>
        <span className="text-meta text-muted-foreground">
          searched {c.searched_km.toFixed(0)} km
        </span>
      </div>

      {joined.length === 0 && (c.neighbours?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">Where the neighbours are joined</div>
          {c.neighbours.map((n) => (
            <WaterFigure
              key={`${n.id_ons}:${n.point_code}`}
              dense
              label={`${n.entity} · ${km(n.distance_km)}`}
              value={n.point_code}
              sub={`${n.substation ?? "—"} · ${kv(n.voltage_kv)} · ${mw(n.capacity_mw)}`}
            />
          ))}
          {c.neighbour_bus_headroom?.map((h) => (
            <StatGrid key={`nb-${h.bus}`} at="pair">
              <Stat
                label={`Bus ${h.bus} · ${h.lines_in_service} circuits`}
                value={
                  h.line_capacity_mva === null
                    ? "rating not published"
                    : `${Math.round(h.line_capacity_mva).toLocaleString()} MVA`
                }
              />
              <Stat
                label={`Attached · ${h.units_attached} units`}
                value={mw(h.attached_mw)}
              />
            </StatGrid>
          ))}
          {/*
            THE SENTENCE THAT KEEPS THIS FROM BEING READ AS A GRANT. No plant
            of the record stands on this ground, so nothing here is published
            about it. What is published is where its neighbours enter the
            network -- and whether a project here would be allowed to join them
            is an access opinion the operator issues and does not publish at
            all.
          */}
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            No plant of the record stands on this ground, so none of this is
            published about it. These are the points the plants nearby enter
            the network at: a project here would be asking to join the same
            part of the system, and would inherit what it does to them.
            Whether it would be allowed to is an access opinion, which the
            operator issues and does not publish.
          </p>
        </div>
      )}

      {joined.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">Where this ground is joined</div>
          {joined.map((a) => (
            <div key={`${a.id_ons}:${a.point_code}`} className="flex flex-col gap-0.5">
              <WaterFigure
                label={a.entity}
                value={a.point_code}
                sub={`${a.substation ?? "—"} · ${kv(a.voltage_kv)} · ${mw(a.capacity_mw)}`}
              />
              {/*
                Said only when it is NOT confirmed, because the confirmed case
                is the expectation and a badge on 221 of 223 rows is noise. The
                two that are not were resolved by distance alone and may name
                the wrong voltage level of the right station.
              */}
              {!a.voltage_confirmed && (
                <p className="text-meta leading-relaxed text-muted-foreground">
                  The bus was matched by position alone; its voltage is not
                  confirmed by the connection code, so this may be the wrong
                  level of the right station.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {headroom.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">What leaves that bus</div>
          {headroom.map((h) => (
            <StatGrid key={h.bus} at="pair">
              <Stat
                label={`Line capacity · ${h.lines_in_service} circuits`}
                value={
                  h.line_capacity_mva === null
                    ? "not published"
                    : `${Math.round(h.line_capacity_mva).toLocaleString()} MVA`
                }
              />
              <Stat
                label={`Attached · ${h.units_attached} units`}
                value={mw(h.attached_mw)}
              />
            </StatGrid>
          ))}
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            {headroom[0].note}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="eyebrow">
          {joined.length ? "Also within reach" : "Nearest on the register"}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <WaterFigure
            dense
            label="Nearest substation"
            value={km(c.nearest_substation?.distance_km)}
            sub={
              c.nearest_substation
                ? `${c.nearest_substation.name} · ${kv(c.nearest_substation.voltage_kv)}`
                : undefined
            }
          />
          <WaterFigure
            dense
            label="Nearest line"
            value={km(c.nearest_line?.distance_km)}
            sub={
              c.nearest_line
                ? `${kv(c.nearest_line.voltage_kv)} · ${
                    c.nearest_line.capacity_mva == null
                      ? "rating not published"
                      : `${c.nearest_line.capacity_mva} MVA`
                  }`
                : undefined
            }
          />
        </div>
        {/*
          The route factor beside the distances rather than under them, because
          it corrects them. ONS publishes a circuit's terminals and its length
          and never its path, so a distance to a line is to the straight
          segment and is short by this much.
        */}
        <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
          {c.route_factor.note} Median ×{c.route_factor.median.toFixed(3)}, p90
          ×{c.route_factor.p90.toFixed(3)}. A rating is published for{" "}
          {Math.round(c.capacity_published_fraction * 100)}% of circuits, so a
          missing one is unpublished rather than zero.
        </p>
      </div>

      <p className="text-meta leading-relaxed text-muted-foreground">
        {result.note}
      </p>
    </div>
  )
}
