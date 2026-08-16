export type WhatsNewEntry = {
  version: string
  title: string
  items: string[]
}

/** Newest first. Keep in sync with AppVersion / Git tags when cutting a release. */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "0.3.0",
    title: "Projects, analysis workspace & clearer naming",
    items: [
      "Projects hub to group analyses, overlays, and AOIs",
      "Dark Modern chrome across Analysis, Settings, and Compare",
      "Run names use run-* prefixes; AOI and project names stay separate",
      "Cover map title shows the project; AOI is labeled on its own row",
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
