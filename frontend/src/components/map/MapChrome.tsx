/**
 * The map's own controls, at the measurements the map already used.
 *
 * Leaflet's zoom and draw bars were styled in index.css and those rules died
 * with the library, so the numbers live here: a 2.125rem square, `--p-ink` at
 * 0.82 behind an 18px blur, a hairline between buttons in a bar and a hairline
 * around it.
 *
 * ONE COPY, because there were three -- the work map's stack, the board's
 * drawing modal, and the camera's own control, which had drifted into a
 * labelled pill twice the height of its neighbours. OverlayToolsPanel records
 * what that costs: "a narrower one beside them reads as a different kind of
 * control", and a wider one reads as a different kind of control that is also
 * shouting.
 */
import { cn } from "@/lib/utils"

/** One bar of controls: the hairline, the radius and the shadow. */
export function MapBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)]",
        "shadow-[0_2px_8px_rgb(0_0_0/0.28)]",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * One control: a glyph, and its name where a name belongs.
 *
 * The label is the title and the accessible name, not text on the button. A
 * map's chrome sits over the imagery it controls, and a control that spells
 * itself out takes ground from the thing being looked at -- which is the whole
 * argument for a toolbar of glyphs rather than a row of words.
 */
export function MapButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-[2.125rem] items-center justify-center transition-colors",
        "border-b border-[rgb(var(--p-line)/0.22)] last:border-b-0",
        "bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-primary"
          : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
