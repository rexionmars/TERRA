/**
 * The grounds of the open project, as the screens read them.
 *
 * A view of store.Area, not a second copy of it. The store row carries the
 * project and user it belongs to and its shape as GeoJSON text; a screen wants
 * the shape parsed and does not want the ownership columns, because the only
 * areas it is ever handed are the open project's.
 *
 * WHAT THIS REPLACES, and why the replacement matters. The catalogue was a JSON
 * array inside preferences.extras_json, minted here with an `aoi:` prefix and a
 * random id. Nothing in Go had ever seen one, so a run's area link pointed at a
 * value no query could resolve and no delete could cascade -- 58 runs sat in
 * one project because the frontend was the only thing that knew what an area
 * was. An area is a row now. Its id comes from the database, its name is minted
 * there against the project's other areas, and deleting it takes the runs of it.
 */
import type { GeoJSONGeometry } from "@/lib/types"
import type { store } from "../../wailsjs/go/models"

export interface Area {
  id: string
  name: string
  geometry: GeoJSONGeometry
  created_at: string
  /**
   * Carried, though nothing here displays it yet, because store.UpdateArea
   * writes every column it is given: an update that omitted this would blank
   * whatever was in it.
   */
  notes: string
  /** Runs measured on this ground. Filled by the listing query. */
  run_count: number
  /**
   * The area this one is a field of, or "" for an area drawn or imported.
   * One level: a field holds no fields (internal/store/areas.go).
   */
  parent_id: string
  /**
   * The delineation run this field was adopted from, or "" for a field drawn
   * by hand -- the fields a later delineation replaces, and the ones it leaves.
   */
  source_run_id: string
}

/**
 * One store row as an Area, or null when its shape cannot be read.
 *
 * Null rather than a throw: the column is opaque text the store never
 * interprets, and one unreadable row should cost that row, not the list it
 * arrived in.
 */
export function toArea(row: store.Area): Area | null {
  const raw = row.polygon_geojson?.trim()
  if (!raw) return null
  let geometry: GeoJSONGeometry
  try {
    geometry = JSON.parse(raw) as GeoJSONGeometry
  } catch {
    return null
  }
  if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") {
    return null
  }
  return {
    id: row.id,
    name: row.name,
    geometry,
    created_at: row.created_at,
    notes: row.notes ?? "",
    run_count: row.run_count ?? 0,
    parent_id: row.parent_id ?? "",
    source_run_id: row.source_run_id ?? "",
  }
}

/** A listing as Areas, dropping any row whose shape cannot be read. */
export function toAreas(rows: store.Area[]): Area[] {
  return rows.map(toArea).filter((a): a is Area => a !== null)
}

/** Whether an area is a field of another. */
export function isField(a: Pick<Area, "parent_id">): boolean {
  return !!a.parent_id
}

/**
 * The fields of each area, keyed by the parent's id, in the order listed.
 *
 * The store lists fields beside the roots, each naming its parent, and leaves
 * the tree to the reader; this is that tree, one level deep.
 */
export function fieldsByParent(areas: readonly Area[]): Map<string, Area[]> {
  const out = new Map<string, Area[]>()
  for (const a of areas) {
    if (!a.parent_id) continue
    const list = out.get(a.parent_id)
    if (list) list.push(a)
    else out.set(a.parent_id, [a])
  }
  return out
}

/**
 * The area whose fields are in view: the area itself, or its parent when it
 * is a field. Null when neither is known.
 */
export function rootOf(areas: readonly Area[], id: string | null | undefined): Area | null {
  if (!id) return null
  const a = areas.find((x) => x.id === id)
  if (!a) return null
  return a.parent_id ? (areas.find((x) => x.id === a.parent_id) ?? null) : a
}
