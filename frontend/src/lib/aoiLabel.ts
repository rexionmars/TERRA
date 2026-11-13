/** Placeholder AOI labels (not run names). */
const PLACEHOLDER_AOI_LABELS = new Set([
  "",
  "Custom AOI",
  "Saved analysis",
  "New field",
])

function isPlaceholderAoiLabel(label: string | null | undefined): boolean {
  return PLACEHOLDER_AOI_LABELS.has((label ?? "").trim())
}

function isRunLabel(label: string | null | undefined): boolean {
  return (label ?? "").trim().toLowerCase().startsWith("run-")
}

/** Build a unique run name: run-<slug>-<yyyyMMdd-HHmmss> */
export function makeRunLabel(aoiHint?: string | null): string {
  const stamp = formatRunStamp(new Date())
  const slug = slugifyAoi(aoiHint) || "aoi"
  return `run-${slug}-${stamp}`
}

/** Show run title; legacy AOI-ish labels get a run- prefix for display only. */
export function displayRunLabel(label: string | null | undefined): string {
  const t = (label ?? "").trim()
  if (!t) return "run-untitled"
  if (isRunLabel(t)) return t
  if (isPlaceholderAoiLabel(t)) return `run-${slugifyAoi(t) || "legacy"}`
  // Legacy: run was saved with the AOI name — show as run-<name>
  return `run-${slugifyAoi(t) || "legacy"}`
}

/**
 * Resolve the area's display name — never use a run-* label here.
 *
 * The second candidate was `projectLabel`, the name a project carried for its
 * one AOI. A project has grounds now, each with its own name, so the run's own
 * area answers where the project used to: `areaName`.
 */
export function resolveAoiDisplayLabel(opts: {
  analysisLabel?: string | null
  areaName?: string | null
  prefsAoiLabel?: string | null
  /** From inference_runs.summary_json aoi_label (frozen at predict). */
  summaryAoiLabel?: string | null
  fallback?: string
}): string {
  for (const c of [
    opts.analysisLabel,
    opts.areaName,
    opts.prefsAoiLabel,
    opts.summaryAoiLabel,
  ]) {
    const t = (c ?? "").trim()
    if (t && !isPlaceholderAoiLabel(t) && !isRunLabel(t)) return t
  }
  for (const c of [
    opts.analysisLabel,
    opts.areaName,
    opts.prefsAoiLabel,
    opts.summaryAoiLabel,
  ]) {
    const t = (c ?? "").trim()
    if (t && !isRunLabel(t)) return t
  }
  return opts.fallback ?? "Custom AOI"
}

/**
 * The name of the area a run was made over, for a list of runs.
 *
 * The summary's aoi_label, frozen when the run was made; else the area's slug
 * out of a run-<area>-<stamp> label, which is all an older row carries; else
 * null, and the caller names the run by its product. A placeholder is no name
 * in either place, nor is the "aoi" makeRunLabel writes when it was given none.
 */
export function runAreaName(run: {
  label?: string | null
  summary?: string | null
}): string | null {
  const frozen = aoiLabelFromRunSummary(run.summary)
  if (frozen && !isPlaceholderAoiLabel(frozen)) return frozen
  const slug = /^run-(.+)-\d{8}-\d{6}$/.exec((run.label ?? "").trim())?.[1]
  if (!slug || PLACEHOLDER_SLUGS.has(slug)) return null
  return slug.replace(/-/g, " ")
}

const PLACEHOLDER_SLUGS = new Set([
  "aoi",
  "legacy",
  ...[...PLACEHOLDER_AOI_LABELS].map((l) => slugifyAoi(l)).filter(Boolean),
])

/** Read aoi_label from a run's summary JSON if present. */
export function aoiLabelFromRunSummary(summary?: string | null): string | undefined {
  if (!summary?.trim()) return undefined
  try {
    const j = JSON.parse(summary) as { aoi_label?: unknown }
    const t = typeof j.aoi_label === "string" ? j.aoi_label.trim() : ""
    return t || undefined
  } catch {
    return undefined
  }
}

function slugifyAoi(raw?: string | null): string {
  return (raw ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
}

function formatRunStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}
