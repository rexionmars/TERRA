/**
 * What each photovoltaic product returns, and which parameters it consumes.
 *
 * One table, read by every place on the energy screen that states an output:
 * the marker beside the label in the selector, the shape the output region
 * takes on selection, and the run button. Stated three times from three
 * literals they could disagree, and a user reading any one of them would have
 * no way to tell which was current.
 *
 * The output column is checkable against lib/types.ts: SolarTerrainAnalysis and
 * SolarSitingAnalysis carry overlay_uri and extent, SolarAnalysis and
 * EnergyModelAnalysis carry neither. That is the whole of the claim -- a
 * product draws when its payload holds a raster to draw.
 *
 * `params` names the parameter groups a product consumes, and is what makes the
 * shared-parameter note derivable rather than hand-maintained: SolarParams is
 * flat, so one climatology period and one pair of slope limits serve several
 * products, and editing one while another holds a result leaves that result on
 * the previous value.
 */
import type { SolarProductId } from "@/lib/energyState"

/**
 * A block of parameters, named by what it configures rather than by the product
 * that happens to be selected. "hourly", "radiation" and "slope" are each
 * consumed by more than one product, and are what raise the shared-parameter
 * note.
 *
 * The hourly window is its own group because its consumers are not those of the
 * rest of the radiation block: the resource run and the energy model read all
 * of those fields, while the terrain map reads only this one. Folded into
 * "radiation" it was declared by neither -- invisible while terrain was
 * selected, and outside the reach of the note even though editing it
 * invalidates a held terrain raster.
 */
export type SolarParamGroup =
  | "hourly"
  | "radiation"
  | "season"
  | "slope"
  | "plant"

export interface SolarProductEntry {
  id: SolarProductId
  label: string
  /** raster: the payload carries overlay_uri and extent. figures: it does not. */
  output: "raster" | "figures"
  /** Imperative for the run button; the output phrase is appended from `output`. */
  runVerb: string
  /** Present participle shown while this product runs. */
  runningLabel: string
  params: readonly SolarParamGroup[]
}

// Annotated rather than `as const`: the entries are read through the interface
// above, and widening `params` to the group union is what lets the shared
// note ask which products consume a group.
export const SOLAR_PRODUCTS: readonly SolarProductEntry[] = [
  {
    id: "resource",
    label: "Resource at the AOI centroid",
    output: "figures",
    runVerb: "Analyse the resource",
    runningLabel: "Computing",
    params: ["hourly", "radiation"],
  },
  {
    id: "terrain",
    label: "Irradiation over terrain",
    output: "raster",
    runVerb: "Map irradiation over terrain",
    runningLabel: "Mapping",
    params: ["hourly", "season"],
  },
  {
    id: "siting",
    label: "Photovoltaic siting",
    output: "raster",
    runVerb: "Map photovoltaic siting",
    runningLabel: "Classifying",
    params: ["slope"],
  },
  {
    id: "energy",
    label: "Photovoltaic energy model",
    output: "figures",
    runVerb: "Model energy",
    runningLabel: "Modelling",
    params: ["hourly", "radiation", "slope", "plant"],
  },
]

const BY_ID = new Map<SolarProductId, SolarProductEntry>(
  SOLAR_PRODUCTS.map((p) => [p.id, p] as const)
)

export function solarProduct(id: SolarProductId): SolarProductEntry {
  const found = BY_ID.get(id)
  // The map is built from the table above and keyed by the same union, so a
  // miss means the two have drifted. Failing here is preferable to rendering a
  // product with no label and no stated output.
  if (!found) throw new Error(`unknown solar product: ${id}`)
  return found
}

/** Marker shown beside the label in the selector. */
export function outputKindLabel(p: SolarProductEntry): string {
  return p.output === "raster" ? "map layer" : "figures, no map layer"
}

/** Clause appended to the run button, so the action states what it returns. */
export function outputPhrase(p: SolarProductEntry): string {
  return p.output === "raster" ? "returns a raster" : "returns figures"
}

export function runButtonLabel(p: SolarProductEntry): string {
  return `${p.runVerb}, ${outputPhrase(p)}`
}

export function drawsRaster(p: SolarProductEntry): boolean {
  return p.output === "raster"
}

/** The products that read a given parameter group, in table order. */
export function productsUsingGroup(
  group: SolarParamGroup
): SolarProductEntry[] {
  return SOLAR_PRODUCTS.filter((p) => p.params.includes(group))
}
