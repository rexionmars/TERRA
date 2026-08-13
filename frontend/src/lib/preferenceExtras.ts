import type { LayoutMode, LeftDockTabsMode, Preferences } from "@/lib/types"
import {
  parseSavedAois,
  type SavedAoi,
} from "@/lib/savedAois"

export type { LayoutMode, LeftDockTabsMode }

export interface PreferenceExtras {
  left_dock_tabs?: LeftDockTabsMode
  /**
   * Which map layout the session was left in. Restored on start, because the
   * two layouts are different enough that landing in the other one reads as
   * the application having changed rather than as a setting having persisted.
   */
  layout_mode?: LayoutMode
  active_project_id?: string
  /** Last custom AOI display name (survives restart with active project / prefs). */
  aoi_label?: string
  /**
   * User-drawn / imported AOIs kept as a catalog so a second draw does not
   * replace the first. The active shape is still `customPolygon` on the map;
   * this list is what the Areas tab offers back.
   */
  saved_aois?: SavedAoi[]
  /** Which catalog entry is currently the map's active AOI, if any. */
  active_aoi_id?: string
  /** Last product version for which What’s New was shown (or silently seeded). */
  last_seen_version?: string
  /**
   * Where the map was left. Restored on start so a session resumes at the last
   * place worked on rather than at the continental default.
   */
  map_view?: { lat: number; lon: number; zoom: number }
  /**
   * The studio's arrangement: which workspace, and each one's area tree.
   *
   * A preference in the same sense `layout_mode` is, and it carries that
   * entry's argument -- a reader who widens a column and finds it narrow again
   * tomorrow reads it as the application having changed rather than as a
   * setting having persisted. The board's CONTENTS are not here; those live in
   * boardMemory, which states why they should not outlive a restart.
   */
  studio_layout?: import("@/lib/studioLayout").StudioLayout
}

export function parsePreferenceExtras(
  raw: string | undefined | null
): PreferenceExtras {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as PreferenceExtras
    if (!parsed || typeof parsed !== "object") return {}
    return {
      ...parsed,
      saved_aois: parseSavedAois(parsed.saved_aois),
    }
  } catch {
    return {}
  }
}

export function leftDockTabsModeFromPrefs(
  prefs: Preferences | null | undefined
): LeftDockTabsMode {
  const mode = parsePreferenceExtras(prefs?.extras_json).left_dock_tabs
  return mode === "always" ? "always" : "retracted_only"
}

/**
 * The stored layout, defaulting by exception.
 *
 * Anything that is not the exact string falls to `docked`, so an absent key, a
 * value written by a newer build, or a corrupted blob all resolve to the layout
 * that has always worked rather than to a half-built one.
 */
export function layoutModeFromPrefs(
  prefs: Preferences | null | undefined
): LayoutMode {
  const mode = parsePreferenceExtras(prefs?.extras_json).layout_mode
  return mode === "workspace" ? "workspace" : "docked"
}

export function mergePreferenceExtras(
  raw: string | undefined | null,
  patch: PreferenceExtras
): string {
  const base = parsePreferenceExtras(raw)
  return JSON.stringify({ ...base, ...patch })
}
