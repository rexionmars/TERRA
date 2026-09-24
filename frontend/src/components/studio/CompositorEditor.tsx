/**
 * The compositor: the board's rasters as nodes, composed, filtered and read.
 *
 * BLENDER'S COMPOSITOR IS THE MODEL. A Run node offers every raster its run
 * produced, one output socket each, as Render Layers offers its passes; nodes
 * are added from a menu of categories -- Input, Output, Filter, Mask, Color,
 * Analysis -- and joined socket to socket; a Viewer draws what reaches it
 * inside its own card. Shift+A adds at the pointer, X removes the selected
 * node, Home frames the graph and Ctrl+Shift+click sends a node's outputs to
 * the Viewer in turn.
 *
 * THE IMAGE STAYS IN THE CARD. Blender also draws the active Viewer behind the
 * whole graph, as a backdrop; that was tried here and taken out, because a
 * raster the size of the pane under the cards made the graph hard to read and
 * put a second copy of the Viewer's picture on screen.
 *
 * The viewport lifts rasters off their coordinates to set them side by side;
 * this editor is where a raster is worked on. Nothing is written to disk and no
 * run changes: every value lives in this editor, computed from the PNGs the
 * runs already hold (lib/compositorEval.ts says how, and what is exact).
 *
 * The graph belongs to the board. BoardSurface holds it with the rest of what
 * a save records; until the reader changes something the default graph is
 * shown without being stored, so opening the editor is not an edit.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { CaretRight, CircleNotch, DownloadSimple, Polygon, X } from "@phosphor-icons/react"
import { NumberField } from "@/components/ui/NumberField"
import { cn } from "@/lib/utils"
import { parseFields, type FieldsTarget } from "@/lib/fields"
import type { FieldsAnalysis } from "@/lib/types"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import { ExportOverlayFile } from "../../../wailsjs/go/main/App"
import {
  linkKey,
  SocketCanvas,
  type CanvasApi,
  type Place,
  type SocketLink,
  type SocketNode,
  type SocketRow,
} from "./SocketCanvas"
import { Choice, Head } from "./nodeCard"
import { AreaHeaderMenus } from "./StudioArea"
import {
  StudioContextMenu,
  StudioMenuGroup,
  StudioMenuItem,
  StudioMenuRule,
  StudioPopover,
} from "./StudioPopover"
import { StudioHeaderMenu } from "./StudioHeaderControls"
import { classIndexFor, NO_CLASS } from "@/lib/classMask"
import { loadImage } from "@/lib/smoothOverlay"
import { changedPixels, WINDOW_SIZES } from "@/lib/classFilters"
import {
  addNode,
  CATEGORIES,
  connect,
  createNode,
  defaultGraph,
  disconnect,
  EMPTY_GRAPH,
  FIELDS_SOCKET,
  inputsOf,
  kindMeta,
  linkInto,
  moveNode,
  nextNodeId,
  NODE_KINDS,
  nodeOf,
  outputsOf,
  outputType,
  removeNode,
  SIEVE_MAX,
  SIEVE_MIN,
  updateNode,
  type CompositorGraph,
  type GraphNode,
  type NodeCategory,
  type NodeKind,
  type SocketType,
} from "@/lib/compositorGraph"
import {
  classAreas,
  classChange,
  evaluate,
  paintValue,
  socketKey,
  type ChangeReading,
  type ClassValue,
  type FieldsValue,
  type ImageValue,
  type RasterValue,
  type Result,
} from "@/lib/compositorEval"
import type { AssetRun, ClassRaster } from "@/lib/runAssets"
import { isZeroExtent, type RasterLayer } from "@/lib/mapLayers"
import { notifyInfo } from "@/lib/notify"

/** How wide each kind is drawn: settings at the run graph's width, readings wider. */
const WIDTH: Record<NodeKind, number> = {
  run: 224,
  majority: 208,
  sieve: 208,
  morphology: 216,
  select: 216,
  mask: 180,
  mix: 208,
  areas: 300,
  change: 330,
  viewer: 320,
  globe: 220,
  fieldFilter: 220,
  adoptFields: 230,
  saveFields: 200,
}

const GUESS_H: Record<NodeKind, number> = {
  run: 190,
  majority: 130,
  sieve: 160,
  morphology: 170,
  select: 200,
  mask: 110,
  mix: 130,
  areas: 220,
  change: 300,
  viewer: 290,
  globe: 130,
  fieldFilter: 150,
  adoptFields: 120,
  saveFields: 100,
}

/*
  A node's header by its category, from the parts the run graph already
  measured against --b-node-ink (lib/contrast.ts): Input takes the source part,
  Filter the method, Mask the catalogue's magenta, Color the period's yellow,
  Analysis the value part, and Output the run node's red, as Blender's output
  nodes are red. `band` and `ink` are what a chosen control inside is drawn in.
*/
const PART: Record<NodeCategory, string> = {
  input: "source",
  filter: "method",
  mask: "catalogue",
  color: "when",
  analysis: "value",
  output: "action",
}
const paint = (c: NodeCategory) => ({
  head: `var(--b-${PART[c]}-node)`,
  band: `var(--b-${PART[c]}-head)`,
  ink: `var(--b-${PART[c]}-ink)`,
})

/*
  A socket's colour says what it carries, as Blender's do: a class map in the
  source part's green, an image in the yellow Blender gives a colour socket.
  An output whose type is not known yet -- a Mask with nothing on its input --
  is grey.
*/
const TYPE_COLOUR: Record<SocketType, string> = {
  classes: "var(--b-source-head)",
  image: "var(--b-when-head)",
  // Polygons, in the field boundaries' kind colour (index.css).
  fields: "rgb(var(--p-kind-fields))",
}
const PLAIN = "var(--b-card-ink)"

const INT = new Intl.NumberFormat("en-US")

function share(part: number, whole: number): string {
  if (!whole) return "0%"
  const v = (part / whole) * 100
  return `${v > 0 && v < 0.1 ? v.toFixed(2) : v.toFixed(1)}%`
}

function hectares(v: number): string {
  const a = Math.abs(v)
  if (a >= 1000) return INT.format(Math.round(v))
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

/** A pixel count as ground, where the run reported how much ground a pixel is. */
function ground(px: number, info: ClassRaster): string {
  return info.pixelAreaHa == null ? `${INT.format(px)} px` : `${hectares(px * info.pixelAreaHa)} ha`
}

/*
  A PNG's RGBA bytes, decoded once per data URI and kept. The class rasters go
  through lib/classMask.ts instead, which inverts their colours to classes.
*/
const decodedImages = new Map<string, Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>>()
function decodeRGBA(uri: string) {
  const hit = decodedImages.get(uri)
  if (hit) return hit
  const job = (async () => {
    const img = await loadImage(uri)
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("no 2d context to decode the raster")
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    return { width: canvas.width, height: canvas.height, rgba: data }
  })()
  decodedImages.set(uri, job)
  void job.catch(() => decodedImages.delete(uri))
  return job
}

/** A value as an image, painted once per value. */
const paintedValues = new WeakMap<RasterValue, ImageValue>()
function painted(v: RasterValue): ImageValue {
  if (v.type === "image") return v
  let hit = paintedValues.get(v)
  if (!hit) {
    hit = paintValue(v)
    paintedValues.set(v, hit)
  }
  return hit
}

/**
 * An image drawn at its own pixels.
 *
 * A canvas rather than an encoded PNG: the bytes are already in memory, and
 * encoding one per parameter change would spend its time compressing a
 * picture only ever shown here. Not interpolated, since a blend of two class
 * colours names no class.
 */
function RasterCanvas({ image, style }: { image: ImageValue; style: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const data = ctx.createImageData(image.width, image.height)
    data.data.set(image.rgba)
    ctx.putImageData(data, 0, 0)
  }, [image])
  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ imageRendering: "pixelated", objectFit: "contain", ...style }}
    />
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span className="telemetry truncate text-foreground" title={value}>
        {value}
      </span>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-meta leading-snug text-muted-foreground">{children}</p>
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-[2px]"
      style={{ background: color, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35)" }}
    />
  )
}

/**
 * A node's one action, drawn as the run card's button is: filled in the accent
 * while it can go, quiet while it cannot.
 */
function ActionButton({
  label,
  icon,
  busy,
  disabled,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const off = disabled || busy
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      disabled={off}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-meta transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        off ? "cursor-not-allowed bg-control text-muted-foreground" : "bg-accent text-accent-foreground hover:opacity-90"
      )}
    >
      {busy ? <CircleNotch className="size-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}

/** Why a result is not a value, in a line. */
function StatusNote({ result }: { result: Result | undefined }) {
  if (!result || result.status === "ready") return null
  if (result.status === "busy") return <Note>Decoding the raster.</Note>
  return <Note>{result.note}</Note>
}

/** The area of each class in a class map, with a bar per row. */
function AreasReading({ value }: { value: ClassValue }) {
  const { rows, total } = useMemo(() => classAreas(value), [value])
  const info = value.info
  const top = rows[0]?.px ?? 1
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_auto_auto] items-center gap-x-2 gap-y-1 text-meta">
        <span className="text-micro text-muted-foreground">Class</span>
        <span />
        <span className="text-right text-micro text-muted-foreground">
          {info.pixelAreaHa == null ? "Pixels" : "Area (ha)"}
        </span>
        <span className="text-right text-micro text-muted-foreground">Share</span>
        {rows.map(({ entry, px }) => (
          <div key={entry.id} className="contents">
            <span className="flex min-w-0 items-center gap-1.5">
              <Swatch color={entry.color} />
              <span className="truncate text-foreground" title={entry.name}>
                {entry.name}
              </span>
            </span>
            <span className="h-1.5 rounded-full" style={{ background: "rgb(var(--p-line) / 0.25)" }}>
              <span
                className="block h-full rounded-full"
                style={{ width: `${(px / top) * 100}%`, background: "var(--b-lit)" }}
              />
            </span>
            <span className="telemetry text-right text-foreground">
              {info.pixelAreaHa == null ? INT.format(px) : hectares(px * info.pixelAreaHa)}
            </span>
            <span className="telemetry text-right text-muted-foreground">{share(px, total)}</span>
          </div>
        ))}
      </div>
      <Figure label="Classified" value={`${INT.format(total)} px · ${ground(total, info)}`} />
      {info.areaIsMean && (
        <Note>Areas use the mean cell area: the grid is in degrees, so a cell's area varies with latitude.</Note>
      )}
    </div>
  )
}

/** What differs between the two class maps on a Change node. */
function ChangeReadingView({ reading, info }: { reading: ChangeReading; info: ClassRaster }) {
  if (!reading.comparable) return <Note>{reading.note}</Note>
  const unit = info.pixelAreaHa == null ? "px" : "ha"
  const amount = (px: number) => (info.pixelAreaHa == null ? INT.format(px) : hectares(px * info.pixelAreaHa))
  const signed = (px: number) => (px > 0 ? `+${amount(px)}` : px < 0 ? `−${amount(-px)}` : "0")
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="telemetry text-[18px] leading-none text-foreground">
          {share(reading.changed, reading.shared)}
        </span>
        <span className="text-meta text-muted-foreground">
          of {INT.format(reading.shared)} pixels classified in both changed class ({ground(reading.changed, info)})
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-2.5 gap-y-1 text-meta">
        <span className="text-micro text-muted-foreground">Class</span>
        <span className="text-right text-micro text-muted-foreground">Before ({unit})</span>
        <span className="text-right text-micro text-muted-foreground">After ({unit})</span>
        <span className="text-right text-micro text-muted-foreground">Change</span>
        {reading.rows.map((r) => (
          <div key={r.id} className="contents">
            <span className="flex min-w-0 items-center gap-1.5">
              <Swatch color={r.color} />
              <span className="truncate text-foreground" title={r.name}>
                {r.name}
              </span>
            </span>
            <span className="telemetry text-right text-muted-foreground">{amount(r.before)}</span>
            <span className="telemetry text-right text-foreground">{amount(r.after)}</span>
            <span className="telemetry text-right text-foreground">{signed(r.after - r.before)}</span>
          </div>
        ))}
      </div>
      {reading.moves.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-micro text-muted-foreground">Largest transitions</span>
          {reading.moves.slice(0, 5).map((m) => (
            <div key={`${m.from.id}-${m.to.id}`} className="flex items-center gap-1.5 text-meta">
              <Swatch color={m.from.color} />
              <span className="min-w-0 truncate text-foreground" title={m.from.name}>
                {m.from.name}
              </span>
              <span className="text-muted-foreground">to</span>
              <Swatch color={m.to.color} />
              <span className="min-w-0 flex-1 truncate text-foreground" title={m.to.name}>
                {m.to.name}
              </span>
              <span className="telemetry shrink-0 text-foreground">
                {amount(m.px)} {unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The Add menu as Blender lays it out: the categories, and beside them the
 * nodes of the one the pointer is on.
 */
function AddCascade({
  onPick,
  refuse,
}: {
  onPick: (kind: NodeKind) => void
  refuse: (kind: NodeKind) => string | null
}) {
  const [category, setCategory] = useState<NodeCategory>("input")
  return (
    <div className="flex">
      <div className="w-[7.5rem] shrink-0 border-r py-0.5" style={{ borderColor: "rgb(var(--p-line) / 0.4)" }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitem"
            onPointerEnter={() => setCategory(c.id)}
            onFocus={() => setCategory(c.id)}
            onClick={() => setCategory(c.id)}
            className="flex w-full items-center gap-2 px-2 py-[3px] text-left text-meta text-foreground outline-none"
            style={category === c.id ? { background: "rgb(var(--p-accent) / 0.18)" } : undefined}
          >
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            <CaretRight className="size-2.5 shrink-0 opacity-60" weight="bold" />
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        {NODE_KINDS.filter((k) => k.category === category).map((k) => (
          <StudioMenuItem
            key={k.kind}
            label={k.label}
            title={refuse(k.kind) ?? k.hint}
            disabled={!!refuse(k.kind)}
            onSelect={() => onPick(k.kind)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * A raster a Globe node sends out of the graph, as the board hands it to the
 * Globe editor.
 */
export interface CompositorGlobeOverlay {
  key: string
  /** The Globe node it comes from; the board drops the overlay when the node goes. */
  nodeId: string
  /** The node's layer it fills; the board drops the overlay when that link goes. */
  socket: string
  /**
   * The run raster this overlay IS, where it reaches the Globe unprocessed --
   * through Viewers alone -- as the plane key's two halves. The board counts
   * it as that raster being on the globe, so the outliner does not offer to
   * send a second copy of it. Null for anything a node has changed.
   */
  source: { areaId: string; sceneId: string } | null
  /**
   * The ground it is stacked with: the area of the first run it derives from,
   * so the globe's spread lifts it over that run's own rasters rather than
   * drawing it in the same plane.
   */
  areaId: string
  /** Every run it derives from; the board drops the overlay when one leaves. */
  runIds: string[]
  layer: RasterLayer
}

/*
  An image as a PNG data URI, encoded once per image. The globe loads its
  overlays as textures from a URL, which is the one place in this editor a
  picture has to be encoded at all.
*/
const encoded = new WeakMap<ImageValue, string>()
function dataUriOf(image: ImageValue): string {
  const hit = encoded.get(image)
  if (hit) return hit
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  const data = ctx.createImageData(image.width, image.height)
  data.data.set(image.rgba)
  ctx.putImageData(data, 0, 0)
  const uri = canvas.toDataURL("image/png")
  encoded.set(image, uri)
  return uri
}

export function CompositorEditor({
  runs,
  graph: stored,
  onChange,
  onGlobe,
  surface,
  fieldsOf,
  fieldsTargetOf,
  onAdoptFields,
}: {
  /** The runs on the board, as the outliner lists them. */
  runs: readonly AssetRun[]
  /**
   * A run's field delineation, where it is one. Its polygons are the Run
   * node's Fields output; a run without them has none.
   */
  fieldsOf?: (runId: string) => FieldsAnalysis | null
  /** The area a delineation's fields would belong to, or null where it has none. */
  fieldsTargetOf?: (runId: string) => FieldsTarget | null
  /** Makes a delineation's fields areas, with the thresholds that reached the node. */
  onAdoptFields?: (runId: string, minHa: number, minCropland: number, replace: boolean) => Promise<boolean>
  /** The stored graph, or null where the reader has not changed the default. */
  graph: CompositorGraph | null
  onChange: (next: CompositorGraph) => void
  /**
   * What the Globe nodes send out, whenever it changes. The board keeps the
   * last list after this editor closes, so an area can be turned into a
   * Globe to look at it.
   */
  onGlobe?: (overlays: CompositorGlobeOverlay[]) => void
  surface: HTMLElement | null
}) {
  /*
    The runs by what identifies their rasters. The board rebuilds `runs` on
    every render of its own; the evaluation below is keyed on this instead,
    so dragging something in the viewport does not recount every pixel here.
  */
  const runsKey = runs
    .map((r) =>
      [
        r.runId,
        r.title,
        `fields:${fieldsOf?.(r.runId)?.fields_geojson.length ?? 0}`,
        ...r.assets.map((a) => `${a.id}:${a.title}:${a.previewUri.length}:${a.classes ? 1 : 0}`),
      ].join("\u0000")
    )
    .join("|")
  const runsRef = useRef(runs)
  runsRef.current = runs

  const runOf = (runId: string | null) => runsRef.current.find((r) => r.runId === runId)
  const fieldsOfRun = (runId: string | null) => (runId && fieldsOf ? fieldsOf(runId) : null)
  const runOutputs = (runId: string | null) => [
    ...(runOf(runId)?.assets ?? []).map((a) => ({
      id: a.id,
      label: a.title,
      type: (a.classes ? "classes" : "image") as SocketType,
    })),
    // A delineation's polygons, beside its rasters.
    ...(runOf(runId) && fieldsOfRun(runId)?.fields_geojson
      ? [{ id: FIELDS_SOCKET, label: "Fields", type: "fields" as SocketType }]
      : []),
  ]

  const firstClass = runs.flatMap((r) => r.assets.filter((a) => a.classes).map((a) => ({ run: r, asset: a })))[0]
  const graph = useMemo<CompositorGraph>(
    () =>
      stored ?? (firstClass ? defaultGraph(firstClass.run.runId, firstClass.asset.id) : EMPTY_GRAPH),
    [stored, firstClass?.run.runId, firstClass?.asset.id]
  )
  const edit = (next: CompositorGraph) => onChange(next)

  /* ---- The rasters Run nodes offer, decoded once each ------------------ */

  const [decoded, setDecoded] = useState<Record<string, { uri: string; result: Result }>>({})
  const decodedRef = useRef(decoded)
  decodedRef.current = decoded
  const token = useRef(1)

  // Only the outputs something reads: a run carries a true-colour scene and a
  // composition or two, and decoding those unasked would be most of the work.
  const needed = graph.links.flatMap((l) => {
    const node = nodeOf(graph, l.from)
    if (node?.kind !== "run" || !node.runId) return []
    const asset = runOf(node.runId)?.assets.find((a) => a.id === l.fromSocket)
    return asset ? [{ runId: node.runId, asset }] : []
  })
  const neededKey = needed.map((n) => `${n.runId}:${n.asset.id}:${n.asset.previewUri.length}`).join("|")

  useEffect(() => {
    for (const { runId, asset } of needed) {
      const key = `${runId}\u0000${asset.id}`
      const uri = asset.previewUri
      if (decodedRef.current[key]?.uri === uri) continue
      setDecoded((prev) => ({ ...prev, [key]: { uri, result: { status: "busy" } } }))
      const settle = (result: Result) =>
        setDecoded((prev) => (prev[key]?.uri === uri ? { ...prev, [key]: { uri, result } } : prev))
      const valueKey = `run:${runId}:${asset.id}:${token.current++}`
      const info = asset.classes
      if (info) {
        classIndexFor(uri, info.legend)
          .then((map) => {
            if (map.unmatched > 0) {
              // classMask's own rule: a legend that does not explain every
              // pixel is refused rather than answered in part.
              settle({
                status: "failed",
                note: `${INT.format(map.unmatched)} pixels match no legend colour, so this raster cannot be read as classes.`,
              })
              return
            }
            let index = map.index
            if (info.excluded.length) {
              // A copy: the decoded map is classMask's cached object, shared.
              index = map.index.slice()
              const drop = new Set(info.excluded)
              for (let p = 0; p < index.length; p++) if (drop.has(index[p])) index[p] = NO_CLASS
            }
            settle({
              status: "ready",
              value: {
                type: "classes",
                key: valueKey,
                grid: { width: map.width, height: map.height, index },
                info,
                extent: asset.extent,
              },
            })
          })
          .catch(() => settle({ status: "failed", note: "The raster could not be decoded." }))
      } else {
        decodeRGBA(uri)
          .then((img) =>
            settle({ status: "ready", value: { type: "image", key: valueKey, ...img, extent: asset.extent } })
          )
          .catch(() => settle({ status: "failed", note: "The raster could not be decoded." }))
      }
    }
    // `needed` is rebuilt every render; its key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey])

  /* ---- Evaluation --------------------------------------------------------- */

  const cache = useRef(new Map<string, RasterValue>())
  const evaluation = useMemo(() => {
    const e = evaluate(graph, {
      source: (runId, assetId) => {
        const run = runOf(runId)
        if (!run) return { status: "none", note: "That run is not on this board." }
        if (assetId === FIELDS_SOCKET) {
          const f = fieldsOfRun(runId)
          if (!f) return { status: "none", note: "That run drew no fields." }
          const fields = parseFields(f)
          return {
            status: "ready",
            value: {
              type: "fields",
              key: `fields:${runId}:${f.fields_geojson.length}`,
              runId,
              fields,
              total: fields.length,
              minHa: 0,
              minCropland: 0,
            },
          }
        }
        if (!run.assets.some((a) => a.id === assetId)) {
          return { status: "none", note: "That run has no such raster." }
        }
        return decoded[`${runId}\u0000${assetId}`]?.result ?? { status: "busy" }
      },
      cache: cache.current,
    })
    for (const k of [...cache.current.keys()]) if (!e.used.has(k)) cache.current.delete(k)
    return e
    // Places are left out on purpose: moving a node computes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, graph.links, decoded, runsKey])

  const outputOf = (node: string, socket: string) => evaluation.outputs.get(socketKey(node, socket))
  const inputOf = (node: string, socket: string) => evaluation.inputs.get(socketKey(node, socket))
  /** A ready raster, or null -- for fields as well, which are no raster. */
  const readyValue = (r: Result | undefined): RasterValue | null =>
    r?.status === "ready" && r.value.type !== "fields" ? r.value : null
  /** Ready fields, or null. */
  const readyFields = (r: Result | undefined): FieldsValue | null =>
    r?.status === "ready" && r.value.type === "fields" ? r.value : null

  /** The runs whose rasters reach a node, through any chain of links. */
  const runsFeeding = (id: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    const stack = [id]
    while (stack.length) {
      const at = stack.pop()!
      if (seen.has(at)) continue
      seen.add(at)
      const node = nodeOf(graph, at)
      if (node?.kind === "run" && node.runId && !out.includes(node.runId)) out.push(node.runId)
      for (const l of graph.links) if (l.to === at) stack.push(l.from)
    }
    return out
  }

  /* ---- What the Globe nodes send out ------------------------------------ */

  /*
    One overlay per linked layer, bottom layer first. Every layer of one Globe
    node is stacked on one ground -- the area of the first run the node reads
    -- so the globe's spread separates them, as it separates the planes of one
    area sent from the viewport.
  */
  const sent = graph.nodes.flatMap((node) => {
    if (node.kind !== "globe") return []
    const ground = runOf(runsFeeding(node.id)[0] ?? null)?.areaId ?? `compositor:${node.id}`
    return inputsOf(graph, node).flatMap((input) => {
      const link = linkInto(graph, node.id, input.id)
      const v = readyValue(inputOf(node.id, input.id))
      if (!link || !v?.extent || isZeroExtent(v.extent)) return []
      return [
        {
          node,
          socket: input.id,
          label: input.label,
          from: link.from,
          fromSocket: link.fromSocket,
          value: v,
          extent: v.extent,
          runIds: runsFeeding(link.from),
          areaId: ground,
        },
      ]
    })
  })
  // A Globe whose raster is still decoding keeps what it last sent, rather
  // than blinking off the globe until the decode lands.
  const decoding = graph.nodes.some(
    (n) =>
      n.kind === "globe" && inputsOf(graph, n).some((i) => inputOf(n.id, i.id)?.status === "busy")
  )
  const sentKey = sent
    .map((s) => `${s.node.id}:${s.socket}:${s.label}:${s.value.key}:${s.node.opacity}:${s.areaId}:${s.runIds.join(",")}`)
    .join("|")

  /**
   * What a layer is called where it is listed: the node its raster came from,
   * looking through Viewers, since "Viewer" says nothing about the raster.
   */
  const describe = (from: string, fromSocket: string): string => {
    const seen = new Set<string>()
    let at = { from, fromSocket }
    for (;;) {
      const n = nodeOf(graph, at.from)
      if (!n || seen.has(n.id)) return "Compositor"
      seen.add(n.id)
      if (n.kind === "viewer") {
        const up = linkInto(graph, n.id, "image")
        if (!up) return "Viewer"
        at = { from: up.from, fromSocket: up.fromSocket }
        continue
      }
      if (n.kind === "run") return outputsOf(n, runOutputs).find((o) => o.id === at.fromSocket)?.label ?? at.fromSocket
      return title(n)
    }
  }

  /** The run raster a link carries unchanged, looking through Viewers; null past any other node. */
  const sourceOf = (from: string, fromSocket: string): CompositorGlobeOverlay["source"] => {
    const seen = new Set<string>()
    let at = { from, fromSocket }
    for (;;) {
      const n = nodeOf(graph, at.from)
      if (!n || seen.has(n.id)) return null
      seen.add(n.id)
      if (n.kind === "viewer") {
        const up = linkInto(graph, n.id, "image")
        if (!up) return null
        at = { from: up.from, fromSocket: up.fromSocket }
        continue
      }
      if (n.kind !== "run") return null
      const run = runOf(n.runId)
      const asset = run?.assets.find((a) => a.id === at.fromSocket)
      return run && asset ? { areaId: run.areaId, sceneId: asset.sceneId } : null
    }
  }
  useEffect(() => {
    if (decoding || !onGlobe) return
    onGlobe(
      sent.map((s) => ({
        key: `compositor:${s.node.id}:${s.socket}`,
        nodeId: s.node.id,
        socket: s.socket,
        source: sourceOf(s.from, s.fromSocket),
        areaId: s.areaId,
        runIds: s.runIds,
        layer: {
          id: `compositor-${s.node.id}-${s.socket}`,
          title: `${describe(s.from, s.fromSocket)} \u00b7 ${s.label}`,
          uri: dataUriOf(painted(s.value)),
          extent: s.extent,
          opacity: s.node.opacity,
          order: 10_000,
          // The graph's rasters are pixel grids, class maps among them: a
          // blend of two class colours names no class.
          pixelated: true,
          smooth: false,
          visible: true,
        },
      }))
    )
    // `sent` is rebuilt every render; its key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentKey, decoding])

  /* ---- Selection, measurement, keys ---------------------------------------- */

  const [selected, setSelected] = useState<string | null>(null)
  /** A selected link, by linkKey. One thing is selected at a time: a node or a link. */
  const [selectedLink, setSelectedLink] = useState<string | null>(null)
  const unlinkSelected = () => {
    if (!selectedLink) return
    const [to, toSocket] = selectedLink.split("\u0000")
    edit(disconnect(graph, to, toSocket))
    setSelectedLink(null)
  }

  /*
    Where nodes are while one is being dragged, written to the graph when the
    drag ends. The graph is BoardSurface's, and handing it every pointer move
    would re-render the whole board once per frame of the gesture -- which is
    why the run graph keeps its own card places beside itself too.
  */
  const [dragging, setDragging] = useState<Record<string, Place>>({})
  const draggingRef = useRef(dragging)
  draggingRef.current = dragging
  const commitDrag = () => {
    const moved = draggingRef.current
    if (!Object.keys(moved).length) return
    let g = graph
    for (const [id, at] of Object.entries(moved)) g = moveNode(g, id, at)
    edit(g)
    setDragging({})
  }
  const [heights, setHeights] = useState<Record<string, number>>({})
  const measure = (id: string, h: number) =>
    setHeights((prev) => (Math.abs((prev[id] ?? 0) - h) < 1 ? prev : { ...prev, [id]: h }))

  const api = useRef<CanvasApi | null>(null)
  const over = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const [menu, setMenu] = useState<"view" | "add" | "node" | null>(null)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)

  /* ---- Editing ------------------------------------------------------------ */

  const refuse = (kind: NodeKind): string | null =>
    kind === "run" && !runs.length ? "No run on the board to read from." : null

  /** `at`, stepped down past any node already standing there. */
  const place = (at: Place): Place => {
    let p = { x: Math.round(at.x), y: Math.round(at.y) }
    const taken = Object.values(graph.places)
    while (taken.some((q) => Math.abs(q.x - p.x) < 40 && Math.abs(q.y - p.y) < 40)) p = { ...p, y: p.y + 56 }
    return p
  }

  /**
   * Add a node. Where one is selected, the new node is set to its right and
   * fed from its first output the new node can take; otherwise it goes where
   * it was asked for, unlinked.
   */
  const add = (kind: NodeKind, at?: Place) => {
    const id = nextNodeId(graph, kind)
    let node = createNode(kind, id)
    if (node.kind === "run") node = { ...node, runId: firstClass?.run.runId ?? runs[0]?.runId ?? null }
    const sel = selected ? nodeOf(graph, selected) : undefined
    const selPlace = sel ? graph.places[sel.id] : undefined
    const where =
      at ??
      (sel && selPlace
        ? { x: selPlace.x + WIDTH[sel.kind] + 64, y: selPlace.y }
        : (() => {
            const c = api.current?.centre() ?? { x: 0, y: 0 }
            return { x: c.x - WIDTH[kind] / 2, y: c.y - GUESS_H[kind] / 2 }
          })())
    let next = addNode(graph, node, place(where))
    if (sel) {
      outer: for (const out of outputsOf(sel, runOutputs)) {
        const type = outputType(next, sel.id, out.id, runOutputs)
        for (const input of inputsOf(next, node)) {
          if (type && !input.accepts.includes(type)) continue
          const r = connect(next, { from: sel.id, fromSocket: out.id, to: id, toSocket: input.id }, runOutputs)
          if (r.ok) {
            next = r.graph
            break outer
          }
        }
      }
    }
    edit(next)
    setSelected(id)
  }

  const remove = (id: string) => {
    edit(removeNode(graph, id))
    setSelected((s) => (s === id ? null : s))
  }

  const link = (from: string, fromSocket: string, to: string, toSocket: string | null) => {
    const target = nodeOf(graph, to)
    if (!target) return
    let socket = toSocket
    if (!socket) {
      // Let go over a node's body: the first input that takes this output,
      // an empty one before one already linked.
      const type = outputType(graph, from, fromSocket, runOutputs)
      const fits = inputsOf(graph, target).filter((i) => !type || i.accepts.includes(type))
      socket = (fits.find((i) => !linkInto(graph, to, i.id)) ?? fits[0])?.id ?? null
      if (!socket) {
        notifyInfo("That link was not made", `${kindMeta(target.kind).label} has no input that takes this output.`)
        return
      }
    }
    const r = connect(graph, { from, fromSocket, to, toSocket: socket }, runOutputs)
    if (r.ok) edit(r.graph)
    else notifyInfo("That link was not made", r.reason)
  }

  /**
   * Ctrl+Shift+click: the node's outputs to the Viewer, the next one on each
   * click, as Blender's node wrangler does. A Viewer is made if there is none.
   */
  const toViewer = (id: string) => {
    const node = nodeOf(graph, id)
    if (!node || node.kind === "viewer") return
    const outs = outputsOf(node, runOutputs)
    if (!outs.length) return
    let g = graph
    let viewer = g.viewer
    if (!viewer) {
      viewer = nextNodeId(g, "viewer")
      const at = g.places[id] ?? { x: 0, y: 0 }
      g = addNode(g, createNode("viewer", viewer), place({ x: at.x + WIDTH[node.kind] + 64, y: at.y }))
    }
    const current = linkInto(g, viewer, "image")
    const next =
      current?.from === id ? (outs.findIndex((o) => o.id === current.fromSocket) + 1) % outs.length : 0
    const r = connect(g, { from: id, fromSocket: outs[next].id, to: viewer, toSocket: "image" }, runOutputs)
    if (r.ok) edit({ ...r.graph, viewer })
  }

  /*
    The keys, while the pointer is over the field: no area holds the focus in
    this studio, and the pointer is what says which one a key is for (see
    lib/operators.ts). Taken in the capture phase and marked handled, so the
    window's keymap -- which skips a handled event -- does not act on them too.
  */
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e: KeyboardEvent) => {
    if (!over.current || e.defaultPrevented || e.repeat) return
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey
    if (e.code === "KeyA" && e.shiftKey && plain) setAddAt({ ...pointer.current })
    else if ((e.code === "KeyX" || e.key === "Delete" || e.key === "Backspace") && plain && !e.shiftKey && selectedLink)
      unlinkSelected()
    else if ((e.code === "KeyX" || e.key === "Delete" || e.key === "Backspace") && plain && !e.shiftKey && selected)
      remove(selected)
    else if (e.key === "Home" && plain) api.current?.fit()
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [])

  /* ---- Drawing ------------------------------------------------------------ */

  const typeColour = (t: SocketType | null) => (t ? TYPE_COLOUR[t] : PLAIN)

  const title = (node: GraphNode): string => {
    switch (node.kind) {
      case "run":
        return runOf(node.runId)?.title ?? "Run"
      case "majority":
        return `Majority ${node.size}×${node.size}`
      case "sieve":
        return `Sieve ${INT.format(node.minPixels)} px`
      case "morphology":
        return `${node.op === "open" ? "Opening" : "Closing"} ${node.size}×${node.size}`
      default:
        return kindMeta(node.kind).label
    }
  }

  /** What a filter moved against the map it read, where both are class maps of one grid. */
  const moved = (node: GraphNode) => {
    const a = readyValue(inputOf(node.id, "classes"))
    const b = readyValue(outputOf(node.id, "classes"))
    if (a?.type !== "classes" || b?.type !== "classes") return null
    if (a.grid.width !== b.grid.width || a.grid.height !== b.grid.height) return null
    const classified = b.grid.index.reduce((s, v) => s + (v === NO_CLASS ? 0 : 1), 0)
    return { changed: changedPixels(a.grid, b.grid), classified, info: b.info }
  }
  const movedMemo = useMemo(() => {
    const out = new Map<string, ReturnType<typeof moved>>()
    for (const n of graph.nodes) if (["majority", "sieve", "morphology", "select"].includes(n.kind)) out.set(n.id, moved(n))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluation])

  /* The Change readings, counted when the evaluation changes and not on every drag. */
  const changes = useMemo(() => {
    const out = new Map<string, { reading: ChangeReading; info: ClassRaster }>()
    for (const n of graph.nodes) {
      if (n.kind !== "change") continue
      const a = readyValue(inputOf(n.id, "before"))
      const b = readyValue(inputOf(n.id, "after"))
      if (a?.type === "classes" && b?.type === "classes") out.set(n.id, { reading: classChange(a, b), info: a.info })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluation])

  const legendOf = (r: Result | undefined) => {
    const v = readyValue(r)
    return v?.type === "classes" ? v.info.legend.filter((_, i) => !v.info.excluded.includes(i)) : []
  }

  const [adopting, setAdopting] = useState<Record<string, "confirm" | "busy">>({})
  const setAdoptState = (id: string, state: "confirm" | "busy" | null) =>
    setAdopting((prev) => {
      const next = { ...prev }
      if (state) next[id] = state
      else delete next[id]
      return next
    })

  const saveFields = async (v: FieldsValue) => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: v.fields.map((f) => ({ type: "Feature", properties: f.properties, geometry: f.geometry })),
    })
    // Base64 of the UTF-8 bytes: btoa alone refuses anything outside Latin-1.
    let bin = ""
    for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
    try {
      const dest = await ExportOverlayFile(`data:application/geo+json;base64,${btoa(bin)}`, "terra_fields.geojson")
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  const body = (node: GraphNode): React.ReactNode => {
    switch (node.kind) {
      case "run": {
        const run = runOf(node.runId)
        return (
          <>
            <select
              value={run ? run.runId : ""}
              onChange={(e) => edit(updateNode(graph, { ...node, runId: e.target.value || null }))}
              className="field-input h-[1.375rem] w-full px-1 text-meta"
              title="The run whose rasters this node offers"
            >
              {!run && <option value="">{node.runId ? "Not on this board" : "Choose a run"}</option>}
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {[r.title, r.period].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
            {run?.model && <Note>{run.model}</Note>}
          </>
        )
      }

      case "majority":
      case "sieve":
      case "morphology":
      case "select": {
        const out = outputOf(node.id, "classes")
        const m = movedMemo.get(node.id)
        const legend = legendOf(inputOf(node.id, "classes"))
        return (
          <>
            {node.kind === "majority" && (
              <div className="flex items-center gap-1">
                <span className="mr-auto text-meta text-muted-foreground">Window</span>
                {WINDOW_SIZES.map((s) => (
                  <Choice
                    key={s}
                    label={`${s}×${s}`}
                    chosen={node.size === s}
                    onPick={() => edit(updateNode(graph, { ...node, size: s }))}
                  />
                ))}
              </div>
            )}
            {node.kind === "sieve" && (
              <>
                <label className="flex items-center gap-1.5 text-meta">
                  <span className="mr-auto text-muted-foreground">Smallest patch</span>
                  <input
                    type="number"
                    min={SIEVE_MIN}
                    max={SIEVE_MAX}
                    step={1}
                    value={node.minPixels}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value))
                      if (Number.isFinite(v)) {
                        edit(updateNode(graph, { ...node, minPixels: Math.min(SIEVE_MAX, Math.max(SIEVE_MIN, v)) }))
                      }
                    }}
                    className="field-input h-[1.375rem] w-16 px-1 text-right text-meta"
                  />
                  <span className="text-muted-foreground">px</span>
                </label>
                <div className="flex items-center gap-1">
                  <span className="mr-auto text-meta text-muted-foreground">Touching by</span>
                  <Choice
                    label="Edges"
                    chosen={node.connectivity === 4}
                    onPick={() => edit(updateNode(graph, { ...node, connectivity: 4 }))}
                  />
                  <Choice
                    label="Corners"
                    chosen={node.connectivity === 8}
                    onPick={() => edit(updateNode(graph, { ...node, connectivity: 8 }))}
                  />
                </div>
              </>
            )}
            {node.kind === "morphology" && (
              <>
                <div className="flex items-center gap-1">
                  <Choice
                    label="Open"
                    chosen={node.op === "open"}
                    onPick={() => edit(updateNode(graph, { ...node, op: "open" }))}
                  />
                  <Choice
                    label="Close"
                    chosen={node.op === "close"}
                    onPick={() => edit(updateNode(graph, { ...node, op: "close" }))}
                  />
                  <span className="ml-auto" />
                  {WINDOW_SIZES.map((s) => (
                    <Choice
                      key={s}
                      label={`${s}×${s}`}
                      chosen={node.size === s}
                      onPick={() => edit(updateNode(graph, { ...node, size: s }))}
                    />
                  ))}
                </div>
                <select
                  value={node.classId ?? ""}
                  disabled={!legend.length}
                  onChange={(e) =>
                    edit(
                      updateNode(graph, {
                        ...node,
                        classId: e.target.value === "" ? null : Number(e.target.value),
                      })
                    )
                  }
                  className="field-input h-[1.375rem] w-full px-1 text-meta"
                  title={node.op === "open" ? "The class whose narrow parts are removed" : "The class whose narrow gaps are filled"}
                >
                  <option value="">{legend.length ? "Choose a class" : "No class map yet"}</option>
                  {legend.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {node.kind === "select" &&
              (legend.length ? (
                <div className="flex flex-col gap-0.5">
                  {legend.map((e) => {
                    const on = node.keep.includes(e.id)
                    return (
                      <button
                        key={e.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          edit(
                            updateNode(graph, {
                              ...node,
                              keep: on ? node.keep.filter((k) => k !== e.id) : [...node.keep, e.id],
                            })
                          )
                        }
                        className="flex items-center gap-1.5 rounded-sm px-1 py-[2px] text-left text-meta hover:bg-hover"
                      >
                        <span
                          aria-hidden
                          className="grid size-2.5 shrink-0 place-items-center rounded-[2px]"
                          style={{ boxShadow: "inset 0 0 0 1px rgb(var(--p-line-strong))" }}
                        >
                          {on && <span className="size-1.5 rounded-[1px]" style={{ background: "var(--b-lit)" }} />}
                        </span>
                        <Swatch color={e.color} />
                        <span className={on ? "truncate text-foreground" : "truncate text-muted-foreground"}>
                          {e.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : null)}
            <StatusNote result={out} />
            {m && (
              <Figure label="Changed" value={`${share(m.changed, m.classified)} · ${ground(m.changed, m.info)}`} />
            )}
          </>
        )
      }

      case "mask":
        return <StatusNote result={outputOf(node.id, "raster")} />

      case "mix":
        return (
          <>
            <label className="flex items-center gap-2 text-meta">
              <span className="text-muted-foreground">Opacity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={node.opacity}
                onChange={(e) => edit(updateNode(graph, { ...node, opacity: Number(e.target.value) }))}
                className="min-w-0 flex-1 accent-[var(--b-lit)]"
              />
              <span className="telemetry w-8 text-right text-foreground">{Math.round(node.opacity * 100)}%</span>
            </label>
            <StatusNote result={outputOf(node.id, "image")} />
          </>
        )

      case "areas": {
        const r = inputOf(node.id, "classes")
        const v = readyValue(r)
        return v?.type === "classes" ? <AreasReading value={v} /> : <StatusNote result={r} />
      }

      case "change": {
        const c = changes.get(node.id)
        if (c) return <ChangeReadingView reading={c.reading} info={c.info} />
        const a = inputOf(node.id, "before")
        return <StatusNote result={a?.status === "ready" ? inputOf(node.id, "after") : a} />
      }

      case "fieldFilter": {
        const out = readyFields(outputOf(node.id, "fields"))
        const pct = (x: number) => `${Math.round(x * 100)}%`
        return (
          <>
            <NumberField
              label="Min. area"
              value={node.minHa}
              min={0}
              max={1000}
              step={0.5}
              format={(x) => `${x.toFixed(1)} ha`}
              parse={(t) => {
                const x = Number(t.replace("ha", "").replace(",", ".").trim())
                return Number.isFinite(x) ? x : null
              }}
              onChange={(x) => edit(updateNode(graph, { ...node, minHa: Math.max(0, x) }))}
            />
            <NumberField
              label="Min. cropland"
              value={node.minCropland}
              min={0}
              max={1}
              step={0.05}
              format={pct}
              parse={(t) => {
                const x = Number(t.replace("%", "").replace(",", ".").trim())
                return Number.isFinite(x) ? x / 100 : null
              }}
              onChange={(x) => edit(updateNode(graph, { ...node, minCropland: Math.min(1, Math.max(0, x)) }))}
            />
            {out ? (
              <Figure label="Kept" value={`${INT.format(out.fields.length)} of ${INT.format(out.total)}`} />
            ) : (
              <StatusNote result={outputOf(node.id, "fields")} />
            )}
          </>
        )
      }

      case "adoptFields": {
        const r = inputOf(node.id, "fields")
        const v = readyFields(r)
        if (!v) return <StatusNote result={r} />
        const target = fieldsTargetOf?.(v.runId) ?? null
        if (!target || !onAdoptFields) {
          return <Note>Only a saved delineation over a saved area can make its fields.</Note>
        }
        const state = adopting[node.id]
        const n = v.fields.length
        const go = async (replace: boolean) => {
          setAdoptState(node.id, "busy")
          const done = await onAdoptFields(v.runId, v.minHa, v.minCropland, replace)
          setAdoptState(node.id, done ? null : replace ? "confirm" : null)
        }
        if (state === "confirm") {
          return (
            <>
              <Note>
                {`${target.name} holds ${target.adopted} fields from an earlier delineation`}
                {target.adoptedWithRuns ? `, ${target.adoptedWithRuns} with runs of their own` : ""}
                {". Replacing removes them; fields drawn by hand stay."}
              </Note>
              <div className="flex gap-1">
                <ActionButton label="Replace" icon={<Polygon className="size-3.5" />} onClick={() => void go(true)} />
                <Choice label="Cancel" chosen={false} onPick={() => setAdoptState(node.id, null)} />
              </div>
            </>
          )
        }
        return (
          <>
            <Figure label="Into" value={target.name} />
            <ActionButton
              label={`Make ${INT.format(n)} fields`}
              icon={<Polygon className="size-3.5" />}
              busy={state === "busy"}
              disabled={!n}
              onClick={() => (target.adopted > 0 ? setAdoptState(node.id, "confirm") : void go(false))}
            />
          </>
        )
      }

      case "saveFields": {
        const r = inputOf(node.id, "fields")
        const v = readyFields(r)
        if (!v) return <StatusNote result={r} />
        return (
          <ActionButton
            label={`GeoJSON, ${INT.format(v.fields.length)} fields`}
            icon={<DownloadSimple className="size-3.5" />}
            disabled={!v.fields.length}
            onClick={() => void saveFields(v)}
          />
        )
      }

      case "viewer": {
        const r = inputOf(node.id, "image")
        const v = readyValue(r)
        if (!v) return <StatusNote result={r} />
        const image = painted(v)
        const inner = WIDTH.viewer - 20
        return (
          <>
            <RasterCanvas
              image={image}
              style={{
                width: inner,
                height: Math.min(260, Math.round((inner * image.height) / Math.max(1, image.width))),
                background: "rgb(var(--p-line) / 0.12)",
                borderRadius: 2,
              }}
            />
            <Figure label="Grid" value={`${image.width} \u00d7 ${image.height} px`} />
          </>
        )
      }

      case "globe": {
        const layers = inputsOf(graph, node).filter((i) => linkInto(graph, node.id, i.id))
        const values = layers.map((i) => ({ input: i, result: inputOf(node.id, i.id) }))
        const unplaced = values.filter((x) => {
          const v = readyValue(x.result)
          return v && (!v.extent || isZeroExtent(v.extent))
        })
        const waiting = values.find((x) => x.result?.status !== "ready")
        return (
          <>
            <label className="flex items-center gap-2 text-meta">
              <span className="text-muted-foreground">Opacity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={node.opacity}
                onChange={(e) => edit(updateNode(graph, { ...node, opacity: Number(e.target.value) }))}
                className="min-w-0 flex-1 accent-[var(--b-lit)]"
              />
              <span className="telemetry w-8 text-right text-foreground">{Math.round(node.opacity * 100)}%</span>
            </label>
            {!layers.length ? (
              <Note>Link a raster to a layer. Each layer is drawn over the one above it in this list.</Note>
            ) : (
              <>
                <Figure label="Layers" value={String(layers.length - unplaced.length)} />
                {waiting && <StatusNote result={waiting.result} />}
                {unplaced.map((x) => (
                  <Note key={x.input.id}>{x.input.label} has no extent to place it by, so it is not drawn.</Note>
                ))}
                <Note>
                  Drawn in every Globe area, Layer 1 lowest; the Globe's spread sets how far apart they stand.
                </Note>
              </>
            )}
          </>
        )
      }
    }
  }

  const socketNodes: SocketNode[] = graph.nodes.map((node) => {
    const meta = kindMeta(node.kind)
    const p = paint(meta.category)
    let outs = outputsOf(node, runOutputs).map<SocketRow>((o) => ({
      id: o.id,
      label: o.label,
      colour: typeColour(outputType(graph, node.id, o.id, runOutputs)),
    }))
    if (node.kind === "run") {
      // Links out of a run whose raster is gone keep a row, so they can be seen and pulled off.
      for (const l of graph.links) {
        if (l.from === node.id && !outs.some((o) => o.id === l.fromSocket)) {
          outs = [...outs, { id: l.fromSocket, label: `${l.fromSocket} (missing)`, colour: PLAIN }]
        }
      }
    }
    const busy =
      node.kind === "run" &&
      graph.links.some((l) => l.from === node.id && outputOf(node.id, l.fromSocket)?.status === "busy")
    return {
      id: node.id,
      place: dragging[node.id] ?? graph.places[node.id] ?? { x: 0, y: 0 },
      w: WIDTH[node.kind],
      h: heights[node.id] ?? GUESS_H[node.kind],
      head: p.head,
      lit: { band: p.band, ink: p.ink },
      selected: selected === node.id,
      status: busy ? "busy" : undefined,
      outputs: outs,
      inputs: inputsOf(graph, node).map((i) => ({
        id: i.id,
        label: i.label,
        colour: TYPE_COLOUR[i.accepts.includes("fields") ? "fields" : i.accepts.includes("image") ? "image" : "classes"],
        linked: !!linkInto(graph, node.id, i.id),
      })),
      header: (
        <>
          <Head label={title(node)} />
          <button
            type="button"
            aria-label={`Remove ${title(node)}`}
            title="Remove (X)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => remove(node.id)}
            className="grid size-4 shrink-0 place-items-center rounded-sm opacity-70 hover:bg-hover hover:opacity-100"
          >
            <X className="size-2.5" weight="bold" />
          </button>
        </>
      ),
      children: body(node),
    }
  })

  const socketLinks: SocketLink[] = graph.links.map((l) => {
    const r = inputOf(l.to, l.toSocket)
    return {
      ...l,
      colour: typeColour(outputType(graph, l.from, l.fromSocket, runOutputs)),
      state: r?.status === "ready" ? "ok" : r?.status === "failed" ? "failed" : "pending",
    }
  })

  const addGroups = (onPick: (kind: NodeKind) => void) =>
    CATEGORIES.map((c) => (
      <StudioMenuGroup key={c.id} label={c.label}>
        {NODE_KINDS.filter((k) => k.category === c.id).map((k) => (
          <StudioMenuItem
            key={k.kind}
            label={k.label}
            title={refuse(k.kind) ?? k.hint}
            disabled={!!refuse(k.kind)}
            onSelect={() => onPick(k.kind)}
          />
        ))}
      </StudioMenuGroup>
    ))

  return (
    <>
      <AreaHeaderMenus>
        <StudioPopover
          open={menu === "view"}
          onOpenChange={(o) => setMenu(o ? "view" : null)}
          surface={surface}
          trigger={(p) => <StudioHeaderMenu {...p} label="View" />}
        >
          <StudioMenuItem
            label="Frame all"
            note="Home"
            onSelect={() => {
              api.current?.fit()
              setMenu(null)
            }}
          />
        </StudioPopover>
        <StudioPopover
          open={menu === "add"}
          onOpenChange={(o) => setMenu(o ? "add" : null)}
          surface={surface}
          widthRem={20}
          trigger={(p) => <StudioHeaderMenu {...p} label="Add" />}
        >
          <AddCascade
            refuse={refuse}
            onPick={(kind) => {
              add(kind)
              setMenu(null)
            }}
          />
        </StudioPopover>
        <StudioPopover
          open={menu === "node"}
          onOpenChange={(o) => setMenu(o ? "node" : null)}
          surface={surface}
          widthRem={15}
          trigger={(p) => <StudioHeaderMenu {...p} label="Node" />}
        >
          <StudioMenuItem
            label={selectedLink ? "Remove link" : "Remove"}
            note="X"
            disabled={!selected && !selectedLink}
            onSelect={() => {
              if (selectedLink) unlinkSelected()
              else if (selected) remove(selected)
              setMenu(null)
            }}
          />
          <StudioMenuItem
            label="Link to Viewer"
            note="Ctrl+Shift+click"
            disabled={!selected || nodeOf(graph, selected)?.kind === "viewer"}
            onSelect={() => {
              if (selected) toViewer(selected)
              setMenu(null)
            }}
          />
          <StudioMenuRule />
          <StudioMenuItem
            label="Clear the graph"
            disabled={!graph.nodes.length}
            onSelect={() => {
              edit(EMPTY_GRAPH)
              setSelected(null)
              setMenu(null)
            }}
          />
        </StudioPopover>
      </AreaHeaderMenus>

      <StudioContextMenu at={addAt} surface={surface} title="Add" onClose={() => setAddAt(null)}>
        {addGroups((kind) => {
          const at = addAt ? api.current?.toBoard(addAt.x, addAt.y) : undefined
          add(kind, at)
          setAddAt(null)
        })}
      </StudioContextMenu>

      <div
        className="h-full w-full"
        onPointerEnter={() => (over.current = true)}
        onPointerLeave={() => (over.current = false)}
        onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      >
        {graph.nodes.length ? (
          <SocketCanvas
            nodes={socketNodes}
            links={socketLinks}
            onMove={(id, at) => setDragging((prev) => ({ ...prev, [id]: at }))}
            onMoveEnd={commitDrag}
            onMeasure={measure}
            onLink={link}
            onUnlink={(to, toSocket) => edit(disconnect(graph, to, toSocket))}
            onSelect={(id, mods) => {
              setSelected(id)
              setSelectedLink(null)
              if (id && mods.ctrl && mods.shift) toViewer(id)
            }}
            selectedLink={selectedLink}
            onSelectLink={(to, toSocket) => {
              setSelectedLink(linkKey(to, toSocket))
              setSelected(null)
            }}
            apiRef={api}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4" style={{ background: "var(--s-field)" }}>
            <p className="max-w-[26rem] text-center text-meta leading-relaxed text-muted-foreground">
              {runs.length
                ? "The graph is empty. Add a Run node from the Add menu, or press Shift+A over this area."
                : "No run on the board. A run added to the board offers its rasters here, one output each."}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
