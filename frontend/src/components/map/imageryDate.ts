/**
 * What the Esri imagery under a point is: when it was taken, and how deep it
 * goes there.
 *
 * BOTH VARY BY FOOTPRINT, WHICH IS THE FACT THIS MODULE EXISTS TO CARRY.
 * World Imagery is not one product with one date and one resolution: over Sao
 * Paulo it reads to z20 on a 2025 acquisition, over Teresina to z18 on a 2024
 * one, over Jose de Freitas it stops at z17 on a 2026 one. The service states
 * both per footprint, in the same reply, and a surface that reports only the
 * date leaves the reader to discover the ceiling by turning the wheel against
 * a picture that has stopped changing.
 *
 * ITS OWN MODULE BECAUSE THE RULE IS THE PART THAT WAS WRONG. The selection
 * sat inside the fetch, in a component that cannot be mounted without a GL
 * context, so the one piece of logic capable of stating something false about
 * the imagery was the one piece nothing could test. Split here, `pickHere` is
 * a pure function over the reply and carries the whole decision; the fetch
 * above it only asks the question.
 */

import { tileLevel } from "@/lib/mapScale"

/** Esri gives dates as YYYYMMDD or M/D/YYYY; ISO is what the credit shows. */
function formatYmd(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }
  return ymd
}

export function normalizeImageryDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d{8}$/.test(trimmed)) return formatYmd(trimmed)
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
  return trimmed
}

function dateSortKey(raw: string): string {
  const n = normalizeImageryDate(raw)
  return n ? n.replace(/-/g, "") : ""
}

/**
 * Whether a footprint states a date at all.
 *
 * THE SERVICE WRITES THE WORD "Null" WHERE IT HAS NONE -- it is how TerraColor,
 * the 15 m mosaic drawn below level 12, reports its own SRC_DATE. Taken as
 * text it is truthy, and the credit line would read "imagery Null".
 */
function stated(raw: string): boolean {
  const t = raw.trim()
  return t !== "" && !/^null$/i.test(t)
}

/**
 * One footprint from the identify reply: when its imagery was taken, and the
 * levels it is drawn at.
 */
export interface ImageryFootprint {
  date: string
  min: number
  max: number
}

/** What can be said about the imagery under one point at one zoom. */
export interface ImageryHere {
  /** The newest acquisition among those drawn here, where one is stated. */
  date: string | null
  /**
   * The deepest level anything here has.
   *
   * THE ANSWER TO "why does it stop sharpening". World Imagery is a mosaic
   * whose resolution varies by footprint as much as its date does: one town
   * reads to z20 on a 2025 acquisition, the next stops at z17 on a 2026 one.
   * The service states the ceiling per footprint, so the surface can say where
   * the imagery ends here instead of leaving a reader to find it by turning
   * the wheel against a picture that no longer changes.
   */
  maxLevel: number | null
  /** The view is past that ceiling: what is on screen is being magnified. */
  magnified: boolean
}

const NOTHING: ImageryHere = { date: null, maxLevel: null, magnified: false }

/**
 * What is known about the imagery drawn under this point at this zoom.
 *
 * ONLY FOOTPRINTS THAT COVER THE LEVEL DECIDE THE DATE. This fell back to the
 * whole reply when none of them did, and reported its newest date. Below z12
 * none of them ever does: every high-resolution footprint Esri returns begins
 * at MinMapLevel 12, while the picture drawn under that level is the 15 m
 * TerraColor mosaic, to which the service itself gives a null SRC_DATE. So the
 * credit named a 2025 acquisition over imagery of no stated year -- it was
 * furthest from the truth exactly where the imagery is oldest.
 *
 * IN LEVELS, NOT IN ZOOMS. Every number here is one of the service's own --
 * MinMapLevel, MaxMapLevel, and the level the caller is actually fetching,
 * which is not the map's zoom. lib/mapScale.ts holds that conversion and the
 * measurement behind it; comparing a zoom to these directly reads every limit
 * one level too high.
 *
 * PAST THE CEILING IS NOT THE SAME AS BELOW THE FLOOR. Above the deepest level
 * anything here has, the picture is the deepest footprint magnified, and its
 * date is still the date of what is on screen; the reading that is unknown is
 * the one below the floor, where the covering imagery is a mosaic the service
 * dates as null.
 */
export function pickHere(
  footprints: readonly ImageryFootprint[],
  level: number
): ImageryHere {
  if (!footprints.length) return NOTHING
  const floor = Math.min(...footprints.map((f) => f.min))
  if (level < floor) return NOTHING
  const ceiling = Math.max(...footprints.map((f) => f.max))
  const drawn =
    level <= ceiling
      ? footprints.filter((f) => level >= f.min && level <= f.max)
      : footprints.filter((f) => f.max === ceiling)
  // Newest first: a level is often covered by several acquisitions, and the
  // one on top is the last one delivered.
  const newest = drawn
    .filter((f) => stated(f.date))
    .sort((a, b) => dateSortKey(b.date).localeCompare(dateSortKey(a.date)))[0]
  return {
    date: newest ? normalizeImageryDate(newest.date) : null,
    maxLevel: ceiling,
    magnified: level > ceiling,
  }
}

/** Esri World Imagery identify, for what is drawn under the centre. */
export async function fetchEsriImageryHere(
  lat: number,
  lon: number,
  zoom: number,
  signal?: AbortSignal
): Promise<ImageryHere> {
  const level = tileLevel(zoom)
  const pad = Math.max(0.02, 180 / 2 ** Math.max(zoom, 1))
  const params = new URLSearchParams({
    f: "json",
    tolerance: "5",
    returnGeometry: "false",
    imageDisplay: "800,600,96",
    geometry: JSON.stringify({ x: lon, y: lat }),
    geometryType: "esriGeometryPoint",
    sr: "4326",
    mapExtent: `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`,
    layers: "top:0",
  })
  const res = await fetch(
    `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?${params}`,
    { signal }
  )
  if (!res.ok) return NOTHING
  const data = (await res.json()) as {
    results?: Array<{ attributes?: Record<string, string> }>
  }
  const footprints = (data.results ?? []).map((r) => {
    const a = r.attributes ?? {}
    return {
      date: a["DATE (YYYYMMDD)"] || a.SRC_DATE2 || "",
      min: Number(a.MinMapLevel ?? 0),
      max: Number(a.MaxMapLevel ?? 22),
    }
  })
  return pickHere(footprints, level)
}
