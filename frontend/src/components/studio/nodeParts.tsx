/**
 * The pieces a reading card on the compositor is written with: a figure, a
 * note, a class swatch, a card's one action, and the line a card shows while
 * its input is not a value.
 *
 * Lifted out of CompositorEditor when the Mineral nodes needed the same ones
 * (mineralNodes.tsx): a figure written two ways would be two figures.
 */
import { CircleNotch } from "@phosphor-icons/react"
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
      className="inline-block size-2 shrink-0 rounded-[2px]"
      style={{ background: color, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35)" }}
    />
  )
}

/**
 * A node's one action, drawn as the run card's button is: filled in the accent
 * while it can go, quiet while it cannot.
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
export function StatusNote({ result }: { result: Result | undefined }) {
  if (!result || result.status === "ready") return null
  if (result.status === "busy") return <Note>Decoding the raster.</Note>
  return <Note>{result.note}</Note>
}
