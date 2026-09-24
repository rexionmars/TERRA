/**
 * Field boundaries: the two windows a delineation reads, the polygons it
 * returns, and the layers they are drawn as.
 *
 * The product itself is sidecar/terra/fields: an FTW network (Kerner et al.,
 * 2025; Muhawenayo et al., 2026) labels every 10 m cell as field interior,
 * boundary or neither from a scene near sowing and one near harvest, and each
 * connected interior region becomes a polygon. What is here is what the
 * interface needs of that: where the two windows come from, and how a result
 * is read and drawn.
 */
import type {
  FieldProperties,
  FieldsAnalysis,
  FieldsWindow,
  GeoJSONGeometry,
} from "@/lib/types"

/**
 * The two windows, taken from the period card: its first third and its last.
 *
 * WHY THE PERIOD AND NOT TWO CARDS OF THEIR OWN. The FTW checkpoints take one
 * scene near planting and one near harvest (ftw-baselines README, "Input
 * format"), and a season is what the period card already states. Over the
 * summer season of the south of Brazil -- sowing from October, harvest from
 * January into March -- a period from 1 October to 31 March puts window A on
 * October and November and window B on February and March, which is the pair
 * the network was trained on. A second pair of date fields would be two more
 * inputs whose only sensible values are these.
 *
 * Thirds rather than halves, so the two windows cannot meet in the middle of
 * the season, where every field is green and alike on both.
 *
 * Null when the period is not two valid dates in order, or is shorter than
 * MIN_PERIOD_DAYS: two windows of a few days each rarely hold a clear scene.
 */
export const MIN_PERIOD_DAYS = 45

export function fieldWindows(
  start: string,
  end: string
): { a: FieldsWindow; b: FieldsWindow } | null {
  const t0 = Date.parse(`${start}T00:00:00Z`)
  const t1 = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
  const day = 86_400_000
  const days = Math.round((t1 - t0) / day)
  if (days < MIN_PERIOD_DAYS) return null
  const third = Math.floor(days / 3)
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  return {
    a: { start: iso(t0), end: iso(t0 + third * day) },
    b: { start: iso(t1 - third * day), end: iso(t1) },
  }
}

/** One field as the interface reads it: its polygon and its figures. */
export interface Field {
  properties: FieldProperties
  geometry: GeoJSONGeometry
}

/**
 * The polygons of a result, largest first as the sidecar wrote them.
 *
 * An empty list, not a throw, for text that does not parse: the rest of the
 * result -- the scenes, the class shares -- is still worth reading.
 */
export function parseFields(result: Pick<FieldsAnalysis, "fields_geojson"> | null | undefined): Field[] {
  const raw = result?.fields_geojson?.trim()
  if (!raw) return []
  try {
    const fc = JSON.parse(raw) as {
      features?: { properties?: FieldProperties; geometry?: GeoJSONGeometry }[]
    }
    return (fc.features ?? [])
      .filter((f) => f.properties && f.geometry)
      .map((f) => ({ properties: f.properties!, geometry: f.geometry! }))
  } catch {
    return []
  }
}

/**
 * The area a delineation's fields would belong to, and what it already holds:
 * the fields adopted from an earlier delineation, which adopting replaces, and
 * how many of those carry runs of their own, which replacing removes.
 */
export interface FieldsTarget {
  name: string
  adopted: number
  adoptedWithRuns: number
}

/** Layer ids for a delineation's rasters. */
export const FIELD_LAYER = {
  classes: "fields:classes",
  windowA: "fields:window-a",
  windowB: "fields:window-b",
} as const

export function isFieldLayer(id: string): boolean {
  return id.startsWith("fields:")
}

/**
 * Which of the three rasters are drawn before the reader chooses.
 *
 * Only the class map: the scenes are the evidence behind it and are one switch
 * away, and drawn by default they would bury the polygons under two opaque
 * images of the same ground.
 */
export function fieldLayerDefaultVisible(id: string): boolean {
  return id === FIELD_LAYER.classes
}

/** "31 Oct 2024", for a scene date. */
export function sceneDate(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
