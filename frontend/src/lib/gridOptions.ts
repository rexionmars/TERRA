/**
 * The questions the operational record can be asked, named once.
 *
 * One table, for the reason mapTools.ts states about its own two: a label that
 * exists twice is a label that can disagree with itself, and this repository
 * has already shipped a hand-copied palette and a hand-copied set of table
 * columns that drifted while nothing compared them.
 */

export type GridProductId = "curtailment" | "record" | "figure"

/**
 * What a product leaves behind, which decides whether it can be a plane.
 *
 * The same column components/energy/solarProducts.ts already carries, and for
 * the same reason: a product draws when its payload holds something to draw.
 * The third value is the difference between the two slices. Solar returns a
 * FIELD -- irradiation over terrain, continuous, and interpolating between two
 * values gives a third that is honestly an irradiation. This record returns
 * PLACES: seventeen named plants at seventeen coordinates, and the ground
 * between two of them was not measured and has no value. So it is drawn as
 * points, and rasterising it would invent the surface layerLegend.ts already
 * argues against inventing.
 */
export type GridOutput = "vector" | "figures"

export interface GridProduct {
  id: GridProductId
  label: string
  /** What the run answers, for the card that names it. */
  hint: string
  /** Whether the question is about a piece of ground. */
  needsArea: boolean
  /**
   * vector: the payload carries coordinates and the result can go on the map.
   * figures: it does not, and offering a plane would be offering a place the
   * answer does not have.
   */
  output: GridOutput
}

export const GRID_PRODUCTS: readonly GridProduct[] = [
  {
    id: "curtailment",
    label: "Curtailment",
    hint: "What the operator withheld at the metered plants inside an area",
    needsArea: true,
    // by_plant returns a coordinate per plant, and the spread is why it is
    // worth drawing: across one connection point the withheld fraction runs
    // 0.238 to 0.322, which a table sorted by energy scatters.
    output: "vector",
  },
  {
    id: "figure",
    // The published series, computed here. Not "chart": the analysis is the
    // product and the drawing is how it is read, which is the same order the
    // research states.
    label: "Series",
    hint: "One analysis of the published research series, over the whole record",
    needsArea: false,
    // Seven of the twelve are about the SIN and refuse a polygon outright.
    // There is no ground for them to be drawn on.
    output: "figures",
  },
  {
    id: "record",
    // Not "Store", which is what the connection is called on the graph. This
    // asks what is IN it, and the two are different questions asked of the
    // same database.
    label: "Record",
    hint: "Which operational record this installation holds, and of which revision",
    needsArea: false,
    // A question about the database, not about any ground.
    output: "figures",
  },
]
