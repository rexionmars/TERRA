/**
 * Drawing an area without leaving the board.
 *
 * The band's AREA group could import a polygon and clear one, but not make one:
 * the only place to draw was the map, and reaching it meant closing the board
 * that the area was being drawn FOR. That is a round trip through the surface
 * you are trying to add to.
 *
 * A MAP OF ITS OWN, not the map screen's. MapView takes eighteen required props
 * -- overlays, swipe, confidence, contour scheme -- because it draws an
 * analysis. This draws a shape: a basemap, pan and zoom, and the polygon tool.
 * Threading the other seventeen through the board to reach the one that matters
 * would put every one of them somewhere they have nothing to do.
 *
 * The draw control itself is MapView's, exported rather than rebuilt. It
 * carries the single-polygon rule, the leaflet-draw patch and the geometry
 * shape the rest of the application means by an AOI; a second copy would be a
 * second place for those to drift.
 *
 * No new dependency and no new chunk: leaflet and leaflet-draw are already in
 * the eager graph through MapView, which the map screen mounts underneath.
 */
import { useState } from "react"
import { MapContainer, TileLayer } from "react-leaflet"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { DrawControl } from "@/components/MapView"
import { BASEMAPS, basemapByKind, type BasemapKind } from "@/lib/basemaps"
import { cn } from "@/lib/utils"
import type { GeoJSONGeometry } from "@/lib/types"

export function BoardAreaModal({
  view,
  polygon,
  onPolygonDrawn,
  onClose,
}: {
  /** Where to open, so the drawing starts where the work is. */
  view: { lat: number; lon: number; zoom: number }
  polygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<BasemapKind>("esri")
  const basemap = basemapByKind(kind)

  return (
    <ModalShell
      onDismiss={onClose}
      label="Draw an area"
      className="w-[min(72rem,92vw)]"
    >
      <ModalHeader
        eyebrow="Area"
        title="Draw the ground to analyse"
        subtitle="The polygon tool is at the bottom right. One shape at a time; drawing a second replaces the first."
        onClose={onClose}
        actions={
          <div className="flex items-center gap-1">
            {BASEMAPS.map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => setKind(b.kind)}
                className={cn(
                  "rounded-sm px-2 py-1 text-meta transition-colors",
                  b.kind === kind
                    ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                )}
              >
                {b.name}
              </button>
            ))}
          </div>
        }
      />

      <div className="p-4">
        {/*
          An explicit height. ModalShell sizes to its content and Leaflet sizes
          to its container, so a map asking for a share of the leftover space
          gets none and renders nothing -- the same zero-height collapse the
          compare modal opened with.
        */}
        <div className="h-[min(60vh,36rem)] overflow-hidden rounded-md">
          <MapContainer
            center={[view.lat, view.lon]}
            zoom={view.zoom}
            className="size-full"
            /*
              Not attribution-free: the licences ask for it where the medium
              allows one, and a modal allows one. Leaflet's own control carries
              the basemap's line.
            */
            attributionControl
          >
            <TileLayer
              key={basemap.kind}
              url={basemap.url}
              /*
                Rebuilt from the credit parts rather than a string of its own:
                the licences ask for the attribution to be reachable where the
                medium allows, and the hrefs live in that table.
              */
              attribution={basemap.credit
                .map((c) =>
                  c.href
                    ? `<a href="${c.href}" target="_blank" rel="noreferrer">${c.label}</a>`
                    : c.label
                )
                .join(" · ")}
              maxZoom={basemap.maxZoom}
            />
            <DrawControl
              customPolygon={polygon}
              onPolygonDrawn={onPolygonDrawn}
            />
          </MapContainer>
        </div>
      </div>
    </ModalShell>
  )
}
