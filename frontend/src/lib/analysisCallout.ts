/**
 * A reading, as something that can be put on the map.
 *
 * WHY A PANEL IS NOT ENOUGH, and it is a counting argument rather than a taste
 * one. Every product this application gains arrives with a reading, and a
 * reading that can only be seen in a panel needs a panel of its own: the board
 * divides into a fixed number of regions, and the fourth analysis is the one
 * there is no room for. The tree beside it has no such limit -- it lists
 * rasters in the dozens already -- so a reading that can be an entry there is a
 * reading the board does not have to make room for.
 *
 * THE SAME FORM THE RASTERS ALREADY USE. lib/layerLegend.ts turns a raster into
 * a legend and components/globe/OverlayCallout.tsx ties that legend to the
 * ground it measures. A reading over an AOI is the same shape of thing --
 * figures about a piece of ground -- so it becomes the same `stats` legend and
 * hangs off the same leader. Nothing new is invented for it, which is also what
 * keeps the two from drifting apart on screen.
 *
 * FIGURES, NOT PROSE. A callout is small and a reading's panel is not; what
 * survives the cut is the numbers the reading leads with, and the sentences
 * that qualify them stay in the panel where there is room to read them. The one
 * exception is a caveat that changes what a number MEANS, which travels as the
 * legend's note -- a figure whose qualification was left behind is worse on a
 * map than in a table, because a map invites being read at a glance.
 */
import type { LayerLegend } from "@/lib/layerLegend"
import type {
  GridCongestionAnalysis,
  GridCurtailmentAnalysis,
} from "@/lib/types"

/** One reading that can be listed, and put on the map. */
export interface AnalysisEntry {
  /** Stable across renders and unique within an area: the tree keys on it. */
  id: string
  title: string
  /** The one line under the title in the tree: what it read and over what. */
  params: string
  legend: NonNullable<LayerLegend>
}

const mwh = (v: number) => `${Math.round(v).toLocaleString()} MWh`
const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`

/**
 * The curtailment reading as an entry, or null where there is nothing to show.
 *
 * THE DESCENT IS WHAT TRAVELS, because it is what the panel leads with and for
 * the same reason: the withheld fraction is the largest number the reading
 * holds and the least usable, and the two subtractions that make it usable are
 * what a siting decision acts on. A callout carrying only the headline would
 * put the misleading number on the map and leave its corrections in a panel.
 *
 * AN AOI WITH NO METERED PLANT STILL GETS AN ENTRY, and it says so. That is a
 * real answer about this ground -- the record does not cover it -- and dropping
 * it from the list would make an unanswerable area look like one that was never
 * asked about.
 */
export function curtailmentEntry(
  result: GridCurtailmentAnalysis | null | undefined
): AnalysisEntry | null {
  if (!result) return null
  const window = result.window.used.join(" .. ")
  const s = result.summary
  if (!s) {
    return {
      id: "grid:curtailment",
      title: "Curtailment",
      params: `no metered plant · ${window}`,
      legend: {
        kind: "note",
        subject: "Curtailment",
        note:
          result.note ??
          "No plant of the operational record lies inside this area. That is " +
            "an absence of measurement, not a curtailment of zero.",
      },
    }
  }

  const shareLocal = result.by_reason?.share_local ?? null
  const localMwh =
    shareLocal === null ? null : s.withheld_under_restriction_mwh * shareLocal
  const actionable =
    localMwh === null || !s.expected_mwh ? null : localMwh / s.expected_mwh

  return {
    id: "grid:curtailment",
    title: "Curtailment",
    params: `${s.plants_in_aoi} metered · ${window}`,
    legend: {
      kind: "stats",
      subject: "Curtailment · local share",
      /*
        Led by the actionable figure, then the two steps that produced it.
        Against EXPECTED output throughout and never against withheld: the
        free-hours gap is two-sided, and over one area of Piaui it runs
        -264,818 MWh, which would make a "share of withheld" read 157 percent.
      */
      rows: [
        { label: "Local", value: pct(actionable) },
        {
          label: "Under restriction",
          value: pct(
            s.expected_mwh
              ? s.withheld_under_restriction_mwh / s.expected_mwh
              : null
          ),
        },
        { label: "Withheld, net", value: pct(s.withheld_fraction) },
        { label: "Expected", value: mwh(s.expected_mwh) },
      ],
      /*
        The floor travels, because it is what decides whether the figures above
        it are curtailment at all. It varies by place far more than by time --
        a standard deviation of 15.3 points across sites against 7.6 across
        months -- so it cannot be stated once and assumed.
      */
      note: `Floor when free ${pct(s.unrestricted_baseline_fraction)}: the operator's own estimate error at these plants over half hours with no restriction in force. Only the local share is a number a decision about this ground can act on.`,
    },
  }
}


/**
 * The connection reading as an entry, or null where there is nothing to show.
 *
 * ATTACHMENT AND PROXIMITY ARE DIFFERENT SUBJECTS, so the entry says which one
 * it is carrying rather than presenting both under one heading. Where a plant
 * of this ground is joined, the bus is published and the figures are about it;
 * where none is, what remains is a distance to a register, and a callout that
 * blurred the two would put the weaker claim on a map under the stronger one's
 * name.
 *
 * THE OCCUPANCY CAVEAT TRAVELS. Line capacity against attached megawatts looks
 * like headroom and is not: across the 29 points where both are known its
 * correlation with the curtailment actually suffered is -0.025. On a map, two
 * numbers side by side are read as a ratio unless something says otherwise.
 */
export function congestionEntry(
  result: GridCongestionAnalysis | null | undefined
): AnalysisEntry | null {
  if (!result) return null
  const c = result.connection
  const joined = c.attachment ?? []
  const km = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${v.toFixed(1)} km`

  if (joined.length === 0) {
    const s = c.nearest_substation
    const l = c.nearest_line
    if (!c.reachable) {
      return {
        id: "grid:connection",
        title: "Connection",
        params: `nothing within ${c.searched_km.toFixed(0)} km`,
        legend: { kind: "note", subject: "Connection", note: c.note },
      }
    }
    return {
      id: "grid:connection",
      title: "Connection",
      params: `no attachment · nearest ${km(s?.distance_km ?? l?.distance_km)}`,
      legend: {
        kind: "stats",
        subject: "Connection · proximity only",
        rows: [
          ...(s
            ? [
                { label: "Nearest bus", value: km(s.distance_km) },
                { label: "At", value: `${s.name} · ${s.voltage_kv ?? "?"} kV` },
              ]
            : []),
          ...(l
            ? [
                { label: "Nearest line", value: km(l.distance_km) },
                {
                  label: "Rating",
                  value:
                    l.capacity_mva == null
                      ? "not published"
                      : `${l.capacity_mva} MVA`,
                },
              ]
            : []),
        ],
        note:
          "No plant of the record stands here, so there is no published " +
          "attachment and this is a distance rather than a connection. " +
          "Line distances are to the straight segment between terminals; the " +
          `conductor runs about ${Math.round((c.route_factor.median - 1) * 100)}% longer at the median.`,
      },
    }
  }

  const a = joined[0]
  const h = c.attached_bus_headroom?.[0]
  return {
    id: "grid:connection",
    title: "Connection",
    params: `${a.point_code} · ${a.substation ?? "—"} ${a.voltage_kv ?? "?"} kV`,
    legend: {
      kind: "stats",
      subject: "Connection · attached",
      rows: [
        { label: "Point", value: a.point_code },
        {
          label: "Bus",
          value: `${a.substation ?? "—"} · ${a.voltage_kv ?? "?"} kV`,
        },
        {
          label: "This entity",
          value:
            a.capacity_mw == null
              ? "—"
              : `${Math.round(a.capacity_mw).toLocaleString()} MW`,
        },
        ...(h
          ? [
              {
                label: "Attached to the bus",
                value:
                  h.attached_mw == null
                    ? "—"
                    : `${Math.round(h.attached_mw).toLocaleString()} MW`,
              },
              {
                label: `Line capacity · ${h.lines_in_service} circuits`,
                value:
                  h.line_capacity_mva == null
                    ? "not published"
                    : `${Math.round(h.line_capacity_mva).toLocaleString()} MVA`,
              },
            ]
          : []),
      ],
      note: a.voltage_confirmed
        ? "Published by the operator, not inferred from distance: a station's " +
          "voltages share one coordinate, so the nearest bus can be the wrong " +
          "level of the right station. Capacity and attachment are not a " +
          "headroom ratio — their correlation with the curtailment actually " +
          "suffered is -0.025."
        : "The bus was matched by position alone; its voltage is not confirmed " +
          "by the connection code, so this may be the wrong level of the " +
          "right station.",
    },
  }
}

/** Every reading held for one area, in the order the tree lists them. */
export function analysisEntries(sources: {
  curtailment?: GridCurtailmentAnalysis | null
  congestion?: GridCongestionAnalysis | null
}): AnalysisEntry[] {
  return [
    curtailmentEntry(sources.curtailment),
    congestionEntry(sources.congestion),
  ].filter((e): e is AnalysisEntry => e !== null)
}
