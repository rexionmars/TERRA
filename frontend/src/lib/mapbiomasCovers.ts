/**
 * MapBiomas class names for the cover lists a siting run records.
 *
 * The sidecar's defaults (and any override the request may one day carry) are
 * numeric MapBiomas ids. The analysis screen and the board's solar drawer both
 * need a readable label; inventing a second palette here would drift from
 * sidecar/class_palette.py, so this table mirrors that legend and extends it
 * only for the ids siting uses that the Python dict has not yet named.
 */
const MAPBIOMAS_COVER_NAMES: Record<number, string> = {
  3: "Forest Formation",
  4: "Savanna Formation",
  9: "Forest Plantation",
  11: "Wetland",
  15: "Pasture",
  20: "Sugar Cane",
  21: "Agriculture-Pasture Mosaic",
  24: "Urban Area",
  25: "Non-vegetated Area",
  33: "Water",
  39: "Soybean",
  40: "Rice",
  41: "Other Temporary Crops",
  46: "Coffee",
  47: "Citrus",
  48: "Other Perennial Crops",
  62: "Cotton",
}

/** Human label for a MapBiomas cover id; falls back to the numeric code. */
export function mapbiomasCoverName(id: number): string {
  return MAPBIOMAS_COVER_NAMES[id] ?? `Class ${id}`
}
