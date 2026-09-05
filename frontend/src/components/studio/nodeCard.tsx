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
  aside,
  colour,
}: {
  icon: PhosphorIcon
  label: string
  lit?: boolean
  /**
   * The card's own colour, where the caller has one for it.
   *
   * A CSS colour rather than a name, for the reason `subject` on CanvasNode
   * gives: this file knows nothing about what a caller's categories are. It is
   * the weakest of the three signals the glyph can carry and is taken last --
   * a card that is out of the request or holding something has something to
   * say about ITSELF, and what kind of card it is can wait behind that.
   */
  colour?: string
  /**
   * The card is on the graph and not in the request.
   *
   * Separate from `lit` rather than a third value of it, because the two
   * answer different questions: `lit` is about what this card is CARRYING and
   * changes as the reader works, and this is about where the card stands in
   * the graph and does not change at all. A card can never be both -- one that
   * feeds nothing has nothing to feed it with -- so the glyph takes this one
   * first and the ordering below costs nothing.
   */
  aside?: boolean
}) {
  return (
    <>
      <Icon
        className={cn(
          "size-3 shrink-0",
          aside
            ? "text-aside"
            : lit
              ? "text-accent-quiet"
              : colour
                ? undefined
                : "text-muted-foreground"
        )}
        style={!aside && !lit && colour ? { color: colour } : undefined}
      />
      {/*
        The label is truncated at the card's width, and `title` is how the whole
        of it is still reachable. The run node's header is the tool's own
        sentence -- "Map irradiation over terrain" -- which does not fit 208px
        at any size this row uses, so the ellipsis there is the normal case
        rather than the exception, and a name that cannot be read is a card
        that does not say which run it is.
      */}
      <span className="eyebrow !text-[9px] truncate" title={label}>
        {label}
      </span>
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
