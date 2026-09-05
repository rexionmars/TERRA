/**
 * WHAT A CARD SUPPLIES, AS A KIND OF THING RATHER THAN AS A SENTENCE.
 *
 * THE DEFECT THIS FOLLOWS. Every card on the board was the same card with
 * different contents in it, and everything the graph had to say about an input
 * was written by hand, per card, three times over: a string for the wire to
 * carry, a predicate for whether the card was empty, and the same string again
 * as the signature a later run is compared against. Three tables over one
 * subject, each of which could be right while another was wrong -- and each of
 * which a new card could be added without.
 *
 * A card declares a VALUE here instead, and the three follow from it. The area
 * supplies ground; the period supplies a span; the elevation card supplies
 * several of a set with a floor under how many. `reading` writes it, `supplied`
 * says whether it is there, `signature` says whether it has moved. A card
 * added without a value does not compile, which is the whole of what this
 * buys over a table of strings.
 *
 * WHAT IT IS NOT. It does not type the CARD, and that is deliberate: a date
 * range and a nine-way product picker are genuinely different controls, and a
 * card body derived from a kind would be a worse editor than the bespoke one
 * each of them already has. What is typed is what leaves the card.
 *
 * NOR IS IT A PORT TYPE. Wires here cannot be made or broken by hand -- see
 * the note at the head of NodeCanvas -- so there is no connection to refuse
 * and nothing for a type to check. It describes; it does not gate.
 */

/**
 * A number written the way a card would write it: as short as it is exact.
 *
 * Two decimals at most and no trailing zeros, so a threshold set to 2.5 reads
 * "2.5" and one set to 3 reads "3" rather than "3.00".
 */
const num = (v: number): string =>
  Number.isFinite(v) ? String(Math.round(v * 100) / 100) : ""

export type RunValue =
  /** Ground, by the name the drawing carries, or nothing drawn. */
  | { kind: "ground"; label: string | null }
  /** A span of calendar time, as two ISO dates. */
  | { kind: "span"; start: string; end: string }
  /**
   * A depth of record, in whole years, and what is being counted.
   *
   * `of` because the years are not interchangeable: ten years of hourly
   * irradiance, thirty of climatology and twenty-five of an analysis period
   * are three different spans that would otherwise all read "N yr" and compare
   * equal to each other.
   */
  | { kind: "record"; years: number; of: string }
  /** One of a fixed set, by its own label, or none chosen. */
  | { kind: "choice"; label: string | null }
  /**
   * Several of a fixed set, and the fewest the run can be made with.
   *
   * `least` is what makes this its own kind rather than a list: the flood
   * envelope is what two elevation products DISAGREE about, so one product is
   * not a smaller answer but no answer. The floor travels with the value
   * because it is a fact about the input, not about the card that edits it.
   */
  | { kind: "several"; items: readonly string[]; least: number; of: number }
  /** A number with a unit. */
  | { kind: "measure"; of: number; unit: string }
  /** Two numbers sharing one unit, low then high. */
  | { kind: "band"; low: number; high: number; unit: string }
  /** One acquisition out of what the period found, or none chosen. */
  | { kind: "scene"; id: string | null; found: number }
  /** A connection to a local store, and whether it answered. */
  | { kind: "store"; reachable: boolean }
  /**
   * A card that supplies nothing to a run.
   *
   * The layers card, which says what is DRAWN while the question is set up;
   * the run card itself, which is where the wires end; and any card whose
   * bundle is absent, since a graph with no solar parameters draws no solar
   * cards but the table over the node ids is total.
   */
  | { kind: "none" }

/**
 * What the wire carries, written out.
 *
 * PREFERRING A QUANTITY WHERE THE KIND HAS ONE. A span reports the days it
 * covers rather than its two dates: the dates are the control, the span is
 * what the run reads, and it is the span that says whether two runs asked the
 * same question. A set of three or fewer names them and a larger one counts
 * them, because past three the names stop fitting and the count is the fact.
 */
export function reading(v: RunValue): string {
  switch (v.kind) {
    case "ground":
      return v.label ?? ""
    case "span": {
      const a = Date.parse(v.start)
      const b = Date.parse(v.end)
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return ""
      const days = Math.round((b - a) / 86_400_000) + 1
      return `${days.toLocaleString()} d`
    }
    case "record":
      return `${num(v.years)} yr ${v.of}`.trim()
    case "choice":
      return v.label ?? ""
    case "several":
      return v.items.length === 0
        ? ""
        : v.items.length <= 3
          ? v.items.join(" ")
          : `${v.items.length} of ${v.of}`
    case "measure":
      return `${num(v.of)} ${v.unit}`.trim()
    case "band":
      return `${num(v.low)}-${num(v.high)} ${v.unit}`.trim()
    case "scene":
      return v.id ?? (v.found > 0 ? `${v.found} scenes` : "")
    case "store":
      return v.reachable ? "reachable" : "unreachable"
    case "none":
      return ""
  }
}

/**
 * Whether the card is holding anything at all.
 *
 * A CLAIM ABOUT THE CARD, NOT ABOUT THE RUN, and the distinction is what makes
 * it safe to derive. An unsupplied input is drawn as a broken line because
 * nothing passes along it, which is true whether or not this particular run is
 * refused on it -- the refusal is reported as a sentence on the control that
 * refuses, where it can say WHY. Before this, the same question was a hand
 * written list of three cards, and the fourth that needed it -- a composition
 * with no scene chosen -- had been missed.
 *
 * `several` is the case worth reading twice: below its floor it is not a
 * smaller value but an absent one.
 */
export function supplied(v: RunValue): boolean {
  switch (v.kind) {
    case "ground":
      return v.label !== null
    case "span":
      return reading(v) !== ""
    case "choice":
      return v.label !== null
    case "several":
      return v.items.length >= v.least
    case "scene":
      return v.id !== null
    case "store":
      return v.reachable
    case "record":
    case "measure":
    case "band":
    case "none":
      return true
  }
}

/**
 * Whether this input has moved, as one string.
 *
 * STRUCTURAL RATHER THAN WRITTEN. The comparison used to be between two
 * READINGS -- the text on the wire -- and a reading is lossy on purpose: it
 * rounds, it counts a set instead of naming it, and it is cut to fit the wire
 * it is written on. Two different periods a day apart in the same week can
 * read the same number of days. The value itself cannot.
 */
export const signature = (v: RunValue): string => JSON.stringify(v)

/**
 * WHICH PART OF THE QUESTION A CARD ANSWERS.
 *
 * A run over ground is asked in four parts, and every card that feeds one is
 * in exactly one of them:
 *
 *   source  WHERE it reads from -- the drawn ground, one acquisition, a store
 *   when    OVER WHAT STRETCH -- a calendar span, a depth of record
 *   method  BY WHICH METHOD -- a model, an index, a product, a set of bands
 *   value   AT WHAT VALUES -- a threshold, a slope, a ratio, a loss
 *
 * IT IS DERIVED FROM THE KIND, not declared per card, so a card cannot be in
 * the wrong part and a kind cannot be added without one being chosen for it.
 *
 * `ground` IS NOT ONLY THE POLYGON. A scene is one acquisition and a store is
 * a local database, and both answer the same question the drawn area does:
 * what this run reads from. The polygon is the commonest of the sources, not
 * the kind.
 *
 * THE FIRST TWO WEIGH MORE THAN THE LAST TWO, and that ordering is what the
 * board draws as weight rather than as a fifth colour. Change where or when a
 * run reads and it is a run about something else; change a threshold and it is
 * the same question answered differently. That is a claim about this
 * application's own products, not a general one, and it is the only ranking
 * here that the data supports.
 */
export type Subject = "source" | "when" | "method" | "value"

/** The two parts that decide what a run is ABOUT, against the two that decide how. */
export const HEAVY: readonly Subject[] = ["source", "when"]

export function subject(v: RunValue): Subject | null {
  switch (v.kind) {
    case "ground":
    case "scene":
    case "store":
      return "source"
    case "span":
    case "record":
      return "when"
    case "choice":
    case "several":
      return "method"
    case "measure":
    case "band":
      return "value"
    case "none":
      return null
  }
}
