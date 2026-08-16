/** Placeholder AOI labels (not run names). */
const PLACEHOLDER_AOI_LABELS = new Set([
  "",
  "Custom AOI",
  "Saved analysis",
  "New field",
])

export function isPlaceholderAoiLabel(label: string | null | undefined): boolean {
  return PLACEHOLDER_AOI_LABELS.has((label ?? "").trim())
}

export function isRunLabel(label: string | null | undefined): boolean {
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
 * Resolve the AOI (area) display name — never use a run-* label here.
 */
export function resolveAoiDisplayLabel(opts: {
  analysisLabel?: string | null
  projectLabel?: string | null
  prefsAoiLabel?: string | null
  /** From inference_runs.summary_json aoi_label (frozen at predict). */
  summaryAoiLabel?: string | null
  fallback?: string
}): string {
  for (const c of [
    opts.analysisLabel,
    opts.projectLabel,
    opts.prefsAoiLabel,
    opts.summaryAoiLabel,
  ]) {
    const t = (c ?? "").trim()
    if (t && !isPlaceholderAoiLabel(t) && !isRunLabel(t)) return t
  }
  for (const c of [
    opts.analysisLabel,
    opts.projectLabel,
    opts.prefsAoiLabel,
    opts.summaryAoiLabel,
  ]) {
    const t = (c ?? "").trim()
    if (t && !isRunLabel(t)) return t
  }
  return opts.fallback ?? "Custom AOI"
}

/** Read aoi_label from a run's summary JSON if present. */
export function aoiLabelFromRunSummary(
  summary?: string | null
): string | undefined {
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
