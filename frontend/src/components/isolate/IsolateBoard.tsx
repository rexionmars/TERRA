/**
 * The isolate board: the analysis lifted off its coordinates.
 *
 * On a cartographic map two AOI analyses cannot be placed side by side --
 * they are at different points on Earth. Freeing the rasters from their
 * coordinates is what makes the comparison possible at all, which is why this
 * surface exists rather than another map mode.
 *
 * Loaded lazily. It is the only route to `three`, and the map screen must not
 * pay for it until the board is opened; see IsolateBoardButton for the other
 * half of that boundary.
 */
import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { X } from "lucide-react"
import type { RasterLayer } from "@/lib/mapLayers"
import type { LayerPatch } from "@/components/isolate/BoardSidebar"
import { BoardSidebar } from "@/components/isolate/BoardSidebar"
import type { CardPlane } from "@/lib/isolateCards"
import { layoutCards } from "@/lib/isolateCards"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import type { BoardHandle } from "@/components/isolate/boardScene"
import { createBoard, tokenColor } from "@/components/isolate/boardScene"

/**
 * Separation between stacked layers, in world units where the AOI's longest
 * side is 1.
 *
 * A tenth of the AOI: far enough that orbiting pulls the layers visibly apart,
 * close enough that they still read as one place seen in section rather than
 * as unrelated sheets.
 */
const STACK_GAP = 0.1
const GAP_MAX = 0.35

export function IsolateBoard({
  layers,
  onLayerChange,
  title,
  showClose,
  onClose,
}: {
  /**
   * Every layer the run could draw, drawn or not.
   *
   * Including the hidden ones is what lets the sidebar offer the switch that
   * turns one back on; the scene takes only those marked visible.
   */
  layers: RasterLayer[]
  onLayerChange: (id: string, patch: LayerPatch) => void
  title: string
  /**
   * Whether this surface draws its own way out.
   *
   * False where the toggle that opened the board stays visible over it -- the
   * dock layout's island -- because one control that turns a thing on and off
   * is one control. True where the toggle is in Leaflet's stack, which this
   * surface covers: there the button cannot be pressed again and its absence
   * would leave Escape as the only exit.
   */
  showClose: boolean
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<BoardHandle | null>(null)
  const [gap, setGap] = useState(STACK_GAP)

  /**
   * The layers with the majority filter already applied where the table asks
   * for it, so the board draws the same class boundaries the map does.
   *
   * Resolved before the scene is built rather than swapped in afterwards: a
   * board that opened on the raw raster and then re-cut every boundary a
   * second later would show the user two different answers in sequence. The
   * transform is memoised on the source URI, so when the map has already
   * computed it -- which it has, whenever the control is on -- this resolves
   * without recomputing.
   */
  const [cards, setCards] = useState<CardPlane[] | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all(
      layers
        .filter((l) => l.visible)
        .map(async (l) =>
          l.smooth
            ? { ...l, uri: await majoritySmoothOverlay(l.uri).catch(() => l.uri) }
            : l
        )
    ).then((resolved) => {
      if (!cancelled) setCards(layoutCards(resolved, STACK_GAP))
    })
    return () => {
      cancelled = true
    }
  }, [layers])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !cards) return
    let board: BoardHandle | null = null
    try {
      // Read from the computed style rather than hardcoded, so the board
      // follows the theme the rest of the application is painted in.
      board = createBoard(host, {
        cards,
        background: tokenColor("--p-ink", "#171717"),
        line: tokenColor("--p-line", "#404040"),
      })
    } catch {
      // A context can fail to be created even where the capability exists --
      // too many live contexts, or a driver reset. The board closes rather
      // than sitting blank, because a blank surface says nothing.
      onClose()
      return
    }
    boardRef.current = board
    return () => {
      boardRef.current = null
      board?.dispose()
    }
  }, [cards, onClose])

  // Moves the existing planes rather than rebuilding the scene, so the camera
  // stays where the user put it while they adjust the separation.
  useEffect(() => {
    boardRef.current?.setGap(gap)
  }, [gap, cards])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <motion.div
      /*
        Above the map, which sits at z-0, and below every piece of chrome: the
        foot track at 900, the island and the panels at 1000, the drawers at
        1100. What this excludes is the MAP, not the application -- the board
        is a working surface, so the controls have to stay within reach of it.
        Covering them turned it into a modal takeover, which is not what a
        whiteboard is.

        Opaque, because the map keeps rendering underneath as a sibling and a
        translucent scrim would leave tiles moving behind the rasters.
      */
      className="app-no-drag absolute inset-0 z-[500] overflow-hidden"
      style={{ background: "rgb(var(--p-ink))" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <div ref={hostRef} className="absolute inset-0" />

      <BoardSidebar
        layers={layers}
        gap={gap}
        gapMax={GAP_MAX}
        onGapChange={setGap}
        onLayerChange={onLayerChange}
      />

      {/*
        Left, and clear of the top-right corner where the search bar sits.

        The close button appears only where the toggle that opened the board is
        hidden behind it. In the dock layout the toggle sits on the island,
        which stays above this surface and turns it off again -- a second exit
        there would be a second answer. In the sidebar layout the toggle is in
        Leaflet's control stack, which this covers, so without an X the only
        way out would be Escape, a key nobody is told about.
      */}
      <div className="absolute left-[16rem] top-3 flex min-w-0 max-w-[24rem] items-start gap-2">
        <div className="min-w-0">
          <p className="eyebrow !text-foreground">Isolated</p>
          <p className="mt-0.5 truncate text-emphasis text-muted-foreground">
            {title}
          </p>
        </div>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-raised/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </motion.div>
  )
}
