/**
 * The layers of a file opened on the map: their colours, how a feature is
 * named, and the polygon an area is made of.
 *
 * A FILE IS SHOWN, NOT IMPORTED. Its layers are drawn over the basemap as
 * they are, every geometry kind, and nothing reaches the project until the
 * reader presses a polygon and asks for it to become an area.
 */
import { geometryAreaHectares } from "@/lib/geometry"
import type { GeoJSONGeometry, GeoPackage, GeoPackageLayer } from "@/lib/types"

/**
 * Okabe-Ito without its black (Wong, Nature Methods, 2011): the colour-blind
 * safe set the app's icons and cluster maps already use. Black is left out
 * because these are drawn over imagery, where it reads as shadow. A file with
 * more layers than colours repeats them, and the kind of mark -- dot, line or
 * filled shape -- still tells two layers of one colour apart in most files.
 *
 * In this order so that the first layers of a file are the furthest apart: the
 * two blues, sky and blue, are first and last, and the orange and the
 * vermillion are three apart.
 */
export const FILE_LAYER_COLORS = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#CC79A7",
  "#F0E442",
  "#D55E00",
  "#0072B2",
] as const

/** A layer as the map and the Layers panel hold it. */
export interface FileLayer extends GeoPackageLayer {
  /** Unique across every open file: the file's id and the layer's name. */
  key: string
  color: string
  visible: boolean
}

export interface OpenedFile {
  id: string
  name: string
  path: string
  layers: FileLayer[]
}

/** Whether the map draws the layer: it was read, and it has geometry. */
export function drawsOnMap(layer: Pick<GeoPackageLayer, "url" | "kind">): boolean {
  return layer.url !== "" && layer.kind !== "table"
}

/** Whether the layer is a table without geometry that was read, whose rows can be listed. */
export function isTable(layer: Pick<GeoPackageLayer, "url" | "kind">): boolean {
  return layer.url !== "" && layer.kind === "table"
}

/**
 * A file's layers keyed and coloured, the colours continuing from `firstColor`
 * so a second file open beside the first does not repeat its first colours.
 * A layer the map does not draw takes no colour.
 */
export function toOpenedFile(gp: GeoPackage, firstColor: number): OpenedFile {
  let next = firstColor
  const layers = gp.layers.map((l) => {
    const drawable = drawsOnMap(l)
    const color = drawable
      ? FILE_LAYER_COLORS[next++ % FILE_LAYER_COLORS.length]
      : "transparent"
    return { ...l, key: `${gp.id}:${l.name}`, color, visible: drawable }
  })
  return { id: gp.id, name: gp.name, path: gp.path, layers }
}

/** How many colours the open files have taken, so the next file continues. */
export function coloursTaken(files: readonly OpenedFile[]): number {
  return files.reduce((n, f) => n + f.layers.filter(drawsOnMap).length, 0)
}

/** West, south, east, north around the given layers, or null when none has any. */
export function layersBounds(
  layers: readonly Pick<GeoPackageLayer, "bounds">[]
): [number, number, number, number] | null {
  const all = layers.map((l) => l.bounds).filter((b) => b !== null)
  if (!all.length) return null
  return [
    Math.min(...all.map((b) => b[0])),
    Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])),
    Math.max(...all.map((b) => b[3])),
  ]
}

/** What one feature of a layer is called in the summary: "1,204 points", "12 rows". */
export function countLabel(layer: Pick<GeoPackageLayer, "kind" | "drawn">): string {
  const n = layer.drawn
  const noun =
    layer.kind === "table"
      ? n === 1
        ? "row"
        : "rows"
      : layer.kind === "point"
        ? n === 1
          ? "point"
          : "points"
        : layer.kind === "line"
          ? n === 1
            ? "line"
            : "lines"
          : layer.kind === "polygon"
            ? n === 1
              ? "polygon"
              : "polygons"
            : n === 1
              ? "feature"
              : "features"
  return `${n.toLocaleString("en")} ${noun}`
}

/**
 * The column a feature is named from: one whose name says it holds names --
 * `name`, `nome`, or IBGE's `NM_` prefix (`NM_MUN`) -- or null for none.
 */
export function nameColumn(columns: readonly string[]): string | null {
  return (
    columns.find((c) => {
      const n = c.toLowerCase()
      return n.includes("name") || n.includes("nome") || n.startsWith("nm_")
    }) ?? null
  )
}

/** What a feature is called: its name, its first text, or its layer and key. */
export function featureLabel(
  properties: Readonly<Record<string, unknown>> | null | undefined,
  columns: readonly string[],
  layerTitle: string,
  id: number | string
): string {
  const props = properties ?? {}
  const named = nameColumn(columns)
  const pick = (c: string | null | undefined) => {
    const v = c ? props[c] : null
    return typeof v === "string" ? v.trim() : ""
  }
  const text =
    pick(named) || pick(columns.find((c) => typeof props[c] === "string" && pick(c)))
  return text || `${layerTitle} ${id}`
}

/**
 * The one polygon an area is made of, from a feature's geometry, or null when
 * it holds none.
 *
 * AN AREA IS ONE POLYGON. A MultiPolygon gives its largest part, by area, and
 * `parts` says how many it had so the reader is told what was left out.
 */
export function areaPolygon(
  geometry: { type: string; coordinates: unknown } | null | undefined
): { polygon: GeoJSONGeometry; parts: number } | null {
  if (!geometry) return null
  if (geometry.type === "Polygon") {
    return { polygon: geometry as GeoJSONGeometry, parts: 1 }
  }
  if (geometry.type !== "MultiPolygon") return null
  const parts = geometry.coordinates as number[][][][]
  let best: GeoJSONGeometry | null = null
  let bestArea = -1
  for (const coordinates of parts) {
    const part: GeoJSONGeometry = { type: "Polygon", coordinates }
    const area = geometryAreaHectares(part)
    if (area > bestArea) {
      best = part
      bestArea = area
    }
  }
  return best ? { polygon: best, parts: parts.length } : null
}

/** West, south, east, north around any GeoJSON geometry, or null when it has no position. */
export function featureBounds(
  geometry: { type: string; coordinates?: unknown } | null | undefined
): [number, number, number, number] | null {
  if (!geometry) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      w = Math.min(w, c[0])
      e = Math.max(e, c[0])
      s = Math.min(s, c[1])
      n = Math.max(n, c[1])
      return
    }
    for (const x of c) walk(x)
  }
  walk(geometry.coordinates)
  return Number.isFinite(w) ? [w, s, e, n] : null
}

/** What a feature is, in words: "A point", "Points", "A polygon of 3 parts". */
export function featureKind(
  geometry: { type: string; coordinates?: unknown } | null | undefined
): string {
  if (!geometry) return "A feature"
  const parts = Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0
  switch (geometry.type) {
    case "Point":
      return "A point"
    case "MultiPoint":
      return parts === 1 ? "A point" : `${parts} points`
    case "LineString":
      return "A line"
    case "MultiLineString":
      return parts === 1 ? "A line" : `A line of ${parts} parts`
    case "Polygon":
      return "A polygon"
    case "MultiPolygon":
      return parts === 1 ? "A polygon" : `A polygon of ${parts} parts`
    default:
      return "A feature"
  }
}
