import { useEffect, useMemo, useRef, useState } from "react"

import {
  CaretRight,
  Check,
  Folder,
  FolderOpen,
  Folders,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  Tray,
  X,
} from "@/components/icons"
import {
  ClassBar,
  KINDS,
  RunCard,
  RunPicture,
  clockTime,
  kindOf,
  runTitle,
  tint,
  type KindId,
} from "@/components/shell/analysisParts"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { btnGhost, btnGhostDense, btnIcon, btnPrimary } from "@/components/ui/buttons"
import { ContextMenu, MenuItem, MenuPopover } from "@/components/workspace/MenuPopover"
import {
  CreateProject,
  DeleteAnalysis,
  DeleteProject,
  SetRunProject,
  UpdateProject,
} from "../../../wailsjs/go/main/App"
import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import { groupRuns, type RunBlock } from "@/lib/runBatches"
import {
  classifiedAreaHa,
  formatHectares,
  modelDisplayName,
  parseRunSummary,
  runKindLabel,
  runRowLine,
} from "@/lib/runSummary"
import type { InferenceRun, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Where the reader stands: everything, the runs filed nowhere, or a project. */
type Scope = { scope: "all" } | { scope: "unfiled" } | { scope: "project"; id: string }

const GRID =
  "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,11.5rem),1fr))]"

/*
  EVERY SAVED ANALYSIS, FILED BY PROJECT AND LAID OUT BY WHEN IT WAS MADE.

  It was a content browser after Unreal's: a tree of sources, a toolbar of
  uppercase type chips, folders as beige icons and runs as 5rem tiles named
  run-field-23-2026..., cut off at the second hyphen. It is now drawn as the
  other destinations are, Settings above all: a header with the path, a column
  of projects at the left, and the page beside it.

  THE PAGE READS AS A LOG, NEWEST FIRST. A day is a heading, and inside a day
  the runs of one request over several areas are a batch, framed together
  under what was asked (lib/runBatches.ts); the runs between batches are laid
  out as they came. A run is named for the area it was made over, with the
  product and what it found under the name, so a batch of twenty-three fields
  reads as twenty-three fields and not as twenty-three timestamps.

  ONE PRESS SELECTS, and the analysis is shown in a column at the right with
  what it found and what can be done with it. Two presses open it on the map,
  which is what the right-hand column's first button does too.

  Deleting a project does not delete its analyses: the store unfiles them, and
  the confirmation says so, because the opposite is what a reader assumes.
*/
export function AnalysesScreen({
  surface,
  activeProjectId = null,
  onActivateProject,
  onOpenRun,
  onOpenReading,
  busy = false,
}: {
  /** Portal host for the menus, clamped inside it as every panel is. */
  surface: HTMLElement | null
  /** The project new runs are filed under. */
  activeProjectId?: string | null
  onActivateProject?: (id: string) => void
  /** Load a run and put it on the map. */
  onOpenRun?: (run: InferenceRun) => void
  /** Load a run with no raster as the live one, so its reading is in the panels. */
  onOpenReading?: (run: InferenceRun) => void
  /** A run is already loading; a second request would race the first. */
  busy?: boolean
}) {
  const { runs, projects, refreshRuns, refreshProjects } = useAuth()

  const [scope, setScope] = useState<Scope>({ scope: "all" })
  const [product, setProduct] = useState<KindId | null>(null)
  const [query, setQuery] = useState("")
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
    Naming a project, in the column it will appear in: `id` is null while a
    new one is named, and the project's id while one is renamed.
  */
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)

  const project =
    scope.scope === "project" ? projects.find((p) => p.id === scope.id) : undefined
  const names = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const projectName = (id?: string) => (id ? (names.get(id) ?? "Project") : "Unfiled")

  /* Per folder, taken once over the whole list, not once per row of the column. */
  const counts = useMemo(() => {
    const byFolder = new Map<string, number>()
    for (const r of runs) {
      const f = r.project_id || "unfiled"
      byFolder.set(f, (byFolder.get(f) ?? 0) + 1)
    }
    return byFolder
  }, [runs])
  const folderCount = (id: string) => counts.get(id) ?? 0

  const inScope = useMemo(
    () =>
      runs.filter((r) => {
        if (scope.scope === "unfiled") return !r.project_id
        if (scope.scope === "project") return r.project_id === scope.id
        return true
      }),
    [runs, scope]
  )

  /* The products present where the reader stands, in the table's order. */
  const products = useMemo(() => {
    const n = new Map<string, number>()
    for (const r of inScope) {
      const k = runKindLabel(r.kind)
      n.set(k, (n.get(k) ?? 0) + 1)
    }
    return KINDS.filter((k) => n.has(k.id)).map((k) => ({
      kind: k,
      count: n.get(k.id)!,
    }))
  }, [inScope])
  /* A product chosen in another project, and absent from this one, chooses none. */
  const shownProduct =
    product && products.some((p) => p.kind.id === product) ? product : null

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inScope.filter((r) => {
      if (shownProduct && runKindLabel(r.kind) !== shownProduct) return false
      if (!q) return true
      return [
        r.label ?? "",
        runTitle(r),
        runRowLine(r),
        kindOf(r).label,
        scope.scope === "all" && r.project_id ? (names.get(r.project_id) ?? "") : "",
      ].some((t) => t.toLowerCase().includes(q))
    })
  }, [inScope, shownProduct, query, scope, names])

  const days = useMemo(() => groupRuns(items), [items])
  const selectedRun = selected ? items.find((r) => r.id === selected) : undefined

  /* A selection the filter hid is one the column would show and the page not. */
  useEffect(() => {
    if (selected && !items.some((r) => r.id === selected)) setSelected(null)
  }, [items, selected])

  /* A new place to stand starts at its top. */
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [scope, shownProduct])

  const go = (next: Scope) => {
    setScope(next)
    setSelected(null)
  }

  const open = (run: InferenceRun) => {
    if (busy) return
    if (run.overlay_relpath) onOpenRun?.(run)
    else onOpenReading?.(run)
  }

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
        if (created?.id) go({ scope: "project", id: created.id })
      } else {
        const p = projects.find((x) => x.id === id)
        if (!p || name === p.name) return
        await UpdateProject({ ...p, name })
        await refreshProjects()
      }
    } catch (e) {
      notifyError(
        id === null ? "Could not create the project" : "Could not rename the project",
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
          The runs first: deleting a project unfiles them, and reading the
          projects first would draw them for a moment under a project that is
          gone.
        */
        await refreshRuns()
        await refreshProjects()
        if (scope.scope === "project" && scope.id === deleting.project.id) {
          go({ scope: "all" })
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

  const title =
    scope.scope === "all"
      ? "All analyses"
      : scope.scope === "unfiled"
        ? "Unfiled"
        : (project?.name ?? "Project")
  const latest = inScope.reduce<string | null>(
    (m, r) => (m === null || r.created_at > m ? r.created_at : m),
    null
  )

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !selected) return
        if ((e.target as HTMLElement).closest("input")) return
        setSelected(null)
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-4">
        <button
          type="button"
          onClick={() => go({ scope: "all" })}
          className="text-title font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Analyses
        </button>
        <CaretRight className="size-3 text-muted-foreground" />
        <h1 className="min-w-0 truncate text-title font-medium text-foreground">
          {title}
        </h1>
        <div className="flex-1" />
        <label className="relative flex w-80 max-w-[40%] items-center">
          <MagnifyingGlass className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation()
                setQuery("")
              }
            }}
            placeholder="Search by area, product or name"
            aria-label="Search analyses"
            className="h-8 w-full rounded-full border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))] pr-8 pl-8 text-body text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute right-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Projects"
          className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border px-3 py-5"
        >
          <ScopeRow
            icon={Folders}
            label="All analyses"
            count={runs.length}
            active={scope.scope === "all"}
            onSelect={() => go({ scope: "all" })}
          />

          <div className="mt-5 mb-1.5 flex items-center justify-between pr-1 pl-2.5">
            <p className="text-meta text-muted-foreground">Projects</p>
            <button
              type="button"
              onClick={() => setNaming({ id: null, name: "" })}
              title="New project"
              aria-label="New project"
              className={cn(btnIcon, "size-6")}
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {projects.map((p) =>
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
              <ScopeRow
                key={p.id}
                icon={Folder}
                label={p.name}
                count={folderCount(p.id)}
                active={scope.scope === "project" && scope.id === p.id}
                filing={p.id === activeProjectId}
                onSelect={() => go({ scope: "project", id: p.id })}
                onContext={(at) => setProjectMenu({ project: p, at })}
              />
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
          {projects.length === 0 && naming === null && (
            <p className="px-2.5 text-label text-muted-foreground">
              No projects yet. A project keeps its areas and analyses together.
            </p>
          )}
          {folderCount("unfiled") > 0 && (
            <div className="mt-5">
              <ScopeRow
                icon={Tray}
                label="Unfiled"
                count={folderCount("unfiled")}
                active={scope.scope === "unfiled"}
                onSelect={() => go({ scope: "unfiled" })}
              />
            </div>
          )}
        </nav>

        <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="px-8 pt-7 pb-16">
            <h2 className="font-display text-display font-semibold text-foreground">
              {title}
            </h2>
            <p className="mt-1 max-w-prose text-read text-muted-foreground">
              {inScope.length === 0
                ? "Nothing is filed here yet."
                : `${inScope.length} ${inScope.length === 1 ? "analysis" : "analyses"}, the latest on ${longDay(latest)}.`}
              {project &&
                (project.id === activeProjectId
                  ? " New runs are filed here."
                  : " New runs are filed in another project.")}
            </p>

            {project && (
              <div className="mt-3 flex flex-wrap gap-2">
                {project.id !== activeProjectId && onActivateProject && (
                  <button
                    type="button"
                    onClick={() => onActivateProject(project.id)}
                    className={btnGhostDense}
                  >
                    <Check className="size-3.5" />
                    File new runs here
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNaming({ id: project.id, name: project.name })}
                  className={btnGhostDense}
                >
                  <PencilSimple className="size-3.5" />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting({ kind: "project", project })}
                  className={btnGhostDense}
                >
                  <Trash className="size-3.5" />
                  Delete project
                </button>
              </div>
            )}

            {products.length > 1 && (
              <div
                role="radiogroup"
                aria-label="Product"
                className="mt-6 flex flex-wrap gap-1.5"
              >
                <Pill
                  on={shownProduct === null}
                  label="All products"
                  count={inScope.length}
                  onSelect={() => setProduct(null)}
                />
                {products.map(({ kind, count }) => (
                  <Pill
                    key={kind.id}
                    on={shownProduct === kind.id}
                    label={kind.label}
                    count={count}
                    icon={
                      <kind.icon
                        className="size-3.5"
                        style={{ color: tint(kind.token) }}
                      />
                    }
                    onSelect={() => setProduct(kind.id)}
                  />
                ))}
              </div>
            )}

            {items.length === 0 ? (
              <Empty
                text={
                  runs.length === 0
                    ? "No saved analyses yet. A run is saved here when it finishes."
                    : inScope.length === 0
                      ? scope.scope === "project"
                        ? "A run is filed in the project that takes new runs when it is made. Any analysis can be moved here from its menu, or with Move to beside it."
                        : "Nothing here."
                      : "Nothing here matches the search."
                }
                action={
                  query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className={btnGhostDense}
                    >
                      <X className="size-3.5" />
                      Clear the search
                    </button>
                  ) : null
                }
              />
            ) : (
              days.map((d) => (
                <section key={d.day} className="mt-10 first-of-type:mt-8">
                  <div className="flex items-baseline justify-between gap-4 border-b border-[rgb(var(--p-line)/0.3)] pb-2">
                    <h3 className="text-heading font-medium text-foreground">
                      {dayHeading(d.day)}
                    </h3>
                    <span className="telemetry text-meta text-muted-foreground">
                      {d.count} {d.count === 1 ? "analysis" : "analyses"}
                    </span>
                  </div>
                  {d.blocks.map((b, i) => (
                    <Block
                      key={b.batch ? b.key : `loose-${i}`}
                      block={b}
                      selected={selected}
                      busy={busy}
                      where={
                        scope.scope === "all"
                          ? (r) =>
                              r.project_id ? projectName(r.project_id) : "Unfiled"
                          : undefined
                      }
                      onSelect={(r) => setSelected(r.id)}
                      onOpen={open}
                      onContext={(r, at) => {
                        setSelected(r.id)
                        setRunMenu({ run: r, at })
                      }}
                    />
                  ))}
                </section>
              ))
            )}
          </div>
        </div>

        {selectedRun && (
          <RunDetail
            key={selectedRun.id}
            run={selectedRun}
            projects={projects}
            surface={surface}
            busy={busy}
            projectName={projectName(selectedRun.project_id)}
            onClose={() => setSelected(null)}
            onOpen={() => open(selectedRun)}
            onMove={(id) => void moveRun(selectedRun, id)}
            onDelete={() => setDeleting({ kind: "run", run: selectedRun })}
          />
        )}
      </div>

      {runMenu && (
        <ContextMenu
          at={runMenu.at}
          surface={surface}
          title={runTitle(runMenu.run)}
          onClose={() => setRunMenu(null)}
        >
          <MenuItem
            icon={kindOf(runMenu.run).icon}
            label={runMenu.run.overlay_relpath ? "Open on the map" : "Open its reading"}
            disabled={
              busy || (runMenu.run.overlay_relpath ? !onOpenRun : !onOpenReading)
            }
            onSelect={() => {
              open(runMenu.run)
              setRunMenu(null)
            }}
          />
          <MoveItems
            run={runMenu.run}
            projects={projects}
            onMove={(id) => {
              void moveRun(runMenu.run, id)
              setRunMenu(null)
            }}
          />
          <div className="my-1 border-t border-[rgb(var(--p-line)/0.22)]" />
          <MenuItem
            icon={Trash}
            label="Delete"
            onSelect={() => {
              setDeleting({ kind: "run", run: runMenu.run })
              setRunMenu(null)
            }}
          />
        </ContextMenu>
      )}

      {projectMenu && (
        <ContextMenu
          at={projectMenu.at}
          surface={surface}
          title={projectMenu.project.name}
          onClose={() => setProjectMenu(null)}
        >
          <MenuItem
            icon={Check}
            label="File new runs here"
            checked={projectMenu.project.id === activeProjectId}
            disabled={!onActivateProject || projectMenu.project.id === activeProjectId}
            onSelect={() => {
              onActivateProject?.(projectMenu.project.id)
              setProjectMenu(null)
            }}
          />
          <MenuItem
            icon={PencilSimple}
            label="Rename"
            onSelect={() => {
              setNaming({ id: projectMenu.project.id, name: projectMenu.project.name })
              setProjectMenu(null)
            }}
          />
          <MenuItem
            icon={Trash}
            label="Delete"
            onSelect={() => {
              setDeleting({ kind: "project", project: projectMenu.project })
              setProjectMenu(null)
            }}
          />
        </ContextMenu>
      )}

      {deleting?.kind === "run" && (
        <ConfirmDelete
          eyebrow="Delete analysis"
          title={runTitle(deleting.run)}
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
          subtitle={`${folderCount(deleting.project.id)} analyses are filed here. They are not deleted: they move to Unfiled.`}
          confirmLabel="Delete the project"
          busy={working}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}

/** A place in the column, drawn as Settings draws its pages. */
function ScopeRow({
  icon: Icon,
  label,
  count,
  active,
  filing = false,
  onSelect,
  onContext,
}: {
  icon: typeof Folder
  label: string
  count: number
  active: boolean
  /** New runs are filed here, which is a different fact from being open. */
  filing?: boolean
  onSelect: () => void
  onContext?: (at: { x: number; y: number }) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={
        onContext &&
        ((e) => {
          e.preventDefault()
          onContext({ x: e.clientX, y: e.clientY })
        })
      }
      aria-current={active ? "page" : undefined}
      title={filing ? `${label}: new runs are filed here` : label}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-read transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "bg-[rgb(var(--p-surface-raised))] text-foreground"
          : "text-muted-foreground hover:bg-hover hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {filing && (
        <span
          aria-label="New runs are filed here"
          className="size-1.5 rounded-full bg-primary"
        />
      )}
      <span className="telemetry text-meta text-muted-foreground">{count}</span>
    </button>
  )
}

/** Committed on Enter and on leaving it, abandoned on Escape. */
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
      className="field-input my-0.5 text-read focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

function Pill({
  on,
  label,
  count,
  icon,
  onSelect,
}: {
  on: boolean
  label: string
  count: number
  icon?: React.ReactNode
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onSelect}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-label transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        on
          ? "border-[rgb(var(--p-line-strong)/0.7)] bg-[rgb(var(--p-surface-raised))] text-foreground"
          : "border-[rgb(var(--p-line)/0.45)] text-muted-foreground hover:bg-hover hover:text-foreground"
      )}
    >
      {icon}
      {label}
      <span className="telemetry text-meta text-muted-foreground">{count}</span>
    </button>
  )
}

/*
  A BATCH IS FRAMED under what was asked: the product, the model where it is a
  classification, how many areas, and the span over which the runs were saved.
  The runs between batches are laid out as they came, unframed.
*/
function Block({
  block,
  selected,
  busy,
  where,
  onSelect,
  onOpen,
  onContext,
}: {
  block: RunBlock
  selected: string | null
  busy: boolean
  where?: (run: InferenceRun) => string
  onSelect: (run: InferenceRun) => void
  onOpen: (run: InferenceRun) => void
  onContext: (run: InferenceRun, at: { x: number; y: number }) => void
}) {
  const cards = (
    <div className={GRID}>
      {block.runs.map((r) => (
        <RunCard
          key={r.id}
          run={r}
          selected={r.id === selected}
          busy={busy}
          where={where?.(r)}
          onSelect={() => onSelect(r)}
          onOpen={() => onOpen(r)}
          onContext={(at) => onContext(r, at)}
        />
      ))}
    </div>
  )
  if (!block.batch) return <div className="mt-4">{cards}</div>

  const first = block.runs[0]
  const kind = kindOf(first)
  const times = block.runs.map((r) => clockTime(r.created_at)).sort()
  const span =
    times[0] === times.at(-1) ? times[0] : `${times[0]} to ${times.at(-1) ?? ""}`
  return (
    <div className="mt-4 rounded-md border border-[rgb(var(--p-line)/0.35)] bg-[rgb(var(--p-ink)/0.45)] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <span className="flex items-center gap-2 text-read font-medium text-foreground">
          <kind.icon className="size-4" style={{ color: tint(kind.token) }} />
          {kind.id === "class"
            ? `${kind.label} with ${modelDisplayName(first.model_kind)}`
            : kind.label}
        </span>
        <span className="telemetry text-meta text-muted-foreground">
          {block.runs.length} areas in one request · saved {span}
        </span>
      </div>
      {cards}
    </div>
  )
}

/** Filing, one project per row: the list is short and already in view beside it. */
function MoveItems({
  run,
  projects,
  onMove,
}: {
  run: InferenceRun
  projects: readonly Project[]
  onMove: (projectId: string) => void
}) {
  if (!projects.length && !run.project_id) return null
  return (
    <>
      <div className="my-1 border-t border-[rgb(var(--p-line)/0.22)]" />
      {projects.map((p) => (
        <MenuItem
          key={p.id}
          indented
          icon={p.id === run.project_id ? Check : undefined}
          label={p.name}
          onSelect={() => onMove(p.id)}
        />
      ))}
      {run.project_id && (
        <MenuItem indented label="Unfile" onSelect={() => onMove("")} />
      )}
    </>
  )
}

/*
  THE SELECTED ANALYSIS, at the right of the page: its picture larger, what it
  found, where it came from, and what can be done with it. Opening is the
  first and filled button, since it is what a reader selects one for.
*/
function RunDetail({
  run,
  projects,
  surface,
  busy,
  projectName,
  onClose,
  onOpen,
  onMove,
  onDelete,
}: {
  run: InferenceRun
  projects: readonly Project[]
  surface: HTMLElement | null
  busy: boolean
  projectName: string
  onClose: () => void
  onOpen: () => void
  onMove: (projectId: string) => void
  onDelete: () => void
}) {
  const [moving, setMoving] = useState(false)
  const kind = kindOf(run)
  const summary = parseRunSummary(run.summary)
  const classes = [...summary.classStats].sort((a, b) => b.pct - a.pct)
  const isClass = kind.id === "class"
  const saved = new Date(run.created_at)

  const facts: [string, React.ReactNode][] = isClass
    ? [
        ["Model", modelDisplayName(run.model_kind)],
        [
          "Observed",
          summary.dateRange?.join(" to ") ??
            (run.period_start
              ? `${run.period_start} to ${run.period_end}`
              : "Not recorded"),
        ],
        ["Classified", formatHectares(classifiedAreaHa(summary.classStats))],
      ]
    : [["Reading", runRowLine(run).split(" · ").slice(1).join(" · ") || kind.label]]
  facts.push(
    [
      "Saved",
      Number.isNaN(saved.getTime())
        ? run.created_at
        : saved.toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
    ],
    ["Project", projectName],
    ["Name", <span className="telemetry break-all">{run.label || run.id}</span>]
  )

  return (
    <aside
      aria-label="Analysis"
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border p-5"
    >
      <div className="flex items-center justify-between">
        <p className="eyebrow">Analysis</p>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close the analysis"
          className={btnIcon}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.45)]">
        <RunPicture run={run} className="h-48 w-full" glyph="size-10" />
        <ClassBar run={run} className="h-1.5" />
      </div>

      <h2 className="mt-4 font-display text-title font-semibold text-foreground">
        {runTitle(run)}
      </h2>
      <p className="mt-0.5 flex items-center gap-1.5 text-label text-muted-foreground">
        <kind.icon className="size-3.5" style={{ color: tint(kind.token) }} />
        {kind.label}
      </p>

      {classes.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {classes.slice(0, 5).map((c) => (
            <li key={c.class_id} className="flex items-center gap-2 text-label">
              <span
                className="size-2.5 shrink-0 rounded-xs"
                style={{ background: c.color }}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
              <span className="telemetry text-meta text-muted-foreground">
                {c.pct.toFixed(1)}%
              </span>
            </li>
          ))}
          {classes.length > 5 && (
            <li className="text-meta text-muted-foreground">
              and {classes.length - 5} more{" "}
              {classes.length - 5 === 1 ? "class" : "classes"}
            </li>
          )}
        </ul>
      )}

      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-foreground">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onOpen}
          className={cn(btnPrimary, "w-full")}
        >
          <FolderOpen className="size-3.5" />
          {run.overlay_relpath ? "Open on the map" : "Open its reading"}
        </button>
        <div className="flex gap-2">
          <MenuPopover
            open={moving}
            onOpenChange={setMoving}
            surface={surface}
            align="start"
            trigger={(t) => (
              <button
                type="button"
                ref={t.ref}
                onClick={t.onClick}
                aria-expanded={t["aria-expanded"]}
                aria-haspopup={t["aria-haspopup"]}
                className={cn(btnGhost, "flex-1")}
              >
                <Folder className="size-3.5" />
                Move to
              </button>
            )}
          >
            {projects.map((p) => (
              <MenuItem
                key={p.id}
                icon={p.id === run.project_id ? Check : undefined}
                label={p.name}
                onSelect={() => {
                  onMove(p.id)
                  setMoving(false)
                }}
              />
            ))}
            {run.project_id && (
              <MenuItem
                label="Unfile"
                onSelect={() => {
                  onMove("")
                  setMoving(false)
                }}
              />
            )}
          </MenuPopover>
          <button type="button" onClick={onDelete} className={btnGhost}>
            <Trash className="size-3.5" />
            Delete
          </button>
        </div>
      </div>
    </aside>
  )
}

function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="mt-10 flex max-w-prose flex-col items-start gap-3">
      <p className="text-read text-muted-foreground">{text}</p>
      {action}
    </div>
  )
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Today and yesterday by name, any other day in full. */
function dayHeading(day: string): string {
  const d = parseDay(day)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((start.getTime() - d.getTime()) / 86_400_000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function longDay(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}
