/**
 * Static class legend for the five classes the classifier can emit.
 *
 * Mirrors sidecar/class_palette.py, which is the canonical definition shared by
 * the classification path (infer.py) and the MapBiomas reference path
 * (lulc.py). Edit both together: this list is what the legend renders next to
 * the reference image, so a divergence here reintroduces the defect where the
 * legend described a different palette than the image beside it.
 *
 * Overlays and class statistics carry their own colour from the backend
 * (ClassStat.color), so this list is only used where no run data is present.
 */
export interface ClassLegendEntry {
  id: number
  name: string
  color: string
}

export const MAPBIOMAS_CLASS_LEGEND: ClassLegendEntry[] = [
  { id: 3, name: "Forest Formation", color: "#006400" },
  { id: 21, name: "Agriculture-Pasture Mosaic", color: "#fff3bf" },
  { id: 25, name: "Non-vegetated Area", color: "#ffa07a" },
  { id: 39, name: "Soybean", color: "#f5b3c8" },
  { id: 41, name: "Other Temporary Crops", color: "#e974ed" },
]
