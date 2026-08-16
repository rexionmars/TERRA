import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Check, Pencil, Focus, Trash2 } from "lucide-react"
import {
  AOI_CONTOUR_SCHEMES,
  type AoiContourSchemeId,
} from "@/lib/aoiStyle"

export interface AoiContextMenuState {
  /** Position relative to the map screen container. */
  x: number
  y: number
}

interface AoiContextMenuProps {
  menu: AoiContextMenuState
  areaName: string
  schemeId: AoiContourSchemeId
  canClear: boolean
  onClose: () => void
  onRename: (name: string) => void
  onSchemeChange: (id: AoiContourSchemeId) => void
  onFitToArea: () => void
  onClearArea: () => void
}

export function AoiContextMenu({
  menu,
  areaName,
  schemeId,
  canClear,
  onClose,
  onRename,
  onSchemeChange,
  onFitToArea,
  onClearArea,
}: AoiContextMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(areaName)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraft(areaName)
    setRenaming(false)
    setPos({ x: menu.x, y: menu.y })
  }, [areaName, menu.x, menu.y])

  useEffect(() => {
    const el = rootRef.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    const pad = 8
    // Anchor at the horizontal midpoint of the top edge (not top-left).
    const centeredX = menu.x - el.offsetWidth / 2
    const maxX = Math.max(pad, parent.clientWidth - el.offsetWidth - pad)
    const maxY = Math.max(pad, parent.clientHeight - el.offsetHeight - pad)
    setPos({
      x: Math.min(Math.max(pad, centeredX), maxX),
      y: Math.min(Math.max(pad, menu.y), maxY),
    })
  }, [menu.x, menu.y, renaming])

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer)
    }, 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onPointer)
    }
  }, [onClose])

  const commitRename = () => {
    const next = draft.trim()
    if (next) onRename(next)
    setRenaming(false)
    onClose()
  }

  const style: CSSProperties = { left: pos.x, top: pos.y }

  return (
    <div
      ref={rootRef}
      className="panel app-no-drag absolute z-[1200] w-[13.5rem] overflow-hidden rounded-md py-1 shadow-lg"
      style={style}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="truncate px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Area
      </p>

      {renaming ? (
        <form
          className="flex items-center gap-1 px-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault()
            commitRename()
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            maxLength={64}
            aria-label="Area name"
          />
          <button
            type="submit"
            className="flex size-7 items-center justify-center rounded-sm text-primary hover:bg-primary/10"
            title="Save name"
          >
            <Check className="size-3.5" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
          onClick={() => setRenaming(true)}
        >
          <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
          Rename area…
        </button>
      )}

      <div className="px-3 py-2">
        <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          Contour color
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AOI_CONTOUR_SCHEMES.map((s) => {
            const active = s.id === schemeId
            return (
              <button
                key={s.id}
                type="button"
                title={s.label}
                aria-label={`Contour ${s.label}`}
                aria-pressed={active}
                className={`size-6 rounded-full border-2 transition-transform hover:scale-105 ${
                  active
                    ? "border-primary ring-1 ring-primary/40"
                    : "border-transparent"
                }`}
                style={{ backgroundColor: s.stroke }}
                onClick={() => {
                  onSchemeChange(s.id)
                  onClose()
                }}
              />
            )
          })}
        </div>
      </div>

      <hr className="hairline mx-2" />

      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
        onClick={() => {
          onFitToArea()
          onClose()
        }}
      >
        <Focus className="size-3.5 shrink-0 text-muted-foreground" />
        Fit map to area
      </button>

      {canClear && (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive-quiet hover:bg-secondary"
          onClick={() => {
            onClearArea()
            onClose()
          }}
        >
          <Trash2 className="size-3.5 shrink-0" />
          Clear area
        </button>
      )}
    </div>
  )
}
