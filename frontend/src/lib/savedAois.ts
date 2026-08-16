/**
 * Catalog of user-drawn / imported AOIs.
 *
 * Distinct from the single active `customPolygon` on the map: the catalog keeps
 * every shape so a second draw does not throw the first away. The active one is
 * whichever id is selected for classify / board CURRENT_AREA.
 */
import type { GeoJSONGeometry } from "@/lib/types"

export const SAVED_AOI_PREFIX = "aoi:"

export interface SavedAoi {
  id: string
  name: string
  geometry: GeoJSONGeometry
  /** ISO timestamp; stable sort / display only. */
  created_at: string
}

export function isSavedAoiId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(SAVED_AOI_PREFIX)
}

export function newSavedAoiId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${SAVED_AOI_PREFIX}${crypto.randomUUID()}`
  }
  return `${SAVED_AOI_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** drawn, drawn 2, drawn 3… skipping names already taken. */
export function nextDrawnName(existing: { name: string }[]): string {
  const used = new Set(
    existing.map((e) => e.name.trim().toLowerCase()).filter(Boolean)
  )
  if (!used.has("drawn")) return "drawn"
  let n = 2
  while (used.has(`drawn ${n}`)) n += 1
  return `drawn ${n}`
}

export function parseSavedAois(raw: unknown): SavedAoi[] {
  if (!Array.isArray(raw)) return []
  const out: SavedAoi[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id : ""
    const name = typeof o.name === "string" ? o.name.trim() : ""
    const geometry = o.geometry as GeoJSONGeometry | undefined
    const created_at =
      typeof o.created_at === "string" ? o.created_at : new Date().toISOString()
    if (!isSavedAoiId(id) || !name || !geometry || geometry.type !== "Polygon") {
      continue
    }
    out.push({ id, name, geometry, created_at })
  }
  return out
}

export function createSavedAoi(
  geometry: GeoJSONGeometry,
  existing: SavedAoi[],
  nameHint?: string | null
): SavedAoi {
  const hint = (nameHint ?? "").trim()
  const name =
    hint && !existing.some((e) => e.name.trim().toLowerCase() === hint.toLowerCase())
      ? hint
      : nextDrawnName(existing)
  return {
    id: newSavedAoiId(),
    name,
    geometry,
    created_at: new Date().toISOString(),
  }
}
