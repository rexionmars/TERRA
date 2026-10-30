import { Polygon, Upload } from "@/components/icons"
import type { Area } from "@/lib/areas"
import { geometryAreaHectares } from "@/lib/geometry"
import { formatHectares } from "@/lib/runSummary"
import { cn } from "@/lib/utils"
import { btnGhost } from "@/components/ui/buttons"
import { PanelEmpty, ShellPanel } from "@/components/shell/ShellPanel"

/** The areas of the open project, and the two ways of making another. */
export function AreasPanel({
  areas,
  hasProject,
  activeAreaId,
  onActivate,
  onImport,
  onClose,
}: {
  areas: readonly Area[]
  hasProject: boolean
  activeAreaId?: string
  onActivate: (area: Area) => void
  onImport: () => void
  onClose: () => void
}) {
  // Fields are listed under Field boundaries, not here: a delineation can make
  // hundreds, and they would bury the areas they belong to.
  const roots = areas.filter((a) => !a.parent_id)
  const fieldCount = (id: string) => areas.filter((a) => a.parent_id === id).length
  return (
    <ShellPanel
      crumbs={[{ label: "Areas" }]}
      onClose={onClose}
      footer={
        <button type="button" onClick={onImport} className={cn(btnGhost, "w-full")}>
          <Upload className="size-4" />
          Import a .kml or GeoJSON file
        </button>
      }
    >
      {!hasProject ? (
        <PanelEmpty title="No project open">
          An area belongs to a project. Create or open one from the menu at the top.
        </PanelEmpty>
      ) : roots.length === 0 ? (
        <PanelEmpty title="No areas in this project">
          Draw one with the pencil on the map, or import a file.
        </PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-1">
          {roots.map((a) => {
            const active = a.id === activeAreaId
            const fields = fieldCount(a.id)
            return (
              <li key={a.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onActivate(a)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors",
                    active ? "bg-selected" : "hover:bg-hover"
                  )}
                >
                  <Polygon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-accent-quiet" : "text-muted-foreground"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-read text-foreground">{a.name}</span>
                    <span className="block text-label text-muted-foreground">
                      {formatHectares(geometryAreaHectares(a.geometry))}
                      {` · ${a.run_count} ${a.run_count === 1 ? "run" : "runs"}`}
                      {fields > 0 && ` · ${fields} ${fields === 1 ? "field" : "fields"}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </ShellPanel>
  )
}
