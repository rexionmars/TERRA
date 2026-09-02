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
 * PLACED BY `StudioPopover`, WHICH MEASURES. This opened with `left-full`, on
 * the reading that the list belongs beside the column it is added from -- true
 * while the outliner WAS a column, fixed at 15rem down the left edge.
 *
 * The area system ended that. An outliner is an editor now and goes wherever
 * the partition puts it, and in the default Layout it is the RIGHT column:
 * `left-full` then opens a 17rem panel past the right edge of the window,
 * where the list is clipped and the rows run out of the screen. Nothing about
 * the CSS was wrong; the thing it measured against stopped being where it was.
 *
 * The first version of this file DID measure, into a portal on document.body,
 * and was replaced because a viewport-relative position had three ways to end
 * up somewhere unintended. `StudioPopover` is the answer the studio arrived at
 * for the same problem: it portals into the STUDIO SURFACE, clamps on both
 * axes, and flips above the anchor where there is no room below. Every menu in
 * every area header already opens that way, so this is not a fourth mechanism.
 *
 * The control still lives below the scrolling tree rather than inside it, so
 * it does not scroll away from the list it adds to.
 */
import { useMemo, useState } from "react"
import { Plus, MagnifyingGlass } from "@phosphor-icons/react"
import { displayRunLabel } from "@/lib/aoiLabel"
import { datesByMonth, runRowLine } from "@/lib/runSummary"
import type { InferenceRun, Project } from "@/lib/types"
import { StudioPopover } from "@/components/studio/StudioPopover"
import { cn } from "@/lib/utils"

export function RunPicker({
  runs,
  projects,
  /** Already on the board, so it cannot be added twice. */
  excludeRunIds,
  busy,
  surface,
  onPick,
}: {
  runs: InferenceRun[]
  projects: Project[]
  excludeRunIds: ReadonlySet<string>
  busy?: boolean
  /** The studio surface the list is portalled into and clamped inside. */
  surface: HTMLElement | null
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
    <StudioPopover
      open={open}
      onOpenChange={setOpen}
      surface={surface}
      widthRem={17}
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref as React.Ref<HTMLButtonElement>}
          onClick={p.onClick}
          disabled={busy}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup={p["aria-haspopup"]}
          className={cn(
            "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            open
              ? "bg-surface-raised text-foreground"
              : "text-muted-foreground hover:bg-surface-raised/40 hover:text-foreground"
          )}
        >
          <Plus className="size-3.5 shrink-0" />
          {busy ? "Loading…" : "Add a run"}
        </button>
      )}
    >
      {(
        /*
          Layout only. The plate -- background, border, shadow, width and the
          placement -- belongs to `StudioPopover`, which every other menu in the
          studio already wears; drawing a second one here is how two surfaces
          come to disagree about what a panel looks like.

          The height is still bounded here, because this is the one popover
          whose content is a list of unknown length.
        */
        <div className="flex max-h-[20rem] flex-col overflow-hidden">
          <label
            className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5"
            style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
          >
            <MagnifyingGlass className="size-3 shrink-0 text-muted-foreground" />
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
          </label>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {total === 0 ? (
              <p className="px-2.5 py-2 text-meta leading-relaxed text-muted-foreground">
                {query.trim()
                  ? "No run matches that."
                  : runs.length === 0
                    ? "No saved runs yet."
                    : "Every saved run is already in the studio."}
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
                    // The popover's own plate, so a heading scrolled under does
                    // not show the rows through a differently coloured band.
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
                      className="flex w-full flex-col items-start gap-px px-2 py-1 text-left leading-tight transition-colors hover:bg-surface-raised/60"
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
    </StudioPopover>
  )
}
