import { useState } from "react"

import { CaretRight, Check, PencilSimple, Polygon, Trash, Upload, X } from "@/components/icons"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import type { Area } from "@/lib/areas"
import type { GeoJSONGeometry } from "@/lib/types"
import { geometryAreaHectares } from "@/lib/geometry"
import { notifyError, notifySuccess } from "@/lib/notify"
import { formatHectares } from "@/lib/runSummary"
import { cn } from "@/lib/utils"
import { btnGhost } from "@/components/ui/buttons"
import { BoundaryCatalogue } from "@/components/shell/BoundaryCatalogue"
import { PanelEmpty, ShellPanel } from "@/components/shell/ShellPanel"

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {children}
    </button>
  )
}

/** One area's row: pressing it goes there, and its two actions stay out of the way. */
function AreaRow({
  area,
  active,
  depth = 0,
  fields = 0,
  expanded,
  onToggle,
  onActivate,
  onRename,
  onDelete,
}: {
  area: Area
  active: boolean
  depth?: number
  fields?: number
  expanded?: boolean
  onToggle?: () => void
  /** With shift, the press adds the area to the selection instead. */
  onActivate: (extend: boolean) => void
  onRename?: (name: string) => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(area.name)

  const commit = () => {
    const name = draft.trim()
    if (name && name !== area.name) onRename?.(name)
    setEditing(false)
  }

  if (editing) {
    return (
      <form
        className="flex items-center gap-1 px-2 py-1"
        onSubmit={(e) => {
          e.preventDefault()
          commit()
        }}
      >
        <input
          aria-label={`New name for ${area.name}`}
          autoFocus
          className="field-input min-w-0 flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false)
          }}
        />
        <IconButton label="Save the name" onClick={commit}>
          <Check className="size-4" />
        </IconButton>
        <IconButton label="Keep the name" onClick={() => setEditing(false)}>
          <X className="size-4" />
        </IconButton>
      </form>
    )
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-sm pr-1 transition-colors",
        active ? "bg-selected" : "hover:bg-hover"
      )}
      style={{ paddingLeft: depth ? "1.5rem" : undefined }}
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} the fields of ${area.name}`}
          onClick={onToggle}
          className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <CaretRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : (
        <span aria-hidden className="w-2 shrink-0" />
      )}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={(e) => onActivate(e.shiftKey)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <Polygon
          className={cn("size-4 shrink-0", active ? "text-accent-quiet" : "text-muted-foreground")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-read text-foreground">{area.name}</span>
          <span className="block text-label text-muted-foreground">
            {formatHectares(geometryAreaHectares(area.geometry))}
            {` · ${area.run_count} ${area.run_count === 1 ? "run" : "runs"}`}
            {fields > 0 && ` · ${fields} ${fields === 1 ? "field" : "fields"}`}
          </span>
        </span>
      </button>
      <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {onRename && (
          <IconButton
            label={`Rename ${area.name}`}
            onClick={() => {
              setDraft(area.name)
              setEditing(true)
            }}
          >
            <PencilSimple className="size-3.5" />
          </IconButton>
        )}
        {onDelete && (
          <IconButton label={`Delete ${area.name}`} onClick={onDelete}>
            <Trash className="size-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  )
}

/** The areas of the open project, and the two ways of making another. */
export function AreasPanel({
  areas,
  hasProject,
  activeAreaId,
  selectedAreaIds,
  onActivate,
  onRename,
  onDelete,
  onSelect,
  onClearSelection,
  onImport,
  onPickBoundary,
  onClose,
}: {
  areas: readonly Area[]
  hasProject: boolean
  activeAreaId?: string
  selectedAreaIds?: readonly string[]
  onActivate: (area: Area) => void
  onRename?: (id: string, name: string) => void
  /** Rejects where the store refused, so the deletion is announced only when it happened. */
  onDelete?: (id: string) => Promise<void> | void
  /** Changes what a queued run is made over, which is what lets a product run over many. */
  onSelect?: (ids: string[], mode: "toggle" | "add") => void
  onClearSelection?: () => void
  onImport: () => void
  onPickBoundary?: (name: string, geometry: GeoJSONGeometry) => void
  onClose: () => void
}) {
  const roots = areas.filter((a) => !a.parent_id)
  const fieldsOf = (id: string) => areas.filter((a) => a.parent_id === id)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selected = selectedAreaIds?.length ?? 0
  const picked = new Set(selectedAreaIds ?? [])
  const [catalogue, setCatalogue] = useState(false)
  const press = (a: Area, extend: boolean) => {
    if (extend && onSelect) onSelect([a.id], "toggle")
    else onActivate(a)
  }
  const [deleting, setDeleting] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)

  /*
    DeleteArea removes the runs of the area and their rasters, and a field's
    with it, which cannot be taken back. So the dialog says how many.
  */
  const confirmDelete = async () => {
    if (!deleting || !onDelete) return
    setBusy(true)
    try {
      await onDelete(deleting.id)
      notifySuccess(`${deleting.name} deleted.`)
      setDeleting(null)
    } catch (e) {
      notifyError("Could not delete the area", e)
    } finally {
      setBusy(false)
    }
  }
  const lost = (a: Area) => {
    const fields = fieldsOf(a.id)
    const runs = a.run_count + fields.reduce((n, f) => n + f.run_count, 0)
    const parts = [
      runs > 0 && `${runs} ${runs === 1 ? "run" : "runs"} and their rasters`,
      fields.length > 0 && `${fields.length} ${fields.length === 1 ? "field" : "fields"}`,
    ].filter(Boolean)
    return parts.length
      ? `This also deletes ${parts.join(" and ")}. It cannot be undone.`
      : "It holds no runs. This cannot be undone."
  }

  if (catalogue && onPickBoundary) {
    return (
      <ShellPanel
        crumbs={[{ label: "Areas", onClick: () => setCatalogue(false) }, { label: "IBGE boundaries" }]}
        onClose={onClose}
      >
        <BoundaryCatalogue
          onPick={(name, geometry) => {
            onPickBoundary(name, geometry)
            setCatalogue(false)
          }}
        />
      </ShellPanel>
    )
  }

  return (
    <ShellPanel
      crumbs={[{ label: "Areas" }]}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {selected > 0 && (
            <div className="flex items-center justify-between gap-2 text-label text-muted-foreground">
              <span>
                {selected} selected. Products queue one run for each. Shift-press adds or removes one.
              </span>
              <button type="button" onClick={onClearSelection} className="text-foreground hover:underline">
                Clear
              </button>
            </div>
          )}
          <button type="button" onClick={onImport} className={cn(btnGhost, "w-full")}>
            <Upload className="size-4" />
            Import a .kml or GeoJSON file
          </button>
          {onPickBoundary && (
            <button
              type="button"
              disabled={!hasProject}
              onClick={() => setCatalogue(true)}
              className={cn(btnGhost, "w-full")}
            >
              <Polygon className="size-4" />
              A state or municipality, from IBGE
            </button>
          )}
        </div>
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
            const fields = fieldsOf(a.id)
            const expanded = open.has(a.id)
            return (
              <li key={a.id}>
                <AreaRow
                  area={a}
                  active={a.id === activeAreaId}
                  fields={fields.length}
                  expanded={expanded}
                  onToggle={fields.length ? () => toggle(a.id) : undefined}
                  onActivate={(extend) => press(a, extend)}
                  onRename={onRename ? (name) => onRename(a.id, name) : undefined}
                  onDelete={onDelete ? () => setDeleting(a) : undefined}
                />
                {expanded && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    {onSelect && (
                      <button
                        type="button"
                        onClick={() => {
                          const ids = fields.map((f) => f.id)
                          if (ids.every((id) => picked.has(id))) onSelect(ids, "toggle")
                          else onSelect(ids, "add")
                        }}
                        className="ml-8 self-start py-1 text-label text-muted-foreground hover:text-foreground"
                      >
                        {fields.every((f) => picked.has(f.id))
                          ? `Deselect all ${fields.length} fields`
                          : `Select all ${fields.length} fields`}
                      </button>
                    )}
                    {fields.map((f) => (
                      <AreaRow
                        key={f.id}
                        area={f}
                        depth={1}
                        active={f.id === activeAreaId}
                        onActivate={(extend) => press(f, extend)}
                        onRename={onRename ? (name) => onRename(f.id, name) : undefined}
                        onDelete={onDelete ? () => setDeleting(f) : undefined}
                      />
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {deleting && (
        <ConfirmDelete
          eyebrow="DELETE AREA"
          title={deleting.name}
          subtitle={lost(deleting)}
          confirmLabel="Delete area"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </ShellPanel>
  )
}
