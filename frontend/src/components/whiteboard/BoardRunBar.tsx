/**
 * What to run on the board's area, along the foot.
 *
 * It was a column in the sidebar first, which was wrong twice over. One
 * product's parameters already filled 15rem and there are three products with
 * solar and wind still to come -- a narrow column would have become a scroll
 * with no end. And the foot was carrying the period timeline, which is a
 * control ABOUT THE MAP: a window dragged over the scenes that fall in it,
 * read against the view. With the map covered there is nothing to read it
 * against, so the band was spent on something this surface cannot use.
 *
 * A band is also the right shape for the work. These are eight or nine small
 * choices, and side by side they are one line to scan rather than a page to
 * scroll.
 *
 * What it must NOT duplicate is protected elsewhere: the models, the modes and
 * the rule between them come from lib/classifyOptions.ts, and every value is
 * the map screen's own state passed straight through. Two renderings of one
 * set of choices is a design decision; two copies of the choices would be a
 * bug waiting for someone to add a model.
 */
import {
  ArrowRight,
  CalendarRange,
  Check,
  Droplet,
  Grid2x2,
  History,
  Image as ImageIcon,
  Loader2,
  type LucideIcon,
  Mountain,
  Network,
  Package,
  PenTool,
  Pentagon,
  Play,
  Sun,
  SunSnow,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react"
import { DateField } from "@/components/ui/DateField"
import { NumberField } from "@/components/ui/NumberField"
import {
  MODEL_OPTIONS,
  MODE_OPTIONS,
  modeBlockedBy,
  type ClassifyMode,
} from "@/lib/classifyOptions"
import { BOARD_TOOLS, type BoardToolId } from "@/lib/mapTools"
import type { ModelKind, SolarSeason } from "@/lib/types"
import { SOLAR_SEASONS } from "@/lib/solarOptions"
import { cn } from "@/lib/utils"

/*
  A glyph per tool, so the two that are not chosen can be shown without their
  names. The same glyphs the board's tree uses for the rasters each tool
  produces, because a tool and its output are one subject.
*/
const TOOL_ICON: Record<BoardToolId, LucideIcon> = {
  classify: Grid2x2,
  compose: ImageIcon,
  water: Droplet,
  solar: Sun,
}


/** A named group of controls. */
function Group({
  icon: Icon,
  label,
  children,
}: {
  /** The group's subject, the same intent as the board tree's layerIcon(). */
  icon: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    /*
      The label ABOVE its controls, not in front of them.

      On one line "SEASON Annual Winter Summer Winter crop" reads as a phrase
      rather than as a heading and six options: the label competes with the
      values for the same horizontal run, and at 9px it loses. Stacked, it
      becomes a column heading and the eye finds the group before it reads any
      of it. This is what the band's height is for.
    */
    <div className="flex shrink-0 flex-col justify-center gap-1 px-2">
      {/*
        The glyph rides the eyebrow row, which is the cheap one: a label is
        26-55px wide against control rows of 96-388px, so a 12px icon there
        costs nothing horizontally. .eyebrow sets the colour and lucide strokes
        currentColor, so the glyph is muted with its label without saying so.
      */}
      <span className="eyebrow !text-[9px] flex shrink-0 items-center gap-1.5">
        <Icon className="size-3 shrink-0" strokeWidth={2} />
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

function Divider() {
  return (
    <div
      // Tall enough to separate a stacked group rather than only its controls.
      className="h-9 w-px shrink-0"
      style={{ background: "rgb(var(--p-line) / 0.28)" }}
    />
  )
}

/**
 * One of a set of choices.
 *
 * Plain words rather than bordered cards: a border per option spends the
 * band's height on edges, and the chosen one takes the same raised plate the
 * board's tree uses for its active row, so the two surfaces agree about what
 * "chosen" looks like.
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
  blockedBy?: string | null
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      title={blockedBy ?? undefined}
      className={cn(
        /*
          The RING carries the chosen state, not the fill and not an underline.

          The fill is a hue mark only -- accent-dim measures 1.35 on ink -- so
          it cannot carry the state alone, and saying so is the point: the ring
          clears 3.88 against its own plate and 5.23 against the ink outside.
          An accent hairline under the cell was tried and dropped: that exact
          rule is the board tree's DROP INDICATOR (BoardSidebar), where an
          accent line on an edge means where a dragged row would land. One
          idiom, one meaning.

          The label stays text-foreground, 9.76 on accent-dim, against 6.93 for
          an unchosen neighbour on ink. accent-quiet was measured and rejected:
          5.72 on the plate is DIMMER than muted-on-ink, which would make the
          chosen value the faintest thing in its own group.

          One height with NumberField and DateField, so a control row scans as
          one line rather than three.
        */
        "inline-flex h-[1.375rem] shrink-0 items-center rounded-sm px-1.5 text-meta transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : chosen
            ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
            : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
      )}
    >
      {label}
    </button>
  )
}

export interface BoardRunBarProps {
  /**
   * Where the band's left edge is, not how far its content is indented.
   *
   * It was a padding, which put the band UNDER the board's column and merely
   * moved its contents clear -- so the column had to stop short of the foot to
   * stay readable. Now the band begins where the column ends and the column
   * runs to the bottom, which is the same total width with one fewer surface
   * crossing another.
   */
  leftOffset?: string
  /** Where the board's right column begins — same seam as the stats band. */
  rightOffset?: string

  tool: BoardToolId | null
  onToolChange: (id: BoardToolId) => void
  /**
   * Everything the solar tool needs, or absent where it cannot be run.
   *
   * One object rather than nine loose props, because they arrive and leave
   * together: a band with no way to start a solar run must not offer solar in
   * its strip, and absence is how it says so. Only the two products that draw
   * a raster are here -- the other two produce figures, which no plane can be.
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

  hasArea: boolean
  activeExample: string
  /** Display name of the active custom AOI (drawn / drawn 2 / renamed). */
  areaLabel?: string
  onImportPolygon: () => void
  /** Opens a map to draw one on; absent where the caller offers no such map. */
  onDrawArea?: () => void
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
}
export function BoardRunBar(props: BoardRunBarProps) {
  const busy = props.running

  return (
    <div
      /*
        Where the period timeline sits on the map, at the same height, taking
        the foot's own reservation -- see --map-foot in index.css. It starts at
        the column's right edge rather than spanning the window, so the two are
        neighbours rather than one lying over the other.
      */
      className="app-no-drag absolute bottom-0 z-[900] flex h-[var(--map-band,3.0625rem)] items-center border-t"
      style={{
        left: props.leftOffset ?? 0,
        right: props.rightOffset ?? 0,
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      {/*
        The parameters scroll sideways; the action does not. On a narrow window
        the groups run out of room before the button does, and a run button
        that had scrolled away would be the one control that has to be
        reachable from anywhere in the band.
      */}
      <div className="panel-scroll flex min-w-0 flex-1 items-center overflow-x-auto py-1">
        <div
          role="tablist"
          className="flex shrink-0 items-center gap-0.5 pl-2.5"
        >
          {/*
            Solar only where this band was given a way to run it. Offering a
            tool that cannot be started is the dead control this file's
            neighbour argues against, and it would be a whole tab of one.
          */}
          {BOARD_TOOLS.filter((t) => t.id !== "solar" || !!props.solar).map(
            (t) => {
              const on = props.tool === t.id
              const Icon = TOOL_ICON[t.id]
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => props.onToolChange(t.id)}
                  title={t.label}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-meta transition-colors",
                    "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
                    on
                      ? "bg-surface-raised text-foreground"
                      : "text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                  {on && t.label}
                </button>
              )
            },
          )}
        </div>

        <Divider />

        <Group icon={Pentagon} label="Area">
          {/*
            Loud when there is an area and quiet when there is not. It is a
            readout rather than a field, so it takes no box -- but it is part of
            what Run will do, so demoting it wholesale would have hidden the
            answer. What is quiet is the ABSENCE.
          */}
          <span
            className={cn(
              "telemetry shrink-0 truncate text-meta",
              props.hasArea ? "max-w-[10rem] text-foreground" : "text-muted-foreground"
            )}
          >
            {props.hasArea ? props.activeExample || props.areaLabel || "drawn" : "none"}
          </span>
          {/*
            First of the three, because it is the one that MAKES an area: the
            other two act on one that exists. Drawing was the only way to get an
            AOI and the only place to do it was the map, so reaching it meant
            closing the board the area was being drawn for.
          */}
          {props.onDrawArea && (
            <button
              type="button"
              onClick={props.onDrawArea}
              disabled={busy}
              title="Draw an area on a map"
              className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-raised/60 hover:text-foreground disabled:opacity-40"
            >
              <PenTool className="size-3" />
            </button>
          )}
          <button
            type="button"
            onClick={props.onImportPolygon}
            disabled={busy}
            title="Import a polygon"
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-raised/60 hover:text-foreground disabled:opacity-40"
          >
            <Upload className="size-3" />
          </button>
          <button
            type="button"
            onClick={props.onClearArea}
            disabled={busy || !props.hasArea}
            title="Clear the area"
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface-raised/60 hover:text-foreground disabled:opacity-40"
          >
            <Trash2 className="size-3" />
          </button>
        </Group>

        {/*
          Withheld for solar, which reads none of these four. SolarTerrainRequest
          carries hourly_years and season; SolarSitingRequest carries the two
          slope limits. Neither sends a date, a cloud ceiling or a monthly pick,
          so leaving them drawn would be four controls that change nothing --
          worse than four absent ones, because they read as inputs to the run.
        */}
        {props.tool !== "solar" && (
          <>
            <Divider />

            <Group icon={CalendarRange} label="Period">
              {/*
            Not `<input type="date">`. The platform draws its picker BELOW the
            field, and a field on the foot band has nothing below it -- the
            calendar rendered over the dock, cut off, with no way to reach the
            days it had hidden. Where that picker opens is not something a page
            can ask the platform to change, so the calendar is drawn by
            DateField and opens upward.
          */}
              <DateField
                value={props.start}
                disabled={busy}
                onChange={props.onStartChange}
              />
              <ArrowRight
                className="size-3 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <DateField
                value={props.end}
                disabled={busy}
                onChange={props.onEndChange}
              />
              <div className="w-24 shrink-0">
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
              </div>
              {/*
                A boxed toggle rather than a native checkbox, which was the one
                control here drawing platform chrome -- at a size and colour the
                theme does not own. Now it joins the vocabulary: the same 22px
                height and the same boundary as the fields beside it, lit with
                the accent when it is on, like a chosen cell.
              */}
              <button
                type="button"
                onClick={() => props.onMonthlyBestChange(!props.monthlyBest)}
                disabled={busy}
                aria-pressed={props.monthlyBest}
                title="Keep only the best scene of each month"
                className={cn(
                  "flex h-[1.375rem] shrink-0 items-center gap-1 rounded-sm px-2 text-meta transition-colors inset-ring-1",
                  "focus-visible:outline-none focus-visible:inset-ring-ring",
                  busy
                    ? "cursor-not-allowed inset-ring-line text-muted-foreground/40"
                    : props.monthlyBest
                      ? "bg-accent-dim text-accent-quiet inset-ring-accent"
                      : "text-muted-foreground inset-ring-line-strong hover:text-foreground"
                )}
              >
                <Check
                  className={cn(
                    "size-3 shrink-0",
                    props.monthlyBest ? "" : "opacity-0"
                  )}
                  strokeWidth={2.25}
                />
                best/month
              </button>
            </Group>
          </>
        )}

        {props.tool === "solar" && props.solar && (
          <>
            <Divider />
            <Group icon={Package} label="Product">
                <Choice
                  label="Irradiation"
                  chosen={props.solar.product === "terrain"}
                  disabled={busy}
                  onPick={() => props.solar?.onProductChange("terrain")}
                />
                <Choice
                  label="Siting"
                  chosen={props.solar.product === "siting"}
                  disabled={busy}
                  onPick={() => props.solar?.onProductChange("siting")}
                />
            </Group>

            {props.solar.product === "terrain" && (
              <>
                <Divider />
                <Group icon={History} label="Record">
                  <div className="w-24 shrink-0">
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
                      onChange={(v) =>
                        props.solar?.onHourlyYearsChange(Math.round(v))
                      }
                    />
                  </div>
                </Group>
                <Divider />
                {/*
                  Choice rather than a select, for the reason the Period group
                  states above: a platform picker opens below the field, and
                  this band has nothing below it. Six short labels fit.
                */}
                <Group icon={SunSnow} label="Season">
                    {SOLAR_SEASONS.map((o) => (
                      <Choice
                        key={o.id}
                        label={o.label}
                        chosen={props.solar?.season === o.id}
                        disabled={busy}
                        onPick={() => props.solar?.onSeasonChange(o.id)}
                      />
                    ))}
                </Group>
              </>
            )}

            {props.solar.product === "siting" && (
              <>
                <Divider />
                <Group icon={Mountain} label="Slope">
                  <div className="w-28 shrink-0">
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
                          props.solar.slopeRestrictiveDeg,
                        )
                      }
                    />
                  </div>
                  <div className="w-28 shrink-0">
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
                          Math.round(v),
                        )
                      }
                    />
                  </div>
                </Group>
              </>
            )}
          </>
        )}

        {props.tool === "classify" && (
          <>
            <Divider />
            <Group icon={Network} label="Model">
                {MODEL_OPTIONS.map((m) => (
                  <Choice
                    key={m.id}
                    label={m.label}
                    chosen={props.modelKind === m.id}
                    disabled={busy}
                    onPick={() => props.onModelKindChange(m.id)}
                  />
                ))}
            </Group>

            <Divider />
            <Group icon={Workflow} label="Mode">
                {MODE_OPTIONS.map((m) => {
                  const blocked = modeBlockedBy(m.id, props.modelKind)
                  return (
                    <Choice
                      key={m.id}
                      label={m.label}
                      chosen={props.mode === m.id}
                      disabled={busy || !!blocked}
                      blockedBy={blocked}
                      onPick={() => props.onModeChange(m.id)}
                    />
                  )
                })}
            </Group>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2.5">
        {props.tool === "classify" && props.onAnalyzeLULC && (
          <button
            type="button"
            onClick={props.onAnalyzeLULC}
            disabled={busy || !props.hasArea || props.lulcRunning}
            className="flex shrink-0 items-center gap-1.5 rounded-sm bg-surface-raised/40 px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
          >
            {props.lulcRunning && <Loader2 className="size-3 animate-spin" />}
            Land cover
          </button>
        )}
        <button
          type="button"
          onClick={props.onRun}
          disabled={!props.canRun || busy}
          /*
            The progress message is the button's tooltip rather than a second
            line: it changes several times a second, and a line that reflows on
            every change costs more attention than it returns.
          */
          title={
            !props.canRun
              ? props.blockedBy
              : busy
                ? props.progressMsg
                : undefined
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            !props.canRun || busy
              ? "cursor-not-allowed bg-surface-raised/40 text-muted-foreground"
              : "bg-accent text-white hover:opacity-90",
          )}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {props.runLabel}
        </button>
      </div>

      {/*
        The progress hairline rides the band's own top edge, so it reports
        without taking height. Only while running: a track drawn at rest would
        assert that a run exists.
      */}
      {busy && (
        <div
          className="absolute inset-x-0 top-0 h-px bg-accent transition-[width]"
          style={{ width: `${Math.round(props.progress * 100)}%` }}
          role="progressbar"
          aria-valuenow={Math.round(props.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${props.runLabel} progress`}
        />
      )}
    </div>
  )
}
