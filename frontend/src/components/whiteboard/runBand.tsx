/**
 * The shape a workflow's parameters take along the foot, named once.
 *
 * A workflow band is a row of small labelled groups with the action pinned at
 * its right end. `BoardRunBar` established it for the classification products
 * and the canopy band follows it, so a reader who has set an area, a period and
 * a model reads the second band as the same instrument with different values in
 * it -- rather than as a second design for the same job.
 *
 * Here rather than exported from BoardRunBar because both are callers now, and
 * a layout idiom that lives in one of its two users is a copy waiting to
 * happen. The reasoning inside each piece is the reasoning that was written
 * when the run band was measured; it is not restated per band.
 */
import type { LucideIcon } from "lucide-react"

/** A named group of controls. */
export function BandGroup({
  icon: Icon,
  label,
  children,
}: {
  /** The group's subject, the same intent as the board tree's layerIcon(). */
  icon: LucideIcon
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
    <div className="flex shrink-0 flex-col justify-center gap-1 px-2">
      {/*
        The glyph rides the eyebrow row, which is the cheap one: a label is
        26-55px wide against control rows of 96-388px, so a 12px icon there
        costs nothing horizontally. .eyebrow sets the colour and lucide strokes
        currentColor, so the glyph is muted with its label without saying so.
      */}
      <span className="eyebrow !text-[9px] flex shrink-0 items-center gap-1.5">
        <Icon className="size-3 shrink-0" strokeWidth={2} />
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

export function BandDivider() {
  return (
    <div
      // Tall enough to separate a stacked group rather than only its controls.
      className="h-9 w-px shrink-0"
      style={{ background: "rgb(var(--p-line) / 0.28)" }}
    />
  )
}
