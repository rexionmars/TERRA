/**
 * The layers of opened files, drawn on the globe: a source per layer, and a
 * fill, a casing, a line and a dot over it, each filtered to the geometries it
 * draws, so a layer of any kind -- or of several -- needs no telling which.
 *
 * THE SOURCE IS THE LAYER'S URL, NOT ITS DATA. Handed an object, MapLibre
 * copies it to its worker on the main thread: a layer of 212 polygons of 20,000
 * vertices (105 MB) stopped the screen for about 12 s. Handed the URL, the
 * worker fetches and cuts it itself, and the screen goes on. Checked in a
 * packaged build, where the page is served over wails://: a worker's fetch of a
 * layer answers 200 with the same bytes as the page's.
 *
 * Kept out of GlobeSurface, which owns when this runs; this owns what is drawn.
 */
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from "maplibre-gl"

/** A layer as the globe draws it; `url` is absolute, since the worker has no page to resolve it against. */
export interface GlobeFileLayer {
  key: string
  url: string
  color: string
  visible: boolean
}

/** A feature pressed on the map: its layer, its key in the layer, and its attributes as drawn. */
export interface FilePick {
  key: string
  id: number
  properties: Record<string, unknown>
}

const PREFIX = "terra-file:"

const ids = (key: string) => ({
  source: `${PREFIX}${key}`,
  fill: `${PREFIX}${key}:fill`,
  casing: `${PREFIX}${key}:casing`,
  line: `${PREFIX}${key}:line`,
  dot: `${PREFIX}${key}:dot`,
})

// MultiPolygon and the others are named apart in newer MapLibre, so both are listed.
const POLYGONS: ExpressionSpecification = [
  "in",
  ["geometry-type"],
  ["literal", ["Polygon", "MultiPolygon"]],
]
const LINES: ExpressionSpecification = [
  "in",
  ["geometry-type"],
  ["literal", ["LineString", "MultiLineString"]],
]
const POINTS: ExpressionSpecification = [
  "in",
  ["geometry-type"],
  ["literal", ["Point", "MultiPoint"]],
]
const PICKED: ExpressionSpecification = ["boolean", ["feature-state", "picked"], false]

/** The near-black the area outlines are cased in, so a colour reads over bright ground. */
const CASING = "#141414"

/** The sources this module added to each map. */
const added = new WeakMap<MapLibreMap, Set<string>>()

/**
 * Brings the map's file layers to `layers`, in that order, all of them under
 * `beforeId` -- the area outlines -- so an area stays readable over a file.
 */
export function syncFileLayers(
  map: MapLibreMap,
  layers: readonly GlobeFileLayer[],
  beforeId: string | undefined
): void {
  const mine = added.get(map) ?? new Set<string>()
  added.set(map, mine)
  const wanted = new Set(layers.map((l) => ids(l.key).source))

  for (const source of [...mine]) {
    if (wanted.has(source)) continue
    const key = source.slice(PREFIX.length)
    for (const [role, id] of Object.entries(ids(key))) {
      if (role !== "source" && map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource(source)) map.removeSource(source)
    mine.delete(source)
  }

  for (const l of layers) {
    const id = ids(l.key)
    const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
    if (!map.getSource(id.source)) {
      map.addSource(id.source, { type: "geojson", data: l.url })
      mine.add(id.source)
      map.addLayer(
        {
          id: id.fill,
          type: "fill",
          source: id.source,
          filter: POLYGONS,
          paint: { "fill-opacity": ["case", PICKED, 0.55, 0.28] },
        },
        before
      )
      map.addLayer(
        {
          id: id.casing,
          type: "line",
          source: id.source,
          filter: ["any", POLYGONS, LINES],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": CASING,
            "line-opacity": 0.6,
            "line-width": ["case", PICKED, 6, ["case", LINES, 4, 3]],
          },
        },
        before
      )
      map.addLayer(
        {
          id: id.line,
          type: "line",
          source: id.source,
          filter: ["any", POLYGONS, LINES],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-width": ["case", PICKED, 3.5, ["case", LINES, 2, 1.25]] },
        },
        before
      )
      map.addLayer(
        {
          id: id.dot,
          type: "circle",
          source: id.source,
          filter: POINTS,
          paint: {
            "circle-radius": ["case", PICKED, 7, 4.5],
            "circle-stroke-color": CASING,
            "circle-stroke-width": 1,
          },
        },
        before
      )
    }
    const visibility = l.visible ? "visible" : "none"
    for (const layer of [id.fill, id.casing, id.line, id.dot]) {
      map.setLayoutProperty(layer, "visibility", visibility)
      // Moved on every pass, so the order of the list is the order on the map
      // and a raster added since stays under the vectors.
      map.moveLayer(layer, before)
    }
    map.setPaintProperty(id.fill, "fill-color", l.color)
    map.setPaintProperty(id.line, "line-color", l.color)
    map.setPaintProperty(id.dot, "circle-color", l.color)
  }
}

/**
 * Reports each file layer once its worker has loaded it, or why it could not.
 * Returns what stops the reports.
 */
export function watchFileLayers(
  map: MapLibreMap,
  report: (key: string, state: "loaded" | "failed", message?: string) => void
): () => void {
  const onData = (e: MapSourceDataEvent) => {
    if (e.sourceId?.startsWith(PREFIX) && e.isSourceLoaded) {
      report(e.sourceId.slice(PREFIX.length), "loaded")
    }
  }
  const onError = (e: { sourceId?: string; error?: { message?: string } }) => {
    if (e.sourceId?.startsWith(PREFIX)) {
      report(e.sourceId.slice(PREFIX.length), "failed", e.error?.message)
    }
  }
  map.on("sourcedata", onData)
  map.on("error", onError)
  return () => {
    map.off("sourcedata", onData)
    map.off("error", onError)
  }
}

/**
 * The file feature under a press, or null.
 *
 * A DOT OR A LINE FIRST, within a few pixels, because those are aimed at; a
 * polygon only when `polygons` allows it, since the caller lets an area under
 * the press win over a polygon that merely covers it.
 */
export function fileFeatureAt(
  map: MapLibreMap,
  point: { x: number; y: number },
  polygons: boolean
): FilePick | null {
  const style = map.getStyle()
  const all = (style?.layers ?? [])
    .map((l) => l.id)
    .filter((id) => id.startsWith(PREFIX))
  const near = all.filter((id) => id.endsWith(":dot") || id.endsWith(":line"))
  const pad = 5
  const box: [[number, number], [number, number]] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ]
  const hit =
    (near.length ? map.queryRenderedFeatures(box, { layers: near })[0] : undefined) ??
    (polygons
      ? map.queryRenderedFeatures([point.x, point.y], {
          layers: all.filter((id) => id.endsWith(":fill")),
        })[0]
      : undefined)
  if (!hit || typeof hit.id !== "number") return null
  return {
    key: hit.source.slice(PREFIX.length),
    id: hit.id,
    properties: { ...(hit.properties as Record<string, unknown>) },
  }
}

/** Marks the pressed feature, and unmarks the one before it. */
export function markPicked(
  map: MapLibreMap,
  before: { key: string; id: number } | null,
  now: { key: string; id: number } | null
): void {
  if (before && map.getSource(ids(before.key).source)) {
    map.setFeatureState(
      { source: ids(before.key).source, id: before.id },
      { picked: false }
    )
  }
  if (now && map.getSource(ids(now.key).source)) {
    map.setFeatureState({ source: ids(now.key).source, id: now.id }, { picked: true })
  }
}

/** Whether any file layer is drawn, so the pointer can say a press does something. */
export function hasFileLayers(map: MapLibreMap): boolean {
  return (map.getStyle()?.layers ?? []).some((l) => l.id.startsWith(PREFIX))
}
