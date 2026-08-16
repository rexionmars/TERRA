export type WhatsNewEntry = {
  version: string
  title: string
  items: string[]
}

/** Newest first. Keep in sync with AppVersion / Git tags when cutting a release. */
export const WHATS_NEW: WhatsNewEntry[] = [
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
