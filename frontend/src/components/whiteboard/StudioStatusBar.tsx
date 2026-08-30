/**
 * The one strip across the studio's foot, in Blender's three zones.
 *
 * WHY THIS ONE AND NOT THE OTHERS. An audit of what a Blender screen carries
 * proposed four new permanent regions -- a toolbar, a tool-settings strip, an
 * icon rail and this. Blender's density is bought with a screen that has room
 * to spend, and this application declares a 1000x700 floor whose workspace
 * presets are tuned against it; four regions would be Blender's chrome budget
 * on a canvas a third the size, taken out of the 3D surface the studio exists
 * to show. So one, and the one that gives back more than it takes.
 *
 * It was written to give back the properties column, which the run log used to
 * take over for as long as a run lasted -- a reader watching a classification
 * could not read the legend of anything. THAT DID NOT ACTUALLY HAPPEN:
 * BoardStatsBar still swaps its whole body for the log while `running`, so the
 * column is still spent and this strip was carrying a second copy of the same
 * line. Removing that copy is not the fix for the column; whether the log
 * should own the properties panel is a question about the panel.
 *
 * LEFT what the pointer does here, RIGHT what is selected. Blender's division
 * has a middle for what the application is doing, and this one is empty on
 * purpose: the only thing it had to say was a run's stage, and that is drawn
 * in the run's own card now.
 */
import type { BoardStats } from "@/components/whiteboard/boardScene"
import { useSyncExternalStore } from "react"
import {
  TELEMETRY_FIGURES,
  studioTelemetry,
  subscribeStudioTelemetry,
} from "@/lib/studioTelemetry"
import { cn } from "@/lib/utils"

/** The strip's height, which the area tree subtracts from its rectangle. */
export const STATUS_BAR_PX = 22

export function StudioStatusBar({
  stats,
  selected,
  total,
  areas,
}: {
  /** What the surface is costing, or null before it has drawn a frame. */
  stats: BoardStats | null
  selected: number
  total: number
  areas: number
}) {
  /*
    Which figures to draw, subscribed rather than received.

    Off by default and each switched separately in Settings, because a status
    bar reporting its own performance to a reader who did not ask is chrome
    spent on a question they are not holding. One of them is not free -- see
    lib/studioTelemetry.ts -- and the scene watches the same store, so switching
    that one off stops the work as well as the display.
  */
  const shows = useSyncExternalStore(
    subscribeStudioTelemetry,
    studioTelemetry
  )
  const anyShown = TELEMETRY_FIGURES.some((f) => shows[f.key])

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[35] flex items-center gap-2 border-t px-2"
      style={{
        height: STATUS_BAR_PX,
        background: "rgb(var(--p-ink))",
        borderColor: "rgb(var(--p-line) / 0.28)",
      }}
    >
      {/*
        LEFT: what the pointer does. Blender draws mouse glyphs here and names
        the binding under each; these are the board's own gestures, which had
        no written form anywhere -- pressing a plane, shift to extend, drag to
        move were all discoverable only by trying.
      */}
      <span className="telemetry flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
        <Binding keys="Press" what="Select" />
        <Binding keys="Shift" what="Extend" />
        <Binding keys="Drag" what="Move" />
        {/*
          The navigation reads as one group because it is one button and its
          modifiers, which is the whole point of taking it off the left.
        */}
        <Binding keys="Middle" what="Orbit" />
        <Binding keys="Shift Middle" what="Pan" />
        <Binding keys="Ctrl Middle" what="Zoom" />
      </span>

      {/*
        What the surface costs, beside what the pointer does, because both
        answer questions about THIS viewport and a reader checking whether a
        drag is smooth is already looking here.

        EVERY FIGURE IS MEASURED. The frame time is the median interval between
        the frames that actually happened -- the board renders on demand, so a
        mean since the scene opened would hide the stall being looked for. The
        counters are three's own renderer.info, which is what was submitted
        rather than an estimate of it.

        There is no CPU or process-memory figure here, and it is not an
        oversight. A WKWebView exposes neither: `performance.memory` is not
        implemented in WebKit, and the process doing the work is a WebContent
        XPC service whose only link back to this application is a handful of
        transient cache files. A number invented for those columns would be
        worse than their absence.
      */}
      {stats && anyShown && (
        <span className="telemetry hidden shrink-0 items-center gap-2 text-[9px] text-muted-foreground xl:flex">
          {shows.page && (
            <Figure
              label="page"
              value={`${stats.displayHz.toFixed(0)}hz`}
              warn={stats.displayHz > 0 && stats.displayHz < 45}
            />
          )}
          {shows.fps && (
            <>
              {/* Under 30 a drag reads as stepping rather than moving. */}
              <Figure label="fps" value={stats.fps.toFixed(0)} warn={stats.fps > 0 && stats.fps < 30} />
              <Figure label="gap" value={`${stats.frameMs.toFixed(0)}ms`} />
            </>
          )}
          {shows.work && (
            <Figure label="work" value={`${stats.workMs.toFixed(1)}ms`} warn={stats.workMs > 16} />
          )}
          {shows.pointer && (
            <>
              <Figure label="move" value={`${stats.moveMs.toFixed(1)}ms`} warn={stats.moveMs > 4} />
              <Figure label="ev" value={`${stats.moveHz.toFixed(0)}/s`} />
            </>
          )}
          {shows.draws && (
            <>
              <Figure label="calls" value={String(stats.calls)} />
              <Figure label="tris" value={formatCount(stats.triangles)} />
            </>
          )}
          {shows.resources && (
            <>
              <Figure label="tex" value={String(stats.textures)} />
              <Figure label="geo" value={String(stats.geometries)} />
            </>
          )}
          {shows.buffer && (
            <Figure
              label={`buf @${stats.pixelRatio}x`}
              value={`${stats.bufferW}x${stats.bufferH}`}
            />
          )}
        </span>
      )}

      {/*
        NO MIDDLE ZONE. It carried the run's stage and percentage, and the run
        card now carries them where the run was started -- the same figure in
        two places at once, which is the duplication this file's own comment
        below already names.

        Its button was also inert: `onOpenLog` is optional and BoardSurface has
        never passed it, so "Open the run log" opened nothing. The full stack is
        reachable from the card's Method panel, which reads the same log and
        keeps it after the run ends.
      */}
      <span className="flex-1" />

      {/* RIGHT: what is in the scene and how much of it is picked. */}
      <span className="telemetry flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
        <span>
          <span className={cn(selected > 0 && "text-foreground")}>{selected}</span>
          /{total} planes
        </span>
        <span>
          {areas} {areas === 1 ? "area" : "areas"}
        </span>
      </span>
    </div>
  )
}

/** One measured figure: the number in the foreground, its unit beside it. */
function Figure({
  label,
  value,
  warn = false,
}: {
  label: string
  value: string
  warn?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="tabular-nums"
        style={{ color: warn ? "var(--destructive-quiet)" : "rgb(var(--p-text))" }}
      >
        {value}
      </span>
      {label}
    </span>
  )
}

/** Thousands as k, because a triangle count is read for its order of size. */
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** One binding: the key in the foreground, what it does beside it. */
function Binding({ keys, what }: { keys: string; what: string }) {
  return (
    <span className="hidden items-center gap-1 lg:inline-flex">
      <span
        className="rounded-[2px] px-1 text-foreground"
        style={{ background: "rgb(var(--p-line) / 0.28)" }}
      >
        {keys}
      </span>
      {what}
    </span>
  )
}
