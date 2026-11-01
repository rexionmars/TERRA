import type { Preferences } from "@/lib/types"

/*
  NO LAYOUT HERE. `layout_mode` chose between an arrangement with the
  navigation column and one without, and `left_dock_tabs` set how that
  column's tabs behaved. There is no column: the studio is the application and
  it arranges itself, in workspaces it stores under `studio_layout` below.

  Both keys may still be present in a stored blob. Nothing reads them, and
  parsePreferenceExtras ignores what it does not name, so they simply age out.
*/
export interface PreferenceExtras {
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
   * Whether the start screen opens with the studio, once per launch.
   *
   * Absent means yes, as Blender's splash is on until it is turned off -- and
   * it is turned off from the screen itself, where the reader is when they
   * decide they have seen enough of it. Only an exact `false` hides it.
   */
  start_screen?: boolean
  /**
   * The .terra file each project was last saved to or opened from, by project
   * id. What Save project file writes without asking; see lib/projectFiles.ts.
   */
  project_files?: Record<string, string>
  /** Project files opened or saved, newest first. */
  recent_project_files?: string[]
  /**
   * Where the map was left. Restored on start so a session resumes at the last
   * place worked on rather than at the continental default.
   */
  map_view?: { lat: number; lon: number; zoom: number }
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
