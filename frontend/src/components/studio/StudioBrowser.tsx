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
 * THUMBNAILS, WHICH THIS PANEL WENT WITHOUT. The reasoning against them was
 * about the PAYLOAD and it was right about that: `overlay_uri` arrives with the
 * loaded result, so a wall of thumbnails drawn from it is a wall of loads. What
 * it missed is that the payload is not the only place the raster is -- every
 * run that writes one records where, in `overlay_relpath` -- and that a file on
 * disk can be FETCHED rather than marshalled. See runoverlay.go, which serves
 * one by run id.
 *
 * The column could not be read until recently: two products out of five filled
 * it, so a reader of it was right for a fifth of the grid and silently wrong
 * for the rest. All five fill it now.
 *
 * THE PLATE STAYS, and not only as a fallback. It is what Unreal draws for an
 * asset whose thumbnail has not been rendered, and it is the honest answer for
 * a run that has no raster at all: the wind screening and the solar resource
 * are figures, and a picture invented for them would say they have one. Each
 * product's own glyph is what it carries, so the plate answers by product and
 * not merely by absence.
 *
 * THE TYPE STRIP WENT WITH THE ARRIVAL OF THE PICTURE. See RunTile: a band of
 * the product's colour was the only thing naming a product while every tile
 * was the same plate, and it is a third statement of that once the tile has a
 * thumbnail and a glyph.
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
  CaretRight,
  Check,
  Drop,
  Folder,
  FolderOpen,
  FolderPlus,
  Folders,
  List,
  MagnifyingGlass,
  SquaresFour,
  Sun,
  Trash,
  Tray,
  Waves,
  Wind,
  X,
} from "@phosphor-icons/react"

import {
  CreateProject,
  DeleteAnalysis,
  DeleteProject,
  RunOverlayURL,
  SetRunProject,
  UpdateProject,
} from "../../../wailsjs/go/main/App"
import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import { runKindLabel, runRowLine } from "@/lib/runSummary"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { AreaHeaderOptions } from "@/components/studio/StudioArea"
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
 * The plate every tile carries, folder and run alike.
 *
 * One class so the two cannot drift: a grid where a folder and a run are
 * different heights is a grid that reflows into ragged rows, and the folder is
 * meant to sit among the runs rather than above them.
 *
 * 4.5rem over a 7.5rem tile, which is close to the 4:3 an icon is drawn at.
 * The first pass was 8.5 by 52px -- a 2.5:1 slab, on which a folder's tab is
 * lost and what reads is a grey rectangle.
 */
/*
  The plate, and the tile it sits in, at two thirds of what they were.

  The grid is for walking rather than jumping -- its own docblock says so -- and
  a walk is over how many things fit in a glance. At 7.5rem a run took a fifth
  of the panel's width and a project's dozen filled two screens of it.

  THE LABEL IS THE FLOOR, and it is close now. A run is named for its area and
  the minute it was made -- run-joao-2-2-20260907-051032 -- and the two clamped
  lines under the plate are what a reader tells one run from another by, since
  the plates of a project's runs are commonly the same product and therefore
  the same picture. At 5rem those two lines hold about the ground and the day;
  narrower and they hold the ground alone, which is the point at which the grid
  stops answering the question it is for.

  The plate keeps the tile's proportion rather than a height of its own: a
  thumbnail is a raster's aspect and a plate is the frame it would be in, so
  the two have to be the same frame.
*/
const TILE_W = "w-[5rem]"
const TILE_PLATE = "h-[3rem] w-full shrink-0 overflow-hidden rounded-sm"

/**
 * The products, and the token each one's plate is tinted with.
 *
 * THE COLOURS ARE NOT HERE ANY MORE. They were: five HSL triples invented in
 * this file at the moment the grid needed them, because the palette declared
 * no categorical scale and a product is not a role the semantic tokens name.
 * One of them landed on the accent's own hue -- a solar tile and the primary
 * action were the same orange -- which is what a scale nobody declares costs.
 *
 * They are `--p-kind-*` in index.css now, spread by hue in OKLCH and held at
 * lower chroma than the semantic tokens so a label does not compete with the
 * things that are asking for something. The argument is written there.
 *
 * The classification is the neutral one. It is the ordinary case and by far
 * the most common, so a grid of them reads as a grid of runs and the four
 * specialised products are what stand out -- which is the question the colour
 * is here to answer.
 */
/*
  ONE GLYPH PER PRODUCT, IN THE TABLE THAT ALREADY HOLDS ONE OF EVERYTHING ELSE.

  The plate drew a bar chart for every run but the two watery ones, which is a
  glyph for "there are figures here" -- true of all five, so it distinguished
  nothing. It mattered most on exactly the runs that have no raster to show
  instead: a wind screening and a solar resource are a plate and a label, and
  the plate was the same picture for both.

  Each is the thing the product is ABOUT rather than a picture of its output. A
  land cover is a mosaic of classes, surface water is a water surface, a flood
  envelope is where water reaches -- a drop rather than the water's own waves,
  since the two are neighbours in the grid and share a colour family. Sun and
  wind name themselves.

  Here rather than in the component, beside the label and the colour, so a
  product added to this table cannot arrive without one.
*/
const KINDS = [
  { id: "class", label: "Classification", token: "--p-kind-class", icon: SquaresFour },
  { id: "water", label: "Surface water", token: "--p-kind-water", icon: Waves },
  { id: "solar", label: "Solar", token: "--p-kind-solar", icon: Sun },
  { id: "wind", label: "Wind", token: "--p-kind-wind", icon: Wind },
  { id: "flood", label: "Flood", token: "--p-kind-flood", icon: Drop },
] as const

/** The token as a colour, at an alpha. One place, so the syntax is right once. */
const tint = (token: string, alpha = 1) => `rgb(var(${token}) / ${alpha})`

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
  onOpenReading,
  busy = false,
}: {
  /** Portal host for the context menus, clamped inside it as every panel is. */
  surface: HTMLElement | null
  activeProjectId?: string | null
  /** Make a project the one new runs are filed under. */
  onActivateProject?: (id: string) => void
  /** Load a run and put it on the board, as an area of its own. */
  onOpenRun?: (run: InferenceRun) => void
  /**
   * Load a run as the live one, so its reading is what the panels show.
   *
   * The other half of what a saved run can be asked for, and the only half
   * that answers for a product with no raster. See the menu below.
   */
  onOpenReading?: (run: InferenceRun) => void
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
          <MagnifyingGlass className="pointer-events-none absolute left-1.5 size-3 text-muted-foreground" />
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
                        borderColor: tint(k.token, 0.55),
                        background: tint(k.token, 0.12),
                      }
                    : undefined
                }
              >
                {/*
                  FILLED WHEN ON, HOLLOW WHEN OFF.

                  The swatch was filled either way, so the only thing saying
                  whether a chip was pressed was a border at 0.55 and a wash at
                  0.12 -- and a row of five permanently coloured squares under
                  five product names reads as a legend, which is a thing you
                  look at rather than a thing you press.
                */}
                <span
                  className="size-1.5 rounded-[1px]"
                  style={
                    on
                      ? { background: tint(k.token) }
                      : { boxShadow: `inset 0 0 0 1px ${tint(k.token, 0.85)}` }
                  }
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
            { on: tiles, icon: SquaresFour, label: "Tiles" },
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
                  ? "bg-selected text-foreground"
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

          {/*
            NEW PROJECT IS IN THE AREA'S HEADER, NOT AT THE FOOT OF THIS
            COLUMN.

            It was a full-width button under the source tree, which is the one
            place in this editor it does not belong: the tree lists what
            EXISTS, and a control that makes a new one sat inside the list of
            the old, tied to the width of a column that is one of two. Filing
            a run into a project is done from the grid on the right just as
            often as from the tree on the left, and the button was reachable
            from only one of them.

            The header is the panel's own edge, so it holds for both. It is
            also where every other act on a whole editor already lives -- the
            research pack on the tables, the arrangement menu at the far right
            -- and it survives this column being scrolled or narrowed.

            Portalled rather than passed up: the naming field it opens is this
            component's state, and getting the button into a header the parent
            builds would mean lifting that state to a component with no other
            use for it. See AreaHeaderOptions.
          */}
          <AreaHeaderOptions>
            <button
              type="button"
              onClick={() => setNaming({ id: null, name: "" })}
              disabled={working}
              title="Create a project to file runs into"
              className={cn(
                "flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-meta transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "text-muted-foreground hover:bg-hover hover:text-foreground",
                working && "cursor-not-allowed opacity-50"
              )}
            >
              <FolderPlus className="size-3 shrink-0" />
              {/*
                Withdrawn with the header's other labels when the area is too
                narrow to carry them, which is what `header-label` is for. The
                glyph is a folder with a plus and says the act on its own.
              */}
              <span className="header-label">New project</span>
            </button>
          </AreaHeaderOptions>
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
            <div
              className={cn(
                "mb-2",
                tiles ? "flex flex-wrap gap-2" : "flex flex-col"
              )}
            >
              {folders.map((f) => {
                const enter = () =>
                  setSource(
                    f.id === "unfiled"
                      ? { scope: "unfiled" }
                      : { scope: "project", id: f.id }
                  )
                const context = (at: { x: number; y: number }) => {
                  const p = projects.find((x) => x.id === f.id)
                  if (p) setProjectMenu({ project: p, at })
                }
                return tiles ? (
                  <FolderTile
                    key={f.id}
                    name={f.name}
                    count={f.count}
                    kinds={folderKinds(f.id)}
                    onOpen={enter}
                    onContext={context}
                  />
                ) : (
                  <FolderRow
                    key={f.id}
                    name={f.name}
                    count={f.count}
                    onOpen={enter}
                    onContext={context}
                  />
                )
              })}
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
          {/*
            WHAT A RUN CAN BE ASKED FOR DEPENDS ON WHETHER IT DREW ANYTHING.

            This offered one action under one name, "Open in the studio",
            which was wrong twice. The reader is already in the studio, so it
            named a place they are standing in; and what it does is neither
            opening nor navigating -- it loads the run and puts it on the
            board as an area of its own.

            A BOARD HOLDS PLANES, so a run that drew none has nothing to be on
            it: a wind screening added this way became an area with nothing in
            it, which is how a finished run came to look lost. What such a run
            has is a reading, and the reading is in a panel -- so that is what
            it is offered, and the board action is withheld rather than
            offered and disappointing.

            overlay_relpath is the test, and it is the right one now: every
            product that writes a raster records it, and the three that do not
            -- the wind screening, the solar resource, the energy model -- are
            exactly the three whose whole result is figures.
          */}
          <StudioMenuItem
            icon={
              (KIND_BY_ID.get(runKindLabel(runMenu.run.kind) as KindId) ??
                KINDS[0]).icon
            }
            label={
              runMenu.run.overlay_relpath
                ? "Add to the board"
                : "Open its reading"
            }
            disabled={
              busy ||
              (runMenu.run.overlay_relpath ? !onOpenRun : !onOpenReading)
            }
            onSelect={() => {
              if (runMenu.run.overlay_relpath) onOpenRun?.(runMenu.run)
              else onOpenReading?.(runMenu.run)
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
            icon={Trash}
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
            icon={Trash}
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
  /** A product's colour token, for the rows that are products. */
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
          ? "bg-selected text-foreground"
          : "text-muted-foreground hover:bg-hover"
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
          <CaretRight
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
            style={{ background: tint(swatch) }}
          />
        ) : Icon ? (
          <Icon className="size-3.5 shrink-0" />
        ) : open ? (
          /*
            The same tone the grid's folders carry. A folder is one colour
            wherever it is drawn, or the tree and the grid are two vocabularies
            for one thing -- and this row is the same folder the tile is.
          */
          <FolderOpen
            className="size-3.5 shrink-0"
            style={{ color: tint("--p-folder") }}
          />
        ) : (
          <Folder
            className="size-3.5 shrink-0"
            style={{ color: tint("--p-folder") }}
          />
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
        icon={id === "unfiled" ? Tray : undefined}
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
            swatch={KIND_BY_ID.get(k)?.token}
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
 * The same silhouette Unreal gives one -- a tab over a body -- because that
 * shape is what makes a folder legible beside the run tiles without a word
 * being read. Drawn from two boxes rather than a scaled icon, so its edge
 * stays one pixel at any tile size.
 *
 * PROPORTION IS THE WHOLE OF IT. Drawn to the full width of the tile over a
 * 52px plate, the two boxes are a 2.5:1 slab: the tab is lost against a shape
 * that wide and what reads is a grey rectangle, not a folder. So the plate is
 * the run tiles' new height and the shape is inset within it, at close to the
 * 4:3 a folder is drawn at everywhere it is drawn.
 */
function FolderTile({
  name,
  count,
  kinds,
  onOpen,
  onContext,
}: {
  name: string
  count: number
  /** Which products are filed here, in the table's order. */
  kinds: readonly KindId[]
  onOpen: () => void
  onContext: (at: { x: number; y: number }) => void
}) {
  /*
    THE GLYPH APPEARS WHERE IT SAYS SOMETHING, AND NOWHERE ELSE.

    Blender marks Desktop, Documents and Downloads and leaves every other
    folder plain, which is the rule worth taking: a mark on all of them is a
    mark that distinguishes none. So a folder holding one product wears that
    product's glyph, and a mixed one wears nothing -- the same honesty the tree
    already applies when it draws a single child for a folder with nothing to
    choose between.

    Not five small glyphs for a mixed folder. The tile is 68px of folder body
    and the count under it already says how much is inside; a row of marks that
    small is a texture, and the reader who wants the breakdown opens the tree,
    where it is drawn at a size that can be read.
  */
  const only = kinds.length === 1 ? KIND_BY_ID.get(kinds[0]) : undefined
  const Glyph = only?.icon
  return (
    <button
      type="button"
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext({ x: e.clientX, y: e.clientY })
      }}
      title={
        `${name} — ${count} ${count === 1 ? "analysis" : "analyses"}` +
        (only ? `, all ${only.label.toLowerCase()}` : "") +
        ". Double-click to open."
      }
      className={cn(
        `flex ${TILE_W} flex-col gap-1 rounded-sm border border-transparent p-1 text-left transition-colors`,
        "hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      {/*
        ALIGNED LEFT, NOT CENTRED IN THE PLATE.

        A run's tile is a tinted plate the full width of the tile, so its left
        edge and its label's left edge are the same line. The folder is a
        smaller shape on an untinted plate, and centred it stood about 22px in
        from that line -- so the grid had two left edges and the eye read the
        folder as shifted right of its own name.

        The shape keeps its proportion rather than being stretched to the
        plate: at the tile's full width it is a 1.7:1 slab, and the tab that
        makes a folder a folder is lost on anything that wide. What moves is
        where it sits, which is what the misalignment was about.
      */}
      <span className={cn(TILE_PLATE, "flex items-center justify-start")}>
        <span className="flex h-[3.25rem] w-[4.25rem] flex-col">
          {/* The tab, a little over a third of the width, and behind the body. */}
          <span
            className="h-[0.5rem] w-[42%] rounded-t-[3px]"
            style={{ background: tint("--p-folder-tab") }}
          />
          {/*
            Lit at the top and shaded at the foot, with a hairline along the
            edge between the two -- the front panel of a folder, catching the
            light a flat fill cannot. One tone read as a swatch beside the
            reference this was drawn from; see the note in index.css.
          */}
          <span
            className="flex flex-1 items-center justify-center rounded-b-[3px] rounded-tr-[3px]"
            style={{
              background: `linear-gradient(${tint("--p-folder")}, ${tint(
                "--p-folder-shade"
              )})`,
              boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.10)",
            }}
          >
            {Glyph ? (
              /*
                On the folder rather than on a plate of its own: the body IS
                the plate, and a second one inside it would be a tile within a
                tile. Ink rather than the product's tint, because the tint on
                its own ground is what every run tile in this grid already
                does, and two things that look alike would be saying different
                sentences.
              */
              <Glyph className="size-4" style={{ color: tint("--p-folder-ink") }} aria-hidden />
            ) : null}
          </span>
        </span>
      </span>
      <span className="truncate text-emphasis text-foreground">{name}</span>
      <span className="truncate text-micro text-muted-foreground">
        {count} {count === 1 ? "analysis" : "analyses"}
      </span>
    </button>
  )
}

/** The same folder, in the row view. Entered the same way. */
function FolderRow({
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
      title={`${name} — double-click to open`}
      className={cn(
        "flex h-8 items-center gap-2 rounded-sm px-1 text-left transition-colors",
        "text-muted-foreground hover:bg-hover hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      <Folder
        className="size-4 shrink-0"
        style={{ color: tint("--p-folder") }}
      />
      <span className="min-w-0 flex-1 truncate text-emphasis text-foreground">
        {name}
      </span>
      <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">
        {count} {count === 1 ? "analysis" : "analyses"}
      </span>
    </button>
  )
}

/**
 * The address of a run's image, or null where it has none.
 *
 * ASKED ONLY WHERE THE ROW SAYS THERE IS ONE. `overlay_relpath` is on the row
 * already, so a run whose result is figures costs nothing here -- no call, no
 * request, no failed <img>. The address itself comes from the Go side rather
 * than being built here, because the route's shape is that file's business and
 * a second copy of the prefix is a second place to edit when it moves.
 */
function useRunOverlay(run: InferenceRun): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const has = !!run.overlay_relpath
  useEffect(() => {
    if (!has) {
      setUrl(null)
      return
    }
    let live = true
    void RunOverlayURL(run.id)
      .then((u) => live && setUrl(u || null))
      .catch(() => live && setUrl(null))
    return () => {
      live = false
    }
  }, [run.id, has])
  return url
}

/** The plate a tile and a row share: the run's raster, else its type. */
function KindPlate({ run, size }: { run: InferenceRun; size: "tile" | "row" }) {
  const kind = KIND_BY_ID.get(runKindLabel(run.kind) as KindId) ?? KINDS[0]
  const Icon = kind.icon
  const overlay = useRunOverlay(run)
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
        size === "tile" ? TILE_PLATE : "size-6"
      )}
      style={{ background: tint(kind.token, 0.14) }}
    >
      {overlay && !failed ? (
        /*
          `lazy`, because the grid is meant to be scrolled and a project's runs
          are counted in dozens: a row that has not been reached costs its
          request only when it is.

          `pixelated` for the same reason the board's planes are: every raster
          this application draws is a class map or a measured field, and a
          blend of two class colours at a plate this size names no class.

          An image that fails falls back to the plate rather than to a broken
          icon. The file can be gone -- a store restored without its assets, a
          run whose directory was cleared -- and the type is still true.
        */
        <img
          src={overlay}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <Icon
          /*
            A third of the plate's height, which is what it was before the
            plate shrank: the glyph is the plate's subject and a mark that
            keeps its size while its frame loses a third becomes the frame's
            subject instead.
          */
          className={size === "tile" ? "size-4" : "size-3.5"}
          style={{ color: tint(kind.token) }}
          strokeWidth={1.75}
        />
      )}
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
        `flex ${TILE_W} flex-col gap-1 rounded-sm border p-1 text-left transition-colors`,
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        on
          ? "border-primary/60 bg-primary/10"
          : "border-transparent hover:bg-hover"
      )}
    >
      <KindPlate run={run} size="tile" />
      {/*
        NO TYPE STRIP. A two-pixel band of the product's colour ran along the
        plate's foot, and it was the colour doing the thumbnail's work: with no
        picture on the tile, it was the only thing telling a classification
        from a water run across the grid.

        There is a picture now, and a glyph per product behind it where there
        is none -- so the strip became a third statement of what the tile
        already said twice, in the position where a tile is read fastest. It
        also fought the thumbnails it sat under: a raster is a field of colour,
        and a saturated line beneath one is a caption in the same ink as the
        photograph.
      */}
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
          : "text-muted-foreground hover:bg-hover hover:text-foreground"
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
