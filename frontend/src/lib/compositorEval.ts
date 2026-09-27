/**
 * What each socket of the compositor's graph carries, computed.
 *
 * Pure: the rasters a Run node offers arrive already decoded through
 * `EvalContext.source`, and everything here is arrays in and arrays out, so
 * the rules are exercised without a DOM (compositorEval.test.ts).
 *
 * TWO KINDS OF VALUE, and the difference is lib/classMask.ts's. A class value
 * is legend ordinals per pixel, recovered exactly from a class PNG; it can be
 * filtered, counted and compared. An image value is colour per pixel; it can
 * be masked, composited and looked at. A class value becomes an image by being
 * painted in its legend, which is why it goes wherever an image does; nothing
 * goes the other way.
 *
 * A THIRD KIND, NOT A RASTER: fields. The polygons a field delineation drew,
 * carried with the thresholds every filter on the way applied, so the node
 * that makes them areas can ask the store for exactly the set that reached it
 * (AdoptFields takes the thresholds, not a list). Filters compose by taking
 * the larger threshold of each, which is the intersection of what each keeps.
 *
 * A FOURTH, NOT A RASTER EITHER: a mineral map's figures, as its run reported
 * them. Nothing computes on them here; each Mineral node reads its part.
 *
 * A FIFTH, A SIXTH AND A SEVENTH, the same way: a classification's season (its
 * series as dates), a vegetation health run's report and an overlap run's
 * registers. The nodes that read them compute their own figures from them, as
 * the Mineral nodes do.
 *
 * RASTERS OF DIFFERENT GRIDS MEET BY WHERE THEY ARE. A mask or an overlay is
 * resampled onto the grid of the raster it is applied to, pixel centre to
 * pixel centre through the two lon/lat extents, nearest neighbour. That is
 * exact for two rasters of one run, which share a grid, and an approximation
 * of a reprojection otherwise: the extents are the boxes the PNGs were written
 * over, and a projected grid is not a lon/lat box.
 *
 * COMPUTED ONCE PER QUESTION. Every value carries a key naming its source and
 * every step above it; the caller keeps a cache by that key across
 * evaluations, so changing one node's setting recomputes that node and what
 * reads it, and nothing else.
 */
import { NO_CLASS, parseHex, type ClassLegendEntry } from "@/lib/classMask"
import {
  closeClass,
  majorityFilter,
  openClass,
  paintClassGrid,
  sieveFilter,
  type ClassGrid,
} from "@/lib/classFilters"
import {
  inputsOf,
  kindMeta,
  linkInto,
  nodeOf,
  refusal,
  type CompositorGraph,
  type GraphNode,
} from "@/lib/compositorGraph"
import type { ClassRaster } from "@/lib/runAssets"
import type { Field } from "@/lib/fields"
import type { Season } from "@/lib/season"
import type {
  Bounds,
  HealthAnalysis,
  MineralAnalysis,
  OverlapAnalysis,
  RadarAnalysis,
  ZonesAnalysis,
} from "@/lib/types"

export interface ClassValue {
  type: "classes"
  key: string
  grid: ClassGrid
  info: ClassRaster
  extent: Bounds | null
}

export interface ImageValue {
  type: "image"
  key: string
  width: number
  height: number
  rgba: Uint8ClampedArray
  extent: Bounds | null
}

export type RasterValue = ClassValue | ImageValue

export interface FieldsValue {
  type: "fields"
  key: string
  /** The delineation run the polygons came from. */
  runId: string
  /** The polygons that passed every filter on the way here, largest first. */
  fields: readonly Field[]
  /** How many the delineation drew, before any filter. */
  total: number
  /** The thresholds applied on the way here; zero where none was. */
  minHa: number
  minCropland: number
}

export interface MineralValue {
  type: "mineral"
  key: string
  /** The mineral run the figures came from. */
  runId: string
  analysis: MineralAnalysis
}

/**
 * A classification run's season: its NDVI series placed as dates, and the mean
 * confidence of its classifier (lib/season.ts). Read by the Season dates and
 * Field table nodes.
 */
export interface SeasonValue {
  type: "season"
  key: string
  runId: string
  season: Season | null
  meanConfidence: number | null
}

/** A vegetation health run's report, read by the Vegetation health and Field table nodes. */
export interface HealthValue {
  type: "health"
  key: string
  runId: string
  report: HealthAnalysis
}

/** An overlap run's registers, read by the Socio-environmental overlap and Field table nodes. */
export interface OverlapValue {
  type: "overlap"
  key: string
  runId: string
  report: OverlapAnalysis
}

/** A radar run's series, read by the Radar series and Field table nodes. */
export interface RadarValue {
  type: "radar"
  key: string
  runId: string
  report: RadarAnalysis
}

/** A zones run's partitions, read by the Management zones and Field table nodes. */
export interface ZonesValue {
  type: "zones"
  key: string
  runId: string
  report: ZonesAnalysis
}

export type Value =
  | RasterValue
  | FieldsValue
  | MineralValue
  | SeasonValue
  | HealthValue
  | OverlapValue
  | RadarValue
  | ZonesValue

/** Whether a value is a raster, the only kind the filters, masks and mixes take. */
export const isRaster = (v: Value): v is RasterValue => v.type === "classes" || v.type === "image"

export type Result =
  | { status: "ready"; value: Value }
  | { status: "busy" }
  | { status: "none"; note: string }
  | { status: "failed"; note: string }

export interface EvalContext {
  /** A run's raster as decoded, or where its decoding stands. */
  source: (runId: string, assetId: string) => Result
  /** Values by key, kept by the caller between evaluations. */
  cache: Map<string, RasterValue>
}

export interface Evaluation {
  /** What each output carries, by socketKey. */
  outputs: Map<string, Result>
  /** What reaches each input, by socketKey, with the input's type rule applied. */
  inputs: Map<string, Result>
  /** The cache keys this evaluation read or wrote; the caller prunes the rest. */
  used: Set<string>
}

export const socketKey = (node: string, socket: string) => `${node}\u0000${socket}`

const valueWidth = (v: RasterValue) => (v.type === "classes" ? v.grid.width : v.width)
const valueHeight = (v: RasterValue) => (v.type === "classes" ? v.grid.height : v.height)

/** A class value painted in its legend. */
export function paintValue(v: RasterValue): ImageValue {
  if (v.type === "image") return v
  const colors = v.info.legend.map((e) => parseHex(e.color))
  return {
    type: "image",
    key: `paint(${v.key})`,
    width: v.grid.width,
    height: v.grid.height,
    rgba: paintClassGrid(v.grid, colors),
    extent: v.extent,
  }
}

/**
 * A run's image with every pixel that holds data made opaque; the same array
 * where none is translucent.
 *
 * Some rasters were written to be laid straight onto the imagery and carry a
 * translucency of their own: the classification's confidence is drawn at
 * alpha = 0.78 x confidence, over a ramp that already encodes it. In the graph
 * that made the Viewer and the globe disagree -- one shows the pixels over the
 * card's dark ground, the other over the satellite scene -- so what the Viewer
 * showed was not what the globe drew. Here the only transparency is the Globe
 * node's Opacity. Pixels with no data (alpha 0) stay transparent.
 */
export function opaqueRGBA(rgba: Uint8ClampedArray): Uint8ClampedArray {
  let partial = false
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0 && rgba[i] < 255) {
      partial = true
      break
    }
  }
  if (!partial) return rgba
  const out = rgba.slice()
  for (let i = 3; i < out.length; i += 4) if (out[i] > 0) out[i] = 255
  return out
}

const sameExtent = (a: Bounds, b: Bounds) =>
  a.lon_min === b.lon_min && a.lon_max === b.lon_max && a.lat_min === b.lat_min && a.lat_max === b.lat_max

/**
 * For each pixel of a destination grid, the source pixel under its centre, or
 * -1 where the source does not reach. Null where the two grids are the same
 * grid and the map would be the identity; a string where they cannot be
 * placed against each other at all.
 */
export function resampleMap(
  src: { width: number; height: number; extent: Bounds | null },
  dst: { width: number; height: number; extent: Bounds | null }
): Int32Array | null | string {
  const sameShape = src.width === dst.width && src.height === dst.height
  if (!src.extent || !dst.extent) {
    return sameShape
      ? null
      : "The two rasters are on different grids and one has no extent to place it by."
  }
  if (sameShape && sameExtent(src.extent, dst.extent)) return null
  const s = src.extent
  const d = dst.extent
  const sw = s.lon_max - s.lon_min
  const sh = s.lat_max - s.lat_min
  if (!(sw > 0 && sh > 0)) return "A raster's extent has no area."

  // Separable, because both grids are boxes on the same two axes.
  const col = new Int32Array(dst.width)
  for (let x = 0; x < dst.width; x++) {
    const lon = d.lon_min + ((x + 0.5) / dst.width) * (d.lon_max - d.lon_min)
    const sx = Math.floor(((lon - s.lon_min) / sw) * src.width)
    col[x] = sx >= 0 && sx < src.width ? sx : -1
  }
  const row = new Int32Array(dst.height)
  for (let y = 0; y < dst.height; y++) {
    const lat = d.lat_max - ((y + 0.5) / dst.height) * (d.lat_max - d.lat_min)
    const sy = Math.floor(((s.lat_max - lat) / sh) * src.height)
    row[y] = sy >= 0 && sy < src.height ? sy : -1
  }
  const map = new Int32Array(dst.width * dst.height)
  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      map[y * dst.width + x] = row[y] < 0 || col[x] < 0 ? -1 : row[y] * src.width + col[x]
    }
  }
  return map
}

/**
 * `top` laid over `base` at `opacity`, both straight alpha: the Porter-Duff
 * "over" operator (Porter and Duff, 1984, Compositing Digital Images).
 */
export function over(
  base: Uint8ClampedArray,
  top: Uint8ClampedArray,
  opacity: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length)
  for (let o = 0; o < base.length; o += 4) {
    const as = (top[o + 3] / 255) * opacity
    const ab = base[o + 3] / 255
    const ao = as + ab * (1 - as)
    if (ao <= 0) continue
    for (let c = 0; c < 3; c++) {
      out[o + c] = Math.round((top[o + c] * as + base[o + c] * ab * (1 - as)) / ao)
    }
    out[o + 3] = Math.round(ao * 255)
  }
  return out
}

function step(node: GraphNode, v: ClassValue, key: string): ClassValue | string {
  const classes = v.info.legend.length
  const grid = ((): ClassGrid | string => {
    switch (node.kind) {
      case "majority":
        return majorityFilter(v.grid, node.size, classes)
      case "sieve":
        return sieveFilter(v.grid, node.minPixels, node.connectivity)
      case "morphology": {
        const ordinal = v.info.legend.findIndex((e) => e.id === node.classId)
        if (node.classId == null || ordinal < 0) return "Choose the class to open or close."
        return node.op === "open"
          ? openClass(v.grid, ordinal, node.size, classes)
          : closeClass(v.grid, ordinal, node.size)
      }
      case "select": {
        if (!node.keep.length) return "Choose the classes to keep."
        const keep = new Uint8Array(256)
        v.info.legend.forEach((e, i) => {
          if (node.keep.includes(e.id)) keep[i] = 1
        })
        const index = v.grid.index.slice()
        for (let p = 0; p < index.length; p++) if (!keep[index[p]]) index[p] = NO_CLASS
        return { width: v.grid.width, height: v.grid.height, index }
      }
      default:
        return v.grid
    }
  })()
  if (typeof grid === "string") return grid
  return { ...v, key, grid }
}

/** The part of a key a node's own settings contribute. */
function paramsKey(node: GraphNode): string {
  switch (node.kind) {
    case "majority":
      return `majority:${node.size}`
    case "sieve":
      return `sieve:${node.minPixels}:${node.connectivity}`
    case "morphology":
      return `${node.op}:${node.size}:${node.classId}`
    case "select":
      return `select:${[...node.keep].sort((a, b) => a - b).join(",")}`
    case "mix":
      return `mix:${node.opacity}`
    default:
      return node.kind
  }
}

export function evaluate(graph: CompositorGraph, ctx: EvalContext): Evaluation {
  const outputs = new Map<string, Result>()
  const inputs = new Map<string, Result>()
  const used = new Set<string>()

  const cached = <T extends RasterValue>(key: string, make: () => T | string): T | string => {
    used.add(key)
    const hit = ctx.cache.get(key)
    if (hit) return hit as T
    const made = make()
    if (typeof made !== "string") ctx.cache.set(key, made)
    return made
  }

  const input = (node: GraphNode, inputId: string, trail: Set<string>): Result => {
    const k = socketKey(node.id, inputId)
    const hit = inputs.get(k)
    if (hit) return hit
    const link = linkInto(graph, node.id, inputId)
    let r: Result
    if (!link) r = { status: "none", note: "Not connected." }
    else {
      r = output(link.from, link.fromSocket, trail)
      const def = inputsOf(graph, node).find((i) => i.id === inputId)
      if (r.status === "ready" && def && !def.accepts.includes(r.value.type)) {
        r = { status: "failed", note: refusal(def, r.value.type) }
      }
    }
    inputs.set(k, r)
    return r
  }

  /** A value as an image, painted once per class map and kept. */
  const painted = (v: RasterValue): ImageValue =>
    v.type === "image" ? v : (cached(`paint(${v.key})`, () => paintValue(v)) as ImageValue)

  /** The reason a node cannot run yet, from the first input that is not ready. */
  const notReady = (r: Result): Result =>
    r.status === "busy"
      ? r
      : r.status === "failed"
        ? { status: "failed", note: r.note }
        : { status: "none", note: "Nothing reaches this node yet." }

  const output = (nodeId: string, socketId: string, trail: Set<string>): Result => {
    const k = socketKey(nodeId, socketId)
    const hit = outputs.get(k)
    if (hit) return hit
    const node = nodeOf(graph, nodeId)
    let r: Result
    if (!node) r = { status: "failed", note: "That node is no longer on the graph." }
    else if (trail.has(nodeId)) r = { status: "failed", note: "The graph loops here." }
    else r = compute(node, socketId, new Set(trail).add(nodeId))
    outputs.set(k, r)
    return r
  }

  const compute = (node: GraphNode, socketId: string, trail: Set<string>): Result => {
    switch (node.kind) {
      case "run":
        if (!node.runId) return { status: "none", note: "Choose a run." }
        return ctx.source(node.runId, socketId)

      case "majority":
      case "sieve":
      case "morphology":
      case "select": {
        const up = input(node, "classes", trail)
        if (up.status !== "ready") return notReady(up)
        if (up.value.type !== "classes") return { status: "failed", note: "Needs a class map." }
        const v = up.value
        const made = cached(`${paramsKey(node)}(${v.key})`, () => step(node, v, `${paramsKey(node)}(${v.key})`))
        return typeof made === "string" ? { status: "none", note: made } : { status: "ready", value: made }
      }

      case "mask": {
        const raster = input(node, "raster", trail)
        if (raster.status !== "ready") return notReady(raster)
        const mask = input(node, "mask", trail)
        if (mask.status !== "ready") return notReady(mask)
        if (mask.value.type !== "classes") return { status: "failed", note: "The mask needs a class map." }
        if (!isRaster(raster.value)) return { status: "failed", note: "The raster input takes a raster." }
        const v = raster.value
        const m = mask.value
        const made = cached(`mask(${v.key},${m.key})`, (): RasterValue | string => {
          const map = resampleMap(
            { width: m.grid.width, height: m.grid.height, extent: m.extent },
            { width: valueWidth(v), height: valueHeight(v), extent: v.extent }
          )
          if (typeof map === "string") return map
          const inside = (p: number) => {
            const q = map ? map[p] : p
            return q >= 0 && m.grid.index[q] !== NO_CLASS
          }
          const key = `mask(${v.key},${m.key})`
          if (v.type === "classes") {
            const index = v.grid.index.slice()
            for (let p = 0; p < index.length; p++) if (!inside(p)) index[p] = NO_CLASS
            return { ...v, key, grid: { ...v.grid, index } }
          }
          const rgba = v.rgba.slice()
          for (let p = 0, o = 3; p < v.width * v.height; p++, o += 4) if (!inside(p)) rgba[o] = 0
          return { ...v, key, rgba }
        })
        return typeof made === "string" ? { status: "failed", note: made } : { status: "ready", value: made }
      }

      case "mix": {
        const base = input(node, "base", trail)
        if (base.status !== "ready") return notReady(base)
        const top = input(node, "overlay", trail)
        if (top.status === "busy") return top
        if (top.status === "failed") return { status: "failed", note: top.note }
        if (!isRaster(base.value)) return { status: "failed", note: "The base takes a raster." }
        const b = painted(base.value)
        if (top.status === "none") return { status: "ready", value: b }
        if (!isRaster(top.value)) return { status: "failed", note: "The overlay takes a raster." }
        const t = painted(top.value)
        const key = `${paramsKey(node)}(${b.key},${t.key})`
        const made = cached(key, (): ImageValue | string => {
          const map = resampleMap(t, b)
          if (typeof map === "string") return map
          let placed = t.rgba
          if (map) {
            placed = new Uint8ClampedArray(b.width * b.height * 4)
            for (let p = 0; p < map.length; p++) {
              const q = map[p]
              if (q < 0) continue
              placed[p * 4] = t.rgba[q * 4]
              placed[p * 4 + 1] = t.rgba[q * 4 + 1]
              placed[p * 4 + 2] = t.rgba[q * 4 + 2]
              placed[p * 4 + 3] = t.rgba[q * 4 + 3]
            }
          }
          return { ...b, key, rgba: over(b.rgba, placed, node.opacity) }
        })
        return typeof made === "string" ? { status: "failed", note: made } : { status: "ready", value: made }
      }

      case "viewer": {
        // What it shows is what it passes on, unchanged.
        const up = input(node, "image", trail)
        return up.status === "ready" ? up : notReady(up)
      }

      case "fieldFilter": {
        const up = input(node, "fields", trail)
        if (up.status !== "ready") return notReady(up)
        if (up.value.type !== "fields") return { status: "failed", note: "Needs the fields a delineation drew." }
        return { status: "ready", value: filterFields(up.value, node.minHa, node.minCropland) }
      }

      default:
        return { status: "failed", note: "This node has no outputs." }
    }
  }

  for (const node of graph.nodes) {
    for (const def of inputsOf(graph, node)) input(node, def.id, new Set([node.id]))
    // A node's own outputs even where nothing reads them, since the node
    // reports on what it made. Not a Run node's: those are decoded rasters,
    // and only the ones something reads are worth decoding.
    if (node.kind !== "run") for (const o of kindMeta(node.kind).outputs) output(node.id, o.id, new Set())
  }
  for (const l of graph.links) output(l.from, l.fromSocket, new Set())
  return { outputs, inputs, used }
}

/**
 * The fields at least `minHa` in area and at least `minCropland` cropland, with
 * the thresholds carried on. A field with no cropland share -- none was read,
 * or it holds no cell -- has nothing to be judged by and is kept.
 */
export function filterFields(v: FieldsValue, minHa: number, minCropland: number): FieldsValue {
  const ha = Math.max(v.minHa, minHa)
  const crop = Math.max(v.minCropland, minCropland)
  return {
    ...v,
    key: `fieldFilter:${minHa}:${minCropland}(${v.key})`,
    fields: v.fields.filter((f) => {
      if (f.properties.area_ha < ha) return false
      const share = f.properties.cropland_share
      return typeof share !== "number" || share >= crop
    }),
    minHa: ha,
    minCropland: crop,
  }
}

/** One class's pixels in a class map. */
export interface AreaRow {
  entry: ClassLegendEntry
  px: number
}

/** The pixels of each class present, largest first, and their sum. */
export function classAreas(v: ClassValue): { rows: AreaRow[]; total: number } {
  const counts = new Uint32Array(v.info.legend.length)
  for (const c of v.grid.index) if (c < counts.length) counts[c]++
  const rows = v.info.legend
    .map((entry, i) => ({ entry, px: counts[i] }))
    .filter((r) => r.px > 0)
    .sort((a, b) => b.px - a.px)
  return { rows, total: rows.reduce((s, r) => s + r.px, 0) }
}

/** One class summed over several class maps: its area, or its pixels where a map has no cell area. */
export interface SummedRow {
  entry: ClassLegendEntry
  amount: number
}

/**
 * The classes of several class maps summed, largest first: hectares where every
 * map knows its cell area, pixels otherwise -- a sum of hectares and pixels
 * names no unit.
 *
 * Classes meet by name and colour, not by legend position: each run writes its
 * own legend, and two runs of one model can order it differently.
 */
export function sumClassAreas(values: readonly ClassValue[]): {
  rows: SummedRow[]
  total: number
  unit: "ha" | "px"
} {
  const unit = values.every((v) => v.info.pixelAreaHa != null) ? "ha" : "px"
  const rows = new Map<string, SummedRow>()
  for (const v of values) {
    const scale = unit === "ha" ? (v.info.pixelAreaHa ?? 0) : 1
    for (const { entry, px } of classAreas(v).rows) {
      const k = `${entry.name}\u0000${entry.color.toLowerCase()}`
      const row = rows.get(k)
      if (row) row.amount += px * scale
      else rows.set(k, { entry, amount: px * scale })
    }
  }
  const out = [...rows.values()].sort((a, b) => b.amount - a.amount)
  return { rows: out, total: out.reduce((s, r) => s + r.amount, 0), unit }
}

export type ChangeReading =
  | {
      comparable: true
      /** Pixels classified in both maps. */
      shared: number
      /** Of those, the ones whose class differs. */
      changed: number
      /** Per class, by legend id: pixels before and after. */
      rows: { id: number; name: string; color: string; before: number; after: number }[]
      /** Pixels per pair of classes that differ, largest first. */
      moves: { from: ClassLegendEntry; to: ClassLegendEntry; px: number }[]
    }
  | { comparable: false; note: string }

/**
 * What differs between two class maps of one grid.
 *
 * Classes are matched by legend id, not by ordinal, so two runs whose legends
 * list the same classes in another order are still compared class for class.
 * Two maps of different grids are refused rather than resampled: a change
 * figure has to be a count of the same pixels.
 */
export function classChange(a: ClassValue, b: ClassValue): ChangeReading {
  if (a.grid.width !== b.grid.width || a.grid.height !== b.grid.height) {
    return {
      comparable: false,
      note: `The two maps are on different grids (${a.grid.width}×${a.grid.height} and ${b.grid.width}×${b.grid.height}); a change is counted over the same pixels.`,
    }
  }
  const la = a.info.legend
  const lb = b.info.legend
  const before = new Map<number, number>()
  const after = new Map<number, number>()
  const pairs = new Map<number, number>()
  let shared = 0
  let changed = 0
  for (let p = 0; p < a.grid.index.length; p++) {
    const x = a.grid.index[p]
    const y = b.grid.index[p]
    if (x < la.length) before.set(la[x].id, (before.get(la[x].id) ?? 0) + 1)
    if (y < lb.length) after.set(lb[y].id, (after.get(lb[y].id) ?? 0) + 1)
    if (x >= la.length || y >= lb.length) continue
    shared++
    if (la[x].id !== lb[y].id) {
      changed++
      const k = x * 256 + y
      pairs.set(k, (pairs.get(k) ?? 0) + 1)
    }
  }
  const ids = [...new Set([...before.keys(), ...after.keys()])]
  const entry = (id: number) => la.find((e) => e.id === id) ?? lb.find((e) => e.id === id)!
  const rows = ids
    .map((id) => ({
      id,
      name: entry(id).name,
      color: entry(id).color,
      before: before.get(id) ?? 0,
      after: after.get(id) ?? 0,
    }))
    .sort((p, q) => q.before - p.before || q.after - p.after)
  const moves = [...pairs.entries()]
    .map(([k, px]) => ({ from: la[Math.floor(k / 256)], to: lb[k % 256], px }))
    .sort((p, q) => q.px - p.px)
  return { comparable: true, shared, changed, rows, moves }
}
