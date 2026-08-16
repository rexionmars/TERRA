import { cn } from "@/lib/utils"
import type { GeoJSONGeometry, Project } from "@/lib/types"
import { geometryAreaHectares } from "@/lib/geometry"
import { AoiFootprint } from "@/components/AoiFootprint"
import { formatHectares } from "@/lib/runSummary"

export function ProjectFolderCard({
  project,
  geometry,
  onOpen,
  selected,
  className,
}: {
  project: Project
  /** Resolved AOI geometry; null when the project has none. */
  geometry?: GeoJSONGeometry | null
  onOpen: () => void
  selected?: boolean
  className?: string
}) {
  const runs = project.run_count ?? 0
  const overlays = project.overlay_count ?? 0
  const areaHa = geometry ? geometryAreaHectares(geometry) : 0

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
        <AoiFootprint
          geometry={geometry}
          title={`${project.name} area of interest`}
          className="h-16 w-16 shrink-0 transition-transform group-hover:scale-[1.04]"
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
        {/* The outline is normalised to its own bounds and so carries no
            scale; the area figure is what distinguishes a 20 ha plot from a
            2000 ha farm. Hectares throughout, the working unit here. */}
        <p
          className={cn(
            "telemetry mt-1 text-[10px]",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {areaHa > 0 ? formatHectares(areaHa) : "No AOI set"}
        </p>
        <p
          className={cn(
            "telemetry mt-0.5 text-[10px]",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {runs} {runs === 1 ? "analysis" : "analyses"} · {overlays}{" "}
          {overlays === 1 ? "overlay" : "overlays"}
          {project.label ? ` · ${project.label}` : ""}
        </p>
      </div>
    </button>
  )
}
