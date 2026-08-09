import { forwardRef, useMemo, useState } from "react"
import { motion } from "motion/react"
import { X, ChevronDown, ChevronUp, Trash2, SlidersHorizontal } from "lucide-react"
import type { CompositionOverlay } from "@/lib/types"
import {
  BLUES_STOPS,
  RDYLGN_STOPS,
  findIndexDef,
  findRgbPreset,
  resolveCompositionMeta,
} from "@/lib/compositeCatalog"

interface CompositionStatusPanelProps {
  composition: CompositionOverlay | null
  sceneDate?: string | null
  composeOpacity: number
  onClear: () => void
}

function CmapLegend({
  stops,
  lowLabel,
  highLabel,
}: {
  stops: string[]
  lowLabel: string
  highLabel: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-2 w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${stops.join(", ")})`,
        }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

export const CompositionStatusPanel = forwardRef<
  HTMLDivElement,
  CompositionStatusPanelProps
>(function CompositionStatusPanel(
  { composition, sceneDate, composeOpacity, onClear },
  ref
) {
  const [collapsed, setCollapsed] = useState(false)
  const hasOverlay = !!composition

  const meta = useMemo(() => {
    if (!composition) return null
    if (composition.kind === "index" && composition.index) {
      return resolveCompositionMeta({
        kind: "index",
        bands: composition.bands ?? ["B04", "B03", "B02"],
        index: composition.index,
      })
    }
    if (composition.kind === "rgb" && composition.bands) {
      return resolveCompositionMeta({
        kind: "rgb",
        bands: composition.bands,
        index: composition.index ?? "ndvi",
      })
    }
    const preset =
      composition.presetId && composition.presetId !== "custom"
        ? findRgbPreset(
            (composition.bands as [string, string, string]) ?? ["B04", "B03", "B02"]
          )
        : undefined
    return {
      title: composition.title || composition.label || "Composition",
      label: composition.label || "",
      description: composition.description || preset?.description || "",
      kind: composition.kind,
      bands: composition.bands,
      index: composition.index,
      rgbHints: preset?.hints,
      indexDef: composition.index ? findIndexDef(composition.index) : undefined,
    }
  }, [composition])

  const title = meta?.title ?? "Composition"
  const subtitleParts: string[] = []
  if (meta?.kind === "rgb" && meta.bands) {
    subtitleParts.push(meta.bands.join("-"))
  } else if (meta?.label && meta.label !== title) {
    subtitleParts.push(meta.label)
  }
  if (sceneDate) subtitleParts.push(sceneDate)
  if (hasOverlay) {
    subtitleParts.push(`opacity ${Math.round(composeOpacity * 100)}%`)
  }
  const subtitle =
    subtitleParts.length > 0
      ? subtitleParts.join(" · ")
      : "No overlay on the map yet"

  return (
    <motion.div
      ref={ref}
      className="panel app-no-drag absolute bottom-[calc(var(--map-foot,0px)+0.75rem)] left-[23.5rem] right-16 z-[1000] mx-auto max-w-[36rem] rounded-md"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="eyebrow shrink-0 !text-foreground">{title}</span>
          <span className="telemetry truncate text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasOverlay}
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
            title="Clear composition from map"
          >
            <Trash2 className="size-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-muted-foreground hover:text-foreground"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!hasOverlay}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Clear composition"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <hr className="hairline" />
          <div className="flex flex-col gap-3 p-3">
            {hasOverlay && meta ? (
              <>
                {meta.description && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {meta.description}
                  </p>
                )}

                {meta.kind === "rgb" && meta.bands && (
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["R", meta.bands[0], "#ef4444"],
                        ["G", meta.bands[1], "#22c55e"],
                        ["B", meta.bands[2], "#3b82f6"],
                      ] as const
                    ).map(([ch, band, color]) => (
                      <span
                        key={ch}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-border/60 bg-secondary/40 px-2 py-1 text-[10px] text-foreground"
                      >
                        <span
                          className="size-2 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-medium">{ch}</span>
                        <span className="telemetry text-muted-foreground">
                          ← {band}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {meta.kind === "rgb" && meta.rgbHints && (
                  <ul className="flex flex-col gap-1.5">
                    {meta.rgbHints.colors.map((c) => (
                      <li
                        key={c.meaning}
                        className="flex items-center gap-2 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: c.swatch }}
                        />
                        {c.meaning}
                      </li>
                    ))}
                  </ul>
                )}

                {meta.kind === "index" && meta.indexDef && (
                  <CmapLegend
                    stops={
                      meta.indexDef.cmap === "blues" ? BLUES_STOPS : RDYLGN_STOPS
                    }
                    lowLabel={meta.indexDef.lowLabel}
                    highLabel={meta.indexDef.highLabel}
                  />
                )}

                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <SlidersHorizontal className="size-3 shrink-0" />
                  Visibility, swipe and opacity live in Overlay Tools.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                List scenes and Apply a preset or index to show on the map.
              </p>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
})
