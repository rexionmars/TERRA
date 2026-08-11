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
 * NO PORTAL, and no measured position. The first version put the list in a
 * portal on document.body and computed a place for it from the button's
 * rectangle -- a portal to escape a clip, a layout effect to measure, a
 * viewport-relative position to keep in step, and three ways for the list to
 * be somewhere other than where it was wanted. It is a sibling of the button
 * now, placed by CSS against the column itself: `left-full` puts it beside the
 * column, and because its containing block is the column rather than the
 * scrolling tree inside it, the scroller does not clip it.
 */
import { useMemo, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { displayRunLabel } from "@/lib/aoiLabel"
import { datesByMonth, runRowLine } from "@/lib/runSummary"
import type { InferenceRun, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

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
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-meta transition-colors",
          "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open
            ? "bg-surface-raised text-foreground"
            : "text-muted-foreground hover:bg-surface-raised/40 hover:text-foreground"
        )}
      >
        <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
        {busy ? "Loading…" : "Add a run"}
      </button>

      {open && (
        /*
          Its own raised surface, not `.panel`.

          `.panel` is `rgb(var(--p-ink) / 0.55)` over a backdrop blur. Over the
          map that reads, because the map is imagery and the blur has something
          to work on. This board is painted in flat `--p-ink`, so ink at 55 %
          composited on ink is ink -- a contrast ratio of 1.000 against its own
          background, with a 28 %-alpha border as the only evidence it is
          there. Measured, after making exactly that mistake in the name of
          matching the project menu. --p-surface-raised gives 1.333.
        */
        <div
          className="absolute bottom-2 left-full z-[20] ml-1.5 flex max-h-[22rem] w-[17rem] flex-col overflow-hidden rounded-sm border shadow-xl"
          style={{
            background: "rgb(var(--p-surface-raised))",
            borderColor: "rgb(var(--p-line-strong) / 0.5)",
          }}
        >
          <label
            className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5"
            style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
          >
            <Search className="size-3 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // The board closes on Escape from a listener on the window;
                // here it should close the list and no more.
                e.stopPropagation()
                if (e.key === "Escape") setOpen(false)
              }}
              placeholder="Find a run"
              className="min-w-0 flex-1 border-0 bg-transparent text-meta text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
            </button>
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
                  {/*
                    Sticky, because the list scrolls past several projects and
                    a row seen without its heading says what was analysed
                    without saying where.
                  */}
                  <p
                    className="eyebrow !text-[9px] sticky top-0 z-10 px-2 py-1"
                    style={{ background: "rgb(var(--p-surface-raised))" }}
                  >
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
                      title={runRowLine(r)}
                      className="flex w-full flex-col items-start gap-px px-2 py-1 text-left leading-tight transition-colors hover:bg-secondary/70"
                    >
                      <span className="w-full truncate text-meta text-foreground">
                        {displayRunLabel(r.label) || r.model_kind}
                      </span>
                      {/*
                        What actually separates two runs of one project. The
                        label above is near-identical across a project's runs
                        -- it is `run-<area>-<timestamp>` -- so this is the
                        line being read.
                      */}
                      <span className="telemetry w-full truncate text-[9px] text-muted-foreground">
                        {datesByMonth(runRowLine(r))}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
