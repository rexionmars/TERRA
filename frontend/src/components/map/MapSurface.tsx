/**
 * The work map, on MapLibre.
 *
 * The same contract MapView answered under Leaflet, prop for prop, so the three
 * screens that mount it can move across one at a time rather than together. The
 * two coexist while that happens; MapView goes when nothing mounts it.
 *
 * WHAT CHANGES BENEATH THE CONTRACT, each a change rather than a translation:
 *
 * - Layer ORDER replaces z-index. Leaflet took a number per ImageOverlay and
 *   the ordering rule lived across six call sites as 350, 358, 360, 365, 400,
 *   450. MapLibre draws layers in style order, so the caller's array IS the
 *   order. See mapOverlays.ts.
 * - `raster-resampling: nearest` replaces a CSS class re-applied on every image
 *   load, and states it where the raster is drawn rather than on the element
 *   that happened to carry it.
 * - The container-resize watcher is gone. It existed because Leaflet re-read
 *   its container only on a window resize; MapLibre observes its own.
 * - Drawing is terra-draw. leaflet-draw was last published in 2023 and this
 *   repository carries 319 lines of patch against it for three failures in
 *   WKWebView. None of that comes across.
 *
 * MERCATOR, NOT THE GLOBE, and north-up. This is the surface work is measured
 * on: an area is drawn here and a run is read here, the swipe's cut is a
 * meridian, and at working zooms the two projections are the same picture. The
 * globe screen is where the camera moves in three dimensions.
 */
import "maplibre-gl/dist/maplibre-gl.css"
// Points MapLibre at its worker; see the module for why that is not automatic.
import "@/lib/maplibreWorker"

import { useEffect, useMemo, useRef, useState } from "react"
import { Layers, Pencil, Spline, Trash2 } from "lucide-react"
import {
  Map as MapLibreMap,
  Marker,
  type GeoJSONSource,
  type Subscription,
} from "maplibre-gl"
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw"
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter"

import {
  AoiContextMenu,
  type AoiContextMenuState,
} from "@/components/AoiContextMenu"
import { SwipeDivider } from "@/components/map/SwipeDivider"
import { cropWestOf } from "@/components/map/cropOverlay"
import {
  clearOverlays,
  syncOverlays,
  type OverlaySpec,
} from "@/components/map/mapOverlays"
import { getAoiContourScheme, type AoiContourSchemeId } from "@/lib/aoiStyle"
import { BASEMAPS, basemapByKind, type BasemapKind } from "@/lib/basemaps"
import {
  pickContourEdge,
  pointInAoi,
  polygonOuterRing,
  ringCentroid,
} from "@/lib/geometry"
import { isZeroExtent } from "@/lib/mapLayers"
import { publishMapPose } from "@/lib/mapPose"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import type {
  Area,
  Bounds,
  CompositionOverlay,
  GeoJSONGeometry,
  PredictResult,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const BASE_SOURCE = "basemap"
const BASE_LAYER = "basemap"
const AOI_SOURCE = "aoi"
const AOI_LINE = "aoi-line"

export interface MapSurfaceProps {
  initialView?: { lat: number; lon: number; zoom: number } | null
  areas: Area[]
  activeExample: string
  customPolygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  flyTo: { lat: number; lon: number; key: number } | null
  result: PredictResult | null
  overlayOpacity: number
  showConfidence: boolean
  confidenceOnTop: boolean
  smoothOverlay: boolean
  showPredictionOverlay?: boolean
  showCompositionOverlay?: boolean
  composition?: CompositionOverlay | null
  solarOverlays?:
    | { id: "terrain" | "siting"; uri: string; extent: Bounds; opacity?: number }[]
    | null
  waterOverlay?: { uri: string; extent: Bounds; opacity: number } | null
  floodOverlay?: { uri: string; extent: Bounds; opacity: number } | null
  swipeCompare: boolean
  swipeRatio: number
  onSwipeRatioChange: (ratio: number) => void
  areaLabel?: string
  onAreaLabelChange: (label: string) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void
  onClearArea: () => void
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
  bottomRightSlot?: React.ReactNode
  onCreditChange?: (c: { kind: BasemapKind; date: string | null }) => void
}

/** What the caller asked for, before smoothing and the swipe cut are applied. */
interface RawOverlay {
  id: string
  url: string
  bounds: Bounds
  opacity: number
  /** Majority smoothing, which produces a different image rather than a filter. */
  smooth: boolean
  /** Whether the swipe cut applies. Water and flood stay whole; see MapView. */
  clipped: boolean
}

export function MapSurface({
  initialView = null,
  areas,
  activeExample,
  customPolygon,
  onPolygonDrawn,
  flyTo,
  result,
  overlayOpacity,
  showConfidence,
  confidenceOnTop,
  smoothOverlay,
  showPredictionOverlay = true,
  showCompositionOverlay = true,
  composition = null,
  solarOverlays = null,
  waterOverlay = null,
  floodOverlay = null,
  swipeCompare,
  swipeRatio,
  onSwipeRatioChange,
  areaLabel,
  onAreaLabelChange,
  aoiContourScheme,
  onAoiContourSchemeChange,
  onClearArea,
  onViewChange,
  onCreditChange,
  bottomRightSlot,
}: MapSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [basemap, setBasemap] = useState<BasemapKind>("esri")
  const [basemapOpen, setBasemapOpen] = useState(false)
  const [dateLabel, setDateLabel] = useState<string | null>(null)
  const [aoiMenu, setAoiMenu] = useState<AoiContextMenuState | null>(null)
  const [swipeDragging, setSwipeDragging] = useState(false)
  const [drawMode, setDrawMode] = useState<"idle" | "draw" | "edit">("idle")
  const [fitAoiNonce, setFitAoiNonce] = useState(0)
  const [handleRatio, setHandleRatio] = useState(swipeRatio)

  const scheme = useMemo(
    () => getAoiContourScheme(aoiContourScheme),
    [aoiContourScheme]
  )

  /*
    Custom first, then the named example: MapView's precedence, kept because it
    decides the outline, the label, the right-click target and what "fit to
    area" fits.
  */
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

  // ---- the map ------------------------------------------------------------

  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const first = basemapByKind("esri")
    const map = new MapLibreMap({
      container: host,
      // The credit is drawn outside the map, in the title bar, through
      // BrowserOpenURL: an anchor in this WKWebView opens nothing.
      attributionControl: false,
      center: [initialView?.lon ?? -52, initialView?.lat ?? -14.5],
      zoom: initialView?.zoom ?? 4,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      style: {
        version: 8,
        sources: {
          [BASE_SOURCE]: {
            type: "raster",
            tiles: [first.url],
            tileSize: 256,
            maxzoom: first.maxNativeZoom ?? first.maxZoom,
          },
          [AOI_SOURCE]: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          { id: BASE_LAYER, type: "raster", source: BASE_SOURCE },
          /*
            Added at style time and kept LAST, so every overlay added later goes
            in before it. MapView's rule: the contour is painted above the
            rasters and the drawn stroke beneath is hidden, because two outlines
            over one area is one too many.
          */
          {
            id: AOI_LINE,
            type: "line",
            source: AOI_SOURCE,
            paint: { "line-color": "#ffffff", "line-width": 2 },
          },
        ],
      },
    })
    mapRef.current = map

    const subs: Subscription[] = []
    subs.push(map.on("load", () => setReady(true)))
    subs.push(
      map.on("error", (e) => {
        // Not fatal: a tile that fails is not a failed map. Logged rather than
        // discarded, because the globe's silent worker failure was invisible
        // for exactly as long as its handler said `void e`.
        console.error("[map]", e.error ?? e)
      })
    )

    /*
      TWO PATHS AT TWO RATES, which is MapView's finding and why the title bar's
      readout is smooth without App re-rendering sixty times a second: the pose
      store takes every frame, onViewChange takes the settled value that is
      persisted. See lib/mapPose.ts.
    */
    const pose = () => {
      const c = map.getCenter()
      return { lat: c.lat, lon: c.lng, zoom: map.getZoom() }
    }
    subs.push(map.on("move", () => publishMapPose(pose())))
    subs.push(map.on("moveend", () => onViewChangeRef.current(pose())))
    subs.push(map.on("zoomend", () => onViewChangeRef.current(pose())))
    publishMapPose(pose())
    onViewChangeRef.current(pose())

    return () => {
      for (const s of subs) s.unsubscribe()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
    // Mount only. initialView is read once, as Leaflet read centre and zoom:
    // rebinding it would fight the reader's own panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- basemap and its credit --------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const b = basemapByKind(basemap)
    const src = map.getSource(BASE_SOURCE)
    // setTiles rather than replacing the source: a new source would drop every
    // layer built on it and take the whole stack above with it.
    ;(src as unknown as { setTiles?: (t: string[]) => void })?.setTiles?.([b.url])
  }, [basemap, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
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
          const d = await fetchEsriImageryDate(
            c.lat,
            c.lng,
            map.getZoom(),
            abort.signal
          )
          if (!cancelled) setDateLabel(d)
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return
          if (!cancelled) setDateLabel(null)
        }
      }, 350)
    }
    refresh()
    const a = map.on("moveend", refresh)
    const b = map.on("zoomend", refresh)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      abort?.abort()
      a.unsubscribe()
      b.unsubscribe()
    }
  }, [basemap, ready])

  useEffect(() => {
    onCreditChange?.({ kind: basemap, date: dateLabel })
  }, [basemap, dateLabel, onCreditChange])

  // ---- the area outline, its colour and its label -------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource<GeoJSONSource>(AOI_SOURCE)
    void src?.setData(
      aoiGeometry
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: aoiGeometry as never },
            ],
          }
        : { type: "FeatureCollection", features: [] }
    )
  }, [aoiGeometry, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer(AOI_LINE)) return
    map.setPaintProperty(AOI_LINE, "line-color", scheme.stroke)
  }, [scheme.stroke, ready])

  /*
    The name chip, glued to a contour edge and turned with it.

    A MapLibre Marker rather than the divIcon-with-a-transform this replaces:
    the marker carries its own rotation, so the angle is a property of the
    control instead of a string inside its HTML.
  */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!aoiGeometry || !aoiName.trim()) return
    const edge = pickContourEdge(aoiGeometry)
    const ring = polygonOuterRing(aoiGeometry)
    const centroid = ring ? ringCentroid(ring) : null
    if (!edge || !centroid) return

    const el = document.createElement("div")
    el.className = "aoi-label-chip"
    el.textContent = aoiName.trim()
    el.style.background = scheme.chipBg
    el.style.color = scheme.chipFg
    const marker = new Marker({
      element: el,
      // Turned with the map's own plane, so the chip keeps its edge when the
      // camera does anything the flat map is allowed to do.
      rotationAlignment: "viewport",
      pitchAlignment: "viewport",
    })

    const place = () => {
      const p1 = map.project([edge.a[0], edge.a[1]])
      const p2 = map.project([edge.b[0], edge.b[1]])
      const mid = map.project([edge.mid[0], edge.mid[1]])
      const c = map.project([centroid[0], centroid[1]])
      let rad = Math.atan2(p2.y - p1.y, p2.x - p1.x)
      let deg = (rad * 180) / Math.PI
      // Upright, so the name reads left to right whichever way the edge runs.
      if (deg > 90) {
        deg -= 180
        rad -= Math.PI
      } else if (deg < -90) {
        deg += 180
        rad += Math.PI
      }
      let nx = -Math.sin(rad)
      let ny = Math.cos(rad)
      if ((mid.x - c.x) * nx + (mid.y - c.y) * ny < 0) {
        nx = -nx
        ny = -ny
      }
      // Half a chip's height: it reads as glued to the contour from outside.
      const offset = 9
      const at = map.unproject([mid.x + nx * offset, mid.y + ny * offset])
      marker.setLngLat(at)
      marker.setRotation(deg)
    }

    place()
    marker.addTo(map)
    const sub = map.on("move", place)
    return () => {
      sub.unsubscribe()
      marker.remove()
    }
  }, [aoiGeometry, aoiName, scheme.chipBg, scheme.chipFg, ready])

  // ---- the rasters --------------------------------------------------------

  const overlayUrl =
    result?.overlay_uri || result?.lulc?.map_uri || result?.reference_uri || ""
  const hasValidExtent = !isZeroExtent(result?.extent)
  const showPredictionUnderConfidence = !showConfidence || confidenceOnTop

  const compositionVisible = !!(
    composition &&
    showCompositionOverlay &&
    !isZeroExtent(composition.extent) &&
    composition.overlay_uri
  )
  const predictionVisible = !!(
    result &&
    showPredictionOverlay &&
    hasValidExtent &&
    overlayUrl &&
    showPredictionUnderConfidence
  )
  const confidenceVisible = !!(
    result &&
    hasValidExtent &&
    showConfidence &&
    result.confidence_uri
  )
  const drawableSolar = useMemo(
    () => (solarOverlays ?? []).filter((o) => o.uri && !isZeroExtent(o.extent)),
    [solarOverlays]
  )

  const swipeActive =
    swipeCompare &&
    (compositionVisible ||
      predictionVisible ||
      confidenceVisible ||
      drawableSolar.length > 0)

  const predictionOpacity = swipeActive
    ? Math.max(overlayOpacity, 0.88)
    : overlayOpacity

  /*
    THE STACK, BOTTOM TO TOP, and the array is the whole ordering rule. It reads
    in the order MapView's z-indices put them: composition under the solar
    rasters, surface water above those, the flood agreement above that, the
    classification above all of it and confidence last.
  */
  const raw = useMemo<RawOverlay[]>(() => {
    const out: RawOverlay[] = []
    if (compositionVisible) {
      out.push({
        id: "composition",
        url: composition!.overlay_uri,
        bounds: composition!.extent,
        opacity: composition!.opacity,
        smooth: false,
        clipped: true,
      })
    }
    for (const o of drawableSolar) {
      out.push({
        id: `solar-${o.id}`,
        url: o.uri,
        bounds: o.extent,
        opacity: o.opacity ?? 0.85,
        smooth: false,
        // Wipes with the rest: comparing a solar raster against the imagery
        // under it is the same gesture.
        clipped: true,
      })
    }
    if (waterOverlay?.uri && !isZeroExtent(waterOverlay.extent)) {
      out.push({
        id: "water",
        url: waterOverlay.uri,
        bounds: waterOverlay.extent,
        opacity: waterOverlay.opacity,
        smooth: false,
        // Whole, always. MapView: the occurrence raster is the standing water
        // an extent is read against, so the wipe would remove the reference.
        clipped: false,
      })
    }
    if (floodOverlay?.uri && !isZeroExtent(floodOverlay.extent)) {
      out.push({
        id: "flood",
        url: floodOverlay.uri,
        bounds: floodOverlay.extent,
        opacity: floodOverlay.opacity,
        // The cells are N+1 classes; smoothing would move a class boundary and
        // a blend of two agreement colours names no class.
        smooth: false,
        clipped: false,
      })
    }
    if (predictionVisible) {
      out.push({
        id: "prediction",
        url: overlayUrl,
        bounds: result!.extent,
        opacity: predictionOpacity,
        smooth: smoothOverlay,
        clipped: true,
      })
    }
    if (confidenceVisible) {
      out.push({
        id: "confidence",
        url: result!.confidence_uri,
        bounds: result!.extent,
        opacity: swipeActive
          ? Math.max(Math.min(1, overlayOpacity + 0.15), 0.9)
          : Math.min(1, overlayOpacity + 0.15),
        smooth: false,
        clipped: true,
      })
    }
    return out
  }, [
    compositionVisible,
    composition,
    drawableSolar,
    waterOverlay,
    floodOverlay,
    predictionVisible,
    overlayUrl,
    result,
    predictionOpacity,
    smoothOverlay,
    confidenceVisible,
    overlayOpacity,
    swipeActive,
  ])

  /*
    Where the wipe cuts, as a MERIDIAN rather than a screen fraction.

    Set from the handle's position at the moment it moves, and left alone after
    that: the seam stays on the ground while the map is panned, and no raster is
    re-cut for a gesture that did not move the handle. cropOverlay.ts carries
    the argument for the cut living in the image at all.
  */
  const cutLonRef = useRef<number | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !swipeActive) {
      cutLonRef.current = null
      return
    }
    const w = map.getCanvas().clientWidth
    const h = map.getCanvas().clientHeight
    cutLonRef.current = map.unproject([swipeRatio * w, h / 2]).lng
  }, [swipeRatio, swipeActive, ready])

  /** The handle's screen position, which follows the ground line as it pans. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !swipeActive) return
    const follow = () => {
      const lon = cutLonRef.current
      if (lon == null) return
      const w = map.getCanvas().clientWidth
      if (w <= 0) return
      const x = map.project([lon, map.getCenter().lat]).x / w
      setHandleRatio((prev) => (Math.abs(prev - x) < 0.001 ? prev : x))
    }
    follow()
    const sub = map.on("move", follow)
    return () => sub.unsubscribe()
  }, [swipeActive, ready, swipeRatio])

  const [resolved, setResolved] = useState<OverlaySpec[]>([])
  useEffect(() => {
    let cancelled = false
    const cut = swipeActive ? cutLonRef.current : null
    ;(async () => {
      const out: OverlaySpec[] = []
      for (const o of raw) {
        let url = o.url
        if (o.smooth) {
          // A majority filter over the classes, which produces a different
          // image; it is not resampling, and raster-resampling cannot do it.
          url = await majoritySmoothOverlay(url).catch(() => o.url)
        }
        if (o.clipped && cut != null) {
          const cropped = await cropWestOf(url, o.bounds, cut).catch(() => url)
          if (cropped == null) continue
          url = cropped
        }
        out.push({ id: o.id, url, bounds: o.bounds, opacity: o.opacity })
      }
      if (!cancelled) setResolved(out)
    })()
    return () => {
      cancelled = true
    }
  }, [raw, swipeActive, swipeRatio])

  const overlayIdsRef = useRef<string[]>([])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    overlayIdsRef.current = syncOverlays(
      map,
      resolved,
      overlayIdsRef.current,
      // Always under the outline, which is the last layer in the style.
      map.getLayer(AOI_LINE) ? AOI_LINE : undefined
    )
  }, [resolved, ready])

  useEffect(() => {
    return () => {
      const map = mapRef.current
      if (map) clearOverlays(map, overlayIdsRef.current)
    }
  }, [])

  // ---- moving the camera --------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !flyTo) return
    map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: 14, duration: 1200 })
  }, [flyTo, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !result || isZeroExtent(result.extent)) return
    map.fitBounds(boundsToLngLat(result.extent), { padding: 40 })
  }, [result, customPolygon, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !composition || result) return
    if (isZeroExtent(composition.extent)) return
    map.fitBounds(boundsToLngLat(composition.extent), { padding: 40 })
  }, [composition?.overlay_uri, result, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !aoiGeometry || fitAoiNonce <= 0) return
    const b = geometryBounds(aoiGeometry)
    if (b) map.fitBounds(boundsToLngLat(b), { padding: 40 })
  }, [fitAoiNonce, aoiGeometry, ready])

  // ---- right-click on the area -------------------------------------------

  const aoiRef = useRef(aoiGeometry)
  aoiRef.current = aoiGeometry
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const el = map.getCanvasContainer()
    const onMenu = (e: MouseEvent) => {
      // The native Reload / Inspect menu is blocked on the map surface either
      // way; only whether the AOI menu opens depends on where the press landed.
      e.preventDefault()
      e.stopPropagation()
      const g = aoiRef.current
      if (!g) return setAoiMenu(null)
      const rect = el.getBoundingClientRect()
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
      if (!pointInAoi(ll.lng, ll.lat, g)) return setAoiMenu(null)
      const root = rootRef.current?.getBoundingClientRect()
      setAoiMenu({
        x: e.clientX - (root?.left ?? 0),
        y: e.clientY - (root?.top ?? 0),
      })
    }
    el.addEventListener("contextmenu", onMenu, true)
    return () => el.removeEventListener("contextmenu", onMenu, true)
  }, [ready])

  // ---- drawing ------------------------------------------------------------

  const drawRef = useRef<TerraDraw | null>(null)
  const onDrawnRef = useRef(onPolygonDrawn)
  onDrawnRef.current = onPolygonDrawn

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: {
            fillColor: "#ffffff",
            fillOpacity: 0.06,
            outlineColor: "#ffffff",
            outlineWidth: 2,
          },
        }),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
          },
        }),
      ],
    })
    draw.start()
    drawRef.current = draw

    const emit = () => {
      const features = draw.getSnapshot().filter((f) => f.geometry.type === "Polygon")
      const last = features[features.length - 1]
      onDrawnRef.current(last ? (last.geometry as GeoJSONGeometry) : null)
    }
    /*
      ONE AREA AT A TIME, which is the map screen's rule and not terra-draw's:
      a second polygon replaces the first rather than joining it, so what the
      run reads is never ambiguous.
    */
    draw.on("finish", () => {
      const features = draw.getSnapshot()
      const extra = features.slice(0, -1).map((f) => f.id!)
      if (extra.length) draw.removeFeatures(extra)
      emit()
      setDrawMode("idle")
      draw.setMode("select")
    })
    draw.on("change", (_ids, type) => {
      if (type === "delete" || type === "update") emit()
    })

    return () => {
      draw.stop()
      drawRef.current = null
    }
  }, [ready])

  /*
    The area held outside this component, put back into the draw store.

    Search, import, an example and clearing all set the polygon from elsewhere,
    and the store has to agree with them or the next edit starts from a shape
    that is no longer on screen.
  */
  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return
    const current = draw.getSnapshot()
    const currentGeom = current.length
      ? (current[current.length - 1].geometry as GeoJSONGeometry)
      : null
    if (JSON.stringify(currentGeom) === JSON.stringify(customPolygon)) return
    draw.clear()
    if (customPolygon && customPolygon.type === "Polygon") {
      draw.addFeatures([
        {
          type: "Feature",
          properties: { mode: "polygon" },
          geometry: customPolygon as never,
        } as never,
      ])
    }
  }, [customPolygon])

  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return
    draw.setMode(
      drawMode === "draw" ? "polygon" : drawMode === "edit" ? "select" : "select"
    )
  }, [drawMode])

  // ---- pan lock while the handle is dragged -------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (swipeDragging) map.dragPan.disable()
    else map.dragPan.enable()
  }, [swipeDragging, ready])

  const swipeRightLabel = confidenceVisible
    ? "Confidence"
    : predictionVisible
      ? "Prediction"
      : compositionVisible
        ? composition?.title || "Composition"
        : drawableSolar.some((o) => o.id === "siting")
          ? "Siting"
          : drawableSolar.some((o) => o.id === "terrain")
            ? "Terrain irradiation"
            : "Overlay"

  return (
    // z-0 keeps the swipe chrome inside this stacking context, under the panels.
    <div ref={rootRef} className="absolute inset-0 z-0">
      {/*
        h-full rather than `absolute inset-0`: MapLibre's own stylesheet sets
        `.maplibregl-map { position: relative }` at one class of specificity and
        is imported after the app's, so `absolute` loses the tie on source order
        and the container collapses to zero height. See GlobeSurface, where that
        cost an afternoon.
      */}
      <div ref={hostRef} className="h-full w-full" />

      {/* The map's own controls, in the app's chrome rather than the library's. */}
      <div className="app-no-drag absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-1.5">
        {bottomRightSlot}
        <div className="flex flex-col overflow-hidden rounded-sm border border-[rgb(var(--p-line)/0.28)] bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]">
          <MapButton
            label="Draw an area"
            active={drawMode === "draw"}
            onClick={() => setDrawMode((m) => (m === "draw" ? "idle" : "draw"))}
          >
            <Pencil className="size-3.5" strokeWidth={1.5} />
          </MapButton>
          <MapButton
            label="Edit the area"
            active={drawMode === "edit"}
            onClick={() => setDrawMode((m) => (m === "edit" ? "idle" : "edit"))}
          >
            <Spline className="size-3.5" strokeWidth={1.5} />
          </MapButton>
          <MapButton
            label="Delete the area"
            onClick={() => {
              drawRef.current?.clear()
              onPolygonDrawn(null)
              setDrawMode("idle")
            }}
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
          </MapButton>
        </div>
        <div className="flex flex-col overflow-hidden rounded-sm border border-[rgb(var(--p-line)/0.28)] bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]">
          <MapButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <span className="text-body leading-none">+</span>
          </MapButton>
          <MapButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <span className="text-body leading-none">−</span>
          </MapButton>
        </div>
      </div>

      {/* Basemaps, where Leaflet's own layers control stood. */}
      <div className="app-no-drag absolute right-3 top-3 z-[1000] flex flex-col items-end gap-1">
        <MapButton
          label="Basemap"
          active={basemapOpen}
          onClick={() => setBasemapOpen((v) => !v)}
          className="rounded-sm border border-[rgb(var(--p-line)/0.28)] bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]"
        >
          <Layers className="size-3.5" strokeWidth={1.5} />
        </MapButton>
        {basemapOpen && (
          <div className="flex flex-col overflow-hidden rounded-sm border border-[rgb(var(--p-line)/0.28)] bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]">
            {BASEMAPS.map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => {
                  setBasemap(b.kind)
                  setBasemapOpen(false)
                }}
                className={cn(
                  "px-2.5 py-1.5 text-left text-meta transition-colors",
                  b.kind === basemap
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {swipeActive && (
        <SwipeDivider
          ratio={handleRatio}
          onRatioChange={onSwipeRatioChange}
          onDraggingChange={setSwipeDragging}
          rightLabel={swipeRightLabel}
        />
      )}

      {aoiMenu && aoiGeometry && (
        <AoiContextMenu
          menu={aoiMenu}
          areaName={aoiName || "AOI"}
          schemeId={scheme.id}
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

function MapButton({
  label,
  active = false,
  onClick,
  className,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  className?: string
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
        "flex size-7 items-center justify-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-surface-raised text-primary"
          : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

/** MapLibre takes west-south then east-north, which is the opposite order. */
function boundsToLngLat(b: Bounds): [[number, number], [number, number]] {
  return [
    [b.lon_min, b.lat_min],
    [b.lon_max, b.lat_max],
  ]
}

function geometryBounds(geometry: GeoJSONGeometry): Bounds | null {
  const ring = polygonOuterRing(geometry)
  if (!ring?.length) return null
  let lon_min = Infinity
  let lat_min = Infinity
  let lon_max = -Infinity
  let lat_max = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < lon_min) lon_min = lon
    if (lon > lon_max) lon_max = lon
    if (lat < lat_min) lat_min = lat
    if (lat > lat_max) lat_max = lat
  }
  return { lon_min, lat_min, lon_max, lat_max }
}

function formatYmd(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  }
  return ymd
}

function normalizeImageryDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d{8}$/.test(trimmed)) return formatYmd(trimmed)
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
  return trimmed
}

function dateSortKey(raw: string): string {
  const n = normalizeImageryDate(raw)
  return n ? n.replace(/-/g, "") : ""
}

/** Esri World Imagery identify, for the acquisition date under the centre. */
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
    results?: Array<{ attributes?: Record<string, string> }>
  }
  const results = data.results ?? []
  if (!results.length) return null
  const withLevels = results.map((r) => {
    const a = r.attributes ?? {}
    return {
      date: a["DATE (YYYYMMDD)"] || a.SRC_DATE2 || "",
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
