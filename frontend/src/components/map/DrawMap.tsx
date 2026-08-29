/**
 * A map for drawing a shape, and nothing else.
 *
 * MapSurface answers a contract of twenty-five props because it draws an
 * analysis: overlays, a swipe, confidence, a contour scheme. This draws a
 * boundary -- a basemap, pan and zoom, and the polygon tool -- and threading
 * the other twenty through the board to reach the one that matters would put
 * every one of them somewhere they have nothing to do. The argument is the
 * board modal's own, from when this was Leaflet, and it did not change with the
 * library.
 *
 * What IS shared is the part that would drift: `useAreaDrawing` carries the
 * single-area rule, when a shape is reported and the sync with the copy held
 * outside. Two maps, one answer to what drawing an area means.
 *
 * THE STROKE IS VISIBLE HERE. On the work map the finished shape is deliberately
 * unpainted and the AOI contour draws the outline above the overlays; there is
 * no contour on this map, so without a stroke of its own a closed polygon
 * vanished the instant it was finished -- the shape in hand and invisible, which
 * reads as the drawing having failed.
 */
import "maplibre-gl/dist/maplibre-gl.css"
// Points MapLibre at its worker; see the module for why that is not automatic.
import "@/lib/maplibreWorker"

import { useEffect, useRef, useState } from "react"
import { Pencil, Spline, Trash2 } from "lucide-react"
import { Map as MapLibreMap, type GeoJSONSource, type Subscription } from "maplibre-gl"

import { SpaceBackdrop } from "@/components/map/SpaceBackdrop"
import { useAreaDrawing } from "@/components/map/useAreaDrawing"
import type { Basemap } from "@/lib/basemaps"
import { cn } from "@/lib/utils"
import type { GeoJSONGeometry } from "@/lib/types"

const BASE_SOURCE = "basemap"
const BASE_LAYER = "basemap"
const SHAPE_SOURCE = "shape"
const SHAPE_FILL = "shape-fill"
const SHAPE_LINE = "shape-line"

export function DrawMap({
  view,
  basemap,
  polygon,
  onPolygonDrawn,
  flyTo,
  className,
}: {
  /** Where to open, so the drawing starts where the work is. */
  view: { lat: number; lon: number; zoom: number }
  basemap: Basemap
  polygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  /** Carries a nonce, so searching the same place twice flies there twice. */
  flyTo: { lat: number; lon: number; key: number } | null
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)

  const { mode, setMode, clear, stop } = useAreaDrawing({
    map: mapRef.current,
    ready,
    polygon,
    onPolygonDrawn,
  })
  const stopRef = useRef(stop)
  stopRef.current = stop

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const map = new MapLibreMap({
      container: host,
      // The credit is in the modal's header, beside the basemap buttons it
      // belongs to, rather than floating over the ground being drawn on.
      attributionControl: false,
      center: [view.lon, view.lat],
      zoom: view.zoom,
      maxPitch: 85,
      style: {
        version: 8,
        projection: { type: "globe" },
        sources: {
          [BASE_SOURCE]: {
            type: "raster",
            tiles: [basemap.url],
            tileSize: 256,
            maxzoom: basemap.maxNativeZoom ?? basemap.maxZoom,
          },
          [SHAPE_SOURCE]: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          { id: BASE_LAYER, type: "raster", source: BASE_SOURCE },
          {
            id: SHAPE_FILL,
            type: "fill",
            source: SHAPE_SOURCE,
            paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 },
          },
          {
            id: SHAPE_LINE,
            type: "line",
            source: SHAPE_SOURCE,
            paint: { "line-color": "#ffffff", "line-width": 1.5 },
          },
        ],
      },
    })
    mapRef.current = map

    const subs: Subscription[] = []
    subs.push(map.on("load", () => setReady(true)))
    subs.push(map.on("error", (e) => console.error("[draw map]", e.error ?? e)))

    return () => {
      // Before the map goes: see useAreaDrawing for why the order matters.
      stopRef.current()
      for (const s of subs) s.unsubscribe()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // Mount only: the opening view is read once, as a camera position is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource(BASE_SOURCE)
    ;(src as unknown as { setTiles?: (t: string[]) => void })?.setTiles?.([
      basemap.url,
    ])
  }, [basemap.url, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource<GeoJSONSource>(SHAPE_SOURCE)
    void src?.setData(
      polygon
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: polygon as never },
            ],
          }
        : { type: "FeatureCollection", features: [] }
    )
  }, [polygon, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !flyTo) return
    map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: 14, duration: 1200 })
  }, [flyTo, ready])

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <SpaceBackdrop />
      {/*
        h-full rather than `absolute inset-0`: MapLibre's stylesheet declares
        `.maplibregl-map { position: relative }` at one class of specificity and
        is imported after the app's, so `absolute` loses the tie on source order
        and the container collapses to zero height.
      */}
      <div ref={hostRef} className="h-full w-full" />
      <div className="app-no-drag absolute bottom-3 right-3 z-[400] flex flex-col overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)]">
        <DrawButton
          label="Draw an area"
          active={mode === "draw"}
          onClick={() => setMode((m) => (m === "draw" ? "idle" : "draw"))}
        >
          <Pencil className="size-4" strokeWidth={1.5} />
        </DrawButton>
        <DrawButton
          label="Edit the area"
          active={mode === "edit"}
          onClick={() => setMode((m) => (m === "edit" ? "idle" : "edit"))}
        >
          <Spline className="size-4" strokeWidth={1.5} />
        </DrawButton>
        <DrawButton label="Delete the area" onClick={clear}>
          <Trash2 className="size-4" strokeWidth={1.5} />
        </DrawButton>
      </div>
    </div>
  )
}

/** The map chrome's figures, as MapSurface and OverlayToolsPanel both use them. */
function DrawButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-[2.125rem] items-center justify-center transition-colors",
        "border-b border-[rgb(var(--p-line)/0.22)] last:border-b-0",
        "bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-primary"
          : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
