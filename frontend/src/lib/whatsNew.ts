export type WhatsNewEntry = {
  version: string
  title: string
  items: string[]
}

/** Newest first. Keep in sync with AppVersion / Git tags when cutting a release. */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "0.5.0",
    title: "Draugen — the ground a run was made over, and a planet to draw it on",
    items: [
      "Work is filed under the piece of ground it was made over. A project holds areas, an area holds its runs, and deleting either takes what belongs to it — where before a project reported every run in it whatever field they came from, because nothing owned anything",
      "Drawing happens on a planet rather than in a dialog with a second map inside it. The globe carries the drawing, the relief, the search and the imagery credit, and the modal that used to hold them is gone",
      "Flood extent from terrain: HAND, run against several elevation models at once, so the reading carries the disagreement between them instead of one model's answer presented as certain",
      "Studios can be started, not only opened and saved over — a new one begins empty and bound to nothing, so saving it makes a second studio rather than writing over the one it began from",
      "The studio's outliner names its columns and answers a right-click. What used to be a list with an eye somewhere on the right is a table with the eye in its own gutter, and the actions on a raster are on the raster instead of in a strip under the panel",
      "A raster can be shown on the globe beside the studio, over the ground it measures — the viewport lifts rasters off their coordinates so two fields hundreds of kilometres apart read side by side, and this is the question that costs",
      "Terrain is a subject rather than an input: the surface model can be read on its own, and a raster can lie on the ground instead of floating over it",
    ],
  },
  {
    version: "0.4.0",
    title: "Amazon — the energy result in a column of its own",
    items: [
      "Energy results are read in a column rather than along the map's foot, with the figures worth quoting at the head of it",
      "An analysis that stalls now stops and says so, instead of waiting without end on a subprocess that will not answer",
      "A panel that fails leaves the rest of the board readable, where before it took the window with it",
      "Work files no longer accumulate without bound: promoted rasters and abandoned work directories are swept once they are old enough that nothing can still be reading them",
      "An export that cannot be finished reports the failure, rather than handing back the path of a file that was truncated on the way out",
      "Analyses now run in the same import environment the Settings screen inspects. On a machine whose packages live only in the per-user site directory, a run will refuse where it previously imported -- which is what that screen was already reporting, and was the one place the two disagreed",
    ],
  },
  {
    version: "0.3.0",
    title: "Ember — the studio, the crop in three dimensions, and energy",
    items: [
      "TERRA Studio: split the screen into the panels a question needs, with more than one area on the same board",
      "Crop simulation: leaf area read from the NDVI series, plant age from that, and the stand lit by the hourly sun of its own location",
      "Energy: irradiation, its distribution over the terrain, where a plant can be sited, and what it would yield — plus wind screening",
      "Where the classification is wrong: agreement with MapBiomas per class and per block, and domain-shift diagnosis between two runs",
      "Surface water from spectral indices, with no trained model and no fixed legend",
      "The Python environment is checked by import rather than by name, and built from the app when something is missing",
      "The Method panel states what the chosen run will do before it runs, and the stages it went through after",
    ],
  },
]

/** Skip What’s New for explicit local/dev builds only. */
export function shouldSkipWhatsNew(version: string): boolean {
  const v = version.trim().toLowerCase()
  return !v || v === "dev" || v === "0.0.0-dev" || v === "0.0.0"
}

type SemVer = { major: number; minor: number; patch: number }

function parseSemver(raw: string): SemVer | null {
  const cleaned = raw.trim().replace(/^v/i, "").split("-")[0] ?? ""
  const parts = cleaned.split(".").map((p) => Number.parseInt(p, 10))
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  }
}

/** Negative if a < b, 0 if equal, positive if a > b. Invalid → treat as equal (0). */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  return pa.patch - pb.patch
}

/**
 * Changelog entries newer than lastSeen and at most current, newest first.
 */
export function entriesSince(
  lastSeen: string,
  current: string,
  catalog: WhatsNewEntry[] = WHATS_NEW
): WhatsNewEntry[] {
  return catalog
    .filter(
      (e) =>
        compareSemver(e.version, lastSeen) > 0 &&
        compareSemver(e.version, current) <= 0
    )
    .sort((x, y) => compareSemver(y.version, x.version))
}
