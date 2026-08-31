import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"
import { FolderKanban } from "lucide-react"

/*
  A project on the hub's grid.

  IT DREW A SHAPE, and could not honestly go on doing it. The outline came from
  the project's own polygon -- one geometry per workspace, written from whatever
  was on the map -- so a project working a dozen fields showed one of them, with
  nothing saying the other eleven were there. Those columns are gone.

  What replaces it is a count, not a thumbnail of the grounds: drawing them
  would be one query per card in a grid, and a dozen outlines at 64px say less
  than the number does. The grounds themselves are one click in, at full size.
*/
export function ProjectFolderCard({
  project,
  onOpen,
  selected,
  className,
}: {
  project: Project
  onOpen: () => void
  selected?: boolean
  className?: string
}) {
  const areas = project.area_count ?? 0
  const runs = project.run_count ?? 0
  const overlays = project.overlay_count ?? 0

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col text-left transition-colors",
        selected ? "rounded-sm border border-primary bg-secondary" : "rounded-sm border border-border bg-secondary hover:brightness-110",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
        className
      )}
    >
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-4 pt-5 pb-2"
        style={{
          background: "var(--background)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <FolderKanban
          aria-hidden
          className={cn(
            "h-12 w-12 shrink-0 transition-transform group-hover:scale-[1.04]",
            selected ? "text-primary" : "text-muted-foreground"
          )}
        />
      </div>
      <div className="mt-auto min-w-0 px-3.5 py-3">
        <p className="truncate font-display text-sm font-semibold tracking-wide text-foreground">
          {project.name}
        </p>
        {/*
          On the selection background muted text measures 3.41:1, below WCAG
          1.4.3. Selected cards therefore use the full-contrast text color
          (9.54:1), which is also the conventional treatment for a selected row.
        */}
        <p
          className={cn(
            "telemetry mt-1 text-[10px]",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {areas > 0
            ? `${areas} ${areas === 1 ? "area" : "areas"}`
            : "No areas drawn"}
        </p>
        <p
          className={cn(
            "telemetry mt-0.5 text-[10px]",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {runs} {runs === 1 ? "run" : "runs"} · {overlays}{" "}
          {overlays === 1 ? "overlay" : "overlays"}
        </p>
      </div>
    </button>
  )
}
