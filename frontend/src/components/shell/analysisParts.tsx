import { useEffect, useState } from "react"

import {
  Broadcast,
  Diamond,
  Plant,
  Polygon,
  SquareSplitHorizontal,
  SquaresFour,
  Stack,
  Waves,
} from "@/components/icons"
import { RunOverlayURL } from "../../../wailsjs/go/main/App"
import { runAreaName } from "@/lib/aoiLabel"
import {
  mineralObservedLine,
  parseRunSummary,
  runKindLabel,
  runRowLine,
} from "@/lib/runSummary"
import type { InferenceRun } from "@/lib/types"
import { cn } from "@/lib/utils"

/*
  ONE ROW PER PRODUCT: its label, the token its plate is tinted with, and its
  glyph. The colours are `--p-kind-*` in index.css, spread by hue and held at
  a lower chroma than the semantic tokens so a product does not compete with
  what asks for something; the classification is the neutral one, since it is
  the common case. Each glyph is what the product is about rather than a
  picture of its output.
*/
export const KINDS = [
  { id: "class", label: "Classification", token: "--p-kind-class", icon: SquaresFour },
  { id: "water", label: "Surface water", token: "--p-kind-water", icon: Waves },
  { id: "mineral", label: "Mineral map", token: "--p-kind-mineral", icon: Diamond },
  { id: "fields", label: "Field boundaries", token: "--p-kind-fields", icon: Polygon },
  { id: "health", label: "Vegetation health", token: "--p-kind-health", icon: Plant },
  {
    id: "overlap",
    label: "Socio-environmental overlap",
    token: "--p-kind-overlap",
    icon: Stack,
  },
  { id: "radar", label: "Sentinel-1 radar", token: "--p-kind-radar", icon: Broadcast },
  {
    id: "zones",
    label: "Management zones",
    token: "--p-kind-zones",
    icon: SquareSplitHorizontal,
  },
] as const

export type KindId = (typeof KINDS)[number]["id"]
export type Kind = (typeof KINDS)[number]

const KIND_BY_ID = new Map<string, Kind>(KINDS.map((k) => [k.id, k]))

export function kindOf(run: Pick<InferenceRun, "kind">): Kind {
  return KIND_BY_ID.get(runKindLabel(run.kind)) ?? KINDS[0]
}

/** The token as a colour, at an alpha. One place, so the syntax is right once. */
export const tint = (token: string, alpha = 1) => `rgb(var(${token}) / ${alpha})`

/*
  WHAT A RUN IS CALLED: the area it was made over, as the reader named it, and
  the product under it. The run's own label -- run-field-23-20260927-101030 --
  is a key, written for uniqueness, and is kept for the search and the detail.
  A run with no area named is called by its product.
*/
export function runTitle(run: InferenceRun): string {
  const area = runAreaName(run)
  return area ? area.charAt(0).toUpperCase() + area.slice(1) : kindOf(run).label
}

/**
 * What the run found, in a few words: the class covering most of a
 * classification, and the rest of the product's own line for the others.
 */
export function runFinding(run: InferenceRun): { text: string; swatch?: string } {
  if (runKindLabel(run.kind) === "class") {
    const top = [...parseRunSummary(run.summary).classStats].sort(
      (a, b) => b.pct - a.pct
    )[0]
    if (top) return { text: `${top.name} ${Math.round(top.pct)}%`, swatch: top.color }
    return { text: runRowLine(run) }
  }
  /*
    A mineral map's line starts with the spectral library's file name, which
    says nothing to a reader; how much of the area was observed does.
  */
  if (runKindLabel(run.kind) === "mineral") {
    return { text: mineralObservedLine(run.summary) || kindOf(run).label }
  }
  const parts = runRowLine(run).split(" · ")
  return { text: (parts.length > 1 ? parts.slice(1) : parts).join(" · ") }
}

export function clockTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

/**
 * The address of a run's image, or null where it has none.
 *
 * Asked only where the row says there is one: `overlay_relpath` is on the row
 * already, so a run whose result is figures costs no call and no failed
 * <img>. The address comes from the Go side (runoverlay.go), which serves the
 * file by run id, so the route's shape has one home.
 */
function useRunOverlay(run: InferenceRun): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const has = !!run.overlay_relpath
  useEffect(() => {
    if (!has) {
      setUrl(null)
      return
    }
    let live = true
    void RunOverlayURL(run.id)
      .then((u) => live && setUrl(u || null))
      .catch(() => live && setUrl(null))
    return () => {
      live = false
    }
  }, [run.id, has])
  return url
}

/*
  THE RUN'S OWN RASTER, WHOLE, on a ground tinted by its product. Contained
  rather than cropped, because the outline of the area is half of what the
  picture says: twenty-three fields of one batch are told apart by their
  shapes as much as by their names. Pixelated, because every raster here is a
  class map or a measured field, and a blend of two class colours names no
  class.

  A run with no raster, or whose file is gone, shows its product's glyph: the
  product is still true of it, and a picture invented for it would not be.
*/
export function RunPicture({
  run,
  className,
  glyph = "size-6",
}: {
  run: InferenceRun
  className?: string
  /** The glyph's size where there is no raster. */
  glyph?: string
}) {
  const kind = kindOf(run)
  const Icon = kind.icon
  const overlay = useRunOverlay(run)
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={cn("flex items-center justify-center overflow-hidden", className)}
      style={{
        background: `radial-gradient(120% 90% at 50% 40%, ${tint(kind.token, 0.16)}, ${tint(kind.token, 0.05)})`,
      }}
    >
      {overlay && !failed ? (
        <img
          src={overlay}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-contain p-3 [image-rendering:pixelated]"
        />
      ) : (
        <Icon className={glyph} style={{ color: tint(kind.token) }} />
      )}
    </span>
  )
}

/** A classification's classes as one bar, in their own colours and shares. */
export function ClassBar({
  run,
  className,
}: {
  run: InferenceRun
  className?: string
}) {
  const stats = parseRunSummary(run.summary).classStats.filter((s) => s.pct > 0)
  if (!stats.length) return null
  return (
    <span aria-hidden className={cn("flex h-1 overflow-hidden", className)}>
      {stats.map((s) => (
        <span key={s.class_id} style={{ width: `${s.pct}%`, background: s.color }} />
      ))}
    </span>
  )
}

/*
  A RUN IS A CARD, as a model is in the catalogue: its picture over its name.
  One press selects it and shows it in the column at the right; two open it on
  the map, as a file is opened where it is listed. The menu holds the rest.
*/
export function RunCard({
  run,
  selected,
  busy,
  where,
  onSelect,
  onOpen,
  onContext,
}: {
  run: InferenceRun
  selected: boolean
  busy: boolean
  /** The project, named on the card when the list spans several. */
  where?: string
  onSelect: () => void
  onOpen: () => void
  onContext: (at: { x: number; y: number }) => void
}) {
  const kind = kindOf(run)
  const finding = runFinding(run)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onDoubleClick={() => !busy && onOpen()}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext({ x: e.clientX, y: e.clientY })
      }}
      title={`${runTitle(run)}. Double-click to open it on the map.`}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-md border text-left transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "border-[rgb(var(--p-text)/0.55)] bg-[rgb(var(--p-surface))]"
          : "border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))] hover:border-[rgb(var(--p-line-strong)/0.6)]"
      )}
    >
      <span className="relative block">
        <RunPicture run={run} className="h-32 w-full" />
        <ClassBar run={run} className="absolute inset-x-0 bottom-0" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 pt-2.5 pb-3">
        <span className="truncate text-read font-medium text-foreground">
          {runTitle(run)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
          {finding.swatch ? (
            <span
              className="size-2 shrink-0 rounded-xs"
              style={{ background: finding.swatch }}
            />
          ) : (
            <kind.icon
              className="size-3.5 shrink-0"
              style={{ color: tint(kind.token) }}
            />
          )}
          <span className="truncate">{finding.text}</span>
        </span>
        <span className="telemetry mt-1 truncate text-meta text-muted-foreground">
          {[where, kind.label, clockTime(run.created_at)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  )
}
