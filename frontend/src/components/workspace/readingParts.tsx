/**
 * The parts every reading on the Compare board is set in.
 *
 * A reading was headed by lines of spaced uppercase -- DIVERGENCE AGAINST
 * AGREEMENT, NDVI HISTOGRAM · A VS B -- its warnings were paragraphs in amber,
 * and its runs were named as the reader typed them, "field 16". Each reading
 * made those choices again. They are made here once, in the vocabulary the
 * Settings and Analyses screens use: a section is a name in sentence case with
 * what it shows said under it, a figure sits on a card, a caution is a framed
 * note with its mark, and a run is named with a capital.
 */
import type { ReactNode } from "react"

import { Info, Warning } from "@/components/icons"
import { cn } from "@/lib/utils"

/** An area's name as a title: the reader typed "field 23", a heading says "Field 23". */
export const titled = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** One part of a reading: a name, what it shows, and the part. */
export function ReadingSection({
  title,
  caption,
  aside,
  children,
  flush = false,
}: {
  title: string
  caption?: ReactNode
  /** A control that belongs to the whole section, set at the right of its name. */
  aside?: ReactNode
  children: ReactNode
  /** No rule above it: the first section under the reading's own header. */
  flush?: boolean
}) {
  return (
    <section className={cn("px-4 py-4", !flush && "border-t border-border")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-read font-medium text-foreground">{title}</h3>
          {caption && (
            <p className="mt-0.5 max-w-prose text-label text-muted-foreground">
              {caption}
            </p>
          )}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** A figure on its own card: what it is, the value, and what qualifies it. */
export function FigureCard({
  label,
  value,
  sub,
  title,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  /** The whole figure, for one too long to show in full. */
  title?: string
}) {
  return (
    <div
      title={title}
      className="min-w-0 rounded-md border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))] px-3 py-2.5"
    >
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="telemetry mt-1 text-heading text-foreground tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-meta text-muted-foreground">{sub}</p>}
    </div>
  )
}

/*
  A CAUTION IS A NOTE WITH A FRAME AND A MARK, not a paragraph in amber. The
  frame sets it apart from the reading it qualifies; the mark says which kind
  it is to a reader who does not take colour; the text stays in the text colour
  so it reads at the contrast every other paragraph does.
*/
export function Callout({
  tone = "warning",
  title,
  children,
}: {
  tone?: "warning" | "info"
  title?: string
  children: ReactNode
}) {
  const Mark = tone === "warning" ? Warning : Info
  return (
    <div
      role="note"
      className={cn(
        "flex gap-2.5 rounded-md border px-3 py-2.5",
        tone === "warning"
          ? "border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]"
          : "border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))]"
      )}
    >
      <Mark
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          tone === "warning" ? "text-warning" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0 text-label text-foreground">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn(title && "mt-0.5 text-muted-foreground")}>{children}</div>
      </div>
    </div>
  )
}

/**
 * Which run a reading is reading, when it is given several: one pill each,
 * as the product filter on Analyses is.
 */
export function RunPills<R extends { id: string; label: string }>({
  runs,
  value,
  onChange,
  prefix,
}: {
  runs: readonly R[]
  value: number
  onChange: (index: number) => void
  /** The role the chosen run plays, as A or B. */
  prefix?: string
}) {
  return (
    <div role="radiogroup" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {prefix && (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[rgb(var(--p-surface-raised))] text-micro font-semibold text-foreground">
          {prefix}
        </span>
      )}
      {runs.map((r, i) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={i === value}
          onClick={() => onChange(i)}
          className={cn(
            "inline-flex h-7 max-w-[12rem] items-center truncate rounded-full border px-3 text-label transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
            i === value
              ? "border-[rgb(var(--p-line-strong)/0.7)] bg-[rgb(var(--p-surface-raised))] text-foreground"
              : "border-[rgb(var(--p-line)/0.45)] text-muted-foreground hover:bg-hover hover:text-foreground"
          )}
        >
          {titled(r.label)}
        </button>
      ))}
    </div>
  )
}

/*
  A COLUMN IS NAMED FOR A READER, AND KEEPS ITS KEY FOR THE FILE. The keys are
  the CSV headers the Go exporter writes -- agreement_pct, kl_ndvi, area_ha --
  and stay what a copied table carries; the header a reader sees spells them
  out, and the key stays on its title.
*/
const WORDS: Record<string, string> = {
  pct: "%",
  ha: "(ha)",
  m: "(m)",
  km2: "(km²)",
  nm: "(nm)",
  id: "ID",
  f1: "F1",
  ndvi: "NDVI",
  ndwi: "NDWI",
  kl: "KL",
  mmd: "MMD",
  mmd2: "MMD²",
  cva: "CVA",
  sd: "(SD)",
  jm: "JM",
  rf: "RF",
  aoi: "area",
  color: "colour",
  n: "n",
  p05: "p05",
  p95: "p95",
}

export function columnLabel(key: string): string {
  const parts = key.split("_").filter(Boolean)
  const words = parts.map((p, i) => {
    const w = WORDS[p.toLowerCase()] ?? p
    return i === 0 && /^[a-z]/.test(w) && w !== "n"
      ? w.charAt(0).toUpperCase() + w.slice(1)
      : w
  })
  return words.join(" ").replace(/\s+\(/g, " (")
}
