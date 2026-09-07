/**
 * What colour a circuit is, by the voltage it runs at.
 *
 * NOT CHOSEN HERE. These are the values ANEEL's own transmission map paints,
 * read out of the renderer its service publishes -- PORTAL/Transmissão layer 1,
 * field SymbolID, uniqueValue -- rather than sampled from a screenshot or
 * matched by eye. A reader who works with the sector's maps recognises them
 * without a legend, which is the whole reason for taking a convention instead
 * of designing a ramp: the ramp would be better at saying which of two lines is
 * higher, and worse at saying what either one IS.
 *
 * WHAT THE CONVENTION DOES NOT NAME. Its renderer has a sixth class holding
 * 13.8, 34.5, 69, 88, 525, 600 and 765 kV together, painted black. Three of
 * those are levels this register carries -- the store's own note names a 600 kV
 * line -- so the class is not empty here, and black is not usable: the map's
 * base is imagery as often as it is a street map, and a black circuit over
 * either is a circuit that is read as a gap.
 *
 * So the class keeps its meaning and loses its colour. `UNNAMED` is a light
 * neutral, which says what the convention says about these levels -- that it
 * does not distinguish them -- rather than inventing five more hues and
 * claiming an authority this table is here to borrow.
 */
import type { ExpressionSpecification } from "maplibre-gl"

/** The levels ANEEL's renderer names, with the colour it gives each. */
export const VOLTAGE_COLOUR: readonly { kv: number; colour: string }[] = [
  { kv: 138, colour: "#F3C71F" },
  { kv: 230, colour: "#1A9B43" },
  { kv: 345, colour: "#00A2EC" },
  { kv: 440, colour: "#B684A1" },
  { kv: 500, colour: "#C90E16" },
]

/**
 * Every other level, including the ones the convention lumps with the
 * distribution voltages. See the note above for why this is not black.
 */
export const UNNAMED_VOLTAGE = "#C6D4E1"

/**
 * The table as a MapLibre expression over a feature's `kv`.
 *
 * `match` and not `step`, because these are named levels and not a range: a
 * 525 kV circuit is not "somewhere above 500", it is a level the convention
 * has an answer about, and that answer is the unnamed class. A step would
 * paint it as though it were 500.
 */
export function voltageColourExpression(): ExpressionSpecification {
  return [
    "match",
    ["get", "kv"],
    ...VOLTAGE_COLOUR.flatMap(({ kv, colour }) => [kv, colour]),
    UNNAMED_VOLTAGE,
  ] as unknown as ExpressionSpecification
}
