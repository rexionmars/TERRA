/**
 * MapBiomas class names, for a cover id a surface has to print.
 *
 * The sidecar reports classes by their numeric MapBiomas ids, and the
 * domain-shift section prints a readable label beside them. Inventing a second
 * palette here would drift from the sidecar's own legend (MAPBIOMAS_LEGEND in
 * sidecar/terra/mapbiomas.py), so this table mirrors that legend and extends it
 * only for the ids that table has not named.
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
