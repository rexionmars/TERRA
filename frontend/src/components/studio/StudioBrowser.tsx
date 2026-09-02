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
 *   - SOURCES on the left, a tree. A store with no grouping is a list that
 *     grows until it cannot be read. Two levels, rooted at All: the folders are
 *     the projects plus the runs filed under none, and inside each folder are
 *     the products it actually holds. A folder holding one product draws no
 *     children, because one product is not a choice between products.
 *   - THE TOOLBAR across the top: what is being looked for. Search narrows by
 *     name, the type chips narrow by product, and the view toggle chooses
 *     between tiles and rows.
 *   - THE ITEMS, the region the other three are in service of. Folders are
 *     drawn here too, before the runs, and entered with a double-click. That
 *     is Unreal's model and the reason its browser scales: the tree is for
 *     jumping, the grid is for walking, and entering a folder is a press on
 *     the thing already under the pointer. Standing at the root with nothing
 *     asked, the grid is folders alone; ask a search or a type, and it answers
 *     ACROSS the folders, since a query answered only inside the one already
 *     open is a query you repeat once per folder.
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
  ChevronRight,
  Folder,
  FolderOpen,
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

/**
 * Width of the sources column, in rem.
 *
 * A tree, so the floor is not the longest name but the deepest row: two levels
 * of indent and a disclosure triangle spend 1.75rem before a product's name
 * starts, and "Classification" is the longest of the five. Below this the
 * products truncate to where they no longer name themselves, which is the one
 * thing the second level is for.
 */
const SOURCES_REM = 11.5

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

/**
 * Where in the store the reader is standing.
 *
 * A path of up to two parts, the way Unreal's is a path of folders: the root
 * holds the projects and the unfiled runs, and each of those holds its runs
 * grouped by product. The second part is optional because a project is a place
 * you can stand; the product under it is a narrower one.
 */
type Source =
  | { scope: "all" }
  | { scope: "unfiled"; kind?: KindId }
  | { scope: "project"; id: string; kind?: KindId }

/** One string per node, for the expansion set and for React keys. */
function sourceKey(src: Source): string {
  if (src.scope === "all") return "all"
  const head = src.scope === "unfiled" ? "unfiled" : src.scope + ":" + src.id
  return src.kind ? head + "/" + src.kind : head
}

function sameSource(a: Source, b: Source): boolean {
  return sourceKey(a) === sourceKey(b)
}

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

  const [source, setSource] = useState<Source>({ scope: "all" })
  /*
    Which folders are open. The root starts open, because a tree whose only
    visible row is its own root shows nothing about the store it indexes.
  */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(["all"])
  )
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
    /** Per folder, and per product inside it: the tree draws both. */
    const byFolder = new Map<string, { total: number; kinds: Map<KindId, number> }>()
    const bump = (folder: string, kind: KindId) => {
      let e = byFolder.get(folder)
      if (!e) {
        e = { total: 0, kinds: new Map() }
        byFolder.set(folder, e)
      }
      e.total += 1
      e.kinds.set(kind, (e.kinds.get(kind) ?? 0) + 1)
    }
    for (const r of runs) {
      bump(r.project_id || "unfiled", runKindLabel(r.kind) as KindId)
    }
    return { byFolder, all: runs.length }
  }, [runs])

  const folderCount = (id: string) => counts.byFolder.get(id)?.total ?? 0
  /*
    The products present in a folder, in the table's order rather than in the
    order the runs happen to be in. A folder holding only classifications draws
    one child, which is honest: there is nothing to choose between.
  */
  const folderKinds = (id: string): readonly KindId[] => {
    const k = counts.byFolder.get(id)?.kinds
    return k ? KINDS.map((x) => x.id).filter((x) => k.has(x)) : []
  }

  /*
    Whether anything is narrowing the view.

    It decides what the root shows. Standing at the root with nothing asked,
    the grid holds folders -- which is Unreal's model and the reason a store
    with many runs is navigable at all. Ask something, and the search runs
    THROUGH the folders and the grid holds what it found, which is what a
    filter is for: a query answered only within the folder you already opened
    is a query you have to repeat once per folder.
  */
  const filtering = query.trim().length > 0 || kinds.size > 0

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (source.scope === "all" && !filtering) return []
    return runs.filter((r) => {
      const folder = r.project_id || "unfiled"
      if (source.scope === "unfiled" && folder !== "unfiled") return false
      if (source.scope === "project" && folder !== source.id) return false
      if (source.scope !== "all" && source.kind) {
        if (runKindLabel(r.kind) !== source.kind) return false
      }
      if (kinds.size && !kinds.has(runKindLabel(r.kind) as KindId)) return false
      if (!q) return true
      return (
        (r.label ?? "").toLowerCase().includes(q) ||
        runRowLine(r).toLowerCase().includes(q)
      )
    })
  }, [runs, source, kinds, query, filtering])

  /** The folders drawn in the grid, which is the root with nothing asked. */
  const folders = useMemo(() => {
    if (source.scope !== "all" || filtering) return []
    const out: { id: string; name: string; count: number }[] = []
    if (folderCount("unfiled") > 0) {
      out.push({
        id: "unfiled",
        name: "Unfiled",
        count: folderCount("unfiled"),
      })
    }
    for (const p of projects) {
      out.push({ id: p.id, name: p.name, count: folderCount(p.id) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, filtering, projects, counts])

  /*
    A selection that survives the filter that hid it is a selection the status
    bar reports and the reader cannot see. Cleared when the item leaves the
    list, rather than when the filter changes -- narrowing to a set that still
    contains it keeps it.
  */
  useEffect(() => {
    if (selected && !items.some((r) => r.id === selected)) setSelected(null)
  }, [items, selected])

  /* The path, as Unreal writes it in its own breadcrumb: where you are, and
     under it the product if one is chosen. */
  const sourceName = (() => {
    const head =
      source.scope === "all"
        ? "All"
        : source.scope === "unfiled"
          ? "Unfiled"
          : (projects.find((p) => p.id === source.id)?.name ?? "Project")
    const kind =
      source.scope !== "all" && source.kind
        ? KIND_BY_ID.get(source.kind)?.label
        : null
    return kind ? head + " / " + kind : head
  })()

  const toggleOpen = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
        if (created?.id) setSource({ scope: "project", id: created.id })
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
        if (source.scope === "project" && source.id === deleting.project.id) {
          setSource({ scope: "all" })
        }
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
          {/*
            A SECTION HEADER, as Unreal puts one over each of its source trees.
            One section here rather than its two: it separates a favourites
            list from a project's own content, and there are no favourites to
            separate from.
          */}
          <div
            className="flex h-6 shrink-0 items-center gap-1.5 border-b px-2 text-micro uppercase tracking-wider text-muted-foreground/70"
            style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
          >
            <Folders className="size-3" />
            <span className="min-w-0 flex-1 truncate">Sources</span>
          </div>

          <div
            role="tree"
            aria-label="Projects and products"
            className="min-h-0 flex-1 overflow-y-auto py-1"
          >
            {/*
              THE ROOT. It is a place to stand and not just a heading: standing
              here is what draws the folders in the grid, which is how the
              store is entered.
            */}
            <SourceNode
              depth={0}
              label="All"
              count={counts.all}
              open={expanded.has("all")}
              hasChildren
              on={sameSource(source, { scope: "all" })}
              onToggle={() => toggleOpen("all")}
              onSelect={() => setSource({ scope: "all" })}
            />

            {expanded.has("all") && (
              <>
                {folderCount("unfiled") > 0 && (
                  <FolderBranch
                    id="unfiled"
                    name="Unfiled"
                    depth={1}
                    source={source}
                    expanded={expanded}
                    kinds={folderKinds("unfiled")}
                    count={folderCount("unfiled")}
                    counts={counts.byFolder.get("unfiled")?.kinds}
                    onToggle={() => toggleOpen("unfiled")}
                    onSelect={(kind) => setSource({ scope: "unfiled", kind })}
                  />
                )}

                {projects.map((p) =>
                  naming?.id === p.id ? (
                    <NameField
                      key={p.id}
                      indent={1}
                      value={naming.name}
                      label={`Rename ${p.name}`}
                      onChange={(name) => setNaming({ id: p.id, name })}
                      onCommit={() => void commitName()}
                      onCancel={() => setNaming(null)}
                    />
                  ) : (
                    <FolderBranch
                      key={p.id}
                      id={p.id}
                      name={p.name}
                      depth={1}
                      source={source}
                      expanded={expanded}
                      kinds={folderKinds(p.id)}
                      count={folderCount(p.id)}
                      counts={counts.byFolder.get(p.id)?.kinds}
                      /* The dot marks the project new runs are filed under,
                         which is a different fact from which one is open. */
                      marked={p.id === activeProjectId}
                      onToggle={() => toggleOpen(p.id)}
                      onSelect={(kind) =>
                        setSource({ scope: "project", id: p.id, kind })
                      }
                      onContext={(at) => setProjectMenu({ project: p, at })}
                    />
                  )
                )}

                {naming?.id === null && (
                  <NameField
                    indent={1}
                    value={naming.name}
                    label="Name the new project"
                    onChange={(name) => setNaming({ id: null, name })}
                    onCommit={() => void commitName()}
                    onCancel={() => setNaming(null)}
                  />
                )}

                {projects.length === 0 && folderCount("unfiled") === 0 && (
                  <p className="py-1 pl-6 pr-2 text-micro leading-relaxed text-muted-foreground">
                    Nothing filed yet.
                  </p>
                )}
              </>
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
          {/*
            FOLDERS FIRST, and in the grid rather than only in the tree. This is
            what Unreal does and it is the reason its browser scales: entering
            a folder is a double-click on the thing you are already looking at,
            so the tree is for jumping and the grid is for walking.

            Only at the root, and only with nothing asked. There are two levels
            here, so a folder inside a folder does not arise; and a search is
            answered across all of them at once.
          */}
          {folders.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {folders.map((f) => (
                <FolderTile
                  key={f.id}
                  name={f.name}
                  count={f.count}
                  onOpen={() =>
                    setSource(
                      f.id === "unfiled"
                        ? { scope: "unfiled" }
                        : { scope: "project", id: f.id }
                    )
                  }
                  onContext={(at) => {
                    const p = projects.find((x) => x.id === f.id)
                    if (p) setProjectMenu({ project: p, at })
                  }}
                />
              ))}
            </div>
          )}

          {items.length === 0 && folders.length === 0 ? (
            <p className="p-2 text-meta leading-relaxed text-muted-foreground">
              {runs.length === 0
                ? "No saved analyses yet. A run is recorded here once it finishes."
                : filtering
                  ? "Nothing here matches. Clear the search or the type filters."
                  : "This folder is empty."}
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
          {/* Folders are counted as items, because they are what is on screen.
              A root reading "0 items" over a grid of five folders is a count
              of the wrong thing. */}
          {folders.length + items.length}{" "}
          {folders.length + items.length === 1 ? "item" : "items"}
          {filtering && ` of ${runs.length}`}
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
          subtitle={`${folderCount(deleting.project.id)} analyses are filed here. They are not deleted -- they move to Unfiled.`}
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
  indent = 0,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  label: string
  /** Tree depth of the row it stands in for, so it does not step out of it. */
  indent?: number
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <input
      autoFocus
      style={{
        marginLeft: `${0.25 + indent * 0.75}rem`,
        borderColor: "rgb(var(--p-line) / 0.4)",
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit()
        if (e.key === "Escape") onCancel()
      }}
      aria-label={label}
      placeholder={label}
      className="mr-1 h-6 w-[calc(100%-1.5rem)] rounded-sm border bg-transparent px-1.5 text-emphasis placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

/**
 * One row of the sources tree.
 *
 * TWO CONTROLS, NOT ONE, as the outliner's rows are and for the same reason:
 * opening a folder and standing in it are different intentions, and a triangle
 * that only reported which it was made the second impossible without doing the
 * first. They are siblings rather than nested because a button inside a button
 * is invalid, and a screen reader would announce one control where there are
 * two.
 *
 * The indent is inline because depth is data. A Tailwind class per level is a
 * fixed set of levels, and it would put the disclosure triangle at a different
 * distance from the name at each one.
 */
function SourceNode({
  depth,
  label,
  count,
  open,
  hasChildren,
  on,
  marked,
  icon: Icon,
  swatch,
  onToggle,
  onSelect,
  onContext,
}: {
  depth: number
  label: string
  count: number
  open?: boolean
  hasChildren?: boolean
  on: boolean
  /** Where new runs are filed, which is not the same as what is open. */
  marked?: boolean
  icon?: React.ComponentType<{ className?: string }>
  /** A product's colour, for the rows that are products. */
  swatch?: string
  onToggle?: () => void
  onSelect: () => void
  onContext?: (at: { x: number; y: number }) => void
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? !!open : undefined}
      aria-selected={on}
      className={cn(
        "group flex h-6 items-center transition-colors",
        on
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface-raised/60"
      )}
      style={{ paddingLeft: `${0.25 + depth * 0.75}rem` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
        </button>
      ) : (
        // Keeps the names of childless rows on the same left edge as the ones
        // with a triangle.
        <span className="size-4 shrink-0" />
      )}

      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onToggle}
        onContextMenu={
          onContext
            ? (e) => {
                e.preventDefault()
                onContext({ x: e.clientX, y: e.clientY })
              }
            : undefined
        }
        title={label}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1.5 pr-2 text-left text-emphasis",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !on && "group-hover:text-foreground"
        )}
      >
        {swatch ? (
          <span
            className="size-2 shrink-0 rounded-[1px]"
            style={{ background: `hsl(${swatch})` }}
          />
        ) : Icon ? (
          <Icon className="size-3.5 shrink-0" />
        ) : open ? (
          <FolderOpen className="size-3.5 shrink-0" />
        ) : (
          <Folder className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {marked && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            title="New runs are filed here"
          />
        )}
        <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">
          {count}
        </span>
      </button>
    </div>
  )
}

/**
 * A folder and, when it is open, the products inside it.
 *
 * The children are the products present, not the five that exist: a folder
 * offering a filter for a product it holds none of is a row that can only
 * empty the grid.
 */
function FolderBranch({
  id,
  name,
  depth,
  source,
  expanded,
  kinds,
  count,
  counts,
  marked,
  onToggle,
  onSelect,
  onContext,
}: {
  id: string
  name: string
  depth: number
  source: Source
  expanded: ReadonlySet<string>
  kinds: readonly KindId[]
  count: number
  counts?: ReadonlyMap<KindId, number>
  marked?: boolean
  onToggle: () => void
  onSelect: (kind?: KindId) => void
  onContext?: (at: { x: number; y: number }) => void
}) {
  const here: Source =
    id === "unfiled" ? { scope: "unfiled" } : { scope: "project", id }
  const open = expanded.has(id)
  /* One product is not a choice between products. The row still stands for the
     folder, and drawing a single child under it would say otherwise. */
  const branching = kinds.length > 1
  return (
    <>
      <SourceNode
        depth={depth}
        label={name}
        count={count}
        open={open}
        hasChildren={branching}
        on={sameSource(source, here)}
        marked={marked}
        icon={id === "unfiled" ? Inbox : undefined}
        onToggle={branching ? onToggle : undefined}
        onSelect={() => onSelect(undefined)}
        onContext={onContext}
      />
      {branching &&
        open &&
        kinds.map((k) => (
          <SourceNode
            key={k}
            depth={depth + 1}
            label={KIND_BY_ID.get(k)?.label ?? k}
            count={counts?.get(k) ?? 0}
            swatch={KIND_BY_ID.get(k)?.hue}
            on={sameSource(source, { ...here, kind: k })}
            onSelect={() => onSelect(k)}
          />
        ))}
    </>
  )
}

/**
 * A folder in the grid.
 *
 * The same silhouette Unreal gives one -- a tab across the top of a wide
 * plate -- because that shape is what makes a folder legible beside the item
 * tiles without a word being read. Drawn from two boxes rather than an icon
 * scaled up, so its edge stays one pixel at any tile size.
 */
function FolderTile({
  name,
  count,
  onOpen,
  onContext,
}: {
  name: string
  count: number
  onOpen: () => void
  onContext: (at: { x: number; y: number }) => void
}) {
  return (
    <button
      type="button"
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext({ x: e.clientX, y: e.clientY })
      }}
      title={`${name} — ${count} ${count === 1 ? "analysis" : "analyses"}. Double-click to open.`}
      className={cn(
        "flex w-[8.5rem] flex-col gap-1 rounded-sm border border-transparent p-1 text-left transition-colors",
        "hover:bg-surface-raised/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      <span className="flex h-[52px] w-full flex-col justify-end">
        {/* The tab, a third of the width, sitting on the plate below it. */}
        <span
          className="h-2 w-[38%] rounded-t-[3px]"
          style={{ background: "rgb(var(--p-line) / 0.5)" }}
        />
        <span
          className="h-[34px] w-full rounded-b-sm rounded-tr-sm"
          style={{ background: "rgb(var(--p-line) / 0.32)" }}
        />
      </span>
      <span className="truncate text-emphasis text-foreground">{name}</span>
      <span className="truncate text-micro text-muted-foreground">
        {count} {count === 1 ? "analysis" : "analyses"}
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
