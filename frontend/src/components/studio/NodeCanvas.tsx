/**
 * A pannable, zoomable field of draggable cards joined by wires.
 *
 * Generic over what the cards hold: it owns the view, the gestures and the
 * geometry, and nothing about runs. `BoardRunGraph` supplies the nodes.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE IS PORTS YOU CAN PULL. The edges it draws
 * come from the graph its caller passes and cannot be made or broken, because
 * the graph is the shape of a request rather than an arrangement someone
 * chose. A port that looked draggable and refused to drag would promise a
 * freedom that does not exist -- so the ends are drawn as small filled marks
 * and take no pointer events at all.
 *
 * THE WIRES ARE RIBBONS, AND THAT WAS A DELIBERATE MOVE TOWARDS A REFERENCE.
 * A hairline says two cards are joined; a ribbon says something passes between
 * them, and this file argued against exactly that reading -- the edges here are
 * a fan-in describing one request, not a pipeline carrying anything. The trade
 * was made knowingly, and two things hold the honesty of it: a ribbon's width
 * is set by how many wires meet the card it lands on and by nothing else, so
 * no ribbon encodes a quantity, and an edge whose input has not been supplied
 * is NOT drawn as a ribbon at all. It stays a thin dashed line, because
 * nothing passes along it. That is the reference's own vocabulary -- there,
 * too, only the routes that were taken are ribbons.
 *
 * EVERY WIRE MEETS A CARD ON A SLOT OF ITS OWN, WHICH IS A LEGIBILITY REPAIR
 * BEFORE IT IS A LIKENESS. There was one port per card, so every wire
 * arriving at the run node converged on a single point and it could not be
 * read which of them ended where -- the fan pinched shut exactly where it had
 * the most to say. They are now stacked down the side of the card they land
 * on, ordered by where their other end sits, so a bundle arrives in the order
 * the eye already reads the column it left.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { ArrowsOut } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NODE_W, PORT_Y, type Place } from "./runGraph"

/**
 * The widest a wire draws where it is carrying the request.
 *
 * THIRTY-FOUR IS THE READING'S. A wire carries what its card supplies, written
 * inside it on two lines -- the card's name over its value -- and that is
 * twenty-one pixels of text with air above and below.
 *
 * A CEILING RATHER THAN A CONSTANT, AND THE FIXED VERSION FAILED IN THE APP.
 * It was this width at both ends of every wire, and the card at the head of a
 * fan was grown tall enough to be landed on by all of them. On a four-input
 * graph that reads. The energy model takes EIGHT, and the run node -- a card
 * whose contents are a button and a method link -- was stretched past three
 * hundred pixels of empty body to be met by them.
 *
 * So a wire is as wide as it needs to be AT EACH END, and the two ends differ:
 * a card that feeds only the run gives its wire the full width to write the
 * reading in, and the run node gives each of its eight arrivals an eighth of
 * its own side. Neither number is a quantity about the datum -- every wire
 * meeting the same card at the same end is the same width, so a comparison
 * between two of them still reads as nothing.
 */
export const RIBBON_W = 34

/**
 * The narrowest a ribbon may be drawn where a card's side is crowded.
 *
 * Under about five pixels a filled ribbon stops reading as a ribbon and
 * becomes a second hairline. A card crowded past this draws slots that touch,
 * which is legible as crowding rather than silent as a mark that went missing.
 */
const RIBBON_MIN_W = 5

/** The narrowest ribbon that still holds both lines of its reading. */
const RIBBON_TWO_LINE_W = 26

/**
 * The narrowest ribbon that holds any text at all.
 *
 * Below this the reading is dropped rather than drawn outside the shape it is
 * written in: a wire with no reading is legible, and a reading lying across
 * three wires is not. The state word at the landing is gated on the LANDING's
 * width for the same reason and separately, since a wire is commonly wide
 * where it leaves and narrow where it arrives.
 */
const RIBBON_TEXT_MIN_W = 15

/** Clearance between two neighbouring ribbons where they land. */
const SLOT_GAP = 4

/**
 * How far apart two slots may sit where wires meet a card.
 *
 * A CEILING, AND THE CARD'S OWN HEIGHT IS THE OTHER ONE. A fan is spread down
 * the side of the card it meets and cannot be spread further than that card
 * goes, so eight wires into a short card share it and are drawn narrower for
 * it. That is a fact about the shape of the request and the size of the card,
 * not about any datum -- and the alternative, tried and reverted, was to grow
 * the card until the fan fit, which turned a button and a method link into
 * three hundred pixels of empty card.
 *
 * The cap keeps a tall card with two wires from throwing them to its corners.
 */
const SLOT_PITCH = RIBBON_W + SLOT_GAP

/** How much of a card's foot the lowest slot leaves alone. */
const SLOT_FOOT = 12

/**
 * How much of the field's ink a ribbon is smoked with, by state.
 *
 * A RIBBON IS A PANE, AND IT TOOK FIVE WRONG ANSWERS TO SAY SO. Two stacked
 * strokes, then three, then a blurred cast beneath, then an inner shadow
 * clipped to the shape, then a soft edge on the shape itself. Every one of
 * them was an attempt to draw LIGHT -- a glow, a shadow, a falloff -- and what
 * the reference has is not a light effect at all. Its edges are hard. What
 * happens where two of them cross is that the upper one is translucent and
 * DARKENS what is under it: the lime goes olive under the dark band, in the
 * band's own shape, with a boundary you could cut out. Smoked acrylic laid on
 * a sheet of colour, not a shadow falling on one.
 *
 * So a carrying ribbon is two fills: the field's ink at the weight below, then
 * its own colour. Together they leave the pane translucent -- a quarter of
 * what it crosses comes through, darkened and tinted -- and neither fill has
 * a soft edge anywhere.
 *
 * A ROUTE THAT WAS TAKEN IS NOT SMOKED. Read, failed and reading take a full
 * ground and near-full colour, which is the reference's lime: opaque, exact,
 * and covering what it crosses. Only the waiting ones are glass, and they are
 * the ones that have to be crossed.
 */
const GROUND: Record<EdgeState, number> = {
  missing: 0,
  pending: 0.62,
  reading: 1,
  read: 1,
  failed: 1,
}

/**
 * What each state is drawn in, and the one that is drawn in the wire's own.
 *
 * PENDING IS NULL, WHICH IS THE POINT. A wire waiting to be read has no
 * outcome to report, so the colour is free to say what the wire CARRIES
 * instead -- the part of the question its card answers, in the same scale the
 * card is painted in. A board at rest then shows where, when, by which method
 * and at what values converging on the run, rather than eight grey bands
 * saying "nothing has happened" eight times. The moment something does happen,
 * the outcome takes the colour back.
 *
 * MISSING STAYS GREY, and that is not the same absence. A pending wire is
 * carrying something nobody has read yet; a missing one is carrying nothing at
 * all, and painting it in the colour of a part it cannot supply would be the
 * picture asserting a completeness the run does not have.
 *
 * --destructive RATHER THAN --destructive-quiet, now that the ribbon is a band
 * and not a line. The quiet one is the pale red measured to be legible AS a
 * mark on a dark surface; filled at this width it is a slab of pink. The plain
 * one is the red this chassis fills a refusing control with, which is what a
 * failed wire now is, and white sits on it at better than six to one.
 */
const EDGE_COLOUR: Record<EdgeState, string | null> = {
  missing: "rgb(var(--p-line-strong))",
  pending: null,
  reading: "rgb(var(--p-accent))",
  read: "var(--success)",
  failed: "var(--destructive)",
}

/**
 * How much colour a ribbon takes, by state, over its own opaque ground.
 *
 * NOT TRANSPARENCY. Every carrying ribbon is filled twice: once in the ink the
 * field is drawn on, which is what makes it opaque, and then in its colour at
 * the weight below. So a ribbon has a hard edge and hides what it crosses
 * instead of blending into it, and a pending wire is a DARK band of its part's
 * hue rather than a wash the background shows through.
 *
 * That is the reference's material, and it is what ours was not: there, the
 * routes that were taken are solid colour and the ones still waiting are a
 * band barely above the background, and every one of them has a boundary you
 * could cut out. Ours were translucent, which is why they read as smears of
 * light rather than as things passing between cards.
 *
 * THE SPLIT IS STILL BETWEEN AN ANSWER AND THE ABSENCE OF ONE. A board that
 * has not been run is most boards most of the time, and a wire only takes the
 * surface once it has something to report.
 */
const FILL_OPACITY: Record<EdgeState, number> = {
  missing: 0,
  pending: 0.38,
  reading: 0.92,
  read: 0.92,
  failed: 0.92,
}

/**
 * Whether a state's ribbon is bright enough to be written on in ink.
 *
 * The reference sets its labels in dark type on the routes that were taken and
 * in white on the ones that were not, and the reason is contrast rather than
 * emphasis: white on a filled green band is about three to one and fails, and
 * the ink this chassis draws its own surfaces against clears it.
 */
const INK_ON: Record<EdgeState, boolean> = {
  missing: false,
  pending: false,
  reading: true,
  read: true,
  failed: false,
}

/**
 * How far a wire runs UNDER the card it meets.
 *
 * A JUNCTION RATHER THAN A JOIN. A ribbon that stops dead on a card's edge is
 * glued to it: the blunt end, the boundary and the card's own border all land
 * on the same pixel, and at any zoom it reads as a lump on the outline rather
 * than as something arriving. Run a few pixels past the edge instead and the
 * card -- which is opaque and painted over the wires -- hides the end, so the
 * wire emerges from beneath it.
 *
 * Seven, which clears the card's 1px border and the 6px corner radius, so the
 * end is covered wherever down the side a wire happens to meet it.
 *
 * IT IS ALSO WHAT REPLACED THE TERMINAL DOTS. Those marked where a wire met a
 * card back when a wire was a hairline, and they were the lump: a 3px circle
 * centred on the edge, half over the card and half over the field, against a
 * ribbon thirty-four pixels wide. What they were for -- reading as a terminal
 * and not as a socket waiting to be pulled out of -- a wire disappearing under
 * a card says better than a dot on its border ever did.
 */
const TUCK = 7

/** The reading written along a wire: two lines, and how far along they start. */
const NAME_PX = 11
const VALUE_PX = 10
const LABEL_LEAD = 16
/** Where each line sits across the ribbon, measured from the wire's centre. */
const NAME_DY = -1
const VALUE_DY = 11

/**
 * About how wide one character of the reading is, at the value's size.
 *
 * The telemetry face is monospaced, so a count of characters is a width -- but
 * only about, since the value is measured from the face rather than read from
 * it. It decides how much of a reading fits between two cards and nothing
 * else, and it is used to drop characters rather than to place them: an
 * estimate two per cent out shortens a reading by a character, and no mark
 * lands anywhere different.
 */
const LABEL_CH = 6

/** The state word at the landing: its size, its clearance, and its room. */
const NOTE_PX = 10
const NOTE_LEAD = 12
const NOTE_ROOM = 66

/**
 * As much of a reading as fits, with the loss admitted.
 *
 * The ellipsis is the point: a value cut without one is a different value, and
 * "hourly, 10 y" is a reading a board could be believed on.
 */
function clip(text: string | undefined, chars: number): string {
  if (!text || chars < 6) return ""
  return text.length <= chars ? text : `${text.slice(0, chars - 1)}\u2026`
}

const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.2
/** Space left around the graph when the view is fitted to it. */
const FIT_PAD = 32

export interface CanvasNode {
  id: string
  place: Place
  /**
   * How tall the card draws.
   *
   * Read to fit the view around the graph, and to spread the wires that meet
   * this card down its side: a fan is bounded by the card it lands on, so a
   * height that is wrong crowds slots into a card taller than they think, or
   * hangs them off the foot of one shorter. The card itself is sized by its
   * contents like any other element.
   *
   * The caller's own number until `onMeasure` has answered for this card, at
   * which point it is whatever was measured. A guess is enough to fit a view
   * and was not enough to stack a column; see `onMeasure` below.
   */
  h: number
  header: React.ReactNode
  children: React.ReactNode
  /**
   * How the card is lit, and the two are DIFFERENT CLAIMS.
   *
   * "action" is the card the others arrive at, so the eye finds the end of the
   * graph. Its header is filled.
   *
   * NOTHING MARKS A CARD THAT IS HOLDING NOTHING, and two attempts at one have
   * been taken out. "held" lit the area while it had a drawing, which the wire
   * now says better by carrying the drawing's own name; "blocking" lit the
   * same card on the opposite condition, in a dashed accent outline, and put
   * a second loud mark on a card whose part colour was already saying what
   * kind of card it is. An input holding nothing is said twice as it is -- by
   * the wire, which goes dashed and reads "not set" at the card's own edge,
   * and by the card's body, which reads "none" where its value would be.
   *
   * "aside" is a THIRD claim and it is about the graph rather than the card:
   * this one is not in the request. Every other card feeds the run -- change it
   * and the answer changes -- and this one says what is DRAWN while the
   * question is being set up. runGraph.ts states that by wiring it to nothing
   * and calls the absent edge the statement; absence is the hardest thing to
   * see on a field of cards, so the statement was one nobody read.
   *
   * It is the only tone not drawn in the accent, and the separation is by
   * temperature rather than by intensity: the accent asks to be acted on, and
   * a card that is not part of the request is the one thing on this surface
   * that is asking for nothing. See --p-aside in index.css for the measurement.
   *
   * Absent is a card with nothing to report about itself: the period and the
   * model always hold a value, so lighting them would be a light that is
   * always on.
   */
  tone?: "action" | "aside"
  /**
   * What the card is DOING, which is not what it is.
   *
   * A second axis rather than a fourth tone. `tone` says where a card stands
   * in the graph and does not change while the reader works; this changes
   * under them and says nothing about the shape. The run node is the action
   * card whether or not a run is on, and collapsing the two would make it stop
   * being the action card for as long as one was.
   *
   * STILL ONLY "busy", NOW THAT THE OUTCOME EXISTS. There was no signal for a
   * finished or failed run at all when this was written -- `boardRun` carried
   * running, progress, a message, a label and canRun, and nothing that said
   * how a run ended. It carries one now, and it is drawn on the WIRES rather
   * than here, because that is the only place it can say what it is an outcome
   * ABOUT: which of the values on the board the answer was computed from, and
   * which have moved since. On the card it would be the same fact with the
   * subject removed, next to four wires already carrying it with one.
   */
  status?: "busy"
  /**
   * What kind of card this is, as the two colours it is drawn in.
   *
   * CSS COLOURS RATHER THAN A NAME, because this file knows nothing about runs
   * and must not learn: the caller decides what its categories are, which of
   * them weigh more, and what each is worth in ink. What is decided here is
   * only the role -- the header a card is titled on and the border around it,
   * which are the two surfaces on a card large enough to be told apart at a
   * glance across a field of them.
   *
   * A FIRST ATTEMPT PUT THIS ON A TWO-PIXEL RULE under the header, on the
   * argument that every larger surface was spoken for. It was: by the tone,
   * which most cards do not have. On a graph of eight cards the rule was two
   * hairlines and six cards of the same grey they had always been, which is
   * the colour of a board with no scheme at all.
   *
   * Overridden where a card has something to say about itself -- the action's
   * filled header, the aside's wash -- since what is happening outranks what a
   * card is.
   */
  subject?: { wash: string; edge: string }
}

/**
 * WHAT A WIRE IS IN, AND THE THREE REGISTERS IT IS SAID IN.
 *
 * `missing` is a fact about the REQUEST -- this input has not been supplied,
 * so the run cannot be made -- which is the same register as the graph itself
 * and the reason a dashed line belongs here at all.
 *
 * `reading` is a fact about a run IN FLIGHT. runGraph.ts objects to drawing
 * the fan-in as a chain, because a chain asserts an order between inputs that
 * the request does not have -- the period does not consume the area. It does
 * not object to showing that a run is reading them, and a fan-in that moves
 * together asserts no order.
 *
 * `pending`, `read` and `failed` are facts about the ANSWER ON SCREEN, and
 * they are the reason a snapshot of the inputs has to be kept somewhere: they
 * say whether the result being looked at was computed from the value this wire
 * carries NOW. Change the season after a run and its wire falls back to
 * pending, because the raster on the map is no longer an answer about it. That
 * distinction is the whole point of drawing them; without the snapshot the
 * only honest state after a run would be "something ran".
 *
 * `read` and `failed` are the RUN'S outcome shown on the wires it read, which
 * is one fact drawn several times -- the caller is what decides that showing
 * it per wire is worth the repetition, since it is the wires that say WHICH
 * values that outcome was about.
 */
export type EdgeState =
  | "missing"
  | "pending"
  | "reading"
  | "read"
  | "failed"

export interface CanvasEdge {
  from: string
  to: string
  state?: EdgeState
  /**
   * What passes along this wire, written inside it.
   *
   * The value the card at its tail supplies, in the shortest form that is
   * still the value -- "10 yr hourly", not "Hourly record over 10 years".
   * Drawn on a path so it follows the wire however its cards have been
   * dragged, which is what makes it a reading of the wire rather than a label
   * floating near one.
   *
   * Absent on a wire between two INPUT cards. Those are gates -- the model
   * gating the mode -- and a gate carries a rule about which choices exist
   * rather than a value the run reads. Writing a value on one would say the
   * run reads it twice.
   */
  label?: string
  /**
   * Which input that value is of, written above it.
   *
   * The reference sets two lines in every ribbon, an identity over a measure,
   * and this is the identity. It is the weaker half here, because the card the
   * wire leaves is titled with the same word -- so it is the line dropped
   * first where a wire is too short or too steep to hold both, and it is never
   * drawn without the value it names.
   */
  name?: string
  /** The state in a word, drawn where the wire lands. Absent where the state is. */
  note?: string
  /**
   * The colour this wire is drawn in while it has no outcome to report.
   *
   * A CSS colour rather than a name, for the reason `subject` on CanvasNode
   * gives: this file does not know what the caller's categories are. Ignored
   * the moment the wire has a state that owns a colour -- see EDGE_COLOUR --
   * because what is happening outranks what is being carried.
   */
  paint?: string
}

interface View {
  x: number
  y: number
  z: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A wire's two ends are two entries, because a card is crowded per side. */
export const slotKey = (from: string, to: string, side: "from" | "to") =>
  `${from}>${to}>${side}`

/** Where one wire meets one card: how far down its side, and how wide it lands. */
export interface Slot {
  y: number
  w: number
}

/**
 * Where every wire meets every card, and how much of the card's side it gets.
 *
 * Computed for the whole field at once rather than per wire, because a slot is
 * not a property of the wire: it is that wire's place among the others landing
 * on the same side of the same card, and no edge can work that out alone.
 *
 * ORDERED BY THE OTHER END, which is what keeps a fan from tangling. Wires
 * arriving at the run node in the order the graph happens to list them would
 * cross each other on the way in for no reason a reader could see; sorted by
 * where they came from, the column's top card lands topmost. The sort reads
 * the other card's MIDDLE, which is a fact about where cards are and cannot
 * depend back on this.
 *
 * Sides are counted apart, which is most of what makes the widths work: a card
 * that feeds only the run has one wire on its right edge at the full width,
 * and the run node fits eight down its left. The wire between them is the
 * first at one end and the last at the other, and it is drawn as both.
 */
export function assignSlots(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): Map<string, Slot> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const middle = (id: string) => {
    const n = byId.get(id)
    return n ? n.place.y + n.h / 2 : 0
  }
  const slots = new Map<string, Slot>()

  for (const node of nodes) {
    for (const side of ["from", "to"] as const) {
      const own = edges.filter(
        (e) => (side === "from" ? e.from : e.to) === node.id
      )
      if (own.length === 0) continue
      const facing = (e: CanvasEdge) => middle(side === "from" ? e.to : e.from)
      own.sort((a, b) => facing(a) - facing(b))

      /*
        The band runs from the header row down, not out from the card's centre.

        PORT_Y is where a single wire has always been met and where the header
        row is, so a fan that starts there leaves the one-wire case untouched
        and grows downwards into the card. Centring it would move every
        existing wire off the header for the sake of a symmetry no card asked
        for.

        BOUNDED BY THE CARD, which is the repair. The card was grown to hold
        the fan and became a button over three hundred pixels of nothing; the
        fan is fitted to the card instead, and a wire narrows at the end where
        it has to share.
      */
      const room = Math.max(0, node.h - SLOT_FOOT - PORT_Y)
      const pitch =
        own.length > 1 ? Math.min(SLOT_PITCH, room / (own.length - 1)) : 0
      const w =
        own.length > 1
          ? clamp(pitch - SLOT_GAP, RIBBON_MIN_W, RIBBON_W)
          : RIBBON_W
      own.forEach((e, i) => {
        slots.set(slotKey(e.from, e.to, side), {
          y: node.place.y + PORT_Y + i * pitch,
          w,
        })
      })
    }
  }
  return slots
}

/**
 * How far a curve's handles are pushed out from the cards.
 *
 * Horizontal, and following the gap: a straight line between two cards in the
 * same column would lie along their shared edge and read as a border, and the
 * curve is what says these two are joined rather than adjacent. Following the
 * gap keeps a short hop from looping and a long one from sagging.
 *
 * IT FOLLOWS THE DROP AS WELL, and that is the reading's doing. A handle set
 * from the horizontal span alone leaves a wire flat for as long as the two
 * cards are far apart SIDEWAYS, and the wire that most needs a flat start is
 * the one whose cards are far apart DOWNWARDS -- the product card sits a
 * column across and half a board above the run node, and its reading was
 * written down the turn, at sixty degrees, one character to a line. Taking the
 * larger of the two spans gives every wire a flat run at each end and puts the
 * whole of the turn in the middle, which is where the reference puts it too.
 *
 * The drop is weighted nine tenths and the span five and a half, and the
 * asymmetry is the point: a wire that has to fall as far as it travels needs
 * the longest handle it can have, and one travelling sideways needs none of
 * that. Nine tenths of a drop equal to the span lands on the ceiling below,
 * which is the flattest such a wire can be drawn at all.
 *
 * THE CEILING IS THE HORIZONTAL SPAN, at 85% of it. The two handles point at
 * each other, and once they are long enough to cross by much the curve stops
 * advancing in x at its middle and doubles back into a cusp. 85% is inside
 * that: the flattest wire the two ends can be joined by without the middle
 * turning back on itself. 220 is the second ceiling and the one that catches a
 * long hop, where the drop is what would otherwise set an unbounded handle.
 */
const reachOf = (x1: number, y1: number, x2: number, y2: number) =>
  clamp(
    Math.max(Math.abs(x2 - x1) * 0.55, Math.abs(y2 - y1) * 0.9),
    26,
    Math.max(26, Math.min(220, Math.abs(x2 - x1) * 0.85))
  )

/** The line down the middle of a wire, from one card's right edge to another's left. */
export function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const reach = reachOf(x1, y1, x2, y2)
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
}

/**
 * The ribbon itself, as a closed shape rather than a thick line.
 *
 * A STROKE WOULD DO FOR THE SHAPE and not for what is drawn on it. The ribbon
 * is written inside, on two lines, and text has to be placed against a band
 * with an inside -- a filled path can be given its own fade along its length
 * and its own ink, and a stroke of the same width is a line that happens to be
 * wide. Drawing it needs an edge for each side: the top boundary out, across
 * the landing, the bottom boundary back.
 *
 * Both boundaries take the same handles as the centre line, so the ribbon
 * follows the wire rather than bowing away from it.
 */
export function ribbonPath(
  x1: number,
  y1: number,
  w1: number,
  x2: number,
  y2: number,
  w2: number
): string {
  const reach = reachOf(x1, y1, x2, y2)
  const a = w1 / 2
  const b = w2 / 2
  return [
    `M ${x1} ${y1 - a}`,
    `C ${x1 + reach} ${y1 - a}, ${x2 - reach} ${y2 - b}, ${x2} ${y2 - b}`,
    `L ${x2} ${y2 + b}`,
    `C ${x2 - reach} ${y2 + b}, ${x1 + reach} ${y1 + a}, ${x1} ${y1 + a}`,
    "Z",
  ].join(" ")
}

export function NodeCanvas({
  nodes,
  edges,
  onMove,
  onMeasure,
  className,
}: {
  nodes: readonly CanvasNode[]
  edges: readonly CanvasEdge[]
  /** A card was dragged. The caller owns where cards are. */
  onMove: (id: string, place: Place) => void
  /**
   * What a card actually draws, once it has drawn.
   *
   * The caller lays cards out before any of them exists, from a height written
   * by hand beside each kind of card. That number cannot be right for a card
   * whose contents depend on what is being asked -- the product card carries
   * four short names under one tool and nine long ones under another, and the
   * declared 78 placed the card below it 124px inside it. Nothing compared the
   * declaration with the drawing, so the overlap was silent and clipped two
   * options out of reach.
   *
   * Reported per card rather than resolved here because the caller owns where
   * cards go: this surface knows how tall a card is and has no opinion about
   * where it belongs.
   */
  onMeasure?: (id: string, h: number) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ x: FIT_PAD, y: FIT_PAD, z: 1 })

  /*
    Once the view has been moved BY HAND it is never moved again on its own.

    The fit below runs when the graph changes shape -- a different product
    brings a different set of cards -- and running it after that would undo a
    reader's own pan every time they switched tools and came back.
  */
  const touched = useRef(false)

  const placesRef = useRef(nodes)
  placesRef.current = nodes

  const fit = useCallback(() => {
    const host = hostRef.current
    const list = placesRef.current
    if (!host || !list.length) return
    const w = host.clientWidth
    const h = host.clientHeight
    if (!w || !h) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of list) {
      minX = Math.min(minX, n.place.x)
      minY = Math.min(minY, n.place.y)
      maxX = Math.max(maxX, n.place.x + NODE_W)
      maxY = Math.max(maxY, n.place.y + n.h)
    }
    const gw = maxX - minX
    const gh = maxY - minY
    // Never magnified to fill: a graph smaller than its pane is drawn at its
    // own size and centred, because scaling three cards up to fill a wide area
    // makes the type large and says nothing new.
    const z = clamp(
      Math.min((w - FIT_PAD * 2) / gw, (h - FIT_PAD * 2) / gh),
      MIN_ZOOM,
      1
    )
    setView({
      z,
      x: (w - gw * z) / 2 - minX * z,
      y: (h - gh * z) / 2 - minY * z,
    })
  }, [])

  /* The graph's shape, so a changed set of cards refits and a moved one does not. */
  const shape = nodes.map((n) => n.id).join(",")
  useLayoutEffect(() => {
    touched.current = false
    fit()
  }, [shape, fit])

  /*
    And again when the heights come back, which is one frame after the fit
    above and with different numbers.

    The first fit runs against the caller's estimates, because that is all
    there is before anything has been drawn. `onMeasure` answers, the caller
    restacks, and the graph the view was fitted to is no longer the graph on
    screen -- a column that grew by 120px would sit with its foot past the
    bottom edge. Keyed on the heights rather than on the places: a place
    changes when a card is dragged, and refitting there would take the view
    away from the reader mid-gesture.
  */
  const sizes = nodes.map((n) => Math.round(n.h)).join(",")
  useLayoutEffect(() => {
    if (!touched.current) fit()
  }, [sizes, fit])

  /*
    What each card draws, watched rather than asked for once.

    A card's height is not fixed after its first frame: a rule can block an
    option, a period can gain a scene list, and the wrap of a row of choices
    changes with them. One observer for the field, with the element's id
    carried beside it, so a card mounting or unmounting costs an entry rather
    than an observer.

    borderBoxSize, not getBoundingClientRect: the cards live inside the zoom
    transform, so a rect measured off the screen is the card's height times
    whatever the view is at. The observer reports in the element's own space,
    which is the space the caller lays out in.
  */
  const measureRef = useRef(onMeasure)
  measureRef.current = onMeasure
  const watched = useRef(new Map<Element, string>())
  const cardSizes = useRef<ResizeObserver | null>(null)
  if (cardSizes.current === null && typeof ResizeObserver !== "undefined") {
    cardSizes.current = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = watched.current.get(e.target)
        if (!id) continue
        const box = e.borderBoxSize?.[0]
        measureRef.current?.(
          id,
          box ? box.blockSize : e.contentRect.height
        )
      }
    })
  }
  useEffect(() => () => cardSizes.current?.disconnect(), [])

  const watch = useCallback((id: string) => (el: HTMLDivElement | null) => {
    const ro = cardSizes.current
    if (!ro) return
    for (const [node, seen] of watched.current) {
      if (seen === id && node !== el) {
        ro.unobserve(node)
        watched.current.delete(node)
      }
    }
    if (el) {
      watched.current.set(el, id)
      ro.observe(el)
    }
  }, [])

  /* And once more when the pane itself is resized, until the reader takes over. */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [fit])

  /*
    Zoom about the pointer, on a listener registered by hand.

    React attaches wheel handlers passively, and a passive handler cannot call
    preventDefault -- so the gesture would zoom the graph AND scroll whatever
    ancestor was willing to scroll. Registered here with `passive: false`, the
    wheel belongs to this surface entirely.
  */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      touched.current = true
      const rect = host.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setView((v) => {
        const z = clamp(v.z * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
        // The point under the pointer is the one that must not move: solve the
        // new offset from the world coordinate it maps to at the old zoom.
        return {
          z,
          x: px - ((px - v.x) / v.z) * z,
          y: py - ((py - v.y) / v.z) * z,
        }
      })
    }
    host.addEventListener("wheel", onWheel, { passive: false })
    return () => host.removeEventListener("wheel", onWheel)
  }, [])

  /*
    One gesture at a time, held in a ref rather than in state: a drag writes on
    every pointermove and state there would re-render the whole graph to move
    one card by a pixel.
  */
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; from: View }
    | { kind: "node"; id: string; startX: number; startY: number; from: Place }
    | null
  >(null)

  const beginPan = (e: React.PointerEvent) => {
    // Middle button pans from anywhere; the left button pans only from the
    // field itself, so pressing a card is never mistaken for pressing past it.
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 0 && e.target !== e.currentTarget) return
    touched.current = true
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: view }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /*
    The card last taken hold of, which is the one drawn in front.

    Cards are absolutely positioned siblings with no z-index, so the stacking
    order was the order the graph happens to list them in -- and dragging the
    area card across the run card sent it UNDER the card it was being dragged
    over. The card under the pointer is the one the reader is working on, so it
    is the one on top, and it stays there after the gesture rather than falling
    back: dropping a card behind another the moment it is released would undo
    the arrangement that was just made by hand.

    State rather than a ref, because it changes what is drawn -- but it is set
    on pointerdown only, so a drag still writes nothing per pointermove.

    `lifted` is the same gesture's other half and is cleared when it ends,
    which `front` is not: which card is in front outlives the drag, and which
    card is off the field does not. It cannot be read from `drag` -- that is a
    ref, so releasing the pointer would leave the card drawn lifted until
    something unrelated re-rendered the field.
  */
  const [front, setFront] = useState<string | null>(null)
  const [lifted, setLifted] = useState<string | null>(null)

  const beginNode = (e: React.PointerEvent, id: string, place: Place) => {
    if (e.button !== 0) return
    e.stopPropagation()
    touched.current = true
    setFront(id)
    setLifted(id)
    drag.current = { kind: "node", id, startX: e.clientX, startY: e.clientY, from: place }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (d.kind === "pan") {
      setView({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
      return
    }
    // Screen pixels are zoomed pixels: a card under a halved view has to move
    // twice as far in its own space to keep up with the pointer.
    onMove(d.id, { x: d.from.x + dx / view.z, y: d.from.y + dy / view.z })
  }

  const endDrag = () => {
    drag.current = null
    setLifted(null)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const slots = assignSlots(nodes, edges)

  /*
    A prefix for the gradient ids, because two of these fields on one page
    would otherwise both define `#area-run` and every wire on both would take
    whichever definition the document happened to hold last. The colons React
    puts in the identifier are legal in an id and in a url() reference, and are
    dropped anyway so the value stays selectable by hand.
  */
  const gid = useId().replace(/:/g, "")

  return (
    <div
      ref={hostRef}
      onPointerDown={beginPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "app-no-drag relative h-full w-full overflow-hidden touch-none select-none",
        className
      )}
      style={{
        /*
          The field is a dot grid that travels with the view, which is what
          makes a pan legible: without it the cards slide against nothing and
          the gesture reads as the cards moving rather than the eye.

          Drawn from --p-line at a low alpha through a gradient rather than
          through the `line` scale, which is declared with a Tailwind v3
          <alpha-value> placeholder and compiles to a rule the parser drops --
          see the note on LEVEL_CLASS in components/ActivityGrid.tsx.
        */
        backgroundImage:
          "radial-gradient(rgb(var(--p-line) / 0.55) 1px, transparent 1px)",
        backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor:
          drag.current?.kind === "pan"
            ? "var(--cursor-grabbing)"
            : "var(--cursor-default)",
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
        }}
      >
        {/*
          The wires sit under the cards, in the same space.

          A 1x1 box with overflow visible rather than a sized viewport: the
          graph has no fixed extent once cards can be dragged anywhere, and a
          box big enough for every arrangement would be a box that decides how
          far the field goes.
        */}
        <svg
          width={1}
          height={1}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          {edges.map((edge) => {
            const { from, to, state, name, label, note, paint: own } = edge
            const a = byId.get(from)
            const b = byId.get(to)
            if (!a || !b) return null
            const p = slots.get(slotKey(from, to, "from"))
            const q = slots.get(slotKey(from, to, "to"))
            if (!p || !q) return null
            const py = p.y
            const qy = q.y
            const x1 = a.place.x + NODE_W
            const x2 = b.place.x
            /*
              An input that has not been supplied is a hairline, never a ribbon.

              This is the one place the two vocabularies have to stay apart. A
              ribbon is the request passing between two cards; there is no
              request to pass while the area is empty, and drawing one would be
              the picture asserting a completeness the run does not have -- the
              run is refused in exactly this state.
            */
            const carrying = state !== "missing"
            const st = state ?? "pending"
            const stroke =
              EDGE_COLOUR[st] ?? own ?? "rgb(var(--p-line-strong))"
            /*
              Both ends run under the card they meet -- see TUCK. The source is
              always a card's right edge and the target always a card's left,
              whatever the reader has dragged where, so the direction is the
              port's and not the geometry's.
            */
            const a1 = x1 - TUCK
            const a2 = x2 + TUCK
            const line = wirePath(a1, py, a2, qy)
            const ribbon = ribbonPath(a1, py, p.w, a2, qy, q.w)
            const key = `${from}-${to}`
            const spine = `${gid}-spine-${key}`
            /*
              HOW MUCH OF THE READING FITS, and the second term is the one that
              matters. What is left of the horizontal span once the tail and
              the state word are cleared would be the answer if wires ran
              straight. They do not: a wire that falls as far as it travels is
              flat only at its two ends, and a reading longer than that flat
              run is written down the turn, one character to a line. So the
              room is discounted by how much of the wire's length is drop --
              level wires keep all of it, and the steepest keep half.

              Dropped rather than shrunk where it will not fit, and dropped
              whole rather than to a stub: `clip` refuses to write fewer than a
              few characters, because two letters and an ellipsis name nothing.
              Dragging the cards apart is what gives a wire its reading back,
              and that is a gesture the reader already has.
            */
            const span = Math.abs(x2 - x1)
            const drop = Math.abs(qy - py)
            const room =
              ((span - LABEL_LEAD - NOTE_ROOM) * span) / (span + drop)
            /*
              THE READING IS THE SOURCE END'S, and it is gated on that end's
              width alone: a wire is commonly wide where it leaves a card that
              feeds only the run and narrow where it arrives at a node that
              eight of them share, and the reading is written where it leaves.
            */
            const chars = Math.floor(room / LABEL_CH)
            const value =
              p.w >= RIBBON_TEXT_MIN_W ? clip(label, chars) : ""
            /*
              The name goes with the value or not at all. It is the weaker of
              the two -- the card it leaves is titled with it -- so a wire that
              can hold one line holds the one the card does not already say,
              whether it is the horizontal run or the ribbon's own width that
              has run out.
            */
            const title =
              value && p.w >= RIBBON_TWO_LINE_W ? clip(name, chars) : ""
            const ink = INK_ON[st]
            const type = ink ? "rgb(var(--p-ink))" : "rgb(var(--p-text))"
            return (
              <g key={key}>
                <defs>
                  {/*
                    The wire's own centre line, kept so the reading can be set
                    ON it. A <text x y> would be level while the wire is not,
                    and a fan-in is steepest exactly where its readings are --
                    the wire from the top card to the bottom slot crosses the
                    whole field. Written on the path, a reading leans with the
                    wire it belongs to and cannot leave it.
                  */}
                  <path id={spine} d={line} />
                </defs>
                {carrying && (
                  <>
                    {/* The smoke, and then the tint. See GROUND. */}
                    <path
                      d={ribbon}
                      fill="rgb(var(--p-ink))"
                      fillOpacity={GROUND[st]}
                    />
                    <path d={ribbon} fill={stroke} fillOpacity={FILL_OPACITY[st]} />
                  </>
                )}
                {/*
                  NOTHING IS DRAWN DOWN THE MIDDLE OF A RIBBON THAT IS ONE.

                  A hairline through a filled band is a seam: it was put there
                  when a pending wire was a sixth of its colour and could be
                  lost where two of them crossed, and it stayed after the fill
                  was raised, so every wire on the board had a pale line
                  running the length of it for no reason a reader could name.
                  A ribbon has its own boundary.

                  The two that remain are not seams. Where an input is absent
                  there is no ribbon at all and this IS the wire, drawn broken
                  because nothing passes along it; where a run is reading, the
                  same dash travels. One mark saying opposite things, and only
                  because one of them moves -- nothing else on this surface
                  does, so motion is unambiguous here in a way a second colour
                  would not be.
                */}
                {(st === "missing" || st === "reading") && (
                  <path
                    d={line}
                    fill="none"
                    stroke={st === "reading" ? type : stroke}
                    strokeWidth={1.5}
                    strokeOpacity={st === "missing" ? 0.5 : st === "reading" ? 0.5 : 0.85}
                    strokeDasharray={
                      st === "missing" ? "3 4" : st === "reading" ? "6 6" : undefined
                    }
                    className={st === "reading" ? "wire-active" : undefined}
                  />
                )}
                {title && (
                  <text
                    dy={NAME_DY}
                    fill={type}
                    fillOpacity={ink ? 0.75 : 0.65}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: NAME_PX,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                    }}
                  >
                    <textPath href={`#${spine}`} startOffset={LABEL_LEAD + TUCK}>
                      {title}
                    </textPath>
                  </text>
                )}
                {value && (
                  <text
                    dy={title ? VALUE_DY : NAME_DY + 4}
                    fill={type}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: VALUE_PX,
                    }}
                  >
                    <textPath href={`#${spine}`} startOffset={LABEL_LEAD + TUCK}>
                      {value}
                    </textPath>
                  </text>
                )}
                {/*
                  The state, in a word, set where the wire lands rather than
                  along it. It is about the far end -- whether the answer on
                  screen was computed from what this wire carries -- and the
                  wire is horizontal there, so it needs no path to lean on.
                */}
                {/*
                  Gated on the LANDING's width, which is a different question
                  from the reading's: this word is set across the wire where it
                  arrives, and eight arrivals sharing one card's side leave no
                  room between them for a word. The state is still said there,
                  in the colour of the ribbon it would have annotated.
                */}
                {note && q.w >= RIBBON_TEXT_MIN_W && (
                  <text
                    x={x2 - NOTE_LEAD}
                    y={qy + 3.5}
                    textAnchor="end"
                    fill={carrying ? type : stroke}
                    fillOpacity={st === "pending" || st === "missing" ? 0.75 : 1}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: NOTE_PX,
                      fontWeight: 600,
                    }}
                  >
                    {note}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            ref={watch(n.id)}
            className={cn(
              "absolute rounded-md border",
              /*
                Transitioned on the shadow alone: left and top carry the drag
                itself, and easing those would put the card behind the pointer.
                The shadow is built below rather than taken from a utility,
                because it is two shadows and one of them is coloured.
              */
              "transition-shadow duration-150",
              /*
                Status before tone on the border, because the border is the one
                thing here that can carry it. The run node is the action card
                either way -- the header keeps its accent plate -- and this says
                whether the action is under way.
              */
              n.status === "busy"
                ? "border-warning/70"
                : n.tone === "action"
                  ? "border-accent/60"
                  : n.tone === "aside"
                    ? "border-aside/70"
                    : n.subject
                      ? undefined
                      : "border-line-strong/45"
            )}
            style={{
              left: n.place.x,
              top: n.place.y,
              width: NODE_W,
              /*
                The card's own part, where nothing louder is being said. A
                border set from a token with an alpha rather than from a class,
                because the colour arrives as a string the caller composed.
              */
              borderColor:
                !n.status && !n.tone && n.subject ? n.subject.edge : undefined,
              background: "rgb(var(--p-surface))",
              zIndex: front === n.id ? 1 : undefined,
              /*
                DEPTH, AND A HALO IN THE CARD'S OWN COLOUR.

                The depth deepens under the card being dragged and only there:
                a card lifted off the field is the one gesture on this surface
                with no other feedback, since the pointer is already captured
                and the cursor already says grabbing.

                The halo is the reference's, and it is spread NEGATIVE so the
                colour stays close to the edge rather than washing the field
                between cards. A card with nothing to report about itself gets
                none -- the period and the model always hold a value, and a
                glow on every card is a glow that distinguishes nothing.
              */
              boxShadow: [
                lifted === n.id
                  ? "0 14px 34px -10px rgb(0 0 0 / 0.62)"
                  : "0 6px 18px -8px rgb(0 0 0 / 0.5)",
                n.status === "busy"
                  ? "0 0 22px -6px var(--warning)"
                  : n.tone === "action"
                    ? "0 0 20px -8px var(--accent)"
                    : n.tone === "aside"
                      ? "0 0 18px -10px rgb(var(--p-aside))"
                      : null,
              ]
                .filter(Boolean)
                .join(", "),
            }}
          >
            {/*
              The header is the handle. Dragging from anywhere on the card would
              mean a date field or a number could not be swiped through, and
              those are the controls the card exists to hold.
            */}
            <div
              onPointerDown={(e) => beginNode(e, n.id, n.place)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                "flex h-[2.125rem] cursor-grab items-center gap-1.5 rounded-t-md px-2.5 active:cursor-grabbing",
                /*
                  The aside header is a WASH, not a fill. `bg-accent-dim` under
                  the action tone is an opaque plate and says "this is the end
                  of the graph"; the same weight here would make the card that
                  is not in the request the loudest thing on the field. A tint
                  reads as a different KIND of card at a glance and stays
                  quieter than every card that is.

                  22%, NOT 12%. The first attempt drew the wash so thin that it
                  rendered rgb(57 60 61) over this surface -- four levels of
                  spread between the channels, which is grey. It also lands the
                  header within a tenth of the step the raised fill gives every
                  other card, so this reads as the same header in a different
                  temperature rather than as a header that went missing.
                */
                n.tone === "action"
                  ? "bg-accent-dim"
                  : n.tone === "aside"
                    ? "bg-aside/22"
                    : n.subject
                      ? undefined
                      : "bg-surface-raised/70"
              )}
              /*
                THE PART IS A TINT ON THE HEADER, NOT A HEADER OF ITS OWN.

                It replaced the raised plate outright at first, and that is
                what put the coloured cards out of pattern: every other header
                on the board is the raised surface at seven tenths, about a
                fifth lighter than the card under it, and a card with a part
                lost that lift and became a flat plate of colour instead. Two
                layers rather than one -- the tint over the plate every card
                has -- so a part reads as the same header in a different
                temperature, which is what --p-aside already does above.
              */
              style={
                n.tone !== "action" && n.tone !== "aside" && n.subject
                  ? {
                      background: `linear-gradient(${n.subject.wash}, ${n.subject.wash}), rgb(var(--p-surface-raised) / 0.7)`,
                    }
                  : undefined
              }
            >
              {n.header}
            </div>
            <div className="flex flex-col gap-1.5 px-2.5 py-2">{n.children}</div>
          </div>
        ))}
      </div>

      {/*
        One control, and it is the way back. A field that can be panned can be
        panned off the edge of what it holds, and without this the only way to
        find the graph again would be to guess which direction it went.
      */}
      <button
        type="button"
        onClick={() => {
          touched.current = false
          fit()
        }}
        title="Fit the graph to the view"
        className={cn(
          "absolute bottom-2 right-2 flex size-7 items-center justify-center rounded-sm",
          "bg-surface-raised/80 text-muted-foreground transition-colors",
          "hover:bg-surface-raised hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        )}
      >
        <ArrowsOut className="size-3.5" />
      </button>
    </div>
  )
}
