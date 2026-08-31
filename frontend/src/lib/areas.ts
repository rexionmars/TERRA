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
  }
}

/** A listing as Areas, dropping any row whose shape cannot be read. */
export function toAreas(rows: store.Area[]): Area[] {
  return rows.map(toArea).filter((a): a is Area => a !== null)
}
