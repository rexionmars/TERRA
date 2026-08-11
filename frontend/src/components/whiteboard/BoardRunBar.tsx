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
  Trash2,
  Upload,
} from "lucide-react"
import { NumberField } from "@/components/ui/NumberField"
import {
  MODEL_OPTIONS,
  MODE_OPTIONS,
  modeBlockedBy,
  type ClassifyMode,
} from "@/lib/classifyOptions"
import { MAP_TOOLS, type MapToolId } from "@/lib/mapTools"
import type { ModelKind } from "@/lib/types"
import { cn } from "@/lib/utils"

/*
  A glyph per tool, so the two that are not chosen can be shown without their
  names. The same glyphs the board's tree uses for the rasters each tool
  produces, because a tool and its output are one subject.
*/
const TOOL_ICON: Record<MapToolId, LucideIcon> = {
  classify: Grid2x2,
  compose: ImageIcon,
  water: Droplet,
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
    <div className="flex shrink-0 items-center gap-1.5 px-2.5">
      <span className="eyebrow !text-[9px] shrink-0">{label}</span>
      {children}
    </div>
  )
}

function Divider() {
  return (
    <div
      className="h-5 w-px shrink-0"
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
   * How far in the band's own left end is already spoken for.
   *
   * The board's column and the workspace island both stand there, and a band
   * that started at zero would run underneath them.
   */
  leftOffset?: string

  tool: MapToolId | null
  onToolChange: (id: MapToolId) => void

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
  const dateField =
    "telemetry rounded-sm bg-surface-raised px-1.5 py-0.5 text-meta text-foreground outline-none disabled:opacity-40"

  return (
    <div
      /*
        Where the period timeline sits on the map. It takes the foot's own
        reservation so the sidebar, the island and this band still meet without
        overlapping -- see --map-foot in index.css.
      */
      className="app-no-drag absolute inset-x-0 bottom-0 z-[900] flex h-[var(--map-foot,3.0625rem)] items-center border-t"
      style={{
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
        paddingLeft: props.leftOffset,
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
          {MAP_TOOLS.map((t) => {
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

        <Divider />

        <Group label="Period">
          {/*
            Native date inputs, kept. They are the one control here that opens
            a calendar, and a field that only accepted typing would be worse at
            the thing dates are hardest at.
          */}
          <input
            type="date"
            value={props.start}
            disabled={busy}
            onChange={(e) => props.onStartChange(e.target.value)}
            className={dateField}
          />
          <span className="shrink-0 text-meta text-muted-foreground">→</span>
          <input
            type="date"
            value={props.end}
            disabled={busy}
            onChange={(e) => props.onEndChange(e.target.value)}
            className={dateField}
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
