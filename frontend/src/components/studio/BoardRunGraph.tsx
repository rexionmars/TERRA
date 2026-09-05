/**
 * What to run on the board's area, drawn as the graph it is.
 *
 * This replaces the run BAND, which was a row of groups separated by rules,
 * scrolling sideways, with the action pinned at its right end. That shape was
 * right for the 4rem foot it was written for and wrong for the studio area it
 * ended up in: `placement="area"` centred a low strip in a tall rectangle, so
 * the height went to nothing and the rules were drawing separations that
 * separate surfaces make better.
 *
 * WHAT IT MUST NOT DUPLICATE IS STILL PROTECTED ELSEWHERE. The models, the
 * modes and the rule between them come from lib/classifyOptions.ts, the
 * seasons from lib/solarOptions.ts, and every value is the map screen's own
 * state passed straight through. Two renderings of one set of choices is a
 * design decision; two copies of the choices would be a bug waiting for
 * someone to add a model.
 *
 * The reasoning that belonged to the individual controls came with them: the
 * calendar opens from a portal because a transformed ancestor would otherwise
 * carry it, the monthly toggle is boxed rather than native because the theme
 * does not own platform chrome, and the model stays a menu because "Random
 * Forest" and "Temporal Transformer" are names rather than pictures.
 */import {
  SOLAR_PRODUCTS,
  type SolarProductEntry,
} from "@/components/energy/solarProducts"
import type { SolarParams, SolarProductId } from "@/lib/energyState"

/**
 * The head of each product's name, for a card 8rem wide.
 *
 * Not derived by truncating the table's label: "Resource at the AOI centroid"
 * cut to its first word is "Resource", but "Photovoltaic energy model" cut the
 * same way is "Photovoltaic", which names the other three as much as it names
 * that one. Written out, and typed against the table so a fifth product cannot
 * be added without one.
 */
const SHORT_SOLAR: Record<SolarProductEntry["id"], string> = {
  resource: "Resource",
  terrain: "Irradiation",
  siting: "Siting",
  energy: "Energy model",
}


import {
  ArrowDown,
  Check,
  ArrowsClockwise,
  CircleNotch,
  Drop,
  GridFour,
  Image as ImageIcon,
  Play,
  Sun,
  Trash,
  type Icon,
  Upload,
  Waves,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { DateField } from "@/components/ui/DateField"
import { NumberField } from "@/components/ui/NumberField"
import { Choice, Head } from "./nodeCard"
import {
  MODEL_OPTIONS,
  MODE_OPTIONS,
  modeBlockedBy,
  type ClassifyMode,
} from "@/lib/classifyOptions"
import { FLOOD_LEAST_DEMS } from "@/components/flood/floodSetup"
import { SERIES_FIGURES } from "@/lib/gridFigures"
import { type GridProductId } from "@/lib/gridOptions"
import {
  setPlantLayer,
  useNetwork,
  usePlantLayers,
  usePlantRegister,
} from "@/lib/plantRegister"
import {
  ENERGY_PRODUCTS,
  energyFamily,
  type BoardToolId,
  type EnergyProductId,
} from "@/lib/mapTools"
import { methodBrief } from "@/lib/methodBrief"
import type { RunLogEntry } from "@/lib/runLog"
import {
  ENERGY_CAPACITY_DENSITY_BASES,
  ENERGY_DECLARED_LOSSES,
  ENERGY_OPTIONAL_LOSSES,
} from "@/lib/energyDefaults"
import { SOLAR_SEASONS } from "@/lib/solarOptions"
import { RGB_PRESETS, INDICES } from "@/lib/compositeCatalog"
import { WATER_INDICES } from "@/lib/waterOptions"
import type {
  CompositeIndex,
  CompositeKind,
  DataCubeScene,
  ModelKind,
  SolarSeason,
  WaterIndex,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  markBoardDirty,
  readBoardMemory,
  RUN_NODE_PLACES,
  writeBoardMemory,
} from "./boardMemory"
import { MethodPanel } from "./MethodPanel"
import {
  NodeCanvas,
  type CanvasEdge,
  type CanvasNode,
  type EdgeState,
} from "./NodeCanvas"
import { defaultPlaces, runGraph, type Place, type RunNodeId } from "./runGraph"
import {
  HEAVY,
  reading,
  signature,
  subject,
  supplied,
  type RunValue,
  type Subject,
} from "./runValue"

/**
 * One glyph per product, exported so the area header names them the same.
 *
 * The same glyphs the board's tree uses for the rasters each tool produces,
 * because a tool and its output are one subject.
 */
export const TOOL_ICON: Record<BoardToolId, Icon> = {
  classify: GridFour,
  compose: ImageIcon,
  water: Drop,
  // The sun for the whole of energy, and it is the honest glyph for it: the
  // resource is what every product here is ultimately about, including the
  // curtailment ones -- those measure what the grid did to a resource that
  // arrived. A fan or a database would name one family and hide two.
  energy: Sun,
  // Waves rather than a droplet: the envelope reads terrain and no
  // precipitation at all, so a rain glyph would name an input it does not have.
  flood: Waves,
}

/**
 * One of a set of choices.
 *
 * Plain words rather than bordered cards: a border per option spends height on
 * edges, and the chosen one takes the same raised plate the board's tree uses
 * for its active row, so the two surfaces agree about what "chosen" looks like.
 *
 * The RING carries the chosen state, not the fill and not an underline. The
 * fill is a hue mark only -- accent-dim measures 1.35 on ink -- so it cannot
 * carry the state alone: the ring clears 3.88 against its own plate and 5.23
 * against the ink outside. An accent hairline under the cell was tried and
 * dropped, because that exact rule is the board tree's drop indicator. One
 * idiom, one meaning.
 */
/**
 * One map layer, with how many marks it puts on screen.
 *
 * The count is beside the label and not in a tooltip: the difference between
 * 558 and 24,140 is the whole reason there are two switches, and a number a
 * reader has to hover for is a number they will not see before they draw.
 */
function LayerSwitch({
  label,
  count,
  on,
  onToggle,
}: {
  label: string
  count: number
  on: boolean
  onToggle: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onToggle(!on)}
      className="flex items-center gap-1.5 text-left"
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          on ? "bg-accent" : "bg-muted-foreground/40"
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-meta",
          on ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      <span className="telemetry shrink-0 text-micro text-muted-foreground">
        {count.toLocaleString()}
      </span>
    </button>
  )
}
/**
 * What the run has said, while it is saying it.
 *
 * MOVED HERE FROM THE PROPERTIES PANEL, which used to swap its whole body for
 * this while a run was going. That panel answers "what is this raster" about
 * one the reader picked, and taking it over spent an answer they were waiting
 * on to give them one they had not asked for. The account of a run belongs
 * beside the button that started it.
 *
 * A LOG RATHER THAN A LINE, and that is the point. The run band kept the stage
 * in a tooltip, and the argument was sound about a single line: one that
 * rewrites itself several times a second costs more attention than it returns.
 * A stack is the other thing -- each line is read once and stays, nothing is
 * overwritten, and it is the only account of what the run actually did. The
 * sidecar's stages carry their own detail and it was being thrown away several
 * times a second.
 *
 * Bounded and scrolled, because a card is a card: a twelve-stage water run
 * would otherwise grow this one past the graph it sits in.
 */

/**
 * A labelled text value, for the two parameters where BLANK IS A VALUE.
 *
 * The performance ratio and the UTC offset both mean something when empty --
 * the reference ratio, and UTC -- and a NumberField would have to invent a
 * zero to say it. Zero is a legitimate offset, so the two would then be
 * indistinguishable.
 */
function TextRow({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-micro text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="telemetry h-6 w-20 min-w-0 rounded-sm border border-border bg-background px-1.5 text-right text-micro text-foreground outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring disabled:opacity-50"
      />
    </label>
  )
}

/**
 * A labelled menu, for a choice whose options are references rather than
 * pictures.
 *
 * The same argument the classification card makes for keeping the model a
 * menu: "Ong T4, above 20 MW, direct array" does not survive being cut to a
 * chip, and eight of them do not fit a card as chips at all.
 */
function SelectRow({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: readonly { id: string; label: string }[]
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-micro text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-full rounded-sm border border-border bg-background px-1 text-micro text-foreground outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** One loss term, as a percentage. Compact because there are eleven of them. */
function LossRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-micro text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        step={0.1}
        min={0}
        max={30}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="telemetry h-5 w-12 shrink-0 rounded-sm border border-border bg-background px-1 text-right text-micro text-foreground outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring disabled:opacity-50"
      />
    </label>
  )
}

function RunLog({ entries }: { entries: RunLogEntry[] }) {
  const endRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // Scrolled to the foot, which is where a log is read: the stage in
    // progress is the one being waited on.
    endRef.current?.scrollIntoView({ block: "end" })
  }, [entries.length])

  return (
    <ul className="panel-scroll flex max-h-[7rem] flex-col gap-0.5 overflow-y-auto pr-1">
      {entries.map((e, i) => (
        <li
          key={`${i}-${e.text}`}
          ref={i === entries.length - 1 ? endRef : undefined}
          className="flex items-baseline gap-1.5"
        >
          <span className="telemetry w-7 shrink-0 text-right text-[9px] tabular-nums text-muted-foreground">
            {Math.round(e.at)}%
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-meta",
              // The last is what is happening; the rest is what happened.
              i === entries.length - 1
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {e.text}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A small square action, the shape the area card's three verbs take. */
function IconAction({
  icon: Icon,
  title,
  disabled,
  onClick,
}: {
  icon: Icon
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-raised/60 hover:text-foreground disabled:opacity-40"
    >
      <Icon className="size-3" />
    </button>
  )
}

export interface BoardRunGraphProps {
  tool: BoardToolId | null

  /**
   * Which energy product is chosen, and how to change it.
   *
   * ONE CARD FOR THREE FAMILIES. The product card used to render the solar
   * table or the grid table depending on which tool the band was on, and the
   * reader had to have chosen the family before they could see what it
   * offered. It renders one list now, and the family is a property of the
   * entry rather than a question asked before it.
   *
   * `blocked` names the families this installation cannot run, so a product
   * that will not go is greyed WITH ITS REASON rather than hidden. A missing
   * option reads as a missing feature; a refused one reads as a setup step.
   */
  energyProduct?: EnergyProductId
  onEnergyProduct?: (id: EnergyProductId) => void
  blockedFamilies?: Partial<Record<"solar" | "wind" | "grid", string>>

  /**
   * Everything the solar tool needs, or absent where it cannot be run.
   *
   * One object rather than nine loose props, because they arrive and leave
   * together: a graph with no way to start a solar run must not offer solar
   * cards, and absence is how it says so.
   */
  solar?: {
    product: SolarProductId
    onProductChange: (p: SolarProductId) => void
    hourlyYears: number
    onHourlyYearsChange: (v: number) => void
    season: SolarSeason
    onSeasonChange: (s: SolarSeason) => void
    slopeAcceptableDeg: number
    slopeRestrictiveDeg: number
    onSlopeChange: (acceptable: number, restrictive: number) => void
    /*
      The rest of what solar sends, back on the graph.

      They lived in an editor of their own on an argument that was true about
      the energy model and was applied to all four products. One object rather
      than twenty loose props, for the reason the solar bundle already gives:
      they arrive and leave together.
    */
    climatologyYears: number
    surfaceAzimuth: number
    performanceRatio: string
    reportingBasis: "year_one" | "lifetime_mean"
    degradationPct: number
    analysisPeriodYears: number
    densityBasis: string
    buildableFraction: number
    gcrFixed: number
    gcrTracker: number
    trackerMaxAngleDeg: number
    utcOffset: string
    applyShading: boolean
    declaredLoss: Record<string, number>
    optionalLoss: Record<string, number>
    onParamsChange: (patch: Partial<SolarParams>) => void
    onLossChange: (
      group: "declared" | "optional",
      key: string,
      pct: number
    ) => void
  }

  /**
   * Everything the wind screening needs, or absent where it cannot be run.
   *
   * One object for the reason the solar bundle is one: they arrive and leave
   * together, and a graph with no way to start a wind run must not draw cards
   * for one.
   */
  wind?: {
    recordYears: number
    onRecordYearsChange: (v: number) => void
    hubHeightM: number
    onHubHeightChange: (v: number) => void
    calmThresholdMS: number
    onCalmThresholdChange: (v: number) => void
    roughnessLowM: number
    roughnessHighM: number
    onRoughnessChange: (low: number, high: number) => void
  }

  /**
   * Everything the operational record needs, or absent where it cannot be
   * read -- which on this tab is the common case rather than the exception,
   * since most installations have no local store at all.
   */
  grid?: {
    product: GridProductId
    onProductChange: (p: GridProductId) => void
    /** The connection as it will be used, already redacted. */
    dsn: string
    /** What decided it: "TERRA_BR_DSN", "chosen" or "default". */
    dsnSource: string
    reachable: boolean
    /** Why not, when it is not. The sidecar's own sentence. */
    unreachable?: string
    /** The span the store holds, as YYYY-MM, or null before it has answered. */
    recordFrom: string | null
    recordTo: string | null
    start: string
    end: string
    onWindowChange: (start: string, end: string) => void
    onCheckStore: () => void
    figure: number
    onFigureChange: (n: number) => void
  }

  /** Everything the flood envelope needs, or absent where it cannot be run. */
  flood?: {
    demIds: string[]
    onDemIdsChange: (ids: string[]) => void
    /** Every product the sidecar can compare, for the card to offer. */
    demOptions: readonly { id: string; label: string }[]
    referenceThresholdM: number
    onReferenceThresholdChange: (v: number) => void
    drainageKm2: number
    onDrainageChange: (v: number) => void
  }

  /**
   * Everything a composition is built from, or absent where it cannot be made.
   *
   * One object for the same reason the solar bundle is one: these arrive and
   * leave together, and a graph with no way to apply a composition must not
   * draw cards for one.
   */
  compose?: {
    scenes: readonly DataCubeScene[]
    scenesLoading: boolean
    scenesError: string | null
    selectedSceneId: string
    onSelectScene: (id: string) => void
    /** Asks the period for the scenes in it; the list is empty until it runs. */
    onListScenes: () => void
    kind: CompositeKind
    onKindChange: (k: CompositeKind) => void
    bands: [string, string, string]
    onBandsChange: (b: [string, string, string]) => void
    index: CompositeIndex
    onIndexChange: (i: CompositeIndex) => void
    stretchLow: number
    stretchHigh: number
    onStretchChange: (low: number, high: number) => void
  }

  /** Which index the surface-water run reads, or absent where it cannot run. */
  water?: {
    index: WaterIndex
    onIndexChange: (i: WaterIndex) => void
  }

  hasArea: boolean
  /** Display name of the active custom AOI (drawn / drawn 2 / renamed). */
  areaLabel?: string
  onImportPolygon: () => void
  onClearArea: () => void

  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  maxCloud: number
  onMaxCloudChange: (v: number) => void
  monthlyBest: boolean
  onMonthlyBestChange: (v: boolean) => void

  modelKind: ModelKind
  onModelKindChange: (m: ModelKind) => void
  mode: ClassifyMode
  onModeChange: (m: ClassifyMode) => void

  /** The chosen tool's own run, already resolved by the map screen. */
  runLabel: string
  running: boolean
  progress: number
  progressMsg: string
  canRun: boolean
  blockedBy?: string
  onRun: () => void
  /** Land cover, which is a second action of the classification tool alone. */
  onAnalyzeLULC?: () => void
  lulcRunning?: boolean

  /**
   * What the run has said, for the method panel's second half.
   *
   * Passed in rather than accumulated here because the same log is drawn in
   * the stats column, and two accumulations of one stream would be two
   * accounts of one run.
   */
  runLog?: RunLogEntry[]
  /** The studio surface the method panel is portalled into and clamped inside. */
  surface?: HTMLElement | null

  /**
   * The last run of this session: what it read, and how it ended.
   *
   * WHAT IT IS FOR is the difference between "a run succeeded" and "the answer
   * on screen is an answer about THIS value". The first is one fact and would
   * be drawn identically on every wire; the second is per wire, and it is what
   * lets a season changed after a run take its wire back to pending while the
   * area's stays read.
   *
   * HELD BY THE CALLER, not here, because this component is unmounted whenever
   * the reader leaves the studio and the results it is about are not. Kept
   * here, a wire would forget what it had been read for while the raster it
   * produced was still on the map.
   *
   * Null before anything has run, which is not the same as a run that read
   * nothing: every wire is pending, and none of them is failed.
   */
  lastRun?: { ok: boolean; inputs: Readonly<Record<string, string>> } | null

  /**
   * What every card supplies right now, reported as it changes.
   *
   * The caller records this when it starts a run and hands it back as
   * `lastRun`. One signature per card, taken from the value the card supplies
   * -- see cardValues here and `signature` in runValue.ts. Reported from this
   * side because this is where the values are assembled; deriving them again
   * on the other would be a second definition of what an input is.
   *
   * Stable identity expected: it is called from an effect keyed on the values
   * themselves, so a callback rebuilt on every render would report on every render.
   */
  onInputs?: (inputs: Record<string, string>) => void
}

/**
 * What one loss chain costs, as a percentage.
 *
 * Series, not sum: each factor takes its share of what the one before it left.
 * Both groups the card edits are in the chain, because both are sent.
 */
function compoundLoss(solar: NonNullable<BoardRunGraphProps["solar"]>): number {
  const all = [
    ...Object.values(solar.declaredLoss),
    ...Object.values(solar.optionalLoss),
  ]
  const kept = all.reduce((acc, pct) => acc * (1 - pct / 100), 1)
  return Math.round((1 - kept) * 1000) / 10
}

/**
 * WHAT EACH PART OF A REQUEST IS DRAWN IN, AND AT WHAT WEIGHT.
 *
 * Two channels over one scale, which is the whole of the scheme. The HUE says
 * which part of the question a card answers -- where, when, by which method,
 * at what values -- and the ALPHA says how much that part decides. Change
 * where or when a run reads and it is a run about something else; change a
 * threshold and it is the same question answered differently, so the source
 * and the stretch are drawn at nearly twice the ink of the method and the
 * settings. See HEAVY in runValue.ts, which is where that ordering is argued.
 *
 * A card with no part -- the layers card, the run card -- takes neither and
 * keeps the chassis's grey, which is the correct statement about both: one is
 * not in the request and the other is where the request ends.
 *
 * The tokens themselves are declared and measured in index.css and
 * lib/contrast.ts. What is decided here is only how much of each is used.
 */
const PART_WASH = { heavy: 0.3, light: 0.18 }
const PART_EDGE = { heavy: 0.85, light: 0.55 }

function partPaint(part: Subject | null): CanvasNode["subject"] {
  if (!part) return undefined
  const weight = HEAVY.includes(part) ? "heavy" : "light"
  const token = `var(--p-part-${part})`
  return {
    wash: `rgb(${token} / ${PART_WASH[weight]})`,
    edge: `rgb(${token} / ${PART_EDGE[weight]})`,
  }
}

/** The same colour at full strength, for the glyph that titles the card. */
const partGlyph = (part: Subject | null): string | undefined =>
  part ? `rgb(var(--p-part-${part}))` : undefined

/**
 * The state of a wire, in the word drawn where it lands.
 *
 * Lower case, and short. These sit between two cards at nine pixels and are
 * read in passing; a sentence there would be a second thing to read on a
 * surface whose subject is the cards.
 */
const EDGE_NOTE: Record<EdgeState, string> = {
  missing: "not set",
  pending: "pending",
  reading: "reading",
  read: "read",
  failed: "error",
}

/**
 * WHAT EVERY CARD SUPPLIES, DECLARED ONCE PER CARD.
 *
 * TOTAL OVER THE NODE IDS, and that is the point of it. This replaced three
 * hand-written tables over the same subject -- a string for the wire to carry,
 * a predicate for whether the card was empty, and the string again as the
 * signature a later run is compared against -- each of which a new card could
 * be added without, and one of which had already been added without: a
 * composition with no scene chosen drew a wire as though it were carrying one.
 * A card added to RunNodeId with no entry here does not compile.
 *
 * The reading, the absence and the signature all follow from the value; see
 * runValue.ts, which owns all three and explains why they are one thing.
 *
 * `none` IS A REAL ANSWER, and it covers two cases that are not the same. The
 * layers card and the run card supply nothing to a run by their nature. The
 * rest are cards whose bundle is absent -- a board with no solar parameters
 * draws no solar cards at all, so no wire asks these what they hold.
 *
 * A CARD HOLDING SEVERAL NUMBERS ALSO ANSWERS `none`, and that is a limit
 * rather than an omission: the loss card carries nine declared percentages and
 * the radiation card three unrelated figures, and no single reading is the
 * value of either. Their wires draw without one rather than with a guess at
 * which of the numbers is the card.
 */
function cardValues(p: BoardRunGraphProps): Record<RunNodeId, RunValue> {
  const { solar, wind, grid, compose, flood, water } = p
  const none: RunValue = { kind: "none" }
  const onWind =
    p.tool === "energy" &&
    !!p.energyProduct &&
    energyFamily(p.energyProduct) === "wind"
  const productLabel =
    p.tool === "energy"
      ? (ENERGY_PRODUCTS.find((e) => e.id === p.energyProduct)?.label ?? null)
      : solar
        ? SHORT_SOLAR[solar.product]
        : null

  return {
    area: { kind: "ground", label: p.hasArea ? p.areaLabel || "drawn" : null },
    period: { kind: "span", start: p.start, end: p.end },
    model: {
      kind: "choice",
      label: MODEL_OPTIONS.find((o) => o.id === p.modelKind)?.label ?? null,
    },
    mode: {
      kind: "choice",
      label: MODE_OPTIONS.find((o) => o.id === p.mode)?.label ?? null,
    },
    scene: compose
      ? {
          kind: "scene",
          id: compose.selectedSceneId || null,
          found: compose.scenes.length,
        }
      : none,
    composite: compose
      ? { kind: "choice", label: compose.kind === "index" ? "index" : "rgb" }
      : none,
    // Three of three: a composition is an ordered triple, so the floor is the
    // whole of it and the reading names them rather than counting them.
    bands: compose
      ? { kind: "several", items: compose.bands, least: 3, of: 3 }
      : none,
    spectralIndex: compose ? { kind: "choice", label: compose.index } : none,
    stretch: compose
      ? {
          kind: "band",
          low: compose.stretchLow,
          high: compose.stretchHigh,
          unit: "%",
        }
      : none,
    waterIndex: water ? { kind: "choice", label: water.index } : none,
    product: { kind: "choice", label: productLabel },
    record: onWind
      ? wind
        ? { kind: "record", years: wind.recordYears, of: "hourly" }
        : none
      : solar
        ? { kind: "record", years: solar.hourlyYears, of: "hourly" }
        : none,
    season: solar
      ? {
          kind: "choice",
          label:
            SOLAR_SEASONS.find((o) => o.id === solar.season)?.label ?? null,
        }
      : none,
    slope: solar
      ? {
          kind: "band",
          low: solar.slopeAcceptableDeg,
          high: solar.slopeRestrictiveDeg,
          unit: "deg",
        }
      : none,
    turbine: wind ? { kind: "measure", of: wind.hubHeightM, unit: "m" } : none,
    roughness: wind
      ? {
          kind: "band",
          low: wind.roughnessLowM,
          high: wind.roughnessHighM,
          unit: "m",
        }
      : none,
    models: flood
      ? {
          kind: "several",
          items: flood.demIds,
          least: FLOOD_LEAST_DEMS,
          of: flood.demOptions.length,
        }
      : none,
    // The reference height, which is what the envelope is taken AT. The
    // drainage threshold is the second number on the same card and stays on
    // it: two measures in different units are not one reading.
    threshold: flood
      ? { kind: "measure", of: flood.referenceThresholdM, unit: "m" }
      : none,
    store: grid ? { kind: "store", reachable: grid.reachable } : none,
    window: grid ? { kind: "span", start: grid.start, end: grid.end } : none,
    figure: grid ? { kind: "choice", label: `fig. ${grid.figure}` } : none,
    /*
      THE FOUR CARDS THAT HELD SEVERAL FIGURES, each now reporting the one it
      is about.

      They answered `none` on the argument that no single reading is the value
      of a card carrying nine percentages -- which was true of the card and
      false of the request. Every one of them has a headline the rest qualify:
      the climatology is a depth of record with an azimuth and a ratio set
      against it, the plant is an analysis period, the array is its ground
      cover ratio, and the losses are their own compound. Leaving them blank
      left half of the busiest graph in the neutral grey that means "this card
      answers no part of the question", which is the one thing they do not.
    */
    radiation: solar
      ? { kind: "record", years: solar.climatologyYears, of: "climatology" }
      : none,
    plant: solar
      ? { kind: "record", years: solar.analysisPeriodYears, of: "analysis" }
      : none,
    array: solar
      ? { kind: "measure", of: solar.gcrFixed, unit: "GCR" }
      : none,
    /*
      The compound, not the sum. Losses apply in series -- each takes its share
      of what the one before it left -- so two percent and two percent is 3.96
      and not four. It is the figure the model itself derives; reporting the
      sum on the wire would put a different number on the board from the one in
      the answer.
    */
    losses: solar
      ? { kind: "measure", of: compoundLoss(solar), unit: "% loss" }
      : none,
    layers: none,
    run: none,
  }
}

/**
 * Where the cards have been dragged to, kept across a close and into a save.
 *
 * The same treatment areas and planes already get -- see `places` and
 * `planePlaces` in boardMemory -- because it is the same kind of value: an
 * arrangement someone made by hand, which is lost work if it is thrown away
 * with the board.
 *
 * The VIEW is deliberately not kept. Where the field is panned to is a reading
 * position, like a scroll offset, and the canvas fits itself to the graph
 * whenever the set of cards changes -- so a reopened board shows the whole
 * graph rather than wherever it was last looked at.
 */
function useKeptPlaces() {
  const [places, setPlaces] = useState<Record<string, Place>>(() =>
    readBoardMemory<Record<string, Place>>(RUN_NODE_PLACES, {})
  )
  useEffect(() => {
    writeBoardMemory(RUN_NODE_PLACES, places)
  }, [places])

  const move = useCallback((id: string, at: Place) => {
    setPlaces((prev) => ({ ...prev, [id]: at }))
    markBoardDirty()
  }, [])

  return [places, move] as const
}

export function BoardRunGraph(props: BoardRunGraphProps) {
  const busy = props.running
  const [places, move] = useKeptPlaces()

  /*
    What the cards were measured at, which supersedes the heights in SPEC.

    NOT KEPT ACROSS A SESSION, unlike the places above. A place is work someone
    did by hand and is lost if it is thrown away; a height is a fact about the
    current render, and one restored from a save would describe the card as it
    was under a different tool, in a different theme, at a different font size.
    It costs one extra layout pass to measure again and cannot go stale.

    Compared before it is stored, because a ResizeObserver reports on every
    layout that touches the card and an unconditional write would re-render the
    field on each one. Sub-pixel changes are noise: the observer reports
    fractional heights, and a card that settles at 201.6 then 201.59 has not
    changed.
  */
  const [heights, setHeights] = useState<Record<string, number>>({})
  const onMeasure = useCallback((id: string, h: number) => {
    setHeights((prev) =>
      Math.abs((prev[id] ?? 0) - h) < 0.5 ? prev : { ...prev, [id]: h }
    )
  }, [])

  /*
    The latest stage, read the way StudioStatusBar reads it so the card and the
    foot cannot come to describe one run differently. `progressMsg` is the
    fallback rather than the source: it is the newest message, the log is the
    account, and a run that has said nothing yet has neither.
  */
  const stage = props.runLog?.length
    ? props.runLog[props.runLog.length - 1].text
    : props.progressMsg || null

  /*
    ALREADY A PERCENTAGE. The sidecar emits it that way -- `emit_progress(10,
    'querying STAC catalog')` -- and StudioStatusBar has always read it so.
    The run band multiplied by a hundred to build the width of its progress
    hairline, which asked for 7900% of a bar and got a full one, so the error
    was invisible for as long as the only reader was a width. Drawn as a
    figure it said 7900%.

    Clamped rather than trusted: a stage that reports past its own scale would
    otherwise push the fill outside the track it is drawn in.
  */
  const pct = Math.round(Math.max(0, Math.min(100, props.progress)))

  // Read here rather than passed in: the register and the switches are held in
  // a module because the card and the map it controls are in unrelated
  // subtrees. See lib/plantRegister.ts.
  const plantRegister = usePlantRegister()
  const plantLayers = usePlantLayers()
  // Same lazy fetch the globe does, so the counts beside the network switches
  // arrive with the layer rather than before anyone asked for it. Both share
  // one module promise, so this is not a second request.
  const network = useNetwork(plantLayers.network || plantLayers.buses)

  const graph = runGraph(
    props.tool,
    props.solar ? props.solar.product : null,
    props.compose ? props.compose.kind : null,
    props.grid ? props.grid.product : null,
    // Without this the Energy entry has no family to dispatch on and the graph
    // comes back null, which the surface renders as "pick a product above" --
    // over a product card that is already showing one picked.
    props.energyProduct ?? null
  )

  /*
    What the chosen tool will actually do, resolved from the SAME props the
    cards are bound to. Derived rather than held: a brief kept in state would
    be one more thing that can disagree with the graph it describes.
  */
  const brief =
    props.tool &&
    methodBrief({
      tool: props.tool,
      modelKind: props.modelKind,
      start: props.start,
      end: props.end,
      maxCloud: props.maxCloud,
      monthlyBest: props.monthlyBest,
      solar: props.solar && {
        product: props.solar.product,
        hourlyYears: props.solar.hourlyYears,
        // The label rather than the id, since the panel is read and the id is
        // stored. SOLAR_SEASONS is the one place that pairing lives.
        season:
          SOLAR_SEASONS.find((o) => o.id === props.solar?.season)?.label ??
          props.solar.season,
        slopeAcceptableDeg: props.solar.slopeAcceptableDeg,
        slopeRestrictiveDeg: props.solar.slopeRestrictiveDeg,
      },
    })

  if (!graph) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4">
        <p className="text-body text-muted-foreground">
          Pick a product above to set up a run.
        </p>
      </div>
    )
  }

  const body: Record<RunNodeId, React.ReactNode> = {
    /*
      WHAT THE MAP IS DRAWING, AND HOW MUCH OF IT CAN BE ASKED ABOUT.

      The count beside each switch is the point of the card rather than a
      flourish. ANEEL registers 18,639 located photovoltaic enterprises and ONS
      meters 558 of them, so a reader deciding where to draw needs to know that
      most of what a "show every plant" layer would put on screen is ground this
      slice cannot answer for. Two switches state that; one switch would hide it.

      No run and no edge. This changes what is drawn while the question is being
      set up and changes nothing about the answer.
    */
    layers: (
      <div className="flex flex-col gap-1.5">
        {plantRegister === null ? (
          <span className="text-meta text-muted-foreground">
            Reading the register
          </span>
        ) : (
          <>
            <LayerSwitch
              label="Plants in the record"
              count={plantRegister.counts.metered}
              on={plantLayers.metered}
              onToggle={(v) => setPlantLayer("metered", v)}
            />
            <LayerSwitch
              label="Registered only"
              count={
                plantRegister.counts.returned - plantRegister.counts.metered
              }
              on={plantLayers.registered}
              onToggle={(v) => setPlantLayer("registered", v)}
            />
            <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">
              Only the first can be read about. A point is one enterprise as
              ANEEL registers it, not a footprint.
            </p>
            <div className="mt-1 border-t border-border/40 pt-1.5" />
            <LayerSwitch
              label="Transmission lines"
              count={network?.counts.lines_in_service ?? 1830}
              on={plantLayers.network}
              onToggle={(v) => setPlantLayer("network", v)}
            />
            <LayerSwitch
              label="Substations"
              count={network?.counts.substations ?? 1677}
              on={plantLayers.buses}
              onToggle={(v) => setPlantLayer("buses", v)}
            />
            {/*
              Said where the layer is switched on, because a map invites
              measuring with the eye and this one cannot be measured that way.
              ONS publishes a circuit's terminals and its length, never its
              path, so the drawn segment is short of the conductor by about 8
              percent at the median and 41 at the ninetieth percentile.
            */}
            <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">
              Drawn terminal to terminal, not along the route: the conductor
              runs ~8% longer at the median, 41% at p90. Transmission only —
              nothing below 230 kV is in the register.
            </p>
          </>
        )}
      </div>
    ),
    store: (
      <div className="flex flex-col gap-1.5">
        {/*
          The state first and the address second, because the state is what
          decides whether anything below this card can run, and the address is
          only interesting once it does not.
        */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              props.grid?.reachable ? "bg-accent" : "bg-muted-foreground/50"
            )}
          />
          <span className="telemetry text-meta text-foreground">
            {props.grid?.reachable ? "reachable" : "unreachable"}
          </span>
          <span className="ml-auto text-micro text-muted-foreground">
            {props.grid?.dsnSource === "TERRA_BR_DSN"
              ? "by variable"
              : props.grid?.dsnSource === "chosen"
                ? "chosen"
                : "default"}
          </span>
        </div>
        <span className="telemetry truncate text-micro text-muted-foreground">
          {props.grid?.dsn ?? "—"}
        </span>
        {/*
          The sidecar's own sentence, clamped to two lines. It already
          distinguishes a missing driver from a server that is not running from
          a database that was never created, and each needs a different action;
          a card is not the place to read all of it, which is what the Grid
          record editor is for.
        */}
        {!props.grid?.reachable && props.grid?.unreachable && (
          <span className="line-clamp-2 text-micro leading-snug text-muted-foreground">
            {props.grid.unreachable}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <IconAction
            icon={ArrowsClockwise}
            title="Check the store again"
            disabled={busy}
            onClick={() => props.grid?.onCheckStore()}
          />
        </div>
      </div>
    ),
    figure: (
      /*
        A list and not chips: twelve entries with names like "Subsystem
        decomposition" do not survive being cut to a chip, and the number is
        how the series refers to them.

        The ones this application does not compute yet are drawn and disabled
        rather than hidden. Hiding them would say the series has one figure;
        showing them says which of twelve is ready, which is the true state and
        the one a reader can act on.
      */
      <div className="flex max-h-44 flex-col gap-px overflow-y-auto">
        {SERIES_FIGURES.map((f) => (
          <button
            key={f.number}
            type="button"
            disabled={busy || !f.ready}
            onClick={() => props.grid?.onFigureChange(f.number)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-micro transition-colors",
              props.grid?.figure === f.number
                ? "bg-accent/15 text-foreground inset-ring-1 inset-ring-accent"
                : f.ready
                  ? "text-muted-foreground hover:bg-surface-raised"
                  : "text-muted-foreground/40"
            )}
          >
            <span className="telemetry w-4 shrink-0 text-right">
              {f.number}
            </span>
            <span className="min-w-0 truncate">{f.label}</span>
          </button>
        ))}
      </div>
    ),
    window: (
      <div className="flex flex-col gap-1.5">
        {/*
          Bounded by what the store holds rather than by a calendar. The hourly
          resource window is a decade; this record begins when the operator
          started publishing it, and a request outside that span is refused
          rather than silently returned short.
        */}
        <div className="flex items-center gap-1">
          <DateField
            value={props.grid?.start ?? ""}
            onChange={(v) =>
              props.grid?.onWindowChange(v, props.grid.end)
            }
            disabled={busy}
          />
          <DateField
            value={props.grid?.end ?? ""}
            onChange={(v) =>
              props.grid?.onWindowChange(props.grid.start, v)
            }
            disabled={busy}
          />
        </div>
        <span className="text-micro text-muted-foreground">
          {props.grid?.recordFrom && props.grid?.recordTo
            ? `the record runs ${props.grid.recordFrom}..${props.grid.recordTo}`
            : "the record's span is unknown until the store answers"}
        </span>
      </div>
    ),
    area: (
      <>
        {/*
          Loud when there is an area and quiet when there is not. It is a
          readout rather than a field, so it takes no box -- but it is part of
          what Run will do, so demoting it wholesale would hide the answer.
          What is quiet is the ABSENCE.
        */}
        <span
          className={cn(
            "telemetry truncate text-meta",
            props.hasArea ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {props.hasArea ? props.areaLabel || "drawn" : "none"}
        </span>
        {/*
          TWO VERBS, NOT THREE. The third was a pencil that opened a dialog
          holding a second map to draw on, which existed because the only place
          to draw was the work map and reaching it meant closing the board the
          area was being drawn for. The studio has a planet in its own
          arrangement now, and the drawing tools are on it -- so the card is
          left with the two acts that are about a shape it already has.
        */}
        <div className="flex items-center gap-0.5">
          <IconAction
            icon={Upload}
            title="Import a polygon"
            disabled={busy}
            onClick={props.onImportPolygon}
          />
          <IconAction
            icon={Trash}
            title="Clear the area"
            disabled={busy || !props.hasArea}
            onClick={props.onClearArea}
          />
        </div>
      </>
    ),

    period: (
      <>
        {/*
          Stacked with the arrow between them rather than side by side. Two ISO
          dates and an arrow need about 250px on one line and the card is 208;
          down the card each date has the width to be read without truncating,
          which is the whole reason to hold it in a card at all.
        */}
        <DateField value={props.start} disabled={busy} onChange={props.onStartChange} />
        <ArrowDown
          className="size-3 self-center text-muted-foreground"
        />
        <DateField value={props.end} disabled={busy} onChange={props.onEndChange} />
        <NumberField
          label="Cloud"
          value={props.maxCloud}
          min={0}
          max={100}
          step={5}
          format={(v) => `${Math.round(v)}%`}
          parse={(t) => {
            const v = parseFloat(t.replace("%", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          disabled={busy}
          onChange={(v) => props.onMaxCloudChange(Math.round(v))}
        />
        {/*
          A boxed toggle rather than a native checkbox, which was the one
          control here drawing platform chrome -- at a size and colour the
          theme does not own. It joins the vocabulary instead: the same 22px
          height and the same boundary as the fields above it, lit with the
          accent when it is on, like a chosen cell.
        */}
        <button
          type="button"
          onClick={() => props.onMonthlyBestChange(!props.monthlyBest)}
          disabled={busy}
          aria-pressed={props.monthlyBest}
          title="Keep only the best scene of each month"
          className={cn(
            "flex h-[1.375rem] items-center gap-1 rounded-sm px-2 text-meta transition-colors inset-ring-1",
            "focus-visible:outline-none focus-visible:inset-ring-ring",
            busy
              ? "cursor-not-allowed inset-ring-line text-muted-foreground/40"
              : props.monthlyBest
                ? "bg-accent-dim text-accent-quiet inset-ring-accent"
                : "text-muted-foreground inset-ring-line-strong hover:text-foreground"
          )}
        >
          <Check
            className={cn("size-3 shrink-0", props.monthlyBest ? "" : "opacity-0")}
          />
          best/month
        </button>
      </>
    ),

    model: (
      /*
        A menu, not three buttons. The guidelines expand an enum into buttons
        where its members can be glyphed and leave it a dropdown where they
        cannot -- and "Random Forest", "Temporal Transformer" and "Prithvi-EO
        2.0" are names, not pictures.
      */
      <select
        value={props.modelKind}
        disabled={busy}
        onChange={(e) => props.onModelKindChange(e.target.value as ModelKind)}
        title={MODEL_OPTIONS.find((m) => m.id === props.modelKind)?.detail}
        className="field-input h-[1.375rem] w-full px-1 text-meta"
      >
        {MODEL_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    ),

    mode: (
      /*
        Choices rather than the header's radio, and this is the correction as
        much as the move is: `modeBlockedBy` says cumulative retention runs on
        Random Forest, and the map's control panel honoured that before this one,
        StudioHeaderRadio has no refused state to honour it with -- so the
        studio let a reader pick a mode the model does not produce. Here the
        rule both disables the option and says why.
      */
      <div className="flex flex-wrap gap-1">
        {MODE_OPTIONS.map((o) => (
          <Choice
            key={o.id}
            label={o.label}
            chosen={props.mode === o.id}
            disabled={busy}
            blockedBy={modeBlockedBy(o.id, props.modelKind)}
            onPick={() => props.onModeChange(o.id)}
          />
        ))}
      </div>
    ),

    scene: props.compose ? (
      <>
        {/*
          THE LIST IS ASKED FOR, NOT ASSUMED. Scenes come from a query over the
          area and the period, which costs a round trip, so nothing is fetched
          until a reader asks -- and the button says which period it will ask
          about by simply being on the card the period feeds.
        */}
        <button
          type="button"
          onClick={props.compose.onListScenes}
          disabled={busy || !props.hasArea || props.compose.scenesLoading}
          className="flex h-[1.375rem] items-center justify-center gap-1.5 rounded-sm bg-surface-raised/40 px-2 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
        >
          {props.compose.scenesLoading && (
            <CircleNotch className="size-3 animate-spin" />
          )}
          {props.compose.scenes.length ? "Refresh scenes" : "List scenes"}
        </button>
        {props.compose.scenesError ? (
          <span className="text-meta text-destructive-quiet">
            {props.compose.scenesError}
          </span>
        ) : props.compose.scenes.length ? (
          <select
            value={props.compose.selectedSceneId}
            disabled={busy}
            onChange={(e) => props.compose?.onSelectScene(e.target.value)}
            className="field-input h-[1.375rem] w-full px-1 text-meta"
          >
            {props.compose.scenes.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.date}
                {` \u00b7 ${Math.round(sc.cloud_cover)}% cloud`}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-meta text-muted-foreground">
            No scenes listed yet.
          </span>
        )}
      </>
    ) : null,

    composite: props.compose ? (
      <div className="flex flex-wrap gap-1">
        <Choice
          label="RGB"
          chosen={props.compose.kind === "rgb"}
          disabled={busy}
          onPick={() => props.compose?.onKindChange("rgb")}
        />
        <Choice
          label="Index"
          chosen={props.compose.kind === "index"}
          disabled={busy}
          onPick={() => props.compose?.onKindChange("index")}
        />
      </div>
    ) : null,

    bands: props.compose ? (
      /*
        The presets, as a menu. Their names are names -- "True color", "False
        colour IR" -- and the guideline this file already follows leaves an
        enum a dropdown where its members cannot be glyphed.
      */
      <select
        value={
          RGB_PRESETS.find(
            (r) => r.bands.join() === props.compose?.bands.join()
          )?.id ?? ""
        }
        disabled={busy}
        onChange={(e) => {
          const hit = RGB_PRESETS.find((r) => r.id === e.target.value)
          if (hit) props.compose?.onBandsChange([...hit.bands] as [string, string, string])
        }}
        title={
          RGB_PRESETS.find((r) => r.bands.join() === props.compose?.bands.join())
            ?.description
        }
        className="field-input h-[1.375rem] w-full px-1 text-meta"
      >
        {!RGB_PRESETS.some(
          (r) => r.bands.join() === props.compose?.bands.join()
        ) && <option value="">Custom</option>}
        {RGB_PRESETS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
    ) : null,

    spectralIndex: props.compose ? (
      <select
        value={props.compose.index}
        disabled={busy}
        onChange={(e) =>
          props.compose?.onIndexChange(e.target.value as CompositeIndex)
        }
        title={INDICES.find((i) => i.id === props.compose?.index)?.description}
        className="field-input h-[1.375rem] w-full px-1 text-meta"
      >
        {INDICES.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </select>
    ) : null,

    stretch: props.compose ? (
      <>
        {/*
          The percentiles the colour ramp is fitted between. Two fields rather
          than one range, because they are read as numbers -- "2 to 98" is the
          convention this is departing from when it is changed.
        */}
        <NumberField
          label="Low"
          value={props.compose.stretchLow}
          min={0}
          max={49}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)}%`}
          parse={(t) => {
            const v = parseFloat(t.replace("%", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.compose?.onStretchChange(
              Math.round(v),
              props.compose.stretchHigh
            )
          }
        />
        <NumberField
          label="High"
          value={props.compose.stretchHigh}
          min={51}
          max={100}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)}%`}
          parse={(t) => {
            const v = parseFloat(t.replace("%", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.compose?.onStretchChange(
              props.compose.stretchLow,
              Math.round(v)
            )
          }
        />
      </>
    ) : null,

    waterIndex: props.water ? (
      /*
        Choices rather than a menu: three short names that fit, and the choice
        between them is a choice between definitions -- the title carries what
        each is computed from and who published it.
      */
      <div className="flex flex-wrap gap-1">
        {WATER_INDICES.map((o) => (
          <Choice
            key={o.id}
            label={o.label}
            chosen={props.water?.index === o.id}
            disabled={busy}
            onPick={() => props.water?.onIndexChange(o.id)}
          />
        ))}
      </div>
    ) : null,

    /*
      ALL FOUR, from the table that declares them. It offered the two that
      draw a raster, which was the whole of what the board could show at the
      time; the resource and the energy model report figures, and the studio
      reads those in the Solar result editor now.

      The labels are the table's own, cut to their head: "Resource at the AOI
      centroid" and "Photovoltaic energy model" are the names a reading gives
      them, and a card 8rem wide is not where a name is spelled in full.
    */
    product: (
      /*
        One card, two products, and the tool decides which table it reads.

        Not two node kinds. A `gridProduct` beside `product` would be two cards
        that are never on screen together, drawn from two tables, saying the
        same thing about different subjects -- and the graph would have to
        explain why the choice is called one name under solar and another under
        the record.
      */
      <div className="flex flex-wrap gap-1">
        {props.tool === "energy"
          ? ENERGY_PRODUCTS.map((p) => (
              <Choice
                key={p.id}
                label={p.label}
                chosen={props.energyProduct === p.id}
                disabled={busy}
                blockedBy={props.blockedFamilies?.[p.family]}
                onPick={() => props.onEnergyProduct?.(p.id)}
              />
            ))
          : SOLAR_PRODUCTS.map((p) => (
              <Choice
                key={p.id}
                label={SHORT_SOLAR[p.id]}
                chosen={props.solar?.product === p.id}
                disabled={busy}
                onPick={() => props.solar?.onProductChange(p.id)}
              />
            ))}
      </div>
    ),

    /*
      SHARED BY TWO PRODUCTS, because it is one question: how many years of the
      NASA POWER hourly record to read. Solar reads it for irradiation and wind
      reads it for the speed distribution, and the card writes to whichever
      bundle is present -- the graph only ever places it under one of them.
    */
    record:
      props.tool === "energy" &&
      props.energyProduct &&
      energyFamily(props.energyProduct) === "wind" &&
      props.wind ? (
        <NumberField
          label="Hourly"
          value={props.wind.recordYears}
          min={3}
          max={20}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)} yr`}
          parse={(t) => {
            const v = parseFloat(t.replace("yr", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.wind?.onRecordYearsChange(Math.round(v))}
        />
      ) : props.solar ? (
        <NumberField
          label="Hourly"
          value={props.solar.hourlyYears}
          min={3}
          max={20}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)} yr`}
          parse={(t) => {
            const v = parseFloat(t.replace("yr", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.solar?.onHourlyYearsChange(Math.round(v))}
        />
      ) : null,

    season: (
      /*
        Choices rather than a select. Six short labels wrap into a card at this
        width, and each one is then a target rather than a row inside a menu
        that has to be opened to see what the options are.
      */
      <div className="flex flex-wrap gap-1">
        {SOLAR_SEASONS.map((o) => (
          <Choice
            key={o.id}
            label={o.label}
            chosen={props.solar?.season === o.id}
            disabled={busy}
            onPick={() => props.solar?.onSeasonChange(o.id)}
          />
        ))}
      </div>
    ),

    radiation: props.solar ? (
      <div className="flex flex-col gap-1.5">
        <NumberField
          label="Climatology"
          value={props.solar.climatologyYears}
          min={5}
          max={40}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)} yr`}
          parse={(t) => {
            const v = parseFloat(t.replace("yr", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.solar?.onParamsChange({ climatologyYears: v })}
        />
        <NumberField
          label="Azimuth"
          value={props.solar.surfaceAzimuth}
          min={-180}
          max={180}
          step={5}
          disabled={busy}
          format={(v) => `${Math.round(v)}°`}
          parse={(t) => {
            const v = parseFloat(t.replace("°", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.solar?.onParamsChange({ surfaceAzimuth: v })}
        />
        {/*
          Blank is a value here and not an omission: it applies the reference
          ratio, and the result reports both it and the modelled one. A number
          field would have to invent a zero for that.
        */}
        <TextRow
          label="Ratio"
          value={props.solar.performanceRatio}
          placeholder="0.80"
          disabled={busy}
          onChange={(v) => props.solar?.onParamsChange({ performanceRatio: v })}
        />
      </div>
    ) : null,
    plant: props.solar ? (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1">
          <Choice
            label="Year one"
            chosen={props.solar.reportingBasis === "year_one"}
            disabled={busy}
            onPick={() =>
              props.solar?.onParamsChange({ reportingBasis: "year_one" })
            }
          />
          <Choice
            label="Lifetime"
            chosen={props.solar.reportingBasis === "lifetime_mean"}
            disabled={busy}
            onPick={() =>
              props.solar?.onParamsChange({ reportingBasis: "lifetime_mean" })
            }
          />
        </div>
        <NumberField
          label="Degradation"
          value={props.solar.degradationPct}
          min={0}
          max={5}
          step={0.1}
          disabled={busy}
          format={(v) => `${v.toFixed(2)} %/yr`}
          parse={(t) => {
            const v = parseFloat(t.replace("%/yr", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.solar?.onParamsChange({ degradationPct: v })}
        />
        <NumberField
          label="Period"
          value={props.solar.analysisPeriodYears}
          min={1}
          max={40}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)} yr`}
          parse={(t) => {
            const v = parseFloat(t.replace("yr", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.solar?.onParamsChange({ analysisPeriodYears: v })
          }
        />
        <NumberField
          label="Buildable"
          value={props.solar.buildableFraction}
          min={0.05}
          max={1}
          step={0.05}
          disabled={busy}
          format={(v) => v.toFixed(2)}
          parse={(t) => {
            const v = parseFloat(t.trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.solar?.onParamsChange({ buildableFraction: v })
          }
        />
        {/*
          A menu and not chips: eight density bases with names like "Ong T4,
          above 20 MW, direct array" are references rather than pictures, which
          is the same reason the model stays a menu on the classification card.
        */}
        <SelectRow
          label="Density"
          value={props.solar.densityBasis}
          disabled={busy}
          options={ENERGY_CAPACITY_DENSITY_BASES}
          onChange={(v) => props.solar?.onParamsChange({ densityBasis: v })}
        />
      </div>
    ) : null,
    array: props.solar ? (
      <div className="flex flex-col gap-1.5">
        <NumberField
          label="GCR fixed"
          value={props.solar.gcrFixed}
          min={0.1}
          max={0.9}
          step={0.005}
          disabled={busy}
          format={(v) => v.toFixed(3)}
          parse={(t) => {
            const v = parseFloat(t.trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.solar?.onParamsChange({ gcrFixed: v })}
        />
        <NumberField
          label="GCR tracker"
          value={props.solar.gcrTracker}
          min={0.1}
          max={0.9}
          step={0.005}
          disabled={busy}
          format={(v) => v.toFixed(3)}
          parse={(t) => {
            const v = parseFloat(t.trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.solar?.onParamsChange({ gcrTracker: v })}
        />
        <NumberField
          label="Rotation"
          value={props.solar.trackerMaxAngleDeg}
          min={0}
          max={90}
          step={5}
          disabled={busy}
          format={(v) => `${Math.round(v)}°`}
          parse={(t) => {
            const v = parseFloat(t.replace("°", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.solar?.onParamsChange({ trackerMaxAngleDeg: v })
          }
        />
        {/*
          Blank labels the diurnal profile in UTC, which is what POWER
          publishes. Not zero: an unstated offset and an offset of zero are the
          same number and different claims.
        */}
        <TextRow
          label="UTC offset"
          value={props.solar.utcOffset}
          placeholder="UTC"
          disabled={busy}
          onChange={(v) => props.solar?.onParamsChange({ utcOffset: v })}
        />
      </div>
    ) : null,
    losses: props.solar ? (
      <div className="flex flex-col gap-1.5">
        {/*
          Two tables, and the split between them is not cosmetic. The declared
          terms are in the modelled ratio; the optional ones are omitted from
          it and are what the reference ratio covers instead. Merging them
          would put a term the model applies beside one it does not.
        */}
        <span className="eyebrow !text-micro">Declared</span>
        {ENERGY_DECLARED_LOSSES.map((l) => (
          <LossRow
            key={l.key}
            label={l.label}
            value={props.solar?.declaredLoss[l.key] ?? l.defaultPct}
            disabled={busy}
            onChange={(v) => props.solar?.onLossChange("declared", l.key, v)}
          />
        ))}
        <span className="eyebrow mt-1 !text-micro">Optional</span>
        {ENERGY_OPTIONAL_LOSSES.map((l) => (
          <LossRow
            key={l.key}
            label={l.label}
            value={props.solar?.optionalLoss[l.key] ?? l.defaultPct}
            disabled={busy}
            onChange={(v) => props.solar?.onLossChange("optional", l.key, v)}
          />
        ))}
      </div>
    ) : null,
    slope: props.solar ? (
      <>
        <NumberField
          label="Acceptable"
          value={props.solar.slopeAcceptableDeg}
          min={1}
          max={45}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)}°`}
          parse={(t) => {
            const v = parseFloat(t.replace("°", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.solar?.onSlopeChange(
              Math.round(v),
              props.solar.slopeRestrictiveDeg
            )
          }
        />
        <NumberField
          label="Restrictive"
          value={props.solar.slopeRestrictiveDeg}
          min={1}
          max={45}
          step={1}
          disabled={busy}
          format={(v) => `${Math.round(v)}°`}
          parse={(t) => {
            const v = parseFloat(t.replace("°", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.solar?.onSlopeChange(
              props.solar.slopeAcceptableDeg,
              Math.round(v)
            )
          }
        />
      </>
    ) : null,

    turbine: props.wind ? (
      <>
        <NumberField
          label="Hub height"
          value={props.wind.hubHeightM}
          min={10}
          max={200}
          step={5}
          disabled={busy}
          format={(v) => `${Math.round(v)} m`}
          parse={(t) => {
            const v = parseFloat(t.replace("m", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.wind?.onHubHeightChange(Math.round(v))}
        />
        <NumberField
          label="Calm below"
          value={props.wind.calmThresholdMS}
          min={0.5}
          max={10}
          step={0.5}
          disabled={busy}
          format={(v) => `${v.toFixed(1)} m/s`}
          parse={(t) => {
            const v = parseFloat(t.replace("m/s", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.wind?.onCalmThresholdChange(v)}
        />
      </>
    ) : null,

    /*
      TWO VALUES AND NOT ONE, which is the reading rather than a setting.

      Hub-height speed comes from a log profile over an assumed surface
      roughness, and two roughnesses that both describe the ground plausibly
      give materially different speeds. The screening reports the span instead
      of choosing, so the span is what the card edits.
    */
    roughness: props.wind ? (
      <>
        <NumberField
          label="Low"
          value={props.wind.roughnessLowM}
          min={0.001}
          max={2}
          step={0.01}
          disabled={busy}
          format={(v) => `${v.toFixed(3)} m`}
          parse={(t) => {
            const v = parseFloat(t.replace("m", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.wind?.onRoughnessChange(v, props.wind.roughnessHighM)
          }
        />
        <NumberField
          label="High"
          value={props.wind.roughnessHighM}
          min={0.001}
          max={2}
          step={0.01}
          disabled={busy}
          format={(v) => `${v.toFixed(3)} m`}
          parse={(t) => {
            const v = parseFloat(t.replace("m", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) =>
            props.wind?.onRoughnessChange(props.wind.roughnessLowM, v)
          }
        />
      </>
    ) : null,

    /*
      A MULTIPLE CHOICE, and the only one on this graph.

      The envelope is the disagreement between products, so one product is not
      a smaller run -- it is a different claim, an extent with no measure of how
      much of it that product chose. The sidecar refuses fewer than two, and the
      card refuses to unpick the second.
    */
    models: props.flood ? (
      <div className="flex flex-wrap gap-1">
        {props.flood.demOptions.map((o) => {
          const on = props.flood!.demIds.includes(o.id)
          return (
            <Choice
              key={o.id}
              label={o.label}
              chosen={on}
              disabled={
                busy || (on && props.flood!.demIds.length <= FLOOD_LEAST_DEMS)
              }
              onPick={() =>
                props.flood?.onDemIdsChange(
                  on
                    ? props.flood.demIds.filter((d) => d !== o.id)
                    : [...props.flood.demIds, o.id]
                )
              }
            />
          )
        })}
      </div>
    ) : null,

    threshold: props.flood ? (
      <>
        <NumberField
          label="Reference"
          value={props.flood.referenceThresholdM}
          min={0.5}
          max={20}
          step={0.5}
          disabled={busy}
          format={(v) => `${v.toFixed(1)} m`}
          parse={(t) => {
            const v = parseFloat(t.replace("m", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.flood?.onReferenceThresholdChange(v)}
        />
        <NumberField
          label="Drainage"
          value={props.flood.drainageKm2}
          min={0.05}
          max={50}
          step={0.05}
          disabled={busy}
          format={(v) => `${v.toFixed(2)} km²`}
          parse={(t) => {
            const v = parseFloat(t.replace("km²", "").trim())
            return Number.isFinite(v) ? v : null
          }}
          onChange={(v) => props.flood?.onDrainageChange(v)}
        />
      </>
    ) : null,

    run: (
      <>
        <button
          type="button"
          onClick={props.onRun}
          disabled={!props.canRun || busy}
          // Only the reason it cannot go. What it is doing is drawn below.
          title={!props.canRun ? props.blockedBy : undefined}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            !props.canRun || busy
              ? "cursor-not-allowed bg-surface-raised/40 text-muted-foreground"
              : "bg-accent text-accent-foreground hover:opacity-90"
          )}
        >
          {busy ? (
            <CircleNotch className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {props.runLabel}
        </button>

        {/*
          WHAT THE RUN IS DOING, IN THE CARD THE RUN IS IN.

          It was a bare hairline here and a line of words in the studio's foot,
          which put the figure a reader is watching at the other end of the
          board from the thing they pressed. The stage now reads where the work
          is, and the strip at the foot keeps its copy: the two answer different
          situations, not one twice. This is for a reader watching the run they
          started; the strip is what they still have after going to look at a
          raster in another area, where this card is not on screen at all.

          THE REFLOW ARGUMENT IS SETTLED BY THE CARD, not abandoned. The run
          band kept this message in a tooltip because a line rewriting itself
          several times a second costs more attention than it returns -- and
          the cost there was that the line was in a row that resized around it.
          A card is a fixed width and this line truncates inside it, so the
          words change and nothing moves.

          The stage comes from the run log rather than from `progressMsg`,
          because the foot's strip reads the log and two accounts of one run
          that can disagree is worse than either alone.

          Drawn only while running: a track at rest would assert that a run
          exists.
        */}
        {busy && (
          <div className="flex flex-col gap-1">
            {props.runLog?.length ? (
              <RunLog entries={props.runLog} />
            ) : (
              /*
                Before the first stage arrives there is no log to draw, and a
                run that has said nothing still has a percentage and a message.
                One line here rather than an empty box, which would read as a
                log that had failed to start.
              */
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="telemetry shrink-0 text-[9px] tabular-nums text-muted-foreground">
                  {pct}%
                </span>
                <span className="min-w-0 flex-1 truncate text-meta text-foreground">
                  {stage ?? "Running"}
                </span>
              </div>
            )}
            <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong/30">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${props.runLabel} progress`}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-1">
          {/*
            Not disabled while running -- that is when the trace inside it is
            being written, and shutting the door on the log at the moment it
            fills would be the opposite of the point.
          */}
          {brief && (
            <MethodPanel
              brief={brief}
              runLog={props.runLog ?? []}
              running={busy}
              surface={props.surface}
            />
          )}
          {props.tool === "classify" && props.onAnalyzeLULC && (
            <button
              type="button"
              onClick={props.onAnalyzeLULC}
              disabled={busy || !props.hasArea || props.lulcRunning}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm bg-surface-raised/40 px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              {props.lulcRunning && <CircleNotch className="size-3 animate-spin" />}
              Land cover
            </button>
          )}
        </div>
      </>
    ),
  }

  const fallback = defaultPlaces(graph, heights)

  /*
    Which cards the request actually reaches, read off the edges.

    Derived rather than named. `layers` is the only card wired to nothing
    today, and hardcoding it here would put the rule in a second place from the
    graph that decides it -- so the next card added without an edge would draw
    as though it fed the run, and the discrepancy would be silent in the way
    the stale heights above were. The graph already answers the question; this
    reads the answer.
  */
  const wired = new Set(graph.edges.flat())

  /*
    WHAT EACH CARD SUPPLIES, AND THE REPORT OF IT.

    Reported through an effect keyed on the values rather than during the
    render that computed them: the caller stores this, and a component that
    wrote to its parent while rendering would be describing a board that had
    not been drawn yet.
  */
  const values = cardValues(props)
  const marks = Object.fromEntries(
    (Object.keys(values) as RunNodeId[]).map((id) => [id, signature(values[id])])
  ) as Record<RunNodeId, string>
  const onInputs = props.onInputs
  const marksKey = JSON.stringify(marks)
  useEffect(() => {
    onInputs?.(JSON.parse(marksKey) as Record<string, string>)
  }, [onInputs, marksKey])


  const nodes: CanvasNode[] = graph.nodes.map((spec) => {
    /*
      A card no edge touches is not an input to the run, and runGraph.ts places
      one deliberately: the layers card says what is drawn while the question
      is being set up and changes nothing about the answer.
    */
    const aside = !wired.has(spec.id)
    /*
      NO THIRD TONE. A card holding nothing was lit here twice over -- once as
      `held`, on the opposite condition, and once as `blocking` -- and both
      were taken out: the wire leaving such a card already goes dashed and
      reads "not set" at the card's own edge, and the card's body already reads
      "none" where its value would be. A third mark on the card put a loud
      outline over a header that was already saying which part of the question
      the card answers. `supplied` still decides the WIRE; see canvasEdges.
    */
    const tone: CanvasNode["tone"] =
      spec.id === "run" ? "action" : aside ? "aside" : undefined
    const part = aside ? null : subject(values[spec.id])
    return {
      id: spec.id,
      place: places[spec.id] ?? fallback[spec.id],
      h: heights[spec.id] ?? spec.h,
      tone,
      subject: partPaint(part),
      status: spec.id === "run" && busy ? "busy" : undefined,
      header:
        spec.id === "run" && props.tool ? (
          <Head icon={TOOL_ICON[props.tool]} label={props.runLabel} />
        ) : (
          <Head
            icon={spec.icon}
            label={spec.label}
            aside={aside}
            colour={partGlyph(part)}
          />
        ),
      children: body[spec.id],
    }
  })

  /*
    WHAT EACH WIRE HAS TO SAY.

    THE FAN-IN IS WHERE A RUN IS VISIBLE, and only there. Wires that end
    anywhere else are gates -- the model gating the mode, the composite gating
    the bands -- and a gate is a rule about which choices exist rather than
    something a run reads. Reporting a state on one would say the run consumed
    a rule; writing a reading along one would say it read the same value twice.
    So a gate carries neither, and draws as it always did.

    READ AND FAILED ARE ABOUT THE ANSWER ON SCREEN, not about the run that is
    over: the comparison is between what this card supplies NOW and what the
    last run read. Change the season afterwards and its wire falls back to
    pending while the area's stays read, which is the true state of a raster
    that answers about one and not the other.

    A card that supplies nothing -- see `none` in cardValues -- has a signature
    that cannot change, so it settles with the run like every other wire and
    never notices a change. It is the weaker claim of the two available, and it
    is the honest one: the alternative is a wire that says pending forever
    after a run that read it.

    WHICH INPUTS ARE ABSENT is now a question about the value rather than a
    list kept here. It was three cards named by hand -- the area, the flood
    comparison, the store -- and the fourth that needed it had been missed: a
    composition with no scene chosen drew a wire as though it carried one. See
    `supplied` in runValue.ts.
  */
  const last = props.lastRun
  /*
    What each input is called, taken from the graph rather than written again.

    The same word the card's own header carries, in the same case, so a reading
    on a wire and the card it left are one subject. SPEC is where the pairing
    lives and this reads it.
  */
  const named = new Map(graph.nodes.map((n) => [n.id, n.label.toUpperCase()]))
  const canvasEdges: CanvasEdge[] = graph.edges.map(([from, to]) => {
    const value = values[from]
    const state: EdgeState | undefined = !supplied(value)
      ? "missing"
      : to !== "run"
        ? undefined
        : busy
          ? "reading"
          : last && last.inputs[from] === marks[from]
            ? last.ok
              ? "read"
              : "failed"
            : "pending"
    return {
      from,
      to,
      state,
      label: to === "run" ? reading(value) : undefined,
      name: to === "run" ? named.get(from) : undefined,
      note: state ? EDGE_NOTE[state] : undefined,
      /*
        The wire in the colour of the card it leaves, for as long as it has no
        outcome of its own to report. A gate carries no reading and takes none
        either: what it carries is a rule about which choices exist, and the
        parts are about what a run is made of.
      */
      paint: to === "run" ? partGlyph(subject(value)) : undefined,
    }
  })

  return (
    <NodeCanvas
      nodes={nodes}
      edges={canvasEdges}
      onMove={move}
      onMeasure={onMeasure}
    />
  )
}
