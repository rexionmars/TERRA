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
   * Whether the studio's panels are separated by a gap.
   *
   * A chrome preference and not a layout one: `studio_layout` below records
   * WHERE the divisions are, and this records how the areas either side of one
   * are told apart. A reader who prefers a denser board turns it off and gets
   * a border in its place -- see lib/studioGutter for why the two are one
   * decision rather than a setting and a fallback.
   */
  studio_panel_gap?: boolean
  /**
   * Where the map was left. Restored on start so a session resumes at the last
   * place worked on rather than at the continental default.
   */
  map_view?: { lat: number; lon: number; zoom: number }
  /**
   * The studio's arrangement: which workspace, and each one's area tree.
   *
   * A preference, stored for the reason the others here are: a reader who
   * widens a column and finds it narrow again tomorrow reads it as the
   * application having changed rather than as a setting having persisted. The
   * board's CONTENTS are not here; those live in
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
