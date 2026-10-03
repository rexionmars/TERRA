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
import { CaretLeft, CaretRight, DownloadSimple, Polygon, X } from "@phosphor-icons/react"
import { NumberField } from "@/components/ui/NumberField"
import { parseFields, type FieldsTarget } from "@/lib/fields"
import type { FieldsAnalysis, MineralAnalysis, PredictResult } from "@/lib/types"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import { ExportOverlayFile, ExportPDFReport, GetAppVersion } from "../../../wailsjs/go/main/App"
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
import { ActionButton, Figure, Note, StatusNote, Swatch } from "./nodeParts"
import { MineralNodeBody, mineralNodeTitle } from "./mineralNodes"
import { FieldTableCard, HealthCard, SeasonCard } from "./fieldNodes"
import { PdfReportCard } from "./pdfReportNodes"
import { OverlapCard } from "./overlapNodes"
import { RadarCard } from "./radarNodes"
import { ZonesCard } from "./zonesNodes"
import { chosenPartition, zonesGeoJSON } from "@/lib/zones"
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
  HEALTH_SOCKET,
  inputsOf,
  MINERAL_SOCKET,
  OVERLAP_SOCKET,
  RADAR_SOCKET,
  SEASON_SOCKET,
  ZONES_SOCKET,
  kindMeta,
  linkInto,
  moveNode,
  nextNodeId,
  NODE_KINDS,
  nodeOf,
  pdfReportMaps,
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
  isRaster,
  opaqueRGBA,
  paintValue,
  socketKey,
  sumClassAreas,
  type ChangeReading,
  type Evaluation,
  type ClassValue,
  type FieldsValue,
  type HealthValue,
  type ImageValue,
  type MineralValue,
  type OverlapValue,
  type RadarValue,
  type RasterValue,
  type ZonesValue,
  type Result,
  type SeasonValue,
} from "@/lib/compositorEval"
import { seasonOf } from "@/lib/season"
import { fieldRow, fieldTableCsv } from "@/lib/fieldTable"
import type { LayerLegend } from "@/lib/layerLegend"
import { buildPdfReport, mapSource, productsIn, type PdfReportFigure, type PdfReportRun } from "@/lib/pdfReport"
import type { AssetRun, ClassRaster } from "@/lib/runAssets"
import { isZeroExtent, type RasterLayer } from "@/lib/mapLayers"
import { arrange } from "@/lib/compositorLayout"
import { perField, resolveEach, runKindProduct, setOf, type FieldMember, type FieldSet } from "@/lib/fieldSets"
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
  pdfReport: 300,
  seasonDates: 340,
  health: 330,
  fieldTable: 380,
  overlap: 340,
  radar: 330,
  zones: 330,
  mineralCoverage: 300,
  mineralClasses: 320,
  mineralReferences: 340,
  mineralPasses: 330,
  mineralCover: 280,
  mineralPositions: 340,
  mineralAcid: 320,
  mineralConfidence: 280,
  mineralAgreement: 340,
  mineralSave: 200,
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
  pdfReport: 380,
  seasonDates: 280,
  health: 280,
  fieldTable: 300,
  overlap: 300,
  radar: 320,
  zones: 320,
  mineralCoverage: 240,
  mineralClasses: 260,
  mineralReferences: 280,
  mineralPasses: 200,
  mineralCover: 200,
  mineralPositions: 220,
  mineralAcid: 180,
  mineralConfidence: 200,
  mineralAgreement: 240,
  mineralSave: 90,
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
  // The mineral map's readings are readings, and are drawn as Analysis is.
  mineral: "value",
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
  // A mineral map's figures, in the mineral map's kind colour.
  mineral: "rgb(var(--p-kind-mineral))",
  // A classification's season, and a health run's report (index.css).
  season: "rgb(var(--p-kind-season))",
  health: "rgb(var(--p-kind-health))",
  // An overlap run's registers, in its kind colour (index.css).
  overlap: "rgb(var(--p-kind-overlap))",
  radar: "rgb(var(--p-kind-radar))",
  zones: "rgb(var(--p-kind-zones))",
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

/*
  A Class areas node under a field set: the field in focus, or every field's
  classes summed -- the figure a field set is for, since the areas of one field
  are already the node's reading when it is fed a single run.
*/
function AreasCard({
  value,
  fields,
}: {
  value: ClassValue | null
  fields: { values: ClassValue[]; count: number; waiting: number } | null
}) {
  const [all, setAll] = useState(true)
  if (!fields) return value ? <AreasReading value={value} /> : null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Choice label={`All ${fields.count} fields`} chosen={all} onPick={() => setAll(true)} />
        <Choice label="This field" chosen={!all} onPick={() => setAll(false)} />
      </div>
      {all ? (
        <SummedReading values={fields.values} count={fields.count} waiting={fields.waiting} />
      ) : value ? (
        <AreasReading value={value} />
      ) : (
        <Note>The field in focus has no class map here.</Note>
      )}
    </div>
  )
}

/** Every field's classes summed; see sumClassAreas for how classes meet. */
function SummedReading({ values, count, waiting }: { values: ClassValue[]; count: number; waiting: number }) {
  const { rows, total, unit } = useMemo(() => sumClassAreas(values), [values])
  const top = rows[0]?.amount ?? 1
  const amount = (x: number) => (unit === "ha" ? hectares(x) : INT.format(x))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_auto_auto] items-center gap-x-2 gap-y-1 text-meta">
        <span className="text-micro text-muted-foreground">Class</span>
        <span />
        <span className="text-right text-micro text-muted-foreground">{unit === "ha" ? "Area (ha)" : "Pixels"}</span>
        <span className="text-right text-micro text-muted-foreground">Share</span>
        {rows.map(({ entry, amount: a }) => (
          <div key={`${entry.name}:${entry.color}`} className="contents">
            <span className="flex min-w-0 items-center gap-1.5">
              <Swatch color={entry.color} />
              <span className="truncate text-foreground" title={entry.name}>
                {entry.name}
              </span>
            </span>
            <span className="h-1.5 rounded-full" style={{ background: "rgb(var(--p-line) / 0.25)" }}>
              <span className="block h-full rounded-full" style={{ width: `${(a / top) * 100}%`, background: "var(--b-lit)" }} />
            </span>
            <span className="telemetry text-right text-foreground">{amount(a)}</span>
            <span className="telemetry text-right text-muted-foreground">{share(a, total)}</span>
          </div>
        ))}
      </div>
      <Figure
        label="Fields read"
        value={`${values.length} of ${count}${unit === "ha" ? ` · ${hectares(total)} ha` : ""}`}
      />
      {waiting > 0 && <Note>{waiting} still decoding; the sum grows as they arrive.</Note>}
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
  /**
   * What its colours mean, where the graph can say: a class map's classes as
   * they reach the Globe node, after whatever filters and masks it passed
   * through, with each one's share. Null for an image, whose colours no node
   * publishes. A raster drawn unchanged (`source`) takes its plane's legend
   * instead, which carries the run's own figures.
   */
  legend: LayerLegend | null
}

/** A class map's classes as a legend: those present, largest first, with their shares. */
function classLegend(v: ClassValue, subject: string): LayerLegend {
  const { rows, total } = classAreas(v)
  const cell = v.info.pixelAreaHa
  return {
    kind: "classes",
    subject,
    entries: rows.map((r) => ({
      name: r.entry.name,
      color: r.entry.color,
      pct: total > 0 ? (100 * r.px) / total : undefined,
      areaHa: cell != null ? r.px * cell : undefined,
    })),
  }
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

const NO_SETS: readonly FieldSet[] = []

/** A field set as a choice of the Run node's list: area and product, joined. */
const setChoice = (areaId: string, runKind: string) => `each:${areaId}|${runKind}`

export function CompositorEditor({
  runs,
  graph: stored,
  onChange,
  onGlobe,
  surface,
  fieldsOf,
  fieldsTargetOf,
  onAdoptFields,
  mineralOf,
  fieldSets = NO_SETS,
  onNeedRuns,
  resultOf,
  runRecordOf,
}: {
  /**
   * A run as the store recorded it -- kind, model, period, when it was made --
   * for the PDF report's method and reproducibility sections; null for a run
   * the store has no record of.
   */
  runRecordOf?: (runId: string) => PdfReportRun | null
  /**
   * A run's whole result, for the outputs that are not rasters: a
   * classification's Season and a vegetation health run's Health report.
   */
  resultOf?: (runId: string) => PredictResult | null
  /**
   * Every field set the catalogue offers (lib/fieldSets.ts): a Run node can
   * stand for every field of an area instead of one run.
   */
  fieldSets?: readonly FieldSet[]
  /**
   * Runs a field set reads that the board does not hold yet. The board loads
   * them; their rasters are decoded here, as any run's are.
   */
  onNeedRuns?: (runIds: string[]) => void
  /**
   * A run's mineral map, where it is one. Its figures are the Run node's
   * Mineral report output, which the Mineral nodes read.
   */
  mineralOf?: (runId: string) => MineralAnalysis | null
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
        `mineral:${mineralOf?.(r.runId)?.observed_cells ?? 0}:${mineralOf?.(r.runId)?.layers?.length ?? 0}`,
        `season:${resultOf?.(r.runId)?.vi_series?.length ?? 0}`,
        `health:${resultOf?.(r.runId)?.health?.anomaly.length ?? -1}`,
        `overlap:${resultOf?.(r.runId)?.overlap?.read_at ?? ""}`,
        `radar:${resultOf?.(r.runId)?.radar?.series.length ?? -1}`,
        `zones:${resultOf?.(r.runId)?.zones?.partitions.length ?? -1}`,
        ...r.assets.map((a) => `${a.id}:${a.title}:${a.previewUri.length}:${a.classes ? 1 : 0}`),
      ].join("\u0000")
    )
    .join("|")
  const runsRef = useRef(runs)
  runsRef.current = runs

  const runOf = (runId: string | null) => runsRef.current.find((r) => r.runId === runId)
  const fieldsOfRun = (runId: string | null) => (runId && fieldsOf ? fieldsOf(runId) : null)
  const mineralOfRun = (runId: string | null) => (runId && mineralOf ? mineralOf(runId) : null)
  const resultOfRun = (runId: string | null) => (runId && resultOf ? resultOf(runId) : null)
  /** Whether a run carries a season to read: a classification's series and its peak. */
  const hasSeason = (runId: string | null) => {
    const r = resultOfRun(runId)
    return !!r && !r.health && (r.vi_series?.length ?? 0) > 0 && r.phenology?.pos_doy != null
  }
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
    // A mineral map's figures, beside its rasters.
    ...(runOf(runId) && mineralOfRun(runId)
      ? [{ id: MINERAL_SOCKET, label: "Mineral report", type: "mineral" as SocketType }]
      : []),
    // A classification's series as dates, beside its rasters.
    ...(runOf(runId) && hasSeason(runId)
      ? [{ id: SEASON_SOCKET, label: "Season", type: "season" as SocketType }]
      : []),
    // A health run's figures against earlier seasons.
    ...(runOf(runId) && resultOfRun(runId)?.health
      ? [{ id: HEALTH_SOCKET, label: "Health report", type: "health" as SocketType }]
      : []),
    // An overlap run's registers, as read under the area.
    ...(runOf(runId) && resultOfRun(runId)?.overlap
      ? [{ id: OVERLAP_SOCKET, label: "Overlap report", type: "overlap" as SocketType }]
      : []),
    // A radar run's series by orbit and its canopy losses.
    ...(runOf(runId) && resultOfRun(runId)?.radar
      ? [{ id: RADAR_SOCKET, label: "Radar report", type: "radar" as SocketType }]
      : []),
    // A zones run's partitions.
    ...(runOf(runId) && resultOfRun(runId)?.zones
      ? [{ id: ZONES_SOCKET, label: "Zones report", type: "zones" as SocketType }]
      : []),
  ]

  const firstClass = runs.flatMap((r) => r.assets.filter((a) => a.classes).map((a) => ({ run: r, asset: a })))[0]
  /*
    The field sets by what decides their runs. Rebuilt by the board on every
    render, so the graph is keyed on this rather than on the list.
  */
  const setsKey = fieldSets
    .map((f) => `${f.areaId}:${f.runKind}:${f.members.map((m) => `${m.fieldId}=${m.runId}`).join(",")}`)
    .join("|")
  const setsRef = useRef(fieldSets)
  setsRef.current = fieldSets
  /*
    Field-set nodes pointed at the run of their field in focus, before
    anything reads them: a set node is then a Run node like any other to
    every rule below.
  */
  const graph = useMemo<CompositorGraph>(
    () =>
      resolveEach(
        stored ?? (firstClass ? defaultGraph(firstClass.run.runId, firstClass.asset.id) : EMPTY_GRAPH),
        setsRef.current
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, firstClass?.run.runId, firstClass?.asset.id, setsKey]
  )
  /** The graph once per field, where a Run node stands for a field set. */
  const fieldGraphs = useMemo(
    () => perField(graph, setsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, setsKey]
  )
  const edit = (next: CompositorGraph) => onChange(next)

  // The runs a field set reads and the board does not hold, asked for once each.
  const asked = useRef(new Set<string>())
  const missing = graph.nodes
    .flatMap((n) => setOf(fieldSets, n)?.members ?? [])
    .map((m) => m.runId)
    .filter((id) => !runs.some((r) => r.runId === id) && !asked.current.has(id))
  const missingKey = missing.join(",")
  useEffect(() => {
    if (!missing.length || !onNeedRuns) return
    for (const id of missing) asked.current.add(id)
    onNeedRuns(missing)
    // `missing` is rebuilt every render; its key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey])

  /* ---- The rasters Run nodes offer, decoded once each ------------------ */

  const [decoded, setDecoded] = useState<Record<string, { uri: string; result: Result }>>({})
  const decodedRef = useRef(decoded)
  decodedRef.current = decoded
  const token = useRef(1)

  // Only the outputs something reads: a run carries a true-colour scene and a
  // composition or two, and decoding those unasked would be most of the work.
  // A field set's, for every field.
  const needed = [graph, ...(fieldGraphs ?? []).map((f) => f.graph)].flatMap((g) =>
    g.links.flatMap((l) => {
      const node = nodeOf(g, l.from)
      if (node?.kind !== "run" || !node.runId) return []
      const asset = runOf(node.runId)?.assets.find((a) => a.id === l.fromSocket)
      return asset ? [{ runId: node.runId, asset }] : []
    })
  )
  const neededKey = [...new Set(needed.map((n) => `${n.runId}:${n.asset.id}:${n.asset.previewUri.length}`))].join("|")

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
            settle({
              status: "ready",
              // Opaque, so the Viewer shows what the Globe node draws (opaqueRGBA).
              value: { type: "image", key: valueKey, ...img, rgba: opaqueRGBA(img.rgba), extent: asset.extent },
            })
          )
          .catch(() => settle({ status: "failed", note: "The raster could not be decoded." }))
      }
    }
    // `needed` is rebuilt every render; its key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey])

  /* ---- Evaluation --------------------------------------------------------- */

  const cache = useRef(new Map<string, RasterValue>())
  /*
    The graph as shown, and once per field where a Run node stands for a field
    set. One cache for all of them, keyed as ever by source and steps: the
    field in focus is computed once whichever evaluation asks first.
  */
  const { evaluation, fieldEvaluations } = useMemo(() => {
    const ctx = {
      source: (runId: string, assetId: string): Result => {
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
        if (assetId === SEASON_SOCKET) {
          const r = resultOfRun(runId)
          if (!r || !hasSeason(runId)) return { status: "none", note: "That run carries no season series." }
          return {
            status: "ready",
            value: {
              type: "season",
              key: `season:${runId}:${r.vi_series?.length ?? 0}`,
              runId,
              season: seasonOf(r),
              meanConfidence: r.mean_confidence > 0 ? r.mean_confidence : null,
            },
          }
        }
        if (assetId === HEALTH_SOCKET) {
          const h = resultOfRun(runId)?.health
          if (!h) return { status: "none", note: "That run is not a vegetation health run." }
          return {
            status: "ready",
            value: { type: "health", key: `health:${runId}:${h.anomaly.length}:${h.map_date}`, runId, report: h },
          }
        }
        if (assetId === ZONES_SOCKET) {
          const mz = resultOfRun(runId)?.zones
          if (!mz) return { status: "none", note: "That run is not a management zones run." }
          return {
            status: "ready",
            value: { type: "zones", key: `zones:${runId}:${mz.partitions.length}:${mz.suggested_k}`, runId, report: mz },
          }
        }
        if (assetId === RADAR_SOCKET) {
          const s1 = resultOfRun(runId)?.radar
          if (!s1) return { status: "none", note: "That run is not a Sentinel-1 radar run." }
          return {
            status: "ready",
            value: { type: "radar", key: `radar:${runId}:${s1.series.length}:${s1.map_date}`, runId, report: s1 },
          }
        }
        if (assetId === OVERLAP_SOCKET) {
          const o = resultOfRun(runId)?.overlap
          if (!o) return { status: "none", note: "That run is not a socio-environmental overlap run." }
          return {
            status: "ready",
            value: { type: "overlap", key: `overlap:${runId}:${o.read_at}`, runId, report: o },
          }
        }
        if (assetId === MINERAL_SOCKET) {
          const m = mineralOfRun(runId)
          if (!m) return { status: "none", note: "That run is not a mineral map." }
          return {
            status: "ready",
            value: { type: "mineral", key: `mineral:${runId}:${m.observed_cells}`, runId, analysis: m },
          }
        }
        if (!run.assets.some((a) => a.id === assetId)) {
          return { status: "none", note: "That run has no such raster." }
        }
        return decoded[`${runId}\u0000${assetId}`]?.result ?? { status: "busy" }
      },
      cache: cache.current,
    }
    const e = evaluate(graph, ctx)
    const each: { member: FieldMember; graph: CompositorGraph; evaluation: Evaluation }[] | null =
      fieldGraphs?.map((f) => ({ ...f, evaluation: evaluate(f.graph, ctx) })) ?? null
    const used = new Set(e.used)
    for (const f of each ?? []) for (const k of f.evaluation.used) used.add(k)
    for (const k of [...cache.current.keys()]) if (!used.has(k)) cache.current.delete(k)
    return { evaluation: e, fieldEvaluations: each }
    // Places are left out on purpose: moving a node computes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, graph.links, decoded, runsKey, fieldGraphs])

  const outputOf = (node: string, socket: string) => evaluation.outputs.get(socketKey(node, socket))
  const inputOf = (node: string, socket: string) => evaluation.inputs.get(socketKey(node, socket))
  /** A ready raster, or null -- for fields and mineral figures as well, which are no raster. */
  const readyValue = (r: Result | undefined): RasterValue | null =>
    r?.status === "ready" && isRaster(r.value) ? r.value : null
  /** Ready mineral figures, or null. */
  const readyMineral = (r: Result | undefined): MineralValue | null =>
    r?.status === "ready" && r.value.type === "mineral" ? r.value : null
  /** Ready fields, or null. */
  const readyFields = (r: Result | undefined): FieldsValue | null =>
    r?.status === "ready" && r.value.type === "fields" ? r.value : null
  const readySeason = (r: Result | undefined): SeasonValue | null =>
    r?.status === "ready" && r.value.type === "season" ? r.value : null
  const readyHealth = (r: Result | undefined): HealthValue | null =>
    r?.status === "ready" && r.value.type === "health" ? r.value : null
  const readyOverlap = (r: Result | undefined): OverlapValue | null =>
    r?.status === "ready" && r.value.type === "overlap" ? r.value : null
  const readyRadar = (r: Result | undefined): RadarValue | null =>
    r?.status === "ready" && r.value.type === "radar" ? r.value : null
  const readyZones = (r: Result | undefined): ZonesValue | null =>
    r?.status === "ready" && r.value.type === "zones" ? r.value : null
  const readyClasses = (r: Result | undefined): ClassValue | null =>
    r?.status === "ready" && r.value.type === "classes" ? r.value : null

  /*
    What reaches one input of a node in every field's evaluation, under a
    field set; null without one. The cards that answer for all fields read it.
  */
  const perFieldInput = (nodeId: string, socket: string) =>
    fieldEvaluations?.map((f) => ({
      member: f.member,
      result: f.evaluation.inputs.get(socketKey(nodeId, socket)),
    })) ?? null

  /** One row per field of the Field table, or the one run's where there is no set. */
  const tableRows = (nodeId: string) => {
    const each = fieldEvaluations
    const row = (name: string, inputs: (socket: string) => Result | undefined) =>
      fieldRow(
        name,
        readyClasses(inputs("classes")),
        readySeason(inputs("season")),
        readyHealth(inputs("health"))?.report ?? null,
        readyOverlap(inputs("overlap"))?.report ?? null,
        readyRadar(inputs("radar"))?.report ?? null,
        readyZones(inputs("zones"))?.report ?? null
      )
    if (each) {
      return each.map((f) => row(f.member.fieldName, (socket) => f.evaluation.inputs.get(socketKey(nodeId, socket))))
    }
    const runIds = runsFeeding(nodeId)
    const name = runOf(runIds[0] ?? null)?.title ?? "Run"
    return [row(name, (socket) => inputOf(nodeId, socket))]
  }

  /*
    THE PDF REPORT. Its rows are the Field table's (tableRows), so the report
    and the table cannot disagree; its maps are the rasters that reach Map 1
    and Map 2 as the Viewer would draw them. The runs it lists are every run
    that feeds it, in every field's evaluation under a field set.
  */
  const [reportBusy, setReportBusy] = useState<string | null>(null)
  const reportRuns = (nodeId: string): string[] => {
    const ids = new Set<string>(runsFeeding(nodeId))
    for (const f of fieldEvaluations ?? []) for (const id of runsFeeding(nodeId, f.graph)) ids.add(id)
    return [...ids]
  }
  /** The field set the graph reads, and the field in focus; null for plain runs. */
  const reportSet = () => {
    if (!fieldEvaluations) return null
    const each = graph.nodes.find((n): n is Extract<GraphNode, { kind: "run" }> => n.kind === "run" && !!n.each)?.each
    const set = each ? fieldSets.find((x) => x.areaId === each.areaId && x.runKind === each.runKind) : undefined
    if (!each || !set) return null
    const focus = set.members.find((m) => m.fieldId === each.fieldId) ?? set.members[0]
    return { areaName: set.areaName, focus: focus?.fieldName ?? null }
  }
  /** What a linked input carries, named by the output it comes from. */
  const sourceLabel = (nodeId: string, socket: string): string => {
    const l = linkInto(graph, nodeId, socket)
    if (!l) return ""
    const from = nodeOf(graph, l.from)
    if (from?.kind === "run") return runOutputs(from.runId).find((o) => o.id === l.fromSocket)?.label ?? "Raster"
    return from ? kindMeta(from.kind).label : "Raster"
  }
  const reportFigures = (node: GraphNode, subject: string): PdfReportFigure[] =>
    pdfReportMaps(graph, node).flatMap(({ id: socket }) => {
      const nodeId = node.id
      const v = readyValue(inputOf(nodeId, socket))
      if (!v) return []
      const image = painted(v)
      const legend = v.type === "classes" ? classAreas(v).rows.map((r) => ({ label: r.entry.name, color: r.entry.color })) : []
      return [
        {
          title: `${sourceLabel(nodeId, socket)}, ${subject}.`,
          caption:
            v.type === "classes"
              ? "One colour per class present, as the legend lists; drawn without interpolation."
              : "As the compositor draws it.",
          uri: dataUriOf(image),
          width: image.width,
          height: image.height,
          extent: v.extent && !isZeroExtent(v.extent) ? v.extent : null,
          legend,
          pixelated: v.type === "classes",
          source: mapSource(
            runsFeeding(linkInto(graph, nodeId, socket)!.from)
              .map((id) => runRecordOf?.(id) ?? null)
              .filter((r): r is PdfReportRun => !!r)
          ),
        },
      ]
    })
  const exportReport = async (node: Extract<GraphNode, { kind: "pdfReport" }>) => {
    setReportBusy(node.id)
    try {
      const rows = tableRows(node.id)
      const set = reportSet()
      const plainName = runOf(runsFeeding(node.id)[0] ?? null)?.title ?? "Run"
      const subject = set?.focus ?? plainName
      const season = readySeason(inputOf(node.id, "season"))?.season ?? null
      const doc = buildPdfReport({
        settings: node.settings,
        rows,
        areaName: set?.areaName ?? null,
        season: season ? { field: subject, season } : null,
        figures: reportFigures(node, subject),
        runs: reportRuns(node.id)
          .map((id) => runRecordOf?.(id) ?? null)
          .filter((r): r is PdfReportRun => !!r),
        appVersion: (await GetAppVersion().catch(() => "")) || "unknown",
        now: new Date(),
      })
      const dest = await ExportPDFReport(JSON.stringify(doc), doc.meta.title)
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    } finally {
      setReportBusy(null)
    }
  }

  const saveTable = async (nodeId: string) => {
    const text = fieldTableCsv(tableRows(nodeId))
    let bin = ""
    for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
    try {
      const dest = await ExportOverlayFile(`data:text/csv;base64,${btoa(bin)}`, "terra_fields_table.csv")
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  /** The runs whose rasters reach a node, through any chain of links. */
  const runsFeeding = (id: string, g: CompositorGraph = graph): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    const stack = [id]
    while (stack.length) {
      const at = stack.pop()!
      if (seen.has(at)) continue
      seen.add(at)
      const node = nodeOf(g, at)
      if (node?.kind === "run" && node.runId && !out.includes(node.runId)) out.push(node.runId)
      for (const l of g.links) if (l.to === at) stack.push(l.from)
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
  /*
    UNDER A FIELD SET, ONE LAYER PER FIELD: each field's answer, stacked on
    that field's own ground, which is what makes one graph stand for all of
    them on the globe. The field in focus is only what the cards show.
  */
  const sources: { member: FieldMember | null; graph: CompositorGraph; evaluation: Evaluation }[] =
    fieldEvaluations ?? [{ member: null, graph, evaluation }]
  const sent = sources.flatMap(({ member, graph: g, evaluation: ev }) =>
    g.nodes.flatMap((node) => {
      if (node.kind !== "globe") return []
      const ground = runOf(runsFeeding(node.id, g)[0] ?? null)?.areaId ?? `compositor:${node.id}`
      return inputsOf(g, node).flatMap((input) => {
        const link = linkInto(g, node.id, input.id)
        const r = ev.inputs.get(socketKey(node.id, input.id))
        const v = readyValue(r)
        if (!link || !v?.extent || isZeroExtent(v.extent)) return []
        return [
          {
            node,
            member,
            graph: g,
            socket: input.id,
            label: input.label,
            from: link.from,
            fromSocket: link.fromSocket,
            value: v,
            extent: v.extent,
            runIds: runsFeeding(link.from, g),
            areaId: ground,
          },
        ]
      })
    })
  )
  // A Globe whose raster is still decoding keeps what it last sent, rather
  // than blinking off the globe until the decode lands.
  const decoding = sources.some(({ graph: g, evaluation: ev }) =>
    g.nodes.some(
      (n) =>
        n.kind === "globe" &&
        inputsOf(g, n).some((i) => ev.inputs.get(socketKey(n.id, i.id))?.status === "busy")
    )
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
  const sourceOf = (
    from: string,
    fromSocket: string,
    g: CompositorGraph = graph
  ): CompositorGlobeOverlay["source"] => {
    const seen = new Set<string>()
    let at = { from, fromSocket }
    for (;;) {
      const n = nodeOf(g, at.from)
      if (!n || seen.has(n.id)) return null
      seen.add(n.id)
      if (n.kind === "viewer") {
        const up = linkInto(g, n.id, "image")
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
        key: `compositor:${s.node.id}:${s.socket}${s.member ? `:${s.member.fieldId}` : ""}`,
        nodeId: s.node.id,
        socket: s.socket,
        source: sourceOf(s.from, s.fromSocket, s.graph),
        areaId: s.areaId,
        runIds: s.runIds,
        layer: {
          id: `compositor-${s.node.id}-${s.socket}${s.member ? `-${s.member.fieldId}` : ""}`,
          title: `${describe(s.from, s.fromSocket)} \u00b7 ${s.label}${s.member ? ` \u00b7 ${s.member.fieldName}` : ""}`,
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
        legend: s.value.type === "classes" ? classLegend(s.value, describe(s.from, s.fromSocket)) : null,
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

  /*
    Arrange: every node placed by its links (lib/compositorLayout.ts), at the
    heights the cards were measured at, then the view framed on the result
    once the canvas has the new places -- hence the flag, read after the render
    that carries them.
  */
  const frameNext = useRef(false)
  const arrangeNodes = () => {
    if (!graph.nodes.length) return
    const places = arrange(graph, (n) => ({ w: WIDTH[n.kind], h: heights[n.id] ?? GUESS_H[n.kind] }))
    frameNext.current = true
    edit({ ...graph, places: { ...graph.places, ...places } })
  }
  useEffect(() => {
    if (!frameNext.current) return
    frameNext.current = false
    api.current?.fit()
  }, [graph.places])

  const over = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const [menu, setMenu] = useState<"view" | "add" | "node" | null>(null)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)

  /* ---- Editing ------------------------------------------------------------ */

  const refuse = (kind: NodeKind): string | null =>
    // A field set is something to read from with no run on the board yet.
    kind === "run" && !runs.length && !fieldSets.length ? "No run on the board to read from." : null

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
    if (node.kind === "run") {
      const runId = firstClass?.run.runId ?? runs[0]?.runId ?? null
      // With no run on the board, the first field set is the one thing to read.
      const set = runId ? undefined : fieldSets[0]
      node = set
        ? {
            ...node,
            runId: set.members[0]?.runId ?? null,
            each: { areaId: set.areaId, runKind: set.runKind, fieldId: set.members[0]?.fieldId ?? null },
          }
        : { ...node, runId }
    }
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
      case "run": {
        const set = setOf(fieldSets, node)
        if (set) return `Every field · ${set.areaName}`
        return runOf(node.runId)?.title ?? "Run"
      }
      case "majority":
        return `Majority ${node.size}×${node.size}`
      case "sieve":
        return `Sieve ${INT.format(node.minPixels)} px`
      case "morphology":
        return `${node.op === "open" ? "Opening" : "Closing"} ${node.size}×${node.size}`
      default:
        return mineralNodeTitle(node) ?? kindMeta(node.kind).label
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

  /** The chosen partition of every field (or the one run) as one GeoJSON file. */
  const saveZones = async (nodeId: string, k: number | null, all: boolean) => {
    const each = perFieldInput(nodeId, "zones")
    const rows =
      all && each
        ? each.map((f) => ({ name: f.member.fieldName, partition: chosenPartition(readyZones(f.result)?.report ?? null, k) }))
        : [
            {
              name: runOf(readyZones(inputOf(nodeId, "zones"))?.runId ?? null)?.title ?? "field",
              partition: chosenPartition(readyZones(inputOf(nodeId, "zones"))?.report ?? null, k),
            },
          ]
    let bin = ""
    for (const b of new TextEncoder().encode(zonesGeoJSON(rows))) bin += String.fromCharCode(b)
    try {
      const dest = await ExportOverlayFile(`data:application/geo+json;base64,${btoa(bin)}`, "terra_zones.geojson")
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  const body = (node: GraphNode): React.ReactNode => {
    switch (node.kind) {
      case "run": {
        const run = runOf(node.runId)
        const set = setOf(fieldSets, node)
        const at = set ? set.members.findIndex((m) => m.runId === node.runId) : -1
        const focus = (i: number) => {
          const m = set?.members[i]
          if (m && node.each) edit(updateNode(graph, { ...node, runId: m.runId, each: { ...node.each, fieldId: m.fieldId } }))
        }
        const choose = (value: string) => {
          if (value.startsWith("each:")) {
            const [areaId, runKind] = value.slice(5).split("|")
            const first = fieldSets.find((f) => f.areaId === areaId && f.runKind === runKind)?.members[0]
            edit(
              updateNode(graph, {
                id: node.id,
                kind: "run",
                runId: first?.runId ?? null,
                each: { areaId, runKind, fieldId: first?.fieldId ?? null },
              })
            )
            return
          }
          edit(updateNode(graph, { id: node.id, kind: "run", runId: value || null }))
        }
        return (
          <>
            <select
              value={node.each ? setChoice(node.each.areaId, node.each.runKind) : run ? run.runId : ""}
              onChange={(e) => choose(e.target.value)}
              className="field-input h-[1.375rem] w-full px-1 text-meta"
              title="The run whose rasters this node offers, or every field of an area"
            >
              {!node.each && !run && <option value="">{node.runId ? "Not on this board" : "Choose a run"}</option>}
              {node.each && !set && (
                <option value={setChoice(node.each.areaId, node.each.runKind)}>No field has this run any more</option>
              )}
              {/*
                The fields of an area first: a set is the one choice here that
                answers for more than one run, and after a queue of jobs the
                board holds a run per field below it.
              */}
              {fieldSets.length > 0 && (
                <optgroup label="Every field of an area">
                  {fieldSets.map((f) => (
                    <option key={setChoice(f.areaId, f.runKind)} value={setChoice(f.areaId, f.runKind)}>
                      {`${f.areaName} · ${runKindProduct(f.runKind)} · ${f.members.length} fields`}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="One run">
                {runs.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {[r.title, r.period].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </optgroup>
            </select>
            {set && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => focus(at - 1)}
                  disabled={at <= 0}
                  title="The previous field"
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
                >
                  <CaretLeft className="size-3" />
                </button>
                <select
                  value={set.members[at]?.fieldId ?? ""}
                  onChange={(e) => focus(set.members.findIndex((m) => m.fieldId === e.target.value))}
                  className="field-input h-[1.375rem] min-w-0 flex-1 px-1 text-meta"
                  title="The field the cards show. The Globe draws every field."
                >
                  {set.members.map((m) => (
                    <option key={m.fieldId} value={m.fieldId}>
                      {m.fieldName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => focus(at + 1)}
                  disabled={at < 0 || at >= set.members.length - 1}
                  title="The next field"
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
                >
                  <CaretRight className="size-3" />
                </button>
              </div>
            )}
            {set ? (
              <Note>
                Field {at + 1} of {set.members.length}, each its latest {runKindProduct(set.runKind).toLowerCase()} run
                {run?.model ? ` · ${run.model}` : ""}
              </Note>
            ) : (
              run?.model && <Note>{run.model}</Note>
            )}
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
        // Under a field set, every field's class map as well as the one in focus.
        const fields = fieldEvaluations
          ? (() => {
              const results = fieldEvaluations.map((f) => f.evaluation.inputs.get(socketKey(node.id, "classes")))
              const values = results
                .map((x) => readyValue(x))
                .filter((x): x is ClassValue => x?.type === "classes")
              const waiting = results.filter((x) => x?.status === "busy").length
              return { values, count: fieldEvaluations.length, waiting }
            })()
          : null
        if (fields && (fields.values.length || fields.waiting)) {
          return <AreasCard value={v?.type === "classes" ? v : null} fields={fields} />
        }
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

      case "seasonDates": {
        const r = inputOf(node.id, "season")
        const each = perFieldInput(node.id, "season")
        if (!readySeason(r) && !each?.some((f) => readySeason(f.result))) return <StatusNote result={r} />
        return (
          <SeasonCard
            focused={readySeason(r)}
            fields={each?.map((f) => ({ name: f.member.fieldName, season: readySeason(f.result)?.season ?? null })) ?? null}
          />
        )
      }

      case "health": {
        const r = inputOf(node.id, "health")
        const each = perFieldInput(node.id, "health")
        const crops = perFieldInput(node.id, "crop")
        if (!readyHealth(r) && !each?.some((f) => readyHealth(f.result))) return <StatusNote result={r} />
        return (
          <HealthCard
            reference={node.reference}
            onReference={(reference) => edit(updateNode(graph, { ...node, reference }))}
            focused={readyHealth(r)}
            fields={
              each?.map((f, i) => {
                const crop = readyClasses(crops?.[i]?.result)
                return {
                  id: f.member.fieldId,
                  name: f.member.fieldName,
                  health: readyHealth(f.result),
                  crop: crop ? (classAreas(crop).rows[0]?.entry.name ?? null) : null,
                }
              }) ?? null
            }
          />
        )
      }

      case "fieldTable": {
        const linked = (socket: string) => !!linkInto(graph, node.id, socket)
        if (
          !linked("classes") &&
          !linked("season") &&
          !linked("health") &&
          !linked("overlap") &&
          !linked("radar") &&
          !linked("zones")
        ) {
          return (
            <Note>
              Link a class map, a Season, or a Health, Overlap, Radar or Zones report: each fills its columns, one row per
              field.
            </Note>
          )
        }
        const missing = [
          !linked("classes") && "a class map",
          !linked("season") && "a Season",
          !linked("health") && "a Health report",
          !linked("overlap") && "an Overlap report",
          !linked("radar") && "a Radar report",
          !linked("zones") && "a Zones report",
        ].filter((x): x is string => !!x)
        return <FieldTableCard rows={tableRows(node.id)} missing={missing} onExport={() => void saveTable(node.id)} />
      }

      case "pdfReport": {
        const linked = (socket: string) => !!linkInto(graph, node.id, socket)
        const rows = tableRows(node.id)
        const products = productsIn(rows)
        const names: Record<string, string> = {
          classes: "land cover",
          season: "season",
          health: "vegetation health",
          overlap: "overlap",
          radar: "radar",
          zones: "zones",
        }
        const missing = [
          !linked("classes") && "a class map",
          !linked("season") && "a Season",
          !linked("health") && "a Health report",
          !linked("overlap") && "an Overlap report",
          !linked("radar") && "a Radar report",
          !linked("zones") && "a Zones report",
        ].filter((x): x is string => !!x)
        return (
          <PdfReportCard
            settings={node.settings}
            onSettings={(settings) => edit(updateNode(graph, { ...node, settings }))}
            products={products.map((p) => names[p])}
            fields={rows.length}
            maps={pdfReportMaps(graph, node).filter((m) => readyValue(inputOf(node.id, m.id))).length}
            missing={missing}
            busy={reportBusy === node.id}
            onExport={() => void exportReport(node)}
          />
        )
      }

      case "overlap": {
        const r = inputOf(node.id, "overlap")
        const each = perFieldInput(node.id, "overlap")
        if (!readyOverlap(r) && !each?.some((f) => readyOverlap(f.result))) return <StatusNote result={r} />
        return (
          <OverlapCard
            focused={readyOverlap(r)}
            fields={each?.map((f) => ({ name: f.member.fieldName, overlap: readyOverlap(f.result) })) ?? null}
          />
        )
      }

      case "zones": {
        const r = inputOf(node.id, "zones")
        const each = perFieldInput(node.id, "zones")
        if (!readyZones(r) && !each?.some((f) => readyZones(f.result))) return <StatusNote result={r} />
        return (
          <ZonesCard
            k={node.k}
            onK={(k) => edit(updateNode(graph, { ...node, k }))}
            focused={readyZones(r)}
            fields={each?.map((f) => ({ name: f.member.fieldName, zones: readyZones(f.result) })) ?? null}
            onExport={(all) => void saveZones(node.id, node.k, all)}
          />
        )
      }

      case "radar": {
        const r = inputOf(node.id, "radar")
        const each = perFieldInput(node.id, "radar")
        if (!readyRadar(r) && !each?.some((f) => readyRadar(f.result))) return <StatusNote result={r} />
        return (
          <RadarCard
            focused={readyRadar(r)}
            fields={each?.map((f) => ({ name: f.member.fieldName, radar: readyRadar(f.result) })) ?? null}
          />
        )
      }

      case "mineralCoverage":
      case "mineralClasses":
      case "mineralReferences":
      case "mineralPasses":
      case "mineralCover":
      case "mineralPositions":
      case "mineralAcid":
      case "mineralConfidence":
      case "mineralAgreement":
      case "mineralSave": {
        const r = inputOf(node.id, "report")
        const v = readyMineral(r)
        return v ? (
          <MineralNodeBody node={node} value={v} onChange={(next) => edit(updateNode(graph, next))} />
        ) : (
          <StatusNote result={r} />
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
        colour: TYPE_COLOUR[
          i.accepts.includes("fields")
            ? "fields"
            : i.accepts.includes("mineral")
              ? "mineral"
              : i.accepts.includes("image")
                ? "image"
                : "classes"
        ],
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
          <StudioMenuItem
            label="Arrange"
            disabled={!graph.nodes.length}
            onSelect={() => {
              arrangeNodes()
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
            onArrange={arrangeNodes}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4" style={{ background: "var(--s-field)" }}>
            <p className="max-w-[26rem] text-center text-meta leading-relaxed text-muted-foreground">
              {runs.length || fieldSets.length
                ? "The graph is empty. Add a Run node from the Add menu, or press Shift+A over this area."
                : "No run on the board. A run added to the board offers its rasters here, one output each."}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
