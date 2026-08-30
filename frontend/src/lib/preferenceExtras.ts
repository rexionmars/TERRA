import type {
  LayoutMode,
  LeftDockTabsMode,
  Preferences,
  StartSurface,
} from "@/lib/types"
export type { LayoutMode, LeftDockTabsMode, StartSurface }

export interface PreferenceExtras {
  left_dock_tabs?: LeftDockTabsMode
  /**
   * Which map layout the session was left in. Restored on start, because the
   * two layouts are different enough that landing in the other one reads as
   * the application having changed rather than as a setting having persisted.
   */
  layout_mode?: LayoutMode
  /**
   * Which surface a session opens on: the map, or the studio over it.
   *
   * Beside `layout_mode` because it answers the neighbouring question -- that
   * one is how a screen is arranged, this one is which screen the application
   * hands the reader first -- and both are restored on start for the same
   * reason: landing somewhere other than where the work is read as the
   * application having changed.
   */
  start_surface?: StartSurface
  active_project_id?: string
  /** Last custom AOI display name (survives restart with active project / prefs). */
  aoi_label?: string
  /*
    NO AREAS HERE. `saved_aois` held the whole catalogue as a JSON array, and
    `active_aoi_id` named one of its entries. Areas are rows now, scoped to the
    project that owns them, so the catalogue is asked for rather than carried;
    which one is open follows `active_project_id` and is not remembered across
    a restart, because an area outlives a session and a selection does not.
  */
  /** Last product version for which What’s New was shown (or silently seeded). */
  last_seen_version?: string
  /**
   * Show the release notes at every start rather than once per version.
   *
   * `last_seen_version` answers "has this been announced yet", which is the
   * right question for an announcement and the wrong one for a reference. A
   * reader who consults the notes for what a release changed is asking a
   * question that does not stop being asked once it has been answered, and the
   * gate has no other way back: it is reached on start or not at all.
   */
  always_show_whats_new?: boolean
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
  /**
   * Which figures the studio's status bar reports.
   *
   * A preference rather than a build flag because one of the figures costs
   * something to have on -- it keeps the page animating -- and the reader who
   * accepts that cost is the one diagnosing a stall. Absent means none, which
   * is what a reader who has never opened the setting should get.
   */
  studio_telemetry?: import("@/lib/studioTelemetry").StudioTelemetry
}

export function parsePreferenceExtras(
  raw: string | undefined | null
): PreferenceExtras {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as PreferenceExtras
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
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

/**
 * Where a session opens, defaulting by exception.
 *
 * The map, unless the stored value is exactly the other string -- so an absent
 * key, a value written by a newer build or a corrupted blob all resolve to the
 * surface that needs nothing to be on screen before it can be shown.
 */
export function startSurfaceFromPrefs(
  prefs: Preferences | null | undefined
): StartSurface {
  const surface = parsePreferenceExtras(prefs?.extras_json).start_surface
  return surface === "studio" ? "studio" : "explorer"
}

/**
 * Whether the release notes are shown at every start, defaulting by exception.
 *
 * Only an exact `true` turns it on, so an absent key, a value written by a
 * newer build and a corrupted blob all resolve to the behaviour that shipped:
 * shown once, when the version is newer than the one last seen.
 */
export function alwaysShowWhatsNewFromPrefs(
  prefs: Preferences | null | undefined
): boolean {
  return parsePreferenceExtras(prefs?.extras_json).always_show_whats_new === true
}

export function mergePreferenceExtras(
  raw: string | undefined | null,
  patch: PreferenceExtras
): string {
  const base = parsePreferenceExtras(raw)
  return JSON.stringify({ ...base, ...patch })
}
