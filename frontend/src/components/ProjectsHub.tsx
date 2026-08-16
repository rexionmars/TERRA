import { useMemo, useState, type ReactNode } from "react"
import { FolderKanban, Inbox, Plus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Area, Project } from "@/lib/types"
import { resolveProjectGeometry } from "@/lib/geometry"
import { ProjectFolderCard } from "@/components/ProjectFolderCard"
import { PageAside, PageBody, PageShell } from "@/components/ui/PageShell"
import { btnGhostDense, btnIcon, btnPrimary, btnPrimaryCommit } from "@/components/ui/buttons"

export type ProjectsHubSelection = "all" | "unassigned" | string

export function ProjectsHub({
  projects,
  areas,
  unassignedCount,
  selection,
  creating,
  newName,
  onNewNameChange,
  onCreate,
  onSelectAll,
  onOpenProject,
  onOpenUnassigned,
  headerActions,
  children,
}: {
  projects: Project[]
  /** Embedded example areas, to resolve a project stored as an area_id. */
  areas?: Area[]
  unassignedCount: number
  selection: ProjectsHubSelection
  creating: boolean
  newName: string
  onNewNameChange: (value: string) => void
  onCreate: () => void
  onSelectAll: () => void
  onOpenProject: (projectId: string) => void
  onOpenUnassigned: () => void
  headerActions?: ReactNode
  children?: ReactNode
}) {
  const [query, setQuery] = useState("")
  const [showCreate, setShowCreate] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.label?.toLowerCase().includes(q) ?? false)
    )
  }, [projects, query])

  const selectedProject =
    typeof selection === "string" && selection !== "all" && selection !== "unassigned"
      ? projects.find((p) => p.id === selection) ?? null
      : null

  const mainTitle =
    selection === "all"
      ? "Projects"
      : selection === "unassigned"
        ? "Unassigned"
        : selectedProject?.name || "Project"

  const mainSubtitle =
    selection === "all"
      ? "Farm and field workspaces — analyses and overlays stay together."
      : selection === "unassigned"
        ? "Older classifications not yet attached to a project."
        : selectedProject?.notes ||
          "Analyses and overlays saved under this project."

  return (
    <PageShell>
      <PageAside>
        <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-2 pt-4">
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold tracking-wide text-foreground">
              Projects
            </p>
            <p className="telemetry mt-0.5 text-meta text-muted-foreground">
              {projects.length}{" "}
              {projects.length === 1 ? "workspace" : "workspaces"}
            </p>
          </div>
          <button
            type="button"
            title="New project"
            onClick={() => setShowCreate(true)}
            className={btnIcon}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              // The wrapping label carries no text (the icon is decorative), so
              // without this the only name is the placeholder, which the value
              // replaces as soon as the user types.
              aria-label="Search projects"
              className="h-8 w-full rounded-sm border border-border bg-background py-0 pl-8 pr-2 text-body outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
          <button
            type="button"
            onClick={onSelectAll}
            className={cn(
              "nav-item mb-1 flex w-full items-center gap-2 px-2 py-1.5 text-left text-body",
              selection === "all"
                ? "is-active"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-primary/75" />
            <span className="min-w-0 flex-1 truncate">All projects</span>
            <span className="telemetry shrink-0 text-meta text-muted-foreground">
              {projects.length}
            </span>
          </button>

          <p className="eyebrow mb-1 mt-2 px-2 !text-muted-foreground">Folders</p>
          <ul className="flex flex-col gap-0.5">
            {filtered.map((p) => {
              const runs = p.run_count ?? 0
              const overlays = p.overlay_count ?? 0
              const active = selection === p.id
              // The badge sums two independent counts, so state them in the
              // accessible name rather than leaving a bare number.
              const countLabel = `${runs} ${
                runs === 1 ? "analysis" : "analyses"
              }, ${overlays} ${overlays === 1 ? "overlay" : "overlays"}`
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProject(p.id)}
                    title={`${p.name} — ${countLabel}`}
                    className={cn(
                      "nav-item flex w-full items-center gap-2 px-2 py-1.5 text-left text-body",
                      active
                        ? "is-active"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FolderKanban
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-primary/85" : "text-muted-foreground"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {/* Two independent counts, shown as such: twelve
                        classifications and twelve compositions are opposite
                        states of work, and their sum said neither. */}
                    <span
                      className="telemetry shrink-0 text-meta text-muted-foreground"
                      aria-label={countLabel}
                    >
                      {runs}
                      <span className="opacity-45"> · </span>
                      {overlays}
                    </span>
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-2 text-meta text-muted-foreground">
                {projects.length === 0 ? "No projects yet" : "No matches"}
              </li>
            )}
          </ul>

          <button
            type="button"
            onClick={onOpenUnassigned}
            className={cn(
              "nav-item mt-3 flex w-full items-center gap-2 px-2 py-1.5 text-left text-body",
              selection === "unassigned"
                ? "is-active"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Inbox className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Unassigned</span>
            {unassignedCount > 0 && (
              <span className="telemetry shrink-0 text-meta text-muted-foreground">
                {unassignedCount}
              </span>
            )}
          </button>
        </div>

        {showCreate && (
          <div className="shrink-0 border-t border-border bg-background p-3">
            <input
              value={newName}
              onChange={(e) => onNewNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreate()
                if (e.key === "Escape") {
                  setShowCreate(false)
                  onNewNameChange("")
                }
              }}
              autoFocus
              placeholder="Project name"
              className="h-8 w-full rounded-sm border border-border bg-background px-2 text-body outline-none focus:border-primary/60"
            />
            <div className="mt-1.5 flex gap-1">
              <button
                type="button"
                disabled={creating || !newName.trim()}
                onClick={onCreate}
                className={cn(btnPrimary, "flex-1")}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false)
                  onNewNameChange("")
                }}
                className={btnGhostDense}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </PageAside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {/*
          The title and its actions, out of the band they sat in. What the
          eyebrow said -- PROJECTS or UNASSIGNED -- the column beside it already
          shows as the selected entry, and the title bar names the screen, so
          the band cost a row of height to repeat two things.
        */}
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 pt-1">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-wide">
              {mainTitle}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{mainSubtitle}</p>
          </div>
          {headerActions ? (
            <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
          ) : null}
        </header>

        <PageBody>
          <div className="p-4">
          {children ? (
            children
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-sm border border-dashed border-border bg-secondary/30 px-6 py-16 text-center">
              <FolderKanban className="mb-3 h-8 w-8 text-primary/70" />
              <p className="text-sm text-foreground">
                {projects.length === 0
                  ? "No projects yet"
                  : "No matching projects"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                {projects.length === 0
                  ? "Create a project so classifications and compositions stay organized by field."
                  : "Try a different search term."}
              </p>
              {projects.length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className={cn(btnPrimaryCommit, "mt-4")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New project
                </button>
              )}
            </div>
          ) : (
            <div>
              {/* The "Folders" heading lives in the sidebar; repeating it here
                  duplicated the label under a header already titled Projects. */}
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p) => (
                  <li key={p.id} className="min-h-[10.5rem]">
                    <ProjectFolderCard
                      project={p}
                      geometry={resolveProjectGeometry(p, areas ?? [])}
                      onOpen={() => onOpenProject(p.id)}
                      selected={selection === p.id}
                      className="h-full min-h-[10.5rem]"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </PageBody>
      </div>
    </PageShell>
  )
}
