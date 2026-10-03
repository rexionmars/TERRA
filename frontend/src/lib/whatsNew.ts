export type WhatsNewEntry = {
  version: string
  title: string
  items: string[]
}

/** Newest first. Keep in sync with AppVersion / Git tags when cutting a release. */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "0.7.0",
    title: "Terminator — a compositor for the board, and an area read field by field",
    items: [
      "The board's rasters are worked as nodes. A compositor takes each run's outputs as sockets, filters, masks, mixes and tabulates them, and reads each product as a card; what reaches a Globe node is drawn over its ground, in layers",
      "Areas hold fields. Field boundaries are delineated from two Sentinel-2 scenes with the Fields of The World baseline, the fields can be made areas of their own, and fields selected with shift run one after another in a queue followed in the Run graph",
      "Four products read an area field by field: vegetation health against the same days of earlier seasons, the hectares on the public registers of clearing, embargo, protection and property, a Sentinel-1 backscatter series that cloud does not stop, and management zones from several seasons of NDVI. Under a field set one graph is evaluated for every field",
      "A mineral map from EMIT imaging spectroscopy: Tetracorder over the area alone, each cell answered from the pass it is least covered in, the EMIT L2B products compared beside it, and its figures as compositor cards. It needs an Earthdata token, set in Settings",
      "What reaches a PDF report node is written up as a PDF: summary, the method as the runs record it, maps with graticule, scale bar and legend, one table per product, and the limitations. It is laid out on this machine, with no TeX installation and no network",
      "Every command has a name, a menu and a key: an operator search on F3 or Mod+K, a Keymap page in Settings, undo and redo for the board, a Console that runs commands by name, a Reports editor that keeps what the toasts said, and a start screen",
      "A project can be saved out as a .terra file and opened again, from the studio or from the Finder",
      "A right-click on a raster on the globe offers its legend, taking it off the globe and framing it. Class rasters are drawn without interpolation",
      "The canopy simulation, the solar, wind and energy products, the Brazilian operational-record readings and the flood products are removed. Solar, wind and flood runs are cleared from the store when it opens",
    ],
  },
  {
    version: "0.6.0",
    title: "Cumulus — the network a site would join, and the work filed where it is done",
    items: [
      "The grid a site would join is on the map. The transmission network is drawn under the plants that reach it, each circuit coloured by the voltage it runs at in ANEEL's own convention, and a connection reading says what the plants on an area are joined to — for bare ground, from the neighbours' attachment rather than from a distance alone",
      "Brazil's operational record is a slice of its own, so a yield can be read against a system that withholds part of what the resource delivers. The curtailment reading over an area of seventeen plants went from 78.5 seconds to 0.28",
      "Rainfall can be routed over an area and answered as depth, speed and arrival, on a board of its own. It is a different question from the flood envelope, which measures how much of an extent follows from the choice of elevation model",
      "Every saved analysis is filed and found in a browser inside the studio rather than on a screen of its own. Folders are drawn in a colour of their own, and one holding a single product carries that product's glyph",
      "Rasters over one area are drawn at heights, so a stack reads as a stack, each with a legend tied to the ground it measures. The base can be a street or topographic drawing as well as a photograph, and below the imagery handover the planet is a Sentinel-2 cloudless mosaic rather than a composite of no stated year",
      "A studio is named when it begins, and the ground drawn in it takes that name. Published state and municipal boundaries can be put on the board as a card and joined to an area with a wire the reader pulls, instead of being drawn again by hand",
      "Saved data no longer grows on its own: a raster is stored once, deleting a run removes it from every arrangement that named it, and the database compacts itself once it fragments. The Python environment the application manages is no longer copied into every backup",
      "The splash, these notes, the storage report and the Python environment open from the Studio menu, where before each could be reached once and then not again",
      "A raster no longer comes apart into bands below zoom 12, and no longer leaves the frame while the planet flattens into a map",
    ],
  },
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

/**
 * The notes to show when a reader ASKS for them, which is a different question
 * from the one the upgrade gate asks.
 *
 * The gate wants everything since the version last seen, because its subject
 * is what the reader has missed. Someone opening this from the menu has missed
 * nothing: they want to know what the release they are running IS. So it is
 * that version's entry alone.
 *
 * A build between tags -- a development version, or a patch whose notes were
 * folded into the minor above it -- matches no entry. Answering with nothing
 * would make the menu item do nothing at all, which reads as broken rather
 * than as empty, so the newest entry stands in: it is the release this build
 * belongs to, which is the honest answer to what was asked.
 */
export function notesForVersion(
  version: string,
  catalog: WhatsNewEntry[] = WHATS_NEW
): WhatsNewEntry[] {
  if (!catalog.length) return []
  const exact = catalog.filter((e) => e.version === version.trim())
  if (exact.length) return exact
  return [...catalog].sort((a, b) => compareSemver(b.version, a.version)).slice(0, 1)
}
