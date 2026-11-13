/**
 * Choosing another run to put on the board.
 *
 * The whole reason this surface exists: on a map, two analyses of areas
 * hundreds of kilometres apart cannot be placed side by side, because the map
 * puts them where they are. This is where the second one is chosen.
 *
 * A RUN IS LISTED AS THE ANALYSES SCREEN SHOWS IT: its picture, the area it
 * was made over, and under the name what it found -- the class covering most
 * of a classification, the reading of any other product. It was listed by its
 * label, run-field-22-20260927-101030, which is near-identical across a
 * project's runs and was cut before the part that told two apart. The label is
 * still matched by the search.
 *
 * Grouped by project, newest first, because the project says where and the
 * name says what; runs with no project are a group of their own at the end.
 *
 * PLACED BY `MenuPopover`, which portals into the surface, clamps on both axes
 * and flips above the anchor where there is no room below, as every menu on
 * the boards does. The control stays outside the scrolling board, so it does
 * not scroll away from the list it adds to.
 */
import { useMemo, useState } from "react"

import { MagnifyingGlass, Plus } from "@/components/icons"
import {
  RunPicture,
  kindOf,
  runFinding,
  runTitle,
  tint,
} from "@/components/shell/analysisParts"
import { MenuPopover } from "@/components/workspace/MenuPopover"
import { runRowLine } from "@/lib/runSummary"
import type { InferenceRun, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

export function RunPicker({
  runs,
  projects,
  /** Already in hand, so it cannot be added twice. */
  excludeRunIds,
  busy,
  surface,
  onPick,
}: {
  runs: InferenceRun[]
  projects: Project[]
  excludeRunIds: ReadonlySet<string>
  busy?: boolean
  /** The surface the list is portalled into and clamped inside. */
  surface: HTMLElement | null
  onPick: (run: InferenceRun) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const projectName = new Map(projects.map((p) => [p.id, p.name]))
    const matches = (r: InferenceRun) =>
      !q ||
      [
        runTitle(r),
        r.label ?? "",
        kindOf(r).label,
        runRowLine(r),
        projectName.get(r.project_id ?? "") ?? "",
      ].some((t) => t.toLowerCase().includes(q))

    const byProject = new Map<string, InferenceRun[]>()
    for (const r of runs) {
      if (excludeRunIds.has(r.id) || !matches(r)) continue
      const key = r.project_id || ""
      byProject.set(key, [...(byProject.get(key) ?? []), r])
    }
    for (const list of byProject.values()) {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    const named = projects
      .filter((p) => byProject.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, runs: byProject.get(p.id)! }))
    const loose = byProject.get("")
    return loose ? [...named, { id: "", name: "No project", runs: loose }] : named
  }, [runs, projects, excludeRunIds, query])

  const total = groups.reduce((n, g) => n + g.runs.length, 0)

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      surface={surface}
      widthRem={24}
      align="end"
      trigger={(p) => (
        <button
          type="button"
          ref={p.ref}
          onClick={p.onClick}
          disabled={busy}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup={p["aria-haspopup"]}
          title="Bring in a saved run"
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border px-2.5 text-label transition-colors",
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            open
              ? "bg-selected text-foreground"
              : "text-muted-foreground hover:bg-hover hover:text-foreground"
          )}
        >
          <Plus className="size-3.5 shrink-0" />
          {busy ? "Loading…" : "Add a run"}
        </button>
      )}
    >
      {/*
        Layout only: the plate, its edge, shadow and placement belong to
        MenuPopover, as every other menu's do. The height is bounded here,
        since this is the one popover whose content is a list of any length.
      */}
      <div className="flex max-h-[26rem] flex-col overflow-hidden">
        <label className="mx-1 mt-1 mb-1.5 flex shrink-0 items-center gap-2 rounded-full border border-[rgb(var(--p-line)/0.45)] px-3 py-1.5">
          <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
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
            placeholder="Find by area, product or project"
            aria-label="Find a run"
            className="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {total === 0 ? (
            <p className="px-3 py-3 text-label text-muted-foreground">
              {query.trim()
                ? "No run matches that."
                : runs.length === 0
                  ? "No saved runs yet."
                  : "Every saved run is already here."}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.id || "none"} role="group" aria-label={g.name}>
                {/*
                  Sticky, because the list scrolls past several projects and a
                  row seen without its heading says what was analysed without
                  saying where. Opaque, in the tone the popover's plate starts
                  at, so rows scrolled under it do not show through.
                */}
                <p
                  className="sticky top-0 z-10 flex items-baseline justify-between border-b border-[rgb(var(--p-line)/0.3)] px-3 pt-2.5 pb-1.5 text-label font-medium text-foreground"
                  style={{ background: "rgb(var(--p-control))" }}
                >
                  {g.name}
                  <span className="telemetry text-meta font-normal text-muted-foreground">
                    {g.runs.length}
                  </span>
                </p>
                {g.runs.map((r) => (
                  <PickerRow
                    key={r.id}
                    run={r}
                    onPick={() => {
                      setOpen(false)
                      onPick(r)
                    }}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </MenuPopover>
  )
}

function PickerRow({ run, onPick }: { run: InferenceRun; onPick: () => void }) {
  const kind = kindOf(run)
  const finding = runFinding(run)
  const made = new Date(run.created_at)
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      title={`${runTitle(run)}: ${runRowLine(run)}\n${run.label ?? ""}`}
      className="flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
    >
      <RunPicture
        run={run}
        className="size-10 shrink-0 rounded-sm [&_img]:p-1"
        glyph="size-4"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-read text-foreground">{runTitle(run)}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
          {finding.swatch ? (
            <span
              className="size-2 shrink-0 rounded-xs"
              style={{ background: finding.swatch }}
            />
          ) : (
            <kind.icon
              className="size-3 shrink-0"
              style={{ color: tint(kind.token) }}
            />
          )}
          <span className="truncate">{finding.text}</span>
        </span>
      </span>
      <span className="telemetry shrink-0 self-start pt-0.5 text-meta text-muted-foreground">
        {Number.isNaN(made.getTime())
          ? ""
          : made.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
      </span>
    </button>
  )
}
