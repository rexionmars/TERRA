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
import { useEffect, useRef } from "react"
import { motion } from "motion/react"
import { X } from "lucide-react"
import type { BoardHandle } from "@/components/isolate/boardScene"
import { createBoard, tokenColor } from "@/components/isolate/boardScene"

export function IsolateBoard({
  textureUri,
  title,
  onClose,
}: {
  textureUri: string
  title: string
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let board: BoardHandle | null = null
    try {
      // Read from the computed style rather than hardcoded, so the board
      // follows the theme the rest of the application is painted in.
      board = createBoard(host, {
        textureUri,
        background: tokenColor("--p-ink", "#171717"),
      })
    } catch {
      // A context can fail to be created even where the capability exists --
      // too many live contexts, or a driver reset. The board closes rather
      // than sitting blank, because a blank surface says nothing.
      onClose()
      return
    }
    return () => board?.dispose()
  }, [textureUri, onClose])

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
        Opaque, and above the panels at 1000 and the foot tracks at 900 while
        staying under the modals at 2000 -- the ladder ModalShell documents.
        Opaque because excluding the rest of the map is the premise: the map,
        the period track and the island keep rendering underneath as siblings,
        and a translucent scrim would leave tiles moving behind the board.
      */
      className="app-no-drag absolute inset-0 z-[1500] overflow-hidden"
      style={{ background: "rgb(var(--p-ink))" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <div ref={hostRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="eyebrow !text-foreground">Isolated</p>
          <p className="mt-0.5 truncate text-emphasis text-muted-foreground">
            {title}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          className="pointer-events-auto flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-raised/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>
    </motion.div>
  )
}
