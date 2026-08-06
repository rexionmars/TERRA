import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  ImageOverlay,
  Marker,
  LayersControl,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet"
import L from "leaflet"
// Imports "leaflet-draw" and patches the leaflet-draw 1.0.4 / leaflet 1.9.x
// touch-finish incompatibility. Must run before any L.Control.Draw is created.
import "./leafletDrawPatch"
import type { LatLngBoundsExpression } from "leaflet"
import type { Area, PredictResult, GeoJSONGeometry, CompositionOverlay } from "@/lib/types"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import {
  polygonOuterRing,
  ringCentroid,
  type LonLat,
} from "@/lib/geometry"
import {
  getAoiContourScheme,
  type AoiContourScheme,
  type AoiContourSchemeId,
} from "@/lib/aoiStyle"
import {
  AoiContextMenu,
  type AoiContextMenuState,
} from "@/components/AoiContextMenu"

interface MapViewProps {
  /**
   * Where the map was left last session. Read once on mount: Leaflet treats
   * center and zoom as initial values, and rebinding them would fight the
   * user's own panning.
   */
  initialView?: { lat: number; lon: number; zoom: number } | null
  areas: Area[]
  activeExample: string
  customPolygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onSelectExample: (id: string) => void
  flyTo: { lat: number; lon: number; key: number } | null
  result: PredictResult | null
  overlayOpacity: number
  showConfidence: boolean
  /** When true (default), keep class prediction under the confidence overlay. */
  confidenceOnTop: boolean
  smoothOverlay: boolean
  /** When false, hide the classification / LULC overlay. */
  showPredictionOverlay?: boolean
  /** When false, hide the band composition overlay. */
  showCompositionOverlay?: boolean
  composition?: CompositionOverlay | null
  /** Surface-water occurrence raster, rendered above the basemap. */
  waterOverlay?: { uri: string; extent: PredictResult["extent"] } | null
  /** Vertical wipe: left = basemap, right = prediction. */
  swipeCompare: boolean
  swipeRatio: number
  onSwipeRatioChange: (ratio: number) => void
  areaLabel?: string
  onAreaLabelChange: (label: string) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void
  onClearArea: () => void
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
}

// Report map center/zoom to the telemetry readout.
function ViewReporter({
  onViewChange,
}: {
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
}) {
  const map = useMapEvents({
    move: () => {
      const c = map.getCenter()
      onViewChange({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })
    },
    zoom: () => {
      const c = map.getCenter()
      onViewChange({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })
    },
  })
  useEffect(() => {
    const c = map.getCenter()
    onViewChange({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })
  }, [map, onViewChange])
  return null
}

type BasemapKind = "esri" | "eox" | "osm"

function basemapKindFromLayerName(name: string): BasemapKind {
  if (/sentinel|eox/i.test(name)) return "eox"
  if (/osm|openstreet/i.test(name) || /^map\b/i.test(name)) return "osm"
  return "esri"
}

function formatYmd(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }
  return ymd
}

/** Normalize Esri DATE (YYYYMMDD) or SRC_DATE2 (M/D/YYYY) → YYYY-MM-DD. */
function normalizeImageryDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d{8}$/.test(trimmed)) return formatYmd(trimmed)
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
  }
  return trimmed
}

function dateSortKey(raw: string): string {
  const n = normalizeImageryDate(raw)
  return n ? n.replace(/-/g, "") : ""
}

/** Esri World Imagery identify → acquisition date at a map point. */
async function fetchEsriImageryDate(
  lat: number,
  lon: number,
  zoom: number,
  signal?: AbortSignal
): Promise<string | null> {
  const pad = Math.max(0.02, 180 / 2 ** Math.max(zoom, 1))
  const params = new URLSearchParams({
    f: "json",
    tolerance: "5",
    returnGeometry: "false",
    imageDisplay: "800,600,96",
    geometry: JSON.stringify({ x: lon, y: lat }),
    geometryType: "esriGeometryPoint",
    sr: "4326",
    mapExtent: `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`,
    layers: "top:0",
  })
  const res = await fetch(
    `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?${params}`,
    { signal }
  )
  if (!res.ok) return null
  const data = (await res.json()) as {
    results?: Array<{
      attributes?: Record<string, string>
    }>
  }
  const results = data.results ?? []
  if (!results.length) return null

  const withLevels = results.map((r) => {
    const a = r.attributes ?? {}
    const date = a["DATE (YYYYMMDD)"] || a.SRC_DATE2 || ""
    return {
      date,
      min: Number(a.MinMapLevel ?? 0),
      max: Number(a.MaxMapLevel ?? 22),
    }
  })
  const matching = withLevels.filter((r) => zoom >= r.min && zoom <= r.max && r.date)
  const pool = matching.length ? matching : withLevels.filter((r) => r.date)
  if (!pool.length) return null

  pool.sort((a, b) => dateSortKey(b.date).localeCompare(dateSortKey(a.date)))
  return normalizeImageryDate(pool[0].date)
}

/**
 * Shows the active basemap imagery date next to the Leaflet attribution prefix.
 * Esri: acquisition date at map center (updates on pan/zoom). EOX: mosaic year.
 */
function BasemapDateAttribution() {
  const map = useMap()
  const [basemap, setBasemap] = useState<BasemapKind>("esri")
  const [dateLabel, setDateLabel] = useState<string | null>(null)

  useEffect(() => {
    const onBase = (e: L.LayersControlEvent) => {
      setBasemap(basemapKindFromLayerName(e.name))
    }
    map.on("baselayerchange", onBase)
    return () => {
      map.off("baselayerchange", onBase)
    }
  }, [map])

  useEffect(() => {
    if (basemap === "eox") {
      setDateLabel("2025")
      return
    }
    if (basemap === "osm") {
      setDateLabel(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: AbortController | undefined

    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        abort?.abort()
        abort = new AbortController()
        const c = map.getCenter()
        try {
          const d = await fetchEsriImageryDate(c.lat, c.lng, map.getZoom(), abort.signal)
          if (!cancelled) setDateLabel(d)
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return
          if (!cancelled) setDateLabel(null)
        }
      }, 350)
    }

    refresh()
    map.on("moveend", refresh)
    map.on("zoomend", refresh)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      abort?.abort()
      map.off("moveend", refresh)
      map.off("zoomend", refresh)
    }
  }, [map, basemap])

  useEffect(() => {
    const leaflet =
      '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>'
    const prefix = dateLabel ? `🇺🇦 ${leaflet} · ${dateLabel}` : `🇺🇦 ${leaflet}`
    map.attributionControl.setPrefix(prefix)
  }, [map, dateLabel])

  return null
}

function FlyToController({
  flyTo,
}: {
  flyTo: { lat: number; lon: number; key: number } | null
}) {
  const map = useMap()
  useEffect(() => {
    if (flyTo) map.flyTo([flyTo.lat, flyTo.lon], 14, { duration: 1.2 })
  }, [map, flyTo])
  return null
}

function FitBounds({
  customPolygon,
  result,
}: {
  customPolygon: GeoJSONGeometry | null
  result: PredictResult | null
}) {
  const map = useMap()
  useEffect(() => {
    if (result) {
      const e = result.extent
      if (
        !e ||
        (e.lon_min === 0 && e.lon_max === 0 && e.lat_min === 0 && e.lat_max === 0)
      ) {
        return
      }
      map.fitBounds(
        [
          [e.lat_min, e.lon_min],
          [e.lat_max, e.lon_max],
        ],
        { padding: [40, 40] }
      )
    }
  }, [map, customPolygon, result])
  return null
}

function FitComposition({
  composition,
  hasPrediction,
}: {
  composition: CompositionOverlay | null | undefined
  hasPrediction: boolean
}) {
  const map = useMap()
  useEffect(() => {
    if (!composition || hasPrediction) return
    const e = composition.extent
    if (
      !e ||
      (e.lon_min === 0 && e.lon_max === 0 && e.lat_min === 0 && e.lat_max === 0)
    ) {
      return
    }
    map.fitBounds(
      [
        [e.lat_min, e.lon_min],
        [e.lat_max, e.lon_max],
      ],
      { padding: [40, 40] }
    )
  }, [map, composition?.overlay_uri, hasPrediction])
  return null
}

/**
 * Prediction ImageOverlay. Smooth = contour/isoband style (solid colors,
 * curved class boundaries via blur→argmax), not soft RGB blend.
 * Optional swipeRatio clips the overlay so the left side reveals the basemap.
 */
function PredictionOverlay({
  url,
  bounds,
  opacity,
  smooth,
  zIndex = 400,
  swipeRatio = null,
}: {
  url: string
  bounds: LatLngBoundsExpression
  opacity: number
  smooth: boolean
  zIndex?: number
  /** 0–1 map-container fraction; null disables clip. */
  swipeRatio?: number | null
}) {
  const map = useMap()
  const ref = useRef<L.ImageOverlay | null>(null)
  const [displayUrl, setDisplayUrl] = useState(url)

  useEffect(() => {
    let cancelled = false

    if (!smooth) {
      setDisplayUrl(url)
      return
    }

    majoritySmoothOverlay(url)
      .then((next) => {
        if (!cancelled) setDisplayUrl(next)
      })
      .catch(() => {
        if (!cancelled) setDisplayUrl(url)
      })

    return () => {
      cancelled = true
    }
  }, [url, smooth])

  useEffect(() => {
    // Always nearest-neighbor: colors stay solid; curves come from the raster.
    const applyCrisp = () => {
      const img = ref.current?.getElement()
      if (!img) return
      img.classList.add("overlay-crisp")
      img.classList.remove("overlay-smooth")
    }
    applyCrisp()
    const overlay = ref.current
    if (!overlay) return
    overlay.on("load", applyCrisp)
    return () => {
      overlay.off("load", applyCrisp)
    }
  }, [displayUrl])

  useEffect(() => {
    ref.current?.setUrl(displayUrl)
  }, [displayUrl])

  useEffect(() => {
    ref.current?.setZIndex(zIndex)
  }, [zIndex])

  useEffect(() => {
    const applyClip = () => {
      const img = ref.current?.getElement()
      if (!img) return
      if (swipeRatio == null) {
        img.style.clipPath = ""
        return
      }
      const mapRect = map.getContainer().getBoundingClientRect()
      const imgRect = img.getBoundingClientRect()
      if (imgRect.width <= 0 || imgRect.height <= 0) {
        img.style.clipPath = ""
        return
      }
      const lineX = mapRect.left + swipeRatio * mapRect.width
      const clipLeft = Math.max(0, Math.min(imgRect.width, lineX - imgRect.left))
      img.style.clipPath = `inset(0 0 0 ${clipLeft}px)`
    }

    applyClip()
    const overlay = ref.current
    overlay?.on("load", applyClip)
    map.on("move zoom moveend zoomend viewreset", applyClip)
    window.addEventListener("resize", applyClip)
    return () => {
      overlay?.off("load", applyClip)
      map.off("move zoom moveend zoomend viewreset", applyClip)
      window.removeEventListener("resize", applyClip)
      const img = ref.current?.getElement()
      if (img) img.style.clipPath = ""
    }
  }, [map, swipeRatio, displayUrl, opacity])

  return (
    <ImageOverlay
      ref={ref}
      url={displayUrl}
      bounds={bounds}
      opacity={opacity}
      zIndex={zIndex}
      className="overlay-crisp"
    />
  )
}

/** Locks pan while the swipe handle is dragged. */
function MapDragLock({ locked }: { locked: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (locked) {
      map.dragging.disable()
      return () => {
        map.dragging.enable()
      }
    }
    map.dragging.enable()
  }, [locked, map])
  return null
}

/** Vertical wipe handle overlaid on the map container (DOM, not a Leaflet layer). */
function SwipeDivider({
  ratio,
  onRatioChange,
  onDraggingChange,
  rightLabel = "Prediction",
}: {
  ratio: number
  onRatioChange: (ratio: number) => void
  onDraggingChange: (dragging: boolean) => void
  rightLabel?: string
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = Math.min(0.92, Math.max(0.08, (clientX - rect.left) / rect.width))
    onRatioChange(next)
  }

  return (
    <div
      ref={trackRef}
      className="map-swipe-track app-no-drag pointer-events-none absolute inset-0 z-[1050]"
      aria-hidden={false}
    >
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: `${ratio * 100}%`, transform: "translateX(-50%)" }}
      />
      <div
        className="pointer-events-none absolute top-3 -translate-x-full rounded-sm bg-black/55 px-1.5 py-0.5 text-[10px] tracking-wide text-white/90"
        style={{ left: `calc(${ratio * 100}% - 8px)` }}
      >
        Imagery
      </div>
      <div
        className="pointer-events-none absolute top-3 translate-x-0 rounded-sm bg-black/55 px-1.5 py-0.5 text-[10px] tracking-wide text-white/90"
        style={{ left: `calc(${ratio * 100}% + 8px)` }}
      >
        {rightLabel}
      </div>
      <button
        type="button"
        aria-label={`Drag to compare imagery and ${rightLabel.toLowerCase()}`}
        className="map-swipe-handle pointer-events-auto absolute top-1/2 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/70 bg-black/55 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        style={{ left: `${ratio * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const target = e.currentTarget
          target.setPointerCapture(e.pointerId)
          onDraggingChange(true)
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          e.preventDefault()
          e.stopPropagation()
          setFromClientX(e.clientX)
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
          onDraggingChange(false)
        }}
        onPointerCancel={() => onDraggingChange(false)}
      >
        <span className="flex gap-0.5" aria-hidden>
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
          <span className="h-4 w-0.5 rounded-full bg-white/90" />
        </span>
      </button>
    </div>
  )
}

// leaflet-draw integration: a single-polygon draw tool with edit/clear.
function DrawControl({
  customPolygon,
  onPolygonDrawn,
}: {
  customPolygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
}) {
  const map = useMap()
  const fgRef = useRef<L.FeatureGroup | null>(null)
  const cbRef = useRef(onPolygonDrawn)
  useEffect(() => {
    cbRef.current = onPolygonDrawn
  }, [onPolygonDrawn])

  useEffect(() => {
    const drawnItems = new L.FeatureGroup()
    fgRef.current = drawnItems
    map.addLayer(drawnItems)

    const drawControl = new (L as any).Control.Draw({
      position: "bottomright",
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          // Non-interactive + light fill so rubber-band guides stay visible
          // above the in-progress shape (see leafletDrawPatch guide pane).
          shapeOptions: {
            interactive: false,
            // legacy leaflet-draw default; keep false so fill never steals events
            clickable: false,
            fill: true,
            fillOpacity: 0.06,
            weight: 1.5,
            opacity: 1,
            color: "#ffffff",
          },
          icon: new L.DivIcon({
            iconSize: new L.Point(10, 10),
            className: "leaflet-div-icon leaflet-editing-icon geosense-draw-vertex",
          }),
        },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems, remove: true },
    })
    map.addControl(drawControl)

    const emit = () => {
      const layers = drawnItems.getLayers()
      if (layers.length === 0) {
        cbRef.current(null)
        return
      }
      const gj = (layers[layers.length - 1] as L.Polygon).toGeoJSON()
      cbRef.current(gj.geometry as GeoJSONGeometry)
    }
    const onCreated = (e: any) => {
      drawnItems.clearLayers()
      // Hide draw stroke once finished — AoiContour paints the visible white outline above overlays.
      if (e.layer?.setStyle) {
        e.layer.setStyle({
          color: "#ffffff",
          weight: 1.5,
          opacity: 0,
          fillOpacity: 0,
        })
      }
      drawnItems.addLayer(e.layer)
      emit()
    }

    map.on((L as any).Draw.Event.CREATED, onCreated)
    map.on((L as any).Draw.Event.EDITED, emit)
    map.on((L as any).Draw.Event.DELETED, emit)

    return () => {
      map.off((L as any).Draw.Event.CREATED, onCreated)
      map.off((L as any).Draw.Event.EDITED, emit)
      map.off((L as any).Draw.Event.DELETED, emit)
      map.removeControl(drawControl)
      map.removeLayer(drawnItems)
    }
  }, [map])

  // Sync external polygon (search/import/example/clear) into the draw layer.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const layers = fg.getLayers()
    const current =
      layers.length > 0
        ? ((layers[0] as L.Polygon).toGeoJSON().geometry as GeoJSONGeometry)
        : null
    if (JSON.stringify(current) === JSON.stringify(customPolygon)) return
    if (customPolygon) {
      fg.clearLayers()
      const layer = L.geoJSON(customPolygon as any, {
        style: {
          color: "#ffffff",
          weight: 1.5,
          opacity: 0,
          fillOpacity: 0,
        },
      })
      layer.eachLayer((l) => {
        if (l instanceof L.Path) {
          l.setStyle({
            color: "#ffffff",
            weight: 1.5,
            opacity: 0,
            fillOpacity: 0,
          })
        }
        fg.addLayer(l)
      })
      try {
        map.fitBounds(fg.getBounds(), { padding: [40, 40] })
      } catch {
        // ignore invalid bounds
      }
    } else if (layers.length > 0) {
      fg.clearLayers()
    }
  }, [map, customPolygon])

  return null
}

/** Ray-cast point-in-polygon (lon/lat), for AOI right-click hit testing. */
function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInAoi(lon: number, lat: number, geometry: GeoJSONGeometry): boolean {
  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as LonLat[][]
    const outer = coords[0]
    if (!outer || !pointInRing(lon, lat, outer)) return false
    for (let h = 1; h < coords.length; h++) {
      if (pointInRing(lon, lat, coords[h])) return false
    }
    return true
  }
  if (geometry.type === "MultiPolygon") {
    const multi = geometry.coordinates as unknown as LonLat[][][]
    return multi.some((poly) => {
      const outer = poly[0]
      if (!outer || !pointInRing(lon, lat, outer)) return false
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lon, lat, poly[h])) return false
      }
      return true
    })
  }
  return false
}

/**
 * Captures right-clicks on the map (including over prediction ImageOverlays).
 * Suppresses the Wails/browser menu and opens the AOI menu when inside the polygon.
 */
function AoiRightClickBridge({
  geometry,
  containerRef,
  onOpen,
}: {
  geometry: GeoJSONGeometry | null
  containerRef: RefObject<HTMLDivElement | null>
  onOpen: (menu: AoiContextMenuState | null) => void
}) {
  const map = useMap()
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const containerRefStable = containerRef

  useEffect(() => {
    const el = map.getContainer()
    const onContextMenu = (e: MouseEvent) => {
      // Always block native Reload / Inspect on the map surface.
      e.preventDefault()
      e.stopPropagation()

      const g = geometryRef.current
      if (!g) {
        onOpenRef.current(null)
        return
      }

      const ll = map.mouseEventToLatLng(e)
      if (!pointInAoi(ll.lng, ll.lat, g)) {
        onOpenRef.current(null)
        return
      }

      const root = containerRefStable.current
      const rect = root?.getBoundingClientRect()
      onOpenRef.current({
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      })
    }

    el.addEventListener("contextmenu", onContextMenu, true)
    return () => el.removeEventListener("contextmenu", onContextMenu, true)
  }, [map, containerRefStable])

  return null
}

/** Longest edge in the southern band of the AOI — label glues to this segment. */
function pickContourEdge(geometry: GeoJSONGeometry): {
  a: LonLat
  b: LonLat
  mid: LonLat
} | null {
  const ring = polygonOuterRing(geometry)
  if (!ring || ring.length < 2) return null

  let latMin = Infinity
  let latMax = -Infinity
  for (const [, lat] of ring) {
    if (lat < latMin) latMin = lat
    if (lat > latMax) latMax = lat
  }
  const southBand = latMin + (latMax - latMin) * 0.4

  let best: { a: LonLat; b: LonLat; mid: LonLat; score: number } | null = null
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const dlon = b[0] - a[0]
    const dlat = b[1] - a[1]
    const len = Math.hypot(dlon, dlat)
    if (len < 1e-12) continue
    // Prefer southern long edges (Wheat Field labels sit on the bottom contour).
    const southBonus = mid[1] <= southBand ? 3 : 1
    const score = len * southBonus - (mid[1] - latMin) * 0.15
    if (!best || score > best.score) {
      best = { a, b, mid, score }
    }
  }
  if (!best) return null
  return { a: best.a, b: best.b, mid: best.mid }
}

/**
 * Thin AOI outline + name chip glued to a contour edge and rotated with it.
 * Right-click is handled by AoiRightClickBridge (works above prediction overlays).
 */
function AoiContour({
  geometry,
  label,
  scheme,
}: {
  geometry: GeoJSONGeometry
  label: string
  scheme: AoiContourScheme
}) {
  const edge = useMemo(() => pickContourEdge(geometry), [geometry])
  const centroid = useMemo(() => {
    const ring = polygonOuterRing(geometry)
    return ring ? ringCentroid(ring) : null
  }, [geometry])

  return (
    <>
      <GeoJSON
        key={`aoi-outline-${scheme.id}`}
        data={geometry as GeoJSON.Geometry}
        interactive={false}
        pathOptions={{
          color: scheme.stroke,
          weight: 2,
          opacity: 1,
          fillColor: scheme.stroke,
          fillOpacity: 0,
        }}
      />
      {edge && centroid && label.trim() && (
        <AoiEdgeLabel
          edge={edge}
          centroid={centroid}
          label={label.trim()}
          scheme={scheme}
        />
      )}
    </>
  )
}

/** Fits the map to the active AOI when `nonce` increments. */
function FitAoiOnRequest({
  geometry,
  nonce,
}: {
  geometry: GeoJSONGeometry | null
  nonce: number
}) {
  const map = useMap()
  useEffect(() => {
    if (!geometry || nonce <= 0) return
    try {
      const layer = L.geoJSON(geometry as GeoJSON.GeoJsonObject)
      map.fitBounds(layer.getBounds(), { padding: [40, 40] })
    } catch {
      // ignore invalid bounds
    }
  }, [map, geometry, nonce])
  return null
}

/** Chip anchored outside a contour segment, rotated to match the edge angle. */
function AoiEdgeLabel({
  edge,
  centroid,
  label,
  scheme,
}: {
  edge: { a: LonLat; b: LonLat; mid: LonLat }
  centroid: LonLat
  label: string
  scheme: AoiContourScheme
}) {
  const map = useMap()
  const [pose, setPose] = useState<{
    position: [number, number]
    angle: number
  } | null>(null)

  const updatePose = () => {
    const p1 = map.latLngToLayerPoint(L.latLng(edge.a[1], edge.a[0]))
    const p2 = map.latLngToLayerPoint(L.latLng(edge.b[1], edge.b[0]))
    const mid = map.latLngToLayerPoint(L.latLng(edge.mid[1], edge.mid[0]))
    const c = map.latLngToLayerPoint(L.latLng(centroid[1], centroid[0]))

    let rad = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    let deg = (rad * 180) / Math.PI
    // Keep text upright (readable left-to-right).
    if (deg > 90) {
      deg -= 180
      rad -= Math.PI
    } else if (deg < -90) {
      deg += 180
      rad += Math.PI
    }

    // Outward unit normal so the chip sits just outside the contour (top edge near the line).
    let nx = -Math.sin(rad)
    let ny = Math.cos(rad)
    const outX = mid.x - c.x
    const outY = mid.y - c.y
    if (outX * nx + outY * ny < 0) {
      nx = -nx
      ny = -ny
    }

    // ~half chip height — looks "glued" to the contour from outside.
    const offsetPx = 9
    const pt = L.point(mid.x + nx * offsetPx, mid.y + ny * offsetPx)
    const ll = map.layerPointToLatLng(pt)
    setPose((prev) => {
      if (
        prev &&
        Math.abs(prev.angle - deg) < 0.08 &&
        Math.abs(prev.position[0] - ll.lat) < 1e-8 &&
        Math.abs(prev.position[1] - ll.lng) < 1e-8
      ) {
        return prev
      }
      return { position: [ll.lat, ll.lng], angle: deg }
    })
  }

  useEffect(() => {
    updatePose()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when edge/map changes
  }, [map, edge.a, edge.b, edge.mid, centroid])

  useMapEvents({
    zoom: updatePose,
    zoomend: updatePose,
    move: updatePose,
    moveend: updatePose,
    viewreset: updatePose,
  })

  const icon = useMemo(() => {
    if (!pose) return null
    const safe = label
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
    return L.divIcon({
      className: "aoi-label",
      html: `<div class="aoi-label-chip" style="transform:translate(-50%,-50%) rotate(${pose.angle}deg);background:${scheme.chipBg};color:${scheme.chipFg}">${safe}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    })
  }, [label, pose, scheme.chipBg, scheme.chipFg])

  if (!pose || !icon) return null

  return (
    <Marker
      position={pose.position}
      icon={icon}
      interactive={false}
      zIndexOffset={600}
    />
  )
}

export function MapView({
  initialView = null,
  areas,
  activeExample,
  customPolygon,
  onPolygonDrawn,
  onSelectExample,
  flyTo,
  result,
  overlayOpacity,
  showConfidence,
  confidenceOnTop,
  smoothOverlay,
  showPredictionOverlay = true,
  showCompositionOverlay = true,
  composition = null,
  waterOverlay = null,
  swipeCompare,
  swipeRatio,
  onSwipeRatioChange,
  areaLabel,
  onAreaLabelChange,
  aoiContourScheme,
  onAoiContourSchemeChange,
  onClearArea,
  onViewChange,
}: MapViewProps) {
  // Continental default, used only when there is no remembered view.
  const center = useMemo<[number, number]>(
    () =>
      initialView ? [initialView.lat, initialView.lon] : [-14.5, -52],
    // Mount-time only: see initialView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const initialZoom = useMemo(
    () => initialView?.zoom ?? 4,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [swipeDragging, setSwipeDragging] = useState(false)
  const [aoiMenu, setAoiMenu] = useState<AoiContextMenuState | null>(null)
  const [fitAoiNonce, setFitAoiNonce] = useState(0)
  const contourScheme = useMemo(
    () => getAoiContourScheme(aoiContourScheme),
    [aoiContourScheme]
  )

  const overlayUrl =
    result?.overlay_uri || result?.lulc?.map_uri || result?.reference_uri || ""
  const overlayBounds: LatLngBoundsExpression | null = result
    ? [
        [result.extent.lat_min, result.extent.lon_min],
        [result.extent.lat_max, result.extent.lon_max],
      ]
    : null
  const hasValidExtent =
    !!result?.extent &&
    !(
      result.extent.lon_min === 0 &&
      result.extent.lon_max === 0 &&
      result.extent.lat_min === 0 &&
      result.extent.lat_max === 0
    )

  const compositionBounds: LatLngBoundsExpression | null =
    composition &&
    !(
      composition.extent.lon_min === 0 &&
      composition.extent.lon_max === 0 &&
      composition.extent.lat_min === 0 &&
      composition.extent.lat_max === 0
    )
      ? [
          [composition.extent.lat_min, composition.extent.lon_min],
          [composition.extent.lat_max, composition.extent.lon_max],
        ]
      : null

  // Confidence is semi-transparent, so prediction always shows through unless
  // we hide it. When confidenceOnTop is off, show confidence alone.
  // Swipe clips whichever overlay(s) are visible so the left side shows basemap.
  const showPredictionUnderConfidence = !showConfidence || confidenceOnTop

  const compositionVisible = !!(
    composition &&
    showCompositionOverlay &&
    compositionBounds &&
    composition.overlay_uri
  )
  const predictionVisible = !!(
    result &&
    showPredictionOverlay &&
    hasValidExtent &&
    overlayBounds &&
    overlayUrl &&
    showPredictionUnderConfidence
  )
  const confidenceVisible = !!(
    result &&
    hasValidExtent &&
    overlayBounds &&
    showConfidence &&
    result.confidence_uri
  )

  const swipeActive =
    swipeCompare &&
    (compositionVisible || predictionVisible || confidenceVisible)

  const swipeClip = swipeActive ? swipeRatio : null
  const predictionOpacity = swipeActive
    ? Math.max(overlayOpacity, 0.88)
    : overlayOpacity

  // Surface-water occurrence sits above the composition and below the
  // prediction, so a classification run stays readable over it.
  const waterBounds: LatLngBoundsExpression | null =
    waterOverlay &&
    waterOverlay.extent &&
    !(
      waterOverlay.extent.lon_min === 0 &&
      waterOverlay.extent.lon_max === 0 &&
      waterOverlay.extent.lat_min === 0 &&
      waterOverlay.extent.lat_max === 0
    )
      ? [
          [waterOverlay.extent.lat_min, waterOverlay.extent.lon_min],
          [waterOverlay.extent.lat_max, waterOverlay.extent.lon_max],
        ]
      : null

  const waterLayer =
    waterOverlay && waterBounds && waterOverlay.uri ? (
      <PredictionOverlay
        key="water"
        url={waterOverlay.uri}
        bounds={waterBounds}
        opacity={0.8}
        smooth={false}
        zIndex={360}
        swipeRatio={1}
      />
    ) : null

  const compositionLayer = compositionVisible ? (
    <PredictionOverlay
      key="composition"
      url={composition!.overlay_uri}
      bounds={compositionBounds!}
      opacity={composition!.opacity}
      smooth={false}
      zIndex={350}
      swipeRatio={swipeClip}
    />
  ) : null

  const predictionLayer = predictionVisible ? (
    <PredictionOverlay
      key="prediction"
      url={overlayUrl}
      bounds={overlayBounds!}
      opacity={predictionOpacity}
      smooth={smoothOverlay}
      zIndex={400}
      swipeRatio={swipeClip}
    />
  ) : null

  const confidenceLayer = confidenceVisible ? (
    <PredictionOverlay
      key="confidence"
      url={result!.confidence_uri}
      bounds={overlayBounds!}
      opacity={
        swipeActive
          ? Math.max(Math.min(1, overlayOpacity + 0.15), 0.9)
          : Math.min(1, overlayOpacity + 0.15)
      }
      smooth={false}
      zIndex={450}
      swipeRatio={swipeClip}
    />
  ) : null

  const swipeRightLabel = confidenceVisible
    ? "Confidence"
    : predictionVisible
      ? "Prediction"
      : compositionVisible
        ? composition?.title || "Composition"
        : "Overlay"

  // Example outlines are shown only when no custom polygon is active, as faint
  // clickable shortcuts to the article's validated sites.
  const showExamples = !customPolygon

  const aoiGeometry = useMemo(() => {
    if (customPolygon) return customPolygon
    if (activeExample) {
      return areas.find((a) => a.id === activeExample)?.geometry ?? null
    }
    return null
  }, [customPolygon, activeExample, areas])

  const aoiName = useMemo(() => {
    if (areaLabel?.trim()) return areaLabel.trim()
    if (activeExample) {
      return areas.find((a) => a.id === activeExample)?.label ?? "AOI"
    }
    return customPolygon ? "Custom AOI" : ""
  }, [areaLabel, activeExample, areas, customPolygon])

  return (
    // z-0 keeps swipe chrome inside this stacking context, under Result/Control panels
    <div ref={containerRef} className="absolute inset-0 z-0">
    <MapContainer
      center={center}
      zoom={initialZoom}
      className="h-full w-full"
      zoomControl={false}
    >
      <ZoomControl position="bottomright" />
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satellite (Esri)">
          <TileLayer
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Sentinel-2 2025 (EOX)">
          <TileLayer
            attribution='&copy; <a href="https://cloudless.eox.at">EOX</a> &mdash; <a href="https://sentinel.esa.int/web/sentinel/user-guides/sentinel-2-msi">Contains modified Copernicus Sentinel data 2025</a>'
            url="https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg"
            maxNativeZoom={14}
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Map (OSM)">
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      {showExamples &&
        areas.map((area) => (
          <GeoJSON
            key={area.id}
            data={area.geometry as GeoJSON.Geometry}
            style={{
              color: activeExample === area.id ? "#22d3ee" : "#c2703d",
              weight: 1.5,
              fillOpacity: 0.04,
              dashArray: "4 3",
            }}
            eventHandlers={{ click: () => onSelectExample(area.id) }}
          />
        ))}

      {compositionLayer}
      {waterLayer}
      {predictionLayer}
      {confidenceLayer}

      {aoiGeometry && (
        <AoiContour
          geometry={aoiGeometry}
          label={aoiName}
          scheme={contourScheme}
        />
      )}

      <DrawControl customPolygon={customPolygon} onPolygonDrawn={onPolygonDrawn} />
      <FlyToController flyTo={flyTo} />
      <FitBounds customPolygon={customPolygon} result={result} />
      <FitComposition composition={composition} hasPrediction={!!result} />
      <FitAoiOnRequest geometry={aoiGeometry} nonce={fitAoiNonce} />
      <AoiRightClickBridge
        geometry={aoiGeometry}
        containerRef={containerRef}
        onOpen={setAoiMenu}
      />
      <ViewReporter onViewChange={onViewChange} />
      <BasemapDateAttribution />
      <MapDragLock locked={swipeDragging} />
    </MapContainer>
    {swipeActive && (
      <SwipeDivider
        ratio={swipeRatio}
        onRatioChange={onSwipeRatioChange}
        onDraggingChange={setSwipeDragging}
        rightLabel={swipeRightLabel}
      />
    )}
    {aoiMenu && aoiGeometry && (
      <AoiContextMenu
        menu={aoiMenu}
        areaName={aoiName || "AOI"}
        schemeId={contourScheme.id}
        canClear={!!customPolygon || !!activeExample}
        onClose={() => setAoiMenu(null)}
        onRename={onAreaLabelChange}
        onSchemeChange={onAoiContourSchemeChange}
        onFitToArea={() => setFitAoiNonce((n) => n + 1)}
        onClearArea={() => {
          setAoiMenu(null)
          onClearArea()
        }}
      />
    )}
    </div>
  )
}
