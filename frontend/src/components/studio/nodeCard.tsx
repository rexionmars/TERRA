/**
 * The two pieces every card on a node canvas is built from.
 *
 * Lifted out of `BoardRunGraph` when a second surface needed them. They were
 * private to that file and copying them would have put the card idiom in two
 * places: the same argument `lib/studioEditors.ts` makes for naming the editors
 * once, and `lib/mapTools.ts` for its own table. A header that exists twice is
 * a header that can disagree with itself.
 *
 * Nothing about runs is in here, as nothing about runs is in `NodeCanvas`. A
 * caller supplies what the card says.
 */
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * A card's header row: the glyph and its label.
 *
 * `lit` takes the glyph to the accent and leaves the name where it is. The
 * border of a card is at the edge of vision when the eye is on the value in
 * the middle of it, and the glyph is the part of the header that is already
 * being looked past -- so it is the cheapest place to put a second signal that
 * the card is carrying something.
 */
export function Head({
  icon: Icon,
  label,
  lit,
}: {
  icon: PhosphorIcon
  label: string
  lit?: boolean
}) {
  return (
    <>
      <Icon
        className={cn(
          "size-3 shrink-0",
          lit ? "text-accent-quiet" : "text-muted-foreground"
        )}
      />
      <span className="eyebrow !text-[9px] truncate">{label}</span>
    </>
  )
}

/** One option in a card, chosen or not. */
export function Choice({
  label,
  chosen,
  disabled,
  blockedBy,
  onPick,
}: {
  label: string
  chosen: boolean
  disabled?: boolean
  /**
   * Why this one cannot be picked, if it cannot.
   *
   * Carried separately from `disabled`, which is the whole card going quiet
   * while a run is on. A rule that refuses an option has something to say and
   * a busy surface does not.
   */
  blockedBy?: string | null
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled || !!blockedBy}
      title={blockedBy ?? undefined}
      className={cn(
        "inline-flex h-[1.375rem] shrink-0 items-center rounded-sm px-1.5 text-meta transition-colors",
        "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
        disabled || blockedBy
          ? "cursor-not-allowed text-muted-foreground/40"
          : chosen
            ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
            : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}
