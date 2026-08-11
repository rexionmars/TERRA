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
  label,
  children,
}: {
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
    <div className="flex shrink-0 flex-col justify-center gap-1 px-2.5">
      <span className="eyebrow !text-[9px] shrink-0">{label}</span>
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
        "shrink-0 rounded-sm px-1.5 py-0.5 text-meta transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : chosen
            ? "bg-surface-raised text-foreground"
            : "text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground"
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
      className="app-no-drag absolute bottom-0 right-0 z-[900] flex h-[var(--map-foot,3.0625rem)] items-center border-t"
      style={{
        left: props.leftOffset ?? 0,
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
        <div className="flex shrink-0 items-center gap-0.5 pl-2.5">
          {/*
            Solar only where this band was given a way to run it. Offering a
            tool that cannot be started is the dead control this file's
            neighbour argues against, and it would be a whole tab of one.
          */}
          {BOARD_TOOLS.filter((t) => t.id !== "solar" || !!props.solar).map((t) => {
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
                    : "text-muted-foreground hover:bg-surface-raised/60 hover:text-foreground"
                )}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                {on && t.label}
              </button>
            )
          })}
        </div>

        <Divider />

        <Group label="Area">
          <span className="telemetry shrink-0 text-meta text-foreground">
            {props.hasArea ? props.activeExample || "drawn" : "none"}
          </span>
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

        <Group label="Period">
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
          <span className="shrink-0 text-meta text-muted-foreground">→</span>
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
          <label className="flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground">
            <input
              type="checkbox"
              checked={props.monthlyBest}
              disabled={busy}
              onChange={(e) => props.onMonthlyBestChange(e.target.checked)}
              className="accent-primary"
            />
            best/month
          </label>
        </Group>
          </>
        )}

        {props.tool === "solar" && props.solar && (
          <>
            <Divider />
            <Group label="Product">
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
                <Group label="Record">
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
                <Group label="Season">
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
                <Group label="Slope">
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
                          props.solar.slopeRestrictiveDeg
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
                          Math.round(v)
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
            <Group label="Model">
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
            <Group label="Mode">
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
            !props.canRun ? props.blockedBy : busy ? props.progressMsg : undefined
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            !props.canRun || busy
              ? "cursor-not-allowed bg-surface-raised/40 text-muted-foreground"
              : "bg-accent text-white hover:opacity-90"
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
