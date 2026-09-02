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
 */
import {
  ArrowDown,
  Check,
  Droplet,
  Grid2x2,
  Image as ImageIcon,
  Loader2,
  type LucideIcon,
  Play,
  Sun,
  Trash2,
  Upload,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { DateField } from "@/components/ui/DateField"
import { NumberField } from "@/components/ui/NumberField"
import {
  MODEL_OPTIONS,
  MODE_OPTIONS,
  modeBlockedBy,
  type ClassifyMode,
} from "@/lib/classifyOptions"
import type { BoardToolId } from "@/lib/mapTools"
import { methodBrief } from "@/lib/methodBrief"
import type { RunLogEntry } from "@/lib/runLog"
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
import { NodeCanvas, type CanvasNode } from "./NodeCanvas"
import { defaultPlaces, runGraph, type Place, type RunNodeId } from "./runGraph"

/**
 * One glyph per product, exported so the area header names them the same.
 *
 * The same glyphs the board's tree uses for the rasters each tool produces,
 * because a tool and its output are one subject.
 */
export const TOOL_ICON: Record<BoardToolId, LucideIcon> = {
  classify: Grid2x2,
  compose: ImageIcon,
  water: Droplet,
  solar: Sun,
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
function Choice({
  label,
  chosen,
  disabled,
  blockedBy,
  onPick,
}: {
  label: string
  chosen: boolean
  disabled?: boolean
  /**
   * Why this one cannot be picked, if it cannot.
   *
   * Carried separately from `disabled`, which is the whole card going quiet
   * while a run is on. A rule that refuses an option has something to say and
   * a busy surface does not.
   */
  blockedBy?: string | null
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled || !!blockedBy}
      title={blockedBy ?? undefined}
      className={cn(
        "inline-flex h-[1.375rem] shrink-0 items-center rounded-sm px-1.5 text-meta transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        disabled || blockedBy
          ? "cursor-not-allowed text-muted-foreground/40"
          : chosen
            ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
            : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}

/**
 * The header of a card: its glyph and its name, in the band's own vocabulary.
 *
 * `lit` takes the glyph to the accent and leaves the name where it is. The
 * border of a card is at the edge of vision when the eye is on the value in
 * the middle of it, and the glyph is the part of the header that is already
 * being looked past -- so it is the cheapest place to put a second signal that
 * the card is carrying something.
 */
function Head({
  icon: Icon,
  label,
  lit,
}: {
  icon: LucideIcon
  label: string
  lit?: boolean
}) {
  return (
    <>
      <Icon
        className={cn(
          "size-3 shrink-0",
          lit ? "text-accent-quiet" : "text-muted-foreground"
        )}
        strokeWidth={2}
      />
      <span className="eyebrow !text-[9px] truncate">{label}</span>
    </>
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
  icon: LucideIcon
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
   * Everything the solar tool needs, or absent where it cannot be run.
   *
   * One object rather than nine loose props, because they arrive and leave
   * together: a graph with no way to start a solar run must not offer solar
   * cards, and absence is how it says so.
   */
  solar?: {
    product: "terrain" | "siting"
    onProductChange: (p: "terrain" | "siting") => void
    hourlyYears: number
    onHourlyYearsChange: (v: number) => void
    season: SolarSeason
    onSeasonChange: (s: SolarSeason) => void
    slopeAcceptableDeg: number
    slopeRestrictiveDeg: number
    onSlopeChange: (acceptable: number, restrictive: number) => void
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

  const graph = runGraph(
    props.tool,
    props.solar ? props.solar.product : null,
    props.compose ? props.compose.kind : null
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
            icon={Trash2}
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
          strokeWidth={1.75}
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
            strokeWidth={2.25}
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
            <Loader2 className="size-3 animate-spin" />
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

    product: (
      <div className="flex flex-wrap gap-1">
        <Choice
          label="Irradiation"
          chosen={props.solar?.product === "terrain"}
          disabled={busy}
          onPick={() => props.solar?.onProductChange("terrain")}
        />
        <Choice
          label="Siting"
          chosen={props.solar?.product === "siting"}
          disabled={busy}
          onPick={() => props.solar?.onProductChange("siting")}
        />
      </div>
    ),

    record: props.solar ? (
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
            <Loader2 className="size-3.5 animate-spin" />
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
              {props.lulcRunning && <Loader2 className="size-3 animate-spin" />}
              Land cover
            </button>
          )}
        </div>
      </>
    ),
  }

  const fallback = defaultPlaces(graph)
  const nodes: CanvasNode[] = graph.nodes.map((spec) => {
    /*
      THE ONE CARD WHOSE EMPTINESS IS A REAL STATE. Every other input arrives
      with a value -- a period has dates, a model is one of three, a mode is
      one of two -- so there is nothing for a light to distinguish. The area
      is the only one that can be genuinely absent, it is the one the run is
      blocked on when it is, and "none" in small type in the middle of a card
      is not where the eye goes first.
    */
    const held = spec.id === "area" && props.hasArea
    const tone: CanvasNode["tone"] =
      spec.id === "run" ? "action" : held ? "held" : undefined
    return {
      id: spec.id,
      place: places[spec.id] ?? fallback[spec.id],
      h: spec.h,
      tone,
      header:
        spec.id === "run" && props.tool ? (
          <Head icon={TOOL_ICON[props.tool]} label={props.runLabel} />
        ) : (
          <Head icon={spec.icon} label={spec.label} lit={held} />
        ),
      children: body[spec.id],
    }
  })

  return <NodeCanvas nodes={nodes} edges={graph.edges} onMove={move} />
}
