import { forwardRef, useMemo, useState } from "react"
import { motion } from "motion/react"
import {
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Pencil,
  Play,
  Trash2,
} from "lucide-react"
import type {
  CompositeIndex,
  CompositeKind,
  DataCubeScene,
} from "@/lib/types"
import { RGB_PRESETS, INDICES } from "@/lib/compositeCatalog"
import { cn } from "@/lib/utils"
import { todayISO } from "@/lib/dates"
import { btnPrimary } from "@/components/ui/buttons"

const S2_BANDS = ["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B11", "B12"] as const

function Section({
  step,
  title,
  children,
}: {
  step: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="telemetry text-[10px] text-primary">{step}</span>
        <span className="eyebrow !text-foreground">{title}</span>
      </div>
      {children}
    </div>
  )
}

export interface CompositionPanelProps {
  hasArea: boolean
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  maxCloud: number
  onMaxCloudChange: (v: number) => void
  monthlyBest: boolean
  onMonthlyBestChange: (v: boolean) => void
  scenes: DataCubeScene[]
  scenesLoading: boolean
  scenesError: string | null
  selectedSceneId: string
  onSelectScene: (id: string) => void
  kind: CompositeKind
  onKindChange: (k: CompositeKind) => void
  bands: [string, string, string]
  onBandsChange: (b: [string, string, string]) => void
  index: CompositeIndex
  onIndexChange: (i: CompositeIndex) => void
  stretchLow: number
  stretchHigh: number
  onStretchChange: (low: number, high: number) => void
  running: boolean
  progress: number
  progressMsg: string
  hasOverlay: boolean
  onApply: () => void
  onClear: () => void
  onCollapse: () => void
  /** Tailwind left offset, e.g. left-3 or left-14 */
  panelOffsetClass?: string
}

export const CompositionPanel = forwardRef<
  HTMLDivElement,
  CompositionPanelProps
>(function CompositionPanel(props, ref) {
  const {
    hasArea,
    start,
    end,
    onStartChange,
    onEndChange,
    maxCloud,
    onMaxCloudChange,
    monthlyBest,
    onMonthlyBestChange,
    scenes,
    scenesLoading,
    scenesError,
    selectedSceneId,
    onSelectScene,
    kind,
    onKindChange,
    bands,
    onBandsChange,
    index,
    onIndexChange,
    stretchLow,
    stretchHigh,
    onStretchChange,
    running,
    progress,
    progressMsg,
    hasOverlay,
    onApply,
    onClear,
    onCollapse,
  } = props

  const [presetId, setPresetId] = useState("true_color")
  const busy = running || scenesLoading
  const canApply = hasArea && !!selectedSceneId && !busy

  const selectedLabel = useMemo(() => {
    const s = scenes.find((x) => x.id === selectedSceneId)
    return s ? `${s.date} · ${s.cloud_cover.toFixed(0)}%` : null
  }, [scenes, selectedSceneId])

  return (
      <motion.div
        ref={ref}
        className={`panel app-no-drag panel-scroll absolute ${props.panelOffsetClass ?? "left-3"} top-3 bottom-3 z-[1000] flex w-[19rem] flex-col gap-4 overflow-y-auto rounded-md p-4`}
        initial={{ opacity: 0, x: -28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -28 }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold">Compositions</h1>
          <button
            type="button"
            onClick={onCollapse}
            className="text-muted-foreground hover:text-foreground"
            title="Hide panel"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>

        <Section step="01" title="Area">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Uses the same AOI as classification. Draw or import from the Classify
            panel if needed.
          </p>
          <div
            className={cn(
              "flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs",
              hasArea
                ? "border-primary/40 text-foreground"
                : "border-dashed border-border text-muted-foreground"
            )}
          >
            {hasArea ? (
              <CheckCircle2 className="size-3.5 text-primary" />
            ) : (
              <Pencil className="size-3.5" />
            )}
            {hasArea ? "AOI ready" : "No area selected"}
          </div>
        </Section>

        <hr className="hairline" />

        <Section step="02" title="Scene">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              Start
              <input
                type="date"
                max={todayISO()}
                value={start}
                onChange={(e) => onStartChange(e.target.value)}
                disabled={busy}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              End
              <input
                type="date"
                max={todayISO()}
                value={end}
                onChange={(e) => onEndChange(e.target.value)}
                disabled={busy}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
            Max cloud %
            <input
              type="number"
              min={0}
              max={100}
              value={maxCloud}
              onChange={(e) => onMaxCloudChange(Number(e.target.value))}
              disabled={busy}
              className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={monthlyBest}
              onChange={(e) => onMonthlyBestChange(e.target.checked)}
              disabled={busy}
              className="accent-primary"
            />
            Best scene per month
          </label>
          {/* The listing is issued from the period track at the foot of the
              map, which is where the window it lists is chosen. A second button
              here made two controls for one request, and this one sat away from
              the dates that decide what comes back. */}
          {scenesError && (
            <p className="text-meta text-destructive-quiet">{scenesError}</p>
          )}
          {selectedLabel && (
            <p className="telemetry text-[10px] text-muted-foreground">
              Selected · {selectedLabel}
            </p>
          )}
          {scenes.length > 0 && (
            <ul className="max-h-36 overflow-y-auto rounded-sm border border-border">
              {scenes.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelectScene(s.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-secondary",
                      selectedSceneId === s.id && "bg-primary/10 text-foreground"
                    )}
                  >
                    <span className="truncate">{s.date}</span>
                    <span className="telemetry shrink-0 text-muted-foreground">
                      {s.cloud_cover.toFixed(0)}% · {s.tile || "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <hr className="hairline" />

        <Section step="03" title="Product">
          <div className="grid grid-cols-2 gap-1 rounded-sm border border-border p-0.5">
            {(["rgb", "index"] as CompositeKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onKindChange(k)}
                className={cn(
                  "rounded-sm px-2 py-1.5 text-[11px]",
                  kind === k
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                )}
              >
                {k === "rgb" ? "RGB composite" : "Index"}
              </button>
            ))}
          </div>

          {kind === "rgb" ? (
            <>
              <div className="flex flex-col gap-1">
                {RGB_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPresetId(p.id)
                      onBandsChange([...p.bands])
                    }}
                    className={cn(
                      "rounded-sm border px-2 py-1.5 text-left text-[11px]",
                      presetId === p.id && bands.join() === p.bands.join()
                        ? "border-primary/40 bg-primary/10"
                        : "border-border hover:bg-secondary"
                    )}
                  >
                    {p.label}
                    <span className="telemetry ml-1 text-muted-foreground">
                      {p.bands.join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["R", "G", "B"] as const).map((ch, i) => (
                  <label
                    key={ch}
                    className="flex flex-col gap-1 text-[10px] text-muted-foreground"
                  >
                    {ch}
                    <select
                      value={bands[i]}
                      onChange={(e) => {
                        const next: [string, string, string] = [...bands]
                        next[i] = e.target.value
                        setPresetId("custom")
                        onBandsChange(next)
                      }}
                      className="rounded-sm border border-border bg-background px-1 py-1 text-[11px] text-foreground"
                    >
                      {S2_BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {INDICES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onIndexChange(item.id)}
                  className={cn(
                    "rounded-sm border px-2 py-1.5 text-[11px]",
                    index === item.id
                      ? "border-primary/40 bg-primary/10"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </Section>

        <hr className="hairline" />

        <Section step="04" title="Display">
          <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
            Percentile stretch ({stretchLow}–{stretchHigh})
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                max={49}
                value={stretchLow}
                onChange={(e) =>
                  onStretchChange(Number(e.target.value), stretchHigh)
                }
                className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs"
              />
              <input
                type="number"
                min={50}
                max={100}
                value={stretchHigh}
                onChange={(e) =>
                  onStretchChange(stretchLow, Number(e.target.value))
                }
                className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs"
              />
            </div>
          </label>

          {running && (
            <div className="flex flex-col gap-1">
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.max(4, progress)}%` }}
                />
              </div>
              <p className="telemetry truncate text-[10px] text-muted-foreground">
                {progressMsg || "Rendering…"}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClear}
              disabled={!hasOverlay || busy}
              className="flex items-center justify-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
              Clear
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={!canApply}
              className={btnPrimary}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Apply
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Applying hides the prediction overlay; toggle visibility and
            opacity from Overlay Tools.
          </p>
        </Section>
      </motion.div>
  )
})
