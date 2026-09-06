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
      {/*
        THE GLYPH INHERITS THE BAND'S INK, which is the only colour that can be
        stated about it from here.

        It used to take three: the aside token, the accent when the card was
        holding something, and otherwise the part's own hue. All three were
        chosen against a header that was a WASH -- a tint over a plate -- and
        none of them survives a band at full strength: the part's hue on a band
        painted in the part's hue is the glyph disappearing, and a blue aside
        mark on Forest Ritual's slate is not far behind it.

        `lit` is the one that stays, and only because its callers do not paint
        bands: FloodRoutingPanel builds cards with no subject and no tone, so
        the accent still lands on the graphite header those take.
      */}
      <Icon className={cn("size-3 shrink-0", lit && "text-accent-quiet")} />
      {/*
        The label is truncated at the card's width, and `title` is how the whole
        of it is still reachable. The run node's header is the tool's own
        sentence -- "Map irradiation over terrain" -- which does not fit 208px
        at any size this row uses, so the ellipsis there is the normal case
        rather than the exception, and a name that cannot be read is a card
        that does not say which run it is.
      */}
      {/*
        NO COLOUR NAMED HERE. `.eyebrow` is drawn in --p-muted, which is
        measured against the surfaces a PANEL is made of, and this row sits on
        a card band instead. The override that used to stand here forced it to
        --p-text, a pale grey, and that was correct for exactly as long as
        every band was a wash over a plate: on Cyber Punch's yellow it is a
        title nobody can read.

        The band sets `color` and this inherits it. Which pair lands on which
        band is decided and measured where the two are written down together,
        in index.css, rather than half here and half there.

        Small and letter-spaced is what keeps it quiet at this weight. Quiet
        was never a token's job here; it is the size's.
      */}
      <span className="eyebrow !text-[9px] truncate !text-current" title={label}>
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
