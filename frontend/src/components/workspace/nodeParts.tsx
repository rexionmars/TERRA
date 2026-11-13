/**
 * The pieces a reading card on the compositor is written with: a figure, a
 * note, a class swatch, a card's one action, and the line a card shows while
 * its input is not a value.
 *
 * Lifted out of CompositorEditor when the Mineral nodes needed the same ones
 * (mineralNodes.tsx): a figure written two ways would be two figures.
 */
import { CircleNotch } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { Result } from "@/lib/compositorEval"

export function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-meta">
      <span className="text-muted-foreground">{label}</span>
      <span className="telemetry truncate text-foreground" title={value}>
        {value}
      </span>
    </div>
  )
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-meta leading-snug text-muted-foreground">{children}</p>
}

export function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-xs"
      style={{ background: color, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35)" }}
    />
  )
}

/**
 * A node's one action: a raised button whose mark is in the accent while it
 * can go, flat and muted while it cannot.
 *
 * It was filled in the accent, and a board with a report, a field table and a
 * zones card on it carried three orange bars, the loudest marks on the board,
 * none of them what the board is read for. The accent stays on the mark, where
 * it still says this is the card's one thing to press.
 */
export function ActionButton({
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
        "flex h-7 w-full items-center justify-center gap-1.5 rounded-sm border px-2 text-meta font-medium transition-colors",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        off
          ? "cursor-not-allowed border-transparent bg-control text-muted-foreground"
          : "border-[rgb(var(--p-line-strong)/0.55)] bg-[rgb(var(--p-surface-raised))] text-foreground hover:bg-hover"
      )}
    >
      <span className={cn("flex shrink-0", !off && "text-primary")}>
        {busy ? <CircleNotch className="size-3.5 animate-spin" /> : icon}
      </span>
      {label}
    </button>
  )
}

/** Why a result is not a value, in a line. */
export function StatusNote({ result }: { result: Result | undefined }) {
  if (!result || result.status === "ready") return null
  if (result.status === "busy") return <Note>Decoding the raster.</Note>
  return <Note>{result.note}</Note>
}
