/**
 * The filters of the Analyses screen: which saved runs the reader asked to see.
 *
 * FOUR FACETS. The product is what was made. The model is what made a
 * classification, the one product made by a choice of model; every other
 * product has a single method, which its model_kind names, so a model filter
 * over them would repeat the product. When is the local day the run was saved.
 * The area is the ground it was made over, by the name the run is titled with.
 *
 * A COUNT IS TAKEN UNDER THE OTHER FILTERS. Each option's count is how many
 * runs it would show with every other filter, the search among them, as it
 * stands, so a zero says before the press that the option empties the page.
 * The options themselves are listed from every run in scope, so the lists do
 * not reshape while the reader narrows them.
 *
 * A CHOICE ABSENT FROM THE SCOPE CHOOSES NOTHING. The filters outlive a change
 * of project, and a model or an area picked in one project and absent from the
 * next would otherwise empty a page with nothing on it to say why.
 */
import { runAreaName } from "@/lib/aoiLabel"
import { localDay } from "@/lib/runBatches"
import { modelDisplayName, runKindLabel } from "@/lib/runSummary"
import type { InferenceRun } from "@/lib/types"

/** The spans counted back from today, today included. */
export const SINCE = [
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
  { id: "year", label: "Last 12 months" },
] as const

export type Since = (typeof SINCE)[number]["id"]

/** When the run was saved, as local calendar days. */
export type Saved =
  | { when: "any" }
  | { when: "since"; since: Since }
  /** YYYY-MM. */
  | { when: "month"; month: string }
  /** YYYY-MM-DD, both ends included; an empty end is open. */
  | { when: "between"; from: string; to: string }

export interface RunFilter {
  /** A product id as runKindLabel gives it, or null for every product. */
  product: string | null
  /** A model key as modelKey gives it. */
  model: string | null
  saved: Saved
  /** An area key as areaKey gives it. */
  area: string | null
}

export const NO_FILTER: RunFilter = {
  product: null,
  model: null,
  saved: { when: "any" },
  area: null,
}

export interface FacetOption {
  key: string
  label: string
  count: number
}

export interface Facets {
  /** The filter with every choice absent from the scope dropped. */
  filter: RunFilter
  /** The runs that pass every filter and the search. */
  shown: InferenceRun[]
  /** Per product id present in scope. */
  products: Map<string, number>
  models: FacetOption[]
  since: Record<Since, number>
  /** Newest first. */
  months: FacetOption[]
  /** In the order of their names, numbers read as numbers. */
  areas: FacetOption[]
}

/**
 * The model of a classification, null for any other product. A row written
 * before the column held the model is "", and was a Random Forest, which is
 * what "spectral" also means, so the two are one choice.
 */
export function modelKey(
  run: Pick<InferenceRun, "kind" | "model_kind">
): string | null {
  if (runKindLabel(run.kind) !== "class") return null
  return run.model_kind || "spectral"
}

/** The area's name, folded so that "Field 1" and "field 1" are one choice. */
export function areaKey(run: Pick<InferenceRun, "label" | "summary">): string | null {
  return runAreaName(run)?.trim().toLowerCase() || null
}

export function isFiltered(f: RunFilter): boolean {
  return (
    f.product !== null || f.model !== null || f.saved.when !== "any" || f.area !== null
  )
}

/** The first local day a span counted back from `today` includes. */
export function sinceDay(since: Since, today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (since === "week") d.setDate(d.getDate() - 6)
  else if (since === "month") d.setDate(d.getDate() - 29)
  else {
    d.setFullYear(d.getFullYear() - 1)
    d.setDate(d.getDate() + 1)
  }
  return ymd(d)
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A month absent from the scope, or a span with neither end, is no filter. */
function settleSaved(saved: Saved, hasMonth: (month: string) => boolean): Saved {
  if (saved.when === "month" && !hasMonth(saved.month)) return { when: "any" }
  if (saved.when === "between" && !saved.from && !saved.to) return { when: "any" }
  return saved
}

function savedPasses(day: string, saved: Saved, today: Date): boolean {
  switch (saved.when) {
    case "any":
      return true
    case "since":
      return day >= sinceDay(saved.since, today)
    case "month":
      return day.slice(0, 7) === saved.month
    case "between":
      return (!saved.from || day >= saved.from) && (!saved.to || day <= saved.to)
  }
}

/**
 * Filter the runs in scope and count every option under the other filters.
 *
 * `search` is the reader's text search, applied to every count as the fifth
 * filter it is; `today` is passed in so a test can fix it.
 */
export function facetRuns(
  runs: readonly InferenceRun[],
  wanted: RunFilter,
  today: Date,
  search: (run: InferenceRun) => boolean = () => true
): Facets {
  const rows = runs.map((r) => {
    const day = localDay(r.created_at)
    return {
      run: r,
      day,
      product: runKindLabel(r.kind),
      model: modelKey(r),
      area: areaKey(r),
    }
  })

  const has = (pick: (row: (typeof rows)[number]) => string | null, v: string | null) =>
    v === null || rows.some((row) => pick(row) === v)
  const filter: RunFilter = {
    product: has((x) => x.product, wanted.product) ? wanted.product : null,
    model: has((x) => x.model, wanted.model) ? wanted.model : null,
    area: has((x) => x.area, wanted.area) ? wanted.area : null,
    saved: settleSaved(wanted.saved, (month) =>
      rows.some((x) => x.day.slice(0, 7) === month)
    ),
  }

  const since = Object.fromEntries(SINCE.map((s) => [s.id, 0])) as Record<Since, number>
  const firstDay = Object.fromEntries(
    SINCE.map((s) => [s.id, sinceDay(s.id, today)])
  ) as Record<Since, string>
  const products = new Map<string, number>()
  const models = new Map<string, number>()
  const months = new Map<string, number>()
  const areas = new Map<string, { label: string; count: number }>()
  const shown: InferenceRun[] = []

  for (const x of rows) {
    const text = search(x.run)
    const p = filter.product === null || x.product === filter.product
    const m = filter.model === null || x.model === filter.model
    const s = savedPasses(x.day, filter.saved, today)
    const a = filter.area === null || x.area === filter.area

    products.set(
      x.product,
      (products.get(x.product) ?? 0) + (text && m && s && a ? 1 : 0)
    )
    if (x.model !== null) {
      models.set(x.model, (models.get(x.model) ?? 0) + (text && p && s && a ? 1 : 0))
    }
    const month = x.day.slice(0, 7)
    const savedCounts = text && p && m && a ? 1 : 0
    months.set(month, (months.get(month) ?? 0) + savedCounts)
    for (const { id } of SINCE) {
      if (x.day >= firstDay[id]) since[id] += savedCounts
    }
    if (x.area !== null) {
      const name = runAreaName(x.run)?.trim() ?? x.area
      const prev = areas.get(x.area)
      areas.set(x.area, {
        label: prev?.label ?? name.charAt(0).toUpperCase() + name.slice(1),
        count: (prev?.count ?? 0) + (text && p && m && s ? 1 : 0),
      })
    }
    if (text && p && m && s && a) shown.push(x.run)
  }

  const byName = (a: FacetOption, b: FacetOption) =>
    a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" })
  return {
    filter,
    shown,
    products,
    models: [...models]
      .map(([key, count]) => ({ key, label: modelDisplayName(key), count }))
      .sort(byName),
    since,
    months: [...months]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([key, count]) => ({ key, label: monthName(key), count })),
    areas: [...areas].map(([key, v]) => ({ key, ...v })).sort(byName),
  }
}

/** "2026-11" as "November 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return month
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
}

/** What a chip says the saved filter is, in a few words. */
export function savedLabel(saved: Saved): string {
  switch (saved.when) {
    case "any":
      return "Any time"
    case "since":
      return SINCE.find((s) => s.id === saved.since)?.label ?? saved.since
    case "month":
      return monthName(saved.month)
    case "between":
      if (saved.from && saved.to) {
        return `${shortDay(saved.from)} to ${shortDay(saved.to)}`
      }
      if (saved.from) return `From ${shortDay(saved.from)}`
      if (saved.to) return `Until ${shortDay(saved.to)}`
      return "Any time"
  }
}

function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  if (!y || !m || !d) return day
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
