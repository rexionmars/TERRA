/**
 * The browser: every saved analysis, filed under the project that holds it.
 *
 * It replaces the project hub, which was a screen. A screen for reading what
 * you have is a screen you leave the work to visit, and everything it listed
 * is work: opening a run puts it on the board, and deleting one changes what
 * the board can be given. So it is an area of the studio, and it can sit beside
 * the viewport that the thing it opens will be drawn in.
 *
 * SHAPED AFTER UNREAL'S CONTENT BROWSER, which solves this exact problem: a
 * store of assets that has to be searched, filtered, grouped and acted on
 * without leaving the tool. Four regions, and each earns its place:
 *
 *   - SOURCES on the left. A store with no grouping is a list that grows until
 *     it cannot be read. The groups here are the projects, plus the two that
 *     are not projects: everything, and the runs filed under nothing.
 *   - THE TOOLBAR across the top: what is being looked for. Search narrows by
 *     name, the type chips narrow by product, and the view toggle chooses
 *     between tiles and rows.
 *   - THE ITEMS, the region the other three are in service of.
 *   - THE STATUS BAR at the foot, stating the count. Unreal puts it there, and
 *     the studio already has one across its own foot for the same reason: a
 *     count is what tells you whether a filter did what you meant.
 *
 * NO THUMBNAILS, AND NOT AS A SHORTCUT. Unreal renders one per asset; a run's
 * raster is not on the row that lists it -- `overlay_uri` arrives with the
 * loaded payload, so a wall of thumbnails is a wall of loads. What is drawn
 * instead is what Unreal draws for an asset whose thumbnail has not been
 * rendered: a type plate, with the product's own colour along its foot. The
 * colour is doing the work the thumbnail would: telling you, at a glance across
 * the grid, which of these are classifications and which are not.
 *
 * SELECTION IS SINGLE. Unreal's is not, because its operations are bulk ones.
 * Every operation here is on one thing -- open it, move it, delete it -- and a
 * multi-select whose every action applies to one row teaches a model the panel
 * does not have.
 *
 * DELETING A PROJECT DOES NOT DELETE ITS RUNS. The store unfiles them, so they
 * come back under Unfiled; the confirmation says so, because the opposite
 * assumption is the one a reader arrives with.
 */
import { useEffect, useMemo, useState } from "react"
import {
  ChartColumn,
  Check,
  FolderPlus,
  Folders,
  Inbox,
  LayoutGrid,
  List,
  Search,
  Trash2,
  Waves,
  X,
} from "lucide-react"

import {
  CreateProject,
  DeleteAnalysis,
  DeleteProject,
  SetRunProject,
  UpdateProject,
} from "../../../wailsjs/go/main/App"
import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import { runKindLabel, runRowLine } from "@/lib/runSummary"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import {
  StudioContextMenu,
  StudioMenuItem,
} from "@/components/studio/StudioPopover"
import { cn } from "@/lib/utils"
import type { InferenceRun, Project } from "@/lib/types"

/** Width of the sources column, in rem. The narrowest a project name reads at. */
const SOURCES_REM = 9.5

/**
 * The products, in the order the run band offers them, with the colour each
 * one's plate carries.
 *
 * CATEGORICAL, and declared here because there is nowhere else. The palette
 * tokens name roles in the interface -- primary, accent, destructive -- and a
 * product is not a role; the rasters' own scales are continuous and per-run,
 * so a product has no established colour to borrow. These are five hues chosen
 * to be told apart at tile size, which is the only job they do.
 *
 * The classification is neutral rather than a sixth hue. It is the ordinary
 * case and by far the most common, so a grid of them reads as a grid of runs,
 * and the four specialised products are what stand out -- which is the question
 * the colour is here to answer. Giving it a hue of its own also put it 18
 * degrees from the flood's, which is not a distinction at 52 pixels.
 *
 * These are literal because they are data, not theme: a run's product does not
 * change between light and dark. The plate holds them at 0.14 and the glyph at
 * full, so neither is carrying small text on a tinted ground -- see
 * lib/contrast.ts, which the check script measures the tokens against and
 * cannot measure these.
 */
const KINDS = [
  { id: "class", label: "Classification", hue: "215 16% 62%" },
  { id: "water", label: "Surface water", hue: "173 80% 40%" },
  { id: "solar", label: "Solar", hue: "38 92% 50%" },
  { id: "wind", label: "Wind", hue: "262 83% 58%" },
  { id: "flood", label: "Flood", hue: "217 91% 60%" },
] as const

type KindId = (typeof KINDS)[number]["id"]

const KIND_BY_ID = new Map(KINDS.map((k) => [k.id, k]))

/** "all", "unfiled", or a project id. */
type SourceId = string

export function StudioBrowser({
  surface,
  activeProjectId = null,
  onActivateProject,
  onOpenRun,
  busy = false,
}: {
  /** Portal host for the context menus, clamped inside it as every panel is. */
  surface: HTMLElement | null
  activeProjectId?: string | null
  /** Make a project the one new runs are filed under. */
  onActivateProject?: (id: string) => void
  /** Load a run and put it on the board. */
  onOpenRun?: (run: InferenceRun) => void
  /** A run is already loading; a second request would race the first. */
  busy?: boolean
}) {
  const { runs, projects, refreshRuns, refreshProjects } = useAuth()

  const [source, setSource] = useState<SourceId>("all")
  const [query, setQuery] = useState("")
  const [kinds, setKinds] = useState<ReadonlySet<KindId>>(new Set())
  const [tiles, setTiles] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const [runMenu, setRunMenu] = useState<{
    run: InferenceRun
    at: { x: number; y: number }
  } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{
    project: Project
    at: { x: number; y: number }
  } | null>(null)
  const [deleting, setDeleting] = useState<
    { kind: "run"; run: InferenceRun } | { kind: "project"; project: Project } | null
  >(null)
  const [working, setWorking] = useState(false)
  /*
    Naming a project, inline in the column it will appear in.

    One field for both acts: `id` is null while the name is being given to a
    project that does not exist yet, and the id of the row being renamed
    otherwise. A native prompt for the new one would be a second grammar for
    the same act -- and a modal the reader cannot see the list behind.
  */
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(
    null
  )

  /*
    Counts per source, taken once over the whole list.

    Computed here rather than by each row filtering the runs itself: a sources
    column of twenty projects would otherwise walk the runs twenty times on
    every keystroke in the search field, which narrows the items and not these.
  */
  const counts = useMemo(() => {
    const byProject = new Map<string, number>()
    let unfiled = 0
    for (const r of runs) {
      if (r.project_id) {
        byProject.set(r.project_id, (byProject.get(r.project_id) ?? 0) + 1)
      } else unfiled += 1
    }
    return { byProject, unfiled, all: runs.length }
  }, [runs])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return runs.filter((r) => {
      if (source === "unfiled") {
        if (r.project_id) return false
      } else if (source !== "all" && r.project_id !== source) return false
      if (kinds.size && !kinds.has(runKindLabel(r.kind) as KindId)) return false
      if (!q) return true
      return (
        (r.label ?? "").toLowerCase().includes(q) ||
        runRowLine(r).toLowerCase().includes(q)
      )
    })
  }, [runs, source, kinds, query])

  /*
    A selection that survives the filter that hid it is a selection the status
    bar reports and the reader cannot see. Cleared when the item leaves the
    list, rather than when the filter changes -- narrowing to a set that still
    contains it keeps it.
  */
  useEffect(() => {
    if (selected && !items.some((r) => r.id === selected)) setSelected(null)
  }, [items, selected])

  const sourceName =
    source === "all"
      ? "All analyses"
      : source === "unfiled"
        ? "Unfiled"
        : (projects.find((p) => p.id === source)?.name ?? "Project")

  const toggleKind = (id: KindId) =>
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function commitName() {
    if (!naming) return
    const name = naming.name.trim()
    const id = naming.id
    setNaming(null)
    if (!name) return
    try {
      if (id === null) {
        const created = await CreateProject(name, "")
        await refreshProjects()
        /* Straight to what was just made. Creating a project and then having
           to find it in the column is the step this saves. */
        if (created?.id) setSource(created.id)
      } else {
        const project = projects.find((p) => p.id === id)
        if (!project || name === project.name) return
        await UpdateProject({ ...project, name })
        await refreshProjects()
      }
    } catch (e) {
      notifyError(
        id === null
          ? "Could not create the project"
          : "Could not rename the project",
        e
      )
    }
  }

  async function moveRun(run: InferenceRun, projectId: string) {
    try {
      await SetRunProject(run.id, projectId)
      await refreshRuns()
    } catch (e) {
      notifyError("Could not move the analysis", e)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setWorking(true)
    try {
      if (deleting.kind === "run") {
        await DeleteAnalysis(deleting.run.id)
        await refreshRuns()
        notifySuccess("Analysis deleted.")
      } else {
        await DeleteProject(deleting.project.id)
        /*
          Both, and in this order. Deleting a project unfiles its runs, so the
          list this panel draws is stale in two ways at once: the source is
          gone and the items moved to Unfiled. Reading the projects first would
          briefly draw the runs under a source that no longer exists.
        */
        await refreshRuns()
        await refreshProjects()
        if (source === deleting.project.id) setSource("all")
        notifySuccess(`Project "${deleting.project.name}" deleted.`)
      }
      setDeleting(null)
    } catch (e) {
      notifyError(
        deleting.kind === "run"
          ? "Could not delete the analysis"
          : "Could not delete the project",
        e
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        THE TOOLBAR. Search first, because it is what a reader reaches for when
        the store is large enough to need this panel at all; the type chips
        beside it, which are the same question asked categorically.
      */}
      <div
        className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-1.5 size-3 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search analyses"
            aria-label="Search analyses"
            className={cn(
              "h-6 w-full min-w-0 rounded-sm border bg-transparent pl-6 pr-6 text-emphasis",
              "placeholder:text-muted-foreground/70",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
            style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute right-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </label>

        <div className="flex shrink-0 items-center gap-0.5">
          {KINDS.map((k) => {
            const on = kinds.has(k.id)
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => toggleKind(k.id)}
                aria-pressed={on}
                title={`Show only ${k.label.toLowerCase()}`}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-sm border px-1.5 text-micro uppercase tracking-wider transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  on
                    ? "text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                style={
                  on
                    ? {
                        borderColor: `hsl(${k.hue} / 0.55)`,
                        background: `hsl(${k.hue} / 0.12)`,
                      }
                    : undefined
                }
              >
                <span
                  className="size-1.5 rounded-[1px]"
                  style={{ background: `hsl(${k.hue})` }}
                />
                {k.id}
              </button>
            )
          })}
        </div>

        {/* Tiles or rows. Unreal's own toggle, and the same trade: a tile shows
            the type at a glance, a row shows the provenance line in full. */}
        <div
          className="flex shrink-0 items-center rounded-sm border"
          style={{ borderColor: "rgb(var(--p-line) / 0.28)" }}
        >
          {[
            { on: tiles, icon: LayoutGrid, label: "Tiles" },
            { on: !tiles, icon: List, label: "Rows" },
          ].map(({ on, icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setTiles(label === "Tiles")}
              aria-pressed={on}
              title={label}
              aria-label={label}
              className={cn(
                "flex h-6 w-6 items-center justify-center transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                on
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* THE SOURCES COLUMN. */}
        <div
          className="flex shrink-0 flex-col border-r"
          style={{
            width: `${SOURCES_REM}rem`,
            borderColor: "rgb(var(--p-line) / 0.22)",
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            <SourceRow
              icon={Folders}
              label="All analyses"
              count={counts.all}
              on={source === "all"}
              onSelect={() => setSource("all")}
            />
            <SourceRow
              icon={Inbox}
              label="Unfiled"
              count={counts.unfiled}
              on={source === "unfiled"}
              onSelect={() => setSource("unfiled")}
            />

            <div
              aria-hidden
              className="mt-1.5 border-t px-2 pb-0.5 pt-1.5 text-micro uppercase tracking-wider text-muted-foreground/70"
              style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
            >
              Projects
            </div>

            {projects.length === 0 ? (
              <p className="px-2 py-1 text-micro leading-relaxed text-muted-foreground">
                None yet.
              </p>
            ) : (
              projects.map((p) =>
                naming?.id === p.id ? (
                  <NameField
                    key={p.id}
                    value={naming.name}
                    label={`Rename ${p.name}`}
                    onChange={(name) => setNaming({ id: p.id, name })}
                    onCommit={() => void commitName()}
                    onCancel={() => setNaming(null)}
                  />
                ) : (
                  <SourceRow
                    key={p.id}
                    label={p.name}
                    count={counts.byProject.get(p.id) ?? 0}
                    on={source === p.id}
                    /* The dot marks the project new runs are filed under, which
                       is a different fact from which one is being looked at. */
                    marked={p.id === activeProjectId}
                    onSelect={() => setSource(p.id)}
                    onContext={(at) => setProjectMenu({ project: p, at })}
                  />
                )
              )
            )}
            {naming?.id === null && (
              <NameField
                value={naming.name}
                label="Name the new project"
                onChange={(name) => setNaming({ id: null, name })}
                onCommit={() => void commitName()}
                onCancel={() => setNaming(null)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => setNaming({ id: null, name: "" })}
            disabled={working}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 border-t px-2 text-emphasis transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
              working && "cursor-not-allowed opacity-50"
            )}
            style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
          >
            <FolderPlus className="size-3.5" />
            New project
          </button>
        </div>

        {/* THE ITEMS. */}
        <div className="panel-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="p-2 text-meta leading-relaxed text-muted-foreground">
              {runs.length === 0
                ? "No saved analyses yet. A run is recorded here once it finishes."
                : "Nothing here matches. Clear the search or the type filters."}
            </p>
          ) : tiles ? (
            <div className="flex flex-wrap gap-2">
              {items.map((r) => (
                <RunTile
                  key={r.id}
                  run={r}
                  on={r.id === selected}
                  busy={busy}
                  onSelect={() => setSelected(r.id)}
                  onOpen={() => onOpenRun?.(r)}
                  onContext={(at) => {
                    setSelected(r.id)
                    setRunMenu({ run: r, at })
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {items.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  on={r.id === selected}
                  busy={busy}
                  onSelect={() => setSelected(r.id)}
                  onOpen={() => onOpenRun?.(r)}
                  onContext={(at) => {
                    setSelected(r.id)
                    setRunMenu({ run: r, at })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/*
        THE STATUS BAR. The count under the filters that produced it, which is
        what says whether a filter did what was meant by it.
      */}
      <div
        className="flex h-[22px] shrink-0 items-center gap-2 border-t px-2 text-micro text-muted-foreground"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        <span className="min-w-0 truncate">
          {items.length} {items.length === 1 ? "item" : "items"}
          {items.length !== runs.length && ` of ${runs.length}`}
          {selected && " · 1 selected"}
        </span>
        <span className="ml-auto min-w-0 truncate">{sourceName}</span>
      </div>

      {runMenu && (
        <StudioContextMenu
          at={runMenu.at}
          surface={surface}
          title={runLabel(runMenu.run)}
          onClose={() => setRunMenu(null)}
        >
          <StudioMenuItem
            icon={ChartColumn}
            label="Open in the studio"
            disabled={busy || !onOpenRun}
            onSelect={() => {
              onOpenRun?.(runMenu.run)
              setRunMenu(null)
            }}
          />
          {/*
            Filing, listed one project per row rather than behind a submenu.
            The list is the projects the user has, which is the same list the
            column beside this already draws -- a submenu would hide a choice
            that is on screen.
          */}
          {projects.length > 0 && (
            <div
              className="my-1 border-t"
              style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
            />
          )}
          {projects.map((p) => (
            <StudioMenuItem
              key={p.id}
              indented
              icon={p.id === runMenu.run.project_id ? Check : undefined}
              label={p.name}
              onSelect={() => {
                void moveRun(runMenu.run, p.id)
                setRunMenu(null)
              }}
            />
          ))}
          {runMenu.run.project_id && (
            <StudioMenuItem
              indented
              label="Unfile"
              onSelect={() => {
                void moveRun(runMenu.run, "")
                setRunMenu(null)
              }}
            />
          )}
          <div
            className="my-1 border-t"
            style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
          />
          <StudioMenuItem
            icon={Trash2}
            label="Delete"
            onSelect={() => {
              setDeleting({ kind: "run", run: runMenu.run })
              setRunMenu(null)
            }}
          />
        </StudioContextMenu>
      )}

      {projectMenu && (
        <StudioContextMenu
          at={projectMenu.at}
          surface={surface}
          title={projectMenu.project.name}
          onClose={() => setProjectMenu(null)}
        >
          <StudioMenuItem
            icon={Check}
            label="File new runs here"
            checked={projectMenu.project.id === activeProjectId}
            disabled={
              !onActivateProject || projectMenu.project.id === activeProjectId
            }
            onSelect={() => {
              onActivateProject?.(projectMenu.project.id)
              setProjectMenu(null)
            }}
          />
          <StudioMenuItem
            label="Rename"
            onSelect={() => {
              setNaming({
                id: projectMenu.project.id,
                name: projectMenu.project.name,
              })
              setProjectMenu(null)
            }}
          />
          <StudioMenuItem
            icon={Trash2}
            label="Delete"
            onSelect={() => {
              setDeleting({ kind: "project", project: projectMenu.project })
              setProjectMenu(null)
            }}
          />
        </StudioContextMenu>
      )}

      {deleting?.kind === "run" && (
        <ConfirmDelete
          eyebrow="Delete analysis"
          title={runLabel(deleting.run)}
          subtitle="The record and its rasters go. The area it was made over stays."
          confirmLabel="Delete"
          busy={working}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {deleting?.kind === "project" && (
        <ConfirmDelete
          eyebrow="Delete project"
          title={deleting.project.name}
          subtitle={`${counts.byProject.get(deleting.project.id) ?? 0} analyses are filed here. They are not deleted -- they move to Unfiled.`}
          confirmLabel="Delete the project"
          busy={working}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}

/**
 * What to call a run.
 *
 * The stored label where there is one, and the product plus its date where
 * there is not: an untitled row listed as its uuid is a row nobody can pick
 * out of a grid.
 */
function runLabel(run: InferenceRun): string {
  const l = run.label?.trim()
  if (l) return l
  const kind = KIND_BY_ID.get(runKindLabel(run.kind) as KindId)
  return `${kind?.label ?? "Analysis"} · ${run.created_at.slice(0, 10)}`
}

/**
 * The one field both naming acts use.
 *
 * Committed on Enter and on losing focus, abandoned on Escape -- the three
 * outcomes a reader expects of a field that appeared in place of a row.
 */
function NameField({
  value,
  label,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  label: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit()
        if (e.key === "Escape") onCancel()
      }}
      aria-label={label}
      placeholder={label}
      className="mx-1 h-6 w-[calc(100%-0.5rem)] rounded-sm border bg-transparent px-1.5 text-emphasis placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      style={{ borderColor: "rgb(var(--p-line) / 0.4)" }}
    />
  )
}

function SourceRow({
  icon: Icon,
  label,
  count,
  on,
  marked,
  onSelect,
  onContext,
}: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  count: number
  on: boolean
  /** Where new runs are filed, which is not the same as what is being read. */
  marked?: boolean
  onSelect: () => void
  onContext?: (at: { x: number; y: number }) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={
        onContext
          ? (e) => {
              e.preventDefault()
              onContext({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
      aria-current={on ? "true" : undefined}
      title={label}
      className={cn(
        "flex h-6 w-full items-center gap-1.5 px-2 text-left text-emphasis transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        on
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground"
      )}
    >
      {Icon ? (
        <Icon className="size-3 shrink-0" />
      ) : (
        <span className="flex size-3 shrink-0 items-center justify-center">
          <span
            className={cn(
              "size-1.5 rounded-full",
              marked ? "bg-primary" : "bg-transparent"
            )}
          />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">
        {count}
      </span>
    </button>
  )
}

/** The plate a tile and a row share: a product's glyph over its own colour. */
function KindPlate({ run, size }: { run: InferenceRun; size: "tile" | "row" }) {
  const kind = KIND_BY_ID.get(runKindLabel(run.kind) as KindId) ?? KINDS[0]
  const Icon = kind.id === "water" || kind.id === "flood" ? Waves : ChartColumn
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
        size === "tile" ? "h-[52px] w-full" : "size-6"
      )}
      style={{ background: `hsl(${kind.hue} / 0.14)` }}
    >
      <Icon
        className={size === "tile" ? "size-5" : "size-3.5"}
        style={{ color: `hsl(${kind.hue})` }}
        strokeWidth={1.75}
      />
    </div>
  )
}

function RunTile({
  run,
  on,
  busy,
  onSelect,
  onOpen,
  onContext,
}: {
  run: InferenceRun
  on: boolean
  busy: boolean
  onSelect: () => void
  onOpen: () => void
  onContext: (at: { x: number; y: number }) => void
}) {
  const kind = KIND_BY_ID.get(runKindLabel(run.kind) as KindId) ?? KINDS[0]
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={() => !busy && onOpen()}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext({ x: e.clientX, y: e.clientY })
      }}
      aria-current={on ? "true" : undefined}
      title={`${runLabel(run)} — ${runRowLine(run)}`}
      className={cn(
        "flex w-[8.5rem] flex-col gap-1 rounded-sm border p-1 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        on
          ? "border-primary/60 bg-primary/10"
          : "border-transparent hover:bg-surface-raised/60"
      )}
    >
      <KindPlate run={run} size="tile" />
      {/* The type strip along the plate's foot, which is what Unreal's tile
          carries and what makes the grid readable by product at a glance. */}
      <span
        className="h-[2px] w-full rounded-full"
        style={{ background: `hsl(${kind.hue})` }}
      />
      <span className="line-clamp-2 text-emphasis leading-snug text-foreground">
        {runLabel(run)}
      </span>
      <span className="truncate text-micro text-muted-foreground">
        {run.created_at.slice(0, 10)}
      </span>
    </button>
  )
}

function RunRow({
  run,
  on,
  busy,
  onSelect,
  onOpen,
  onContext,
}: {
  run: InferenceRun
  on: boolean
  busy: boolean
  onSelect: () => void
  onOpen: () => void
  onContext: (at: { x: number; y: number }) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={() => !busy && onOpen()}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext({ x: e.clientX, y: e.clientY })
      }}
      aria-current={on ? "true" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-sm px-1 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        on
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground"
      )}
    >
      <KindPlate run={run} size="row" />
      <span className="min-w-0 flex-1 truncate text-emphasis text-foreground">
        {runLabel(run)}
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-micro text-muted-foreground sm:block">
        {runRowLine(run)}
      </span>
      <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">
        {run.created_at.slice(0, 10)}
      </span>
    </button>
  )
}
