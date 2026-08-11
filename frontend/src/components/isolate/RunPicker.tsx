/**
 * Choosing another run to put on the board.
 *
 * The whole reason this surface exists: on a map, two analyses of areas
 * hundreds of kilometres apart cannot be placed side by side, because the map
 * puts them where they are. This is where the second one is chosen.
 *
 * Grouped by project rather than listed flat, because a run's name says what
 * was analysed and the project says where -- and with runs from several fields
 * in one list, the names alone do not separate them. The period is what tells
 * two runs of one project apart, so it is on every row.
 *
 * In a portal for the same reason the project menu is: the column it opens
 * from is 15rem wide and scrolls, so a list rendered inside it would be
 * clipped by the thing it is trying to escape.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Plus, Search } from "lucide-react"
import { displayRunLabel } from "@/lib/aoiLabel"
import { runRowLine } from "@/lib/runSummary"
import type { InferenceRun, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

const PICKER_W = 288

export function RunPicker({
  runs,
  projects,
  /** Already on the board, so it cannot be added twice. */
  excludeRunIds,
  busy,
  onPick,
}: {
  runs: InferenceRun[]
  projects: Project[]
  excludeRunIds: ReadonlySet<string>
  busy?: boolean
  onPick: (run: InferenceRun) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const place = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    /*
      Opens upward from a control at the foot of the column, and to its right.
      Anchored to the button's bottom rather than its top so the list grows
      into the board, which has room, instead of off the top of the window.
    */
    const height = Math.min(360, window.innerHeight - 32)
    setPos({
      top: Math.max(16, Math.min(r.bottom - height, window.innerHeight - height - 16)),
      left: Math.min(r.right + 6, window.innerWidth - PICKER_W - 8),
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      setQuery("")
      return
    }
    place()
  }, [open])

  useEffect(() => {
    if (!open) return
    const reposition = () => place()
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [open])

  /**
   * The runs on offer, by project, with the ones already on the board removed.
   *
   * Runs with no project are their own group at the end rather than dropped:
   * a run made before projects existed, or made with none active, is still a
   * run someone may want beside another.
   */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (r: InferenceRun) =>
      !q ||
      displayRunLabel(r.label).toLowerCase().includes(q) ||
      (projects.find((p) => p.id === r.project_id)?.name ?? "")
        .toLowerCase()
        .includes(q)

    const available = runs.filter((r) => !excludeRunIds.has(r.id) && matches(r))
    const byProject = new Map<string, InferenceRun[]>()
    for (const r of available) {
      const key = r.project_id || ""
      const list = byProject.get(key)
      if (list) list.push(r)
      else byProject.set(key, [r])
    }
    for (const list of byProject.values()) {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    const named = projects
      .filter((p) => byProject.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, runs: byProject.get(p.id)! }))
    const loose = byProject.get("")
    return loose
      ? [...named, { id: "", name: "No project", runs: loose }]
      : named
  }, [runs, projects, excludeRunIds, query])

  const total = groups.reduce((n, g) => n + g.runs.length, 0)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-meta transition-colors",
          "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
          "text-muted-foreground hover:bg-surface-raised/40 hover:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
        {busy ? "Loading…" : "Add a run"}
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[5000] cursor-default"
              aria-label="Close run picker"
              onClick={() => setOpen(false)}
            />
            <div
              className="fixed z-[5001] flex flex-col overflow-hidden rounded-sm border shadow-lg"
              style={{
                top: pos.top,
                left: pos.left,
                width: PICKER_W,
                maxHeight: Math.min(360, window.innerHeight - 32),
                background: "rgb(var(--p-surface))",
                borderColor: "rgb(var(--p-line) / 0.4)",
              }}
            >
              <label className="flex shrink-0 items-center gap-1.5 border-b px-2.5 py-2"
                style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}>
                <Search className="size-3 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // The board closes on Escape from a listener on the
                    // window; here it should close the picker and no more.
                    e.stopPropagation()
                    if (e.key === "Escape") setOpen(false)
                  }}
                  placeholder="Find a run"
                  className="min-w-0 flex-1 border-0 bg-transparent text-meta text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>

              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {total === 0 ? (
                  <p className="px-2.5 py-2 text-meta leading-relaxed text-muted-foreground">
                    {query.trim()
                      ? "No run matches that."
                      : runs.length === 0
                        ? "No saved runs yet."
                        : "Every saved run is already on the board."}
                  </p>
                ) : (
                  groups.map((g) => (
                    <div key={g.id || "none"}>
                      <p className="px-2.5 pb-0.5 pt-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {g.name}
                      </p>
                      {g.runs.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onPick(r)
                          }}
                          className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-raised/60"
                        >
                          <span className="w-full truncate text-emphasis text-foreground">
                            {displayRunLabel(r.label) || r.model_kind}
                          </span>
                          <span className="telemetry w-full truncate text-meta text-muted-foreground">
                            {runRowLine(r)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  )
}
