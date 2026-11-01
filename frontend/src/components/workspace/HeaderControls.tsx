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
import { cn } from "@/lib/utils"

/** Every control in a header is this tall. */
const HEADER_CONTROL = "h-5"

const BASE =
  "flex shrink-0 items-center rounded-sm transition-colors focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring"

/** A bare text menu: View, Select, Add. No glyph, no outline, ever. */
export function HeaderMenu({
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
        "px-1.5 text-meta text-foreground hover:bg-hover",
        rest.className
      )}
    >
      {label}
    </button>
  )
}
