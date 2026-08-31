/**
 * The header's vocabulary, copied from Blender's because it is what makes a
 * header hold twenty controls in twenty-six pixels.
 *
 * Four shapes and no more:
 *
 *   TEXT MENU      View  Select  Add        no glyph, no border, opens a list
 *   TOGGLE         [icon]                   pressed reads as filled accent
 *   POPOVER        [icon ⌄]                 a glyph and a chevron, opens a panel
 *   FUSED PAIR     [icon|⌄]                 a toggle and a popover in one outline
 *
 * The fused pair is the one worth naming. Blender's snapping control is a
 * magnet that turns snapping on and a chevron that says what it snaps to, in a
 * single outline -- so the header spends one control's width on two decisions.
 * Overlays, gizmos and proportional editing are all built that way.
 *
 * BORDERLESS UNTIL TOUCHED. A header of outlined buttons is a header of boxes;
 * Blender draws nothing until hover and fills only what is on. That is what
 * lets a row of fifteen controls read as one strip rather than as fifteen
 * things competing.
 *
 * 20px controls in a 26px header, 12px glyphs. These are Blender's own
 * proportions, and they are why its headers fit what they fit.
 */
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/** Every control in a header is this tall. */
export const HEADER_CONTROL = "h-5"

const BASE =
  "flex shrink-0 items-center rounded-sm transition-colors focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"

/** A bare text menu: View, Select, Add. No glyph, no outline, ever. */
export function StudioHeaderMenu({
  label,
  ref,
  ...rest
}: {
  label: string
  /** The popover anchors on this, so it opens under the menu that summoned it. */
  ref?: (el: HTMLElement | null) => void
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      ref={ref as React.Ref<HTMLButtonElement>}
      {...rest}
      className={cn(
        BASE,
        HEADER_CONTROL,
        "px-1.5 text-meta text-foreground hover:bg-surface-raised",
        rest.className
      )}
    >
      {label}
    </button>
  )
}

/**
 * A toggle. Filled with the accent while on, which is Blender's only
 * strong colour in a header and therefore reads as state at a glance.
 */
export function StudioHeaderToggle({
  icon: Icon,
  label,
  on,
  onToggle,
  title,
  showLabel = false,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  on: boolean
  onToggle: () => void
  title?: string
  /** Text beside the glyph, where the header is wide enough to want it. */
  showLabel?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      title={title ?? label}
      className={cn(
        BASE,
        HEADER_CONTROL,
        showLabel ? "gap-1 px-1.5" : "w-5 justify-center",
        disabled && "cursor-not-allowed opacity-40",
        on
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
      )}
    >
      <Icon className="size-3 shrink-0" strokeWidth={1.75} />
      {showLabel && <span className="text-meta">{label}</span>}
    </button>
  )
}

/**
 * A popover entrance: a glyph, an optional label, and a chevron.
 *
 * The chevron is what tells the reader there is more behind it -- without one
 * the control looks like a toggle that does not respond.
 */
export const StudioHeaderPopoverButton = ({
  ref,
  icon: Icon,
  label,
  showLabel = false,
  open,
  active,
  title,
  ...rest
}: {
  ref?: (el: HTMLElement | null) => void
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  showLabel?: boolean
  open?: boolean
  /** Some entrances also carry state, as Blender's Shading pair does. */
  active?: boolean
  title?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    ref={ref as React.Ref<HTMLButtonElement>}
    title={title ?? label}
    {...rest}
    className={cn(
      BASE,
      HEADER_CONTROL,
      "gap-0.5 px-1",
      active
        ? "bg-accent text-accent-foreground"
        : open
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
      rest.className
    )}
  >
    {Icon && <Icon className="size-3 shrink-0" strokeWidth={1.75} />}
    {showLabel && <span className="truncate text-meta">{label}</span>}
    <ChevronDown className="size-2.5 shrink-0 opacity-60" strokeWidth={2} />
  </button>
)

/** The vertical hairline Blender puts between groups in a header. */
export function StudioHeaderRule() {
  return (
    <span
      className="mx-1 h-3.5 w-px shrink-0 self-center"
      style={{ background: "rgb(var(--p-line) / 0.45)" }}
      aria-hidden
    />
  )
}

/**
 * A radio group drawn as icons, which the guidelines ask for by name: an enum
 * expands to buttons where its members can be glyphed, and stays a dropdown
 * where they cannot -- "Random Forest" has no glyph, a camera view does.
 */
export function StudioHeaderRadio<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{
    id: T
    /** Written beside the glyph where the header is wide enough to carry it. */
    label: string
    /** The full sentence, for the pointer. Falls back to the label. */
    title?: string
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  }>
  onChange: (id: T) => void
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-px overflow-hidden rounded-sm",
        HEADER_CONTROL
      )}
      style={{ background: "rgb(var(--p-line) / 0.22)" }}
    >
      {/*
        The name rides beside the glyph. This drew icons alone, which suits an
        enum whose members ARE pictures -- a camera view, an axis -- and not one
        whose members are procedures: a map pin against a clock says nothing
        about a full temporal stack against cumulative retention. The label
        withdraws with the rest when the area cannot carry it.
      */}
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          title={o.title ?? o.label}
          className={cn(
            "flex h-full shrink-0 items-center gap-1 px-1.5 transition-colors",
            o.id === value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
          )}
        >
          <o.icon className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="header-label text-meta">{o.label}</span>
        </button>
      ))}
    </span>
  )
}
