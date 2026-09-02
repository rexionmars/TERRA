import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CaretDown,
  CaretRight,
  Check,
  FolderSimple,
  StackSimple,
} from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { displayRunLabel } from "@/lib/aoiLabel"
import { runRowLine } from "@/lib/runSummary"
import type { InferenceRun, Project } from "@/lib/types"
import type { Studio } from "@/lib/studios"

/** Width of the run list, and what deciding to flip it is measured against. */
const SUBMENU_W = 248
/**
 * How long the run list survives the pointer leaving it.
 *
 * Travelling from a project row to its list crosses a gap, and on the way the
 * pointer passes over rows that are not the one it came from. Closing on the
 * first leave would shut the list under the pointer on the way to it.
 */
const CLOSE_DELAY_MS = 180

export function ProjectSwitcher({
  projects,
  activeProjectId,
  runs,
  studios,
  onOpenStudio,
  onMenuOpen,
  onSelect,
  onCreate,
  onOpenRun,
  busy,
  onOpenHub,
  className,
}: {
  projects: Project[]
  activeProjectId: string | null
  /**
   * Every run the user has. Filtered here rather than fetched per project:
   * they are already loaded, and a menu that opened a request on hover would
   * fire one for every project the pointer crossed on its way down the list.
   */
  runs: InferenceRun[]
  onSelect: (id: string | null) => void
  onCreate: () => void
  onOpenRun: (run: InferenceRun) => void
  /**
   * Saved boards, listed beside the projects.
   *
   * Here rather than only in the hub because a board is a place someone
   * RETURNS to -- it is where several runs were arranged -- and the hub is a
   * detour when the menu that switches context is already open. The hub is
   * still where one is deleted.
   *
   * Not under a project: a board's members can come from several, which is
   * what it exists for, so filing it under one would make its own purpose the
   * exception.
   */
  studios: Studio[]
  onOpenStudio: (board: Studio) => void
  /**
   * The menu is opening.
   *
   * Studios are saved from the board, which this menu knows nothing about,
   * so the list is refreshed when it is about to be read rather than kept in
   * step by something watching for saves.
   */
  onMenuOpen?: () => void
  /** A run is being loaded; a second click would race the first. */
  busy?: boolean
  onOpenHub?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  )
  const btnRef = useRef<HTMLButtonElement>(null)

  /**
   * The project whose runs are showing, and where to put them.
   *
   * Held with its position rather than derived from the row, because the list
   * is drawn in a portal beside the menu and the row it belongs to is not its
   * parent.
   */
  const [sub, setSub] = useState<{
    id: string
    top: number
    left: number
  } | null>(null)
  const closeTimer = useRef(0)

  /** Newest first, and only this project's. */
  const subRuns = useMemo(
    () =>
      sub
        ? runs
            .filter((r) => r.project_id === sub.id)
            .slice()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
        : [],
    [runs, sub]
  )

  const openSub = (id: string, el: HTMLElement) => {
    window.clearTimeout(closeTimer.current)
    const r = el.getBoundingClientRect()
    // Flipped to the other side where it would run off the window rather than
    // opening a list the last third of which cannot be read.
    const right = r.right + 4
    setSub({
      id,
      top: r.top,
      left:
        right + SUBMENU_W > window.innerWidth ? r.left - SUBMENU_W - 4 : right,
    })
  }
  const holdSub = () => window.clearTimeout(closeTimer.current)
  const scheduleCloseSub = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setSub(null), CLOSE_DELAY_MS)
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  const active = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )

  const updatePos = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 4, left: r.left })
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      setSub(null)
      return
    }
    updatePos()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onReposition = () => updatePos()
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open])

  const menu =
    open &&
    menuPos &&
    createPortal(
      <>
        <button
          type="button"
          className="fixed inset-0 z-[5000] cursor-default"
          aria-label="Close project menu"
          onClick={() => setOpen(false)}
        />
        <div
          className="panel fixed z-[5001] w-56 overflow-hidden rounded-sm border border-border/70 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] hover:bg-secondary/50"
            onClick={() => {
              onSelect(null)
              setOpen(false)
            }}
          >
            <span className="flex-1 text-muted-foreground">No project</span>
            {!activeProjectId && <Check className="size-3 text-primary" />}
          </button>
          <hr className="hairline" />
          <div className="max-h-48 overflow-y-auto">
            {projects.length === 0 ? (
              <p className="px-2.5 py-2 text-[10px] text-muted-foreground">
                No projects yet.
              </p>
            ) : (
              projects.map((p) => {
                const n = runs.filter((r) => r.project_id === p.id).length
                return (
                  <button
                    key={p.id}
                    type="button"
                    /*
                      Hover and focus both open the list, so it is reachable
                      without a pointer. Clicking the row still does what it
                      always did -- make this the active project -- and the
                      list beside it is a second thing you can do from here,
                      not a replacement for the first.
                    */
                    onMouseEnter={(e) => openSub(p.id, e.currentTarget)}
                    onFocus={(e) => openSub(p.id, e.currentTarget)}
                    onMouseLeave={scheduleCloseSub}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] hover:bg-secondary/50",
                      sub?.id === p.id && "bg-secondary/50"
                    )}
                    onClick={() => {
                      onSelect(p.id)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {activeProjectId === p.id && (
                      <Check className="size-3 shrink-0 text-primary" />
                    )}
                    {/*
                      The count is the reason to go right, and its absence is
                      the reason not to: a project with no runs says so before
                      the pointer travels to find out.
                    */}
                    {n > 0 && (
                      <>
                        <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                          {n}
                        </span>
                        <CaretRight className="size-3 shrink-0 text-muted-foreground" />
                      </>
                    )}
                  </button>
                )
              })
            )}
          </div>
          {studios.length > 0 && (
            <>
              <hr className="hairline" />
              <p className="px-2.5 pb-0.5 pt-2 text-[9px] uppercase tracking-wide text-muted-foreground">
                Studios
              </p>
              <div className="max-h-40 overflow-y-auto">
                {studios.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] hover:bg-secondary/50"
                    onClick={() => {
                      setOpen(false)
                      onOpenStudio(b)
                    }}
                  >
                    <StackSimple className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {/*
                      How many runs are arranged on it, which is the only thing
                      about a board that says how much is there.
                    */}
                    <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                      {b.member_count}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <hr className="hairline" />
          <button
            type="button"
            className="flex w-full px-2.5 py-2 text-left text-[11px] text-primary hover:bg-secondary/50"
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
          >
            New project…
          </button>
          {onOpenHub && (
            <button
              type="button"
              className="flex w-full px-2.5 py-2 text-left text-[11px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              onClick={() => {
                setOpen(false)
                onOpenHub()
              }}
            >
              Open projects hub
            </button>
          )}
        </div>

        {sub && (
          <div
            onMouseEnter={holdSub}
            onMouseLeave={scheduleCloseSub}
            className="panel fixed z-[5002] overflow-hidden rounded-sm border border-border/70 shadow-lg"
            style={{ top: sub.top, left: sub.left, width: SUBMENU_W }}
          >
            <p className="px-2.5 pb-1 pt-2 text-[9px] uppercase tracking-wide text-muted-foreground">
              Runs
            </p>
            <div className="max-h-64 overflow-y-auto pb-1">
              {subRuns.length === 0 ? (
                <p className="px-2.5 py-2 text-[10px] text-muted-foreground">
                  No runs in this project yet.
                </p>
              ) : (
                subRuns.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setOpen(false)
                      setSub(null)
                      onOpenRun(r)
                    }}
                    className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="w-full truncate text-[11px] text-foreground">
                      {displayRunLabel(r.label) || r.model_kind}
                    </span>
                    {/*
                      The same line the hub prints under a run, so the two
                      places that list runs describe them the same way.
                    */}
                    <span className="telemetry w-full truncate text-[10px] text-muted-foreground">
                      {runRowLine(r)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </>,
      document.body
    )

  return (
    <div className={cn("relative app-no-drag", className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() =>
          setOpen((o) => {
            if (!o) onMenuOpen?.()
            return !o
          })
        }
        /*
          NO BOX AT REST, and no accent on the glyph.

          It wore `panel` -- a bordered, translucent surface -- inside the title
          bar, which is itself a panel. A panel drawn on a panel reads as a
          control competing with the wordmark beside it rather than as one more
          thing on the same row, and the row already separates its parts with a
          hairline where it means to.

          The accent went with it. DESIGN.md gives that colour three jobs -- a
          fill, a focus ring, an active state -- and a permanent tint on a
          folder glyph is none of them. It spent the one colour on screen that
          is not data on a decoration, beside the project's name, which is what
          a reader is actually here to read.

          Both come back when the menu is open, because that IS an active state
          and is exactly what the accent is for.
        */
        className={cn(
          "flex max-w-[14rem] items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] transition-colors",
          open
            ? "bg-secondary/60 text-foreground"
            : "text-foreground hover:bg-secondary/40"
        )}
        title="Active project"
      >
        <FolderSimple
          className={cn(
            "size-3.5 shrink-0 transition-colors",
            open ? "text-primary" : "text-muted-foreground"
          )}
        />
        {/*
          The name at full strength and the fallback muted, because they are
          different kinds of thing: one is a value, the other is the absence of
          one. Drawn alike, "No project" read as a project called that.
        */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !active && "text-muted-foreground"
          )}
        >
          {active ? active.name : "No project"}
        </span>
        <CaretDown
          className={cn(
            "size-3 shrink-0 transition-transform",
            open ? "rotate-180 text-foreground" : "text-muted-foreground"
          )}
        />
      </button>
      {menu}
    </div>
  )
}
