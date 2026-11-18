import { CircleNotch, CornersOut, Polygon } from "@/components/icons"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"
import { ShellPanel } from "@/components/shell/ShellPanel"
import {
  areaPolygon,
  featureKind,
  featureLabel,
  type FileLayer,
  type OpenedFile,
} from "@/lib/fileLayers"
import type { GeoJSONGeometry } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { PickedFeature } from "@/session/fileLayers"

/** A value as the table shows it; an empty one is said to be empty. */
function shown(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return v.toLocaleString("en", { maximumFractionDigits: 6 })
  return String(v)
}

/**
 * One feature of an opened file: what it is, every attribute the file gives
 * it, and, for a polygon, the way to make it an area.
 *
 * THE ATTRIBUTES IN THE FILE'S ORDER, each one, empty ones included and said
 * to be empty: a table that skipped them would make a missing value and a
 * missing column look the same.
 */
export function FeaturePanel({
  file,
  layer,
  picked,
  hasProject,
  onBack,
  onClose,
  onZoom,
  onUseAsArea,
}: {
  file: OpenedFile
  layer: FileLayer
  /** The attributes as the map drew them at once, and the whole feature once read. */
  picked: PickedFeature
  hasProject: boolean
  onBack: () => void
  onClose: () => void
  onZoom: () => void
  onUseAsArea: (name: string, polygon: GeoJSONGeometry) => void
}) {
  const feature = picked.feature
  // The file's own properties once read: the map's copy leaves out empty ones.
  const props = feature?.properties ?? picked.properties
  const name = featureLabel(props, layer.columns, layer.title || layer.name, picked.id)
  const area = areaPolygon(
    feature?.geometry as { type: string; coordinates: unknown } | null | undefined
  )
  const reading = !feature && !picked.failed
  const polygonal = layer.kind === "polygon" || layer.kind === "mixed"
  const kind = feature
    ? featureKind(feature.geometry)
    : layer.kind === "point"
      ? "A point"
      : layer.kind === "line"
        ? "A line"
        : layer.kind === "polygon"
          ? "A polygon"
          : "A feature"
  return (
    <ShellPanel
      crumbs={[
        { label: "Layers", onClick: onBack },
        { label: layer.title || layer.name, onClick: onBack },
        { label: name },
      ]}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {reading && (
            <p className="flex items-center gap-2 text-label text-muted-foreground">
              <CircleNotch className="size-3.5 animate-spin" />
              Reading its whole shape from the file
            </p>
          )}
          {picked.failed && (
            <p className="text-label text-destructive-quiet">
              Its whole shape could not be read: {picked.failed}
            </p>
          )}
          {area && area.parts > 1 && (
            <p className="text-label text-muted-foreground">
              It has {area.parts} parts. An area is one polygon, so the largest becomes
              the area.
            </p>
          )}
          {polygonal && !hasProject && (
            <p className="text-label text-muted-foreground">
              Open a project first: an area belongs to one.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!feature}
              onClick={onZoom}
              className={cn(btnGhost, "flex-1")}
            >
              <CornersOut className="size-4" />
              Zoom to it
            </button>
            {polygonal && (feature === null || area) && (
              <button
                type="button"
                disabled={!hasProject || !area}
                onClick={() => area && onUseAsArea(name, area.polygon)}
                className={cn(btnPrimary, "flex-1")}
              >
                <Polygon className="size-4" />
                Use as an area
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-label text-muted-foreground">
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-full border border-black/60"
            style={{ background: layer.color }}
          />
          {kind} in the layer {layer.title || layer.name} of {file.name}
        </p>
        {layer.columns.length === 0 ? (
          <p className="text-read text-muted-foreground">
            The layer has no attributes.
          </p>
        ) : (
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5">
            {layer.columns.map((c) => {
              const v = shown((props as Record<string, unknown>)[c])
              return (
                <div key={c} className="contents">
                  <dt className="truncate text-label text-muted-foreground" title={c}>
                    {c}
                  </dt>
                  <dd
                    className={cn(
                      "text-read break-words",
                      v === null ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {v ?? "empty"}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
      </div>
    </ShellPanel>
  )
}
