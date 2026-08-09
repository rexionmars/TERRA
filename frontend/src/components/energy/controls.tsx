/**
 * Small controls shared by the two tabs of the energy screen.
 *
 * The number field and the progress bar were duplicated per product on the
 * left-dock panel this screen replaces, which is how one product ended up
 * reading another product's progress channel. One definition each, taking the
 * value it renders and nothing else.
 */
import { Loader2, Play } from "lucide-react"
import { cn } from "@/lib/utils"

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
      />
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
      />
    </label>
  )
}

/** Explanatory paragraph under a group of controls. */
export function FieldNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

/**
 * The note raised when a parameter shared with another product is edited.
 *
 * Marked as a status region so a change reaches assistive technology without
 * moving focus: the note appears in response to typing in the field above it.
 */
export function SharedParameterNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-sm border border-primary/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground"
    >
      {children}
    </p>
  )
}

export function RunProgress({
  active,
  progress,
  message,
}: {
  active: boolean
  progress: number
  message: string
}) {
  if (!active) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="bg-background h-1 overflow-hidden rounded-sm">
        <div
          className="h-full rounded-sm bg-primary transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      <span className="telemetry text-[10px] text-muted-foreground">
        {message}
      </span>
    </div>
  )
}

/**
 * The run action, labelled with what it returns.
 *
 * The label is not free text: it is composed from the product table, so a
 * button cannot promise a raster the payload does not carry. This is the third
 * of the three places the output kind is stated before the run, after the
 * marker in the selector and the shape of the output region.
 */
export function RunButton({
  label,
  runningLabel,
  running,
  disabled,
  onClick,
}: {
  label: string
  runningLabel: string
  running: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      // The one filled button that cannot take a primitive verbatim: its label
      // states what the product returns and wraps to two lines, so min-h-9 with
      // its own leading is load-bearing and any fixed height truncates it. The
      // rest of the primitive is here in full -- the fill, the near-black label,
      // one disabled convention and the focus ring.
      className={cn(
        "flex min-h-9 w-full items-center justify-center gap-1.5 rounded-sm bg-primary px-3 py-2",
        "text-center text-emphasis font-semibold leading-snug text-primary-foreground",
        "disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      )}
    >
      {running ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <Play className="size-3.5 shrink-0" />
      )}
      {running ? runningLabel : label}
    </button>
  )
}

/**
 * The output region before a run, for a product that draws nothing.
 *
 * Rendered on selection rather than after a failed-looking run. Every other
 * workflow in the application draws, so an empty region is read as a failure
 * unless the region itself says what the product returns.
 */
export function OutputPlaceholder({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-sm border border-border bg-secondary/50 flex h-full min-h-[16rem] items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <span className="text-muted-foreground">{icon}</span>
        <p className="eyebrow !text-foreground">{title}</p>
        <div className="flex flex-col gap-2 text-[11px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  )
}
