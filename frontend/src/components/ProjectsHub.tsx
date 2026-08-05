import { useMemo, useState, type ReactNode } from "react"
import { FolderKanban, Inbox, Plus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"
import { ProjectFolderCard } from "@/components/ProjectFolderCard"

export type ProjectsHubSelection = "all" | "unassigned" | string

export function ProjectsHub({
  projects,
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
    <div className="terra-workspace flex h-full min-h-0 w-full">
      <aside className="ar-sidebar flex w-[16.5rem] shrink-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-2 pt-4">
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold tracking-wide text-foreground">
              Projects
            </p>
            <p className="telemetry mt-0.5 text-[10px] text-muted-foreground">
              {projects.length}{" "}
              {projects.length === 1 ? "workspace" : "workspaces"}
            </p>
          </div>
          <button
            type="button"
            title="New project"
            onClick={() => setShowCreate(true)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-[var(--ar-raised)] hover:text-foreground"
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
              className="ar-inset h-8 w-full py-0 pl-8 pr-2 text-[11px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
          <button
            type="button"
            onClick={onSelectAll}
            className={cn(
              "ar-nav-item mb-1 flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]",
              selection === "all"
                ? "is-active"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-primary/75" />
            <span className="min-w-0 flex-1 truncate">All projects</span>
            <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
              {projects.length}
            </span>
          </button>

          <p className="eyebrow mb-1 mt-2 px-2 !text-muted-foreground">Folders</p>
          <ul className="flex flex-col gap-0.5">
            {filtered.map((p) => {
              const runs = p.run_count ?? 0
              const overlays = p.overlay_count ?? 0
              const count = runs + overlays
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
                      "ar-nav-item flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]",
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
                    <span
                      className="telemetry shrink-0 text-[10px] text-muted-foreground"
                      aria-label={countLabel}
                    >
                      {count}
                    </span>
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-2 text-[10px] text-muted-foreground">
                {projects.length === 0 ? "No projects yet" : "No matches"}
              </li>
            )}
          </ul>

          <button
            type="button"
            onClick={onOpenUnassigned}
            className={cn(
              "ar-nav-item mt-3 flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]",
              selection === "unassigned"
                ? "is-active"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Inbox className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Unassigned</span>
            {unassignedCount > 0 && (
              <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                {unassignedCount}
              </span>
            )}
          </button>
        </div>

        {showCreate && (
          <div
            className="shrink-0 p-3"
            style={{
              borderTop: "1px solid var(--ar-border)",
              background: "var(--ar-bg)",
            }}
          >
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
              className="ar-inset h-8 w-full px-2 text-[11px] outline-none focus:border-primary/60"
            />
            <div className="mt-1.5 flex gap-1">
              <button
                type="button"
                disabled={creating || !newName.trim()}
                onClick={onCreate}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-sm bg-primary text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false)
                  onNewNameChange("")
                }}
                className="ar-ghost h-7 rounded-sm border px-2 text-[10px] text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="ar-header flex shrink-0 flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            {/* Names this screen; the classification view uses ANALYSIS. */}
            <p className="telemetry text-[10px] text-primary">
              {selection === "unassigned" ? "UNASSIGNED" : "PROJECTS"}
            </p>
            <h1 className="mt-0.5 font-display text-xl font-semibold tracking-wide">
              {mainTitle}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{mainSubtitle}</p>
          </div>
          {headerActions ? (
            <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">
          {children ? (
            children
          ) : filtered.length === 0 ? (
            <div className="ar-section flex min-h-[18rem] flex-col items-center justify-center border-dashed px-6 py-16 text-center">
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
                  className="mt-4 flex h-9 items-center gap-1.5 rounded-sm bg-primary px-4 text-xs font-semibold text-primary-foreground"
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
      </main>
    </div>
  )
}
