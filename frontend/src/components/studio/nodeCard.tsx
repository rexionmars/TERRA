/**
 * The two pieces every card on a node canvas is built from.
 *
 * Lifted out of `BoardRunGraph` when a second surface needed them, which has
 * since been removed; `BoardRunGraph` is their one caller again. They stay
 * apart because a surface that draws cards should reach for this header rather
 * than copy it: the same argument `lib/studioEditors.ts` makes for naming the
 * editors once, and `lib/mapTools.ts` for its own table. A header that exists
 * twice is a header that can disagree with itself.
 *
 * Nothing about runs is in here, as nothing about runs is in `NodeCanvas`. A
 * caller supplies what the card says.
 */
import { cn } from "@/lib/utils"

/**
 * A card's header: its name, and nothing else.
 *
 * As Solara writes it and Blender before it. The glyph that stood before the
 * name, and the small letter-spaced type the name was set in, were chosen for
 * a header that was a wash over the card; a node header is a band of its own,
 * and on it the name in body type is the whole of what needs saying. The
 * category is the band's colour.
 *
 * NO COLOUR NAMED HERE. The band sets `color` -- --b-node-ink on every header
 * -- and this inherits it, so the pair is measured where both are written
 * down, in index.css.
 */
export function Head({ label }: { label: string }) {
  /*
    Truncated at the card's width, and `title` is how the whole of it is still
    reachable: the run node's header is the tool's own sentence, which does not
    fit 208px, and a name that cannot be read is a card that does not say which
    run it is.
  */
  return (
    <span className="min-w-0 flex-1 truncate" title={label}>
      {label}
    </span>
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
            ? undefined
            : "text-muted-foreground hover:bg-hover hover:text-foreground"
      )}
      /*
        A CHOSEN OPTION IS A CHIP IN THE CARD'S OWN COLOUR, and it is the same
        pair the header band is: the band filled, the band's ink on it.

        It was `bg-accent-dim text-foreground inset-ring-1 inset-ring-accent` --
        a brown plate with an orange ring, the chassis's accent at the one
        weight it has. On a board where a card's colour says which part of a
        request it answers, that made every chosen value on every card say the
        same thing, and what it said was the RUN card's colour: the board's one
        press-me signal, repeated down every list of options that is not it.

        No ring. The chip is a filled shape now, and a ring on a fill in the
        same family is a second boundary drawn around the first -- the accent
        ring existed to give a dim plate an edge, and a plate that is no longer
        dim does not need one.

        The two properties come from the card this chip is inside, which
        declares them on its own box; see NodeCanvas. The fallbacks are what a
        card with no part is drawn in, so a chip rendered outside one is quiet
        rather than invisible.
      */
      style={
        !disabled && !blockedBy && chosen
          ? {
              background: "var(--b-lit, var(--b-card-head))",
              color: "var(--b-lit-ink, var(--b-card-ink))",
            }
          : undefined
      }
    >
      {label}
    </button>
  )
}
