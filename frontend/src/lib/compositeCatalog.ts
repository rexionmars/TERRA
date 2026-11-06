import type { PaletteName } from "@/lib/palettes"
import type { CompositeIndex, CompositeKind } from "@/lib/types"

export type RgbChannelHints = {
  /** Short meaning for what the R/G/B mapping emphasizes on the map. */
  colors: { swatch: string; meaning: string }[]
}

export type RgbPresetDef = {
  id: string
  label: string
  bands: [string, string, string]
  description: string
  hints: RgbChannelHints
}

export type IndexDef = {
  id: CompositeIndex
  label: string
  /** What the index is read for, the heading it is listed under. */
  group: "Vegetation" | "Water and moisture" | "Fire"
  description: string
  /** The formula over Sentinel-2 bands, as composite.py computes it. */
  formula: string
  /**
   * The ramp that drew the raster, named as COMPOSITE_INDICES in composite.py
   * names it. sidecar/tests/test_composite_catalog_sync.py compares the two.
   */
  cmap: Extract<PaletteName, "rdylgn" | "blues" | "inferno">
  lowLabel: string
  highLabel: string
}

/**
 * The Sentinel-2 L2A bands a composite can put in a channel.
 *
 * The same ten, in the same order, as ALLOWED_BANDS in composite.py, which
 * sidecar/tests/test_composite_catalog_sync.py checks. Wavelengths are the
 * Sentinel-2A central wavelengths from ESA's spectral response functions,
 * rounded to the nanometre.
 */
export const S2_BANDS: readonly { id: string; name: string; nm: number }[] = [
  { id: "B02", name: "Blue", nm: 492 },
  { id: "B03", name: "Green", nm: 560 },
  { id: "B04", name: "Red", nm: 665 },
  { id: "B05", name: "Red edge 1", nm: 704 },
  { id: "B06", name: "Red edge 2", nm: 741 },
  { id: "B07", name: "Red edge 3", nm: 783 },
  { id: "B08", name: "NIR", nm: 833 },
  { id: "B8A", name: "Narrow NIR", nm: 865 },
  { id: "B11", name: "SWIR 1", nm: 1614 },
  { id: "B12", name: "SWIR 2", nm: 2202 },
]

export const RGB_PRESETS: RgbPresetDef[] = [
  {
    id: "true_color",
    label: "True color",
    bands: ["B04", "B03", "B02"],
    description:
      "Natural-looking RGB (red, green, blue). Closest to what the eye sees from space.",
    hints: {
      colors: [
        { swatch: "#2d6a4f", meaning: "Vegetation appears green" },
        { swatch: "#c4a574", meaning: "Bare soil / dry fields tan" },
        { swatch: "#3a6ea5", meaning: "Water darker blue–black" },
      ],
    },
  },
  {
    id: "false_color_ir",
    label: "False color IR",
    bands: ["B08", "B04", "B03"],
    description:
      "Near-infrared on red. Healthy vegetation turns bright red; useful for plant vigor.",
    hints: {
      colors: [
        { swatch: "#e63946", meaning: "Healthy vegetation → red" },
        { swatch: "#a8dadc", meaning: "Urban / bare → cyan–grey" },
        { swatch: "#1d3557", meaning: "Water → dark" },
      ],
    },
  },
  {
    id: "agriculture",
    label: "Agriculture",
    bands: ["B11", "B08", "B02"],
    description:
      "SWIR–NIR–blue. Crops and healthy plants stand out in green; soils and built areas in magenta.",
    hints: {
      colors: [
        { swatch: "#70e000", meaning: "Crops / dense veg → lime green" },
        { swatch: "#c77dff", meaning: "Bare soil / urban → magenta" },
        { swatch: "#4361ee", meaning: "Water → dark blue" },
      ],
    },
  },
  {
    id: "swir",
    label: "SWIR",
    bands: ["B12", "B8A", "B04"],
    description:
      "Short-wave IR composite. Highlights moisture contrast, burn scars, and soil vs vegetation.",
    hints: {
      colors: [
        { swatch: "#2a9d8f", meaning: "Vegetation → teal–green" },
        { swatch: "#e9c46a", meaning: "Dry soil / rock → yellow" },
        { swatch: "#264653", meaning: "Wet areas / water → dark" },
      ],
    },
  },
]

/** In the order the panel lists them, grouped by what each is read for. */
export const INDICES: IndexDef[] = [
  {
    id: "ndvi",
    label: "NDVI",
    group: "Vegetation",
    description:
      "Normalized Difference Vegetation Index. Higher values mean denser green biomass.",
    formula: "(B08 - B04) / (B08 + B04)",
    cmap: "rdylgn",
    lowLabel: "Sparse / bare",
    highLabel: "Dense vegetation",
  },
  {
    id: "evi",
    label: "EVI",
    group: "Vegetation",
    description:
      "Enhanced Vegetation Index. Similar to NDVI with better sensitivity in dense canopy.",
    formula: "2.5 (B08 - B04) / (B08 + 6 B04 - 7.5 B02 + 1)",
    cmap: "rdylgn",
    lowLabel: "Sparse / bare",
    highLabel: "Dense vegetation",
  },
  {
    id: "savi",
    label: "SAVI",
    group: "Vegetation",
    description:
      "Soil-Adjusted Vegetation Index. NDVI with a soil term, for canopy that leaves soil in view.",
    formula: "1.5 (B08 - B04) / (B08 + B04 + 0.5)",
    cmap: "rdylgn",
    lowLabel: "Sparse / bare",
    highLabel: "Dense vegetation",
  },
  {
    id: "msavi",
    label: "MSAVI",
    group: "Vegetation",
    description:
      "Modified SAVI. The soil term is set by each pixel, for a crop early in the season over bare soil.",
    formula: "(2 B08 + 1 - sqrt((2 B08 + 1)^2 - 8 (B08 - B04))) / 2",
    cmap: "rdylgn",
    lowLabel: "Sparse / bare",
    highLabel: "Dense vegetation",
  },
  {
    id: "ndre",
    label: "NDRE",
    group: "Vegetation",
    description:
      "Normalized Difference Red Edge. Keeps rising in dense canopy after NDVI has levelled off, and follows chlorophyll.",
    formula: "(B8A - B05) / (B8A + B05)",
    cmap: "rdylgn",
    lowLabel: "Low chlorophyll",
    highLabel: "High chlorophyll",
  },
  {
    id: "gci",
    label: "GCI",
    group: "Vegetation",
    description:
      "Green Chlorophyll Index. Rises with the chlorophyll content of the canopy.",
    formula: "B08 / B03 - 1",
    cmap: "rdylgn",
    lowLabel: "Low chlorophyll",
    highLabel: "High chlorophyll",
  },
  {
    id: "psri",
    label: "PSRI",
    group: "Vegetation",
    description:
      "Plant Senescence Reflectance Index. Rises as chlorophyll breaks down against carotenoids: senescence, ripening or stress.",
    formula: "(B04 - B02) / B06",
    cmap: "inferno",
    lowLabel: "Green canopy",
    highLabel: "Senescent",
  },
  {
    id: "ndwi",
    label: "NDWI",
    group: "Water and moisture",
    description:
      "Normalized Difference Water Index. Emphasizes open water and wet surfaces.",
    formula: "(B03 - B08) / (B03 + B08)",
    cmap: "blues",
    lowLabel: "Dry / land",
    highLabel: "Water",
  },
  {
    id: "mndwi",
    label: "MNDWI",
    group: "Water and moisture",
    description:
      "Modified NDWI. Short-wave infrared in place of near infrared, which keeps built-up ground from reading as water.",
    formula: "(B03 - B11) / (B03 + B11)",
    cmap: "blues",
    lowLabel: "Land",
    highLabel: "Water",
  },
  {
    id: "ndmi",
    label: "NDMI",
    group: "Water and moisture",
    description:
      "Normalized Difference Moisture Index. Relates to canopy / soil moisture stress.",
    formula: "(B08 - B11) / (B08 + B11)",
    cmap: "blues",
    lowLabel: "Drier",
    highLabel: "Wetter",
  },
  {
    id: "msi",
    label: "MSI",
    group: "Water and moisture",
    description:
      "Moisture Stress Index. Rises as the water content of the canopy falls.",
    formula: "B11 / B08",
    cmap: "inferno",
    lowLabel: "Wetter canopy",
    highLabel: "Drier canopy",
  },
  {
    id: "nbr",
    label: "NBR",
    group: "Fire",
    description:
      "Normalized Burn Ratio. Falls over burned ground; read a scene from before a fire beside one from after.",
    formula: "(B08 - B12) / (B08 + B12)",
    cmap: "rdylgn",
    lowLabel: "Burned / bare",
    highLabel: "Vegetated",
  },
]

/** The headings of the index list, in the order INDICES first reaches each. */
export const INDEX_GROUPS: readonly IndexDef["group"][] = [
  ...new Set(INDICES.map((i) => i.group)),
]

/** The band's name for a channel picker, or the id alone for one not listed. */
export function bandName(id: string): string {
  const b = S2_BANDS.find((x) => x.id === id)
  return b ? `${b.id} ${b.name}, ${b.nm} nm` : id
}

export function findRgbPreset(
  bands: [string, string, string]
): RgbPresetDef | undefined {
  const key = bands.join(",")
  return RGB_PRESETS.find((p) => p.bands.join(",") === key)
}

function findIndexDef(id: CompositeIndex): IndexDef {
  return INDICES.find((i) => i.id === id) ?? INDICES[0]
}

export function resolveCompositionMeta(input: {
  kind: CompositeKind
  bands: [string, string, string]
  index: CompositeIndex
}): {
  title: string
  label: string
  description: string
  presetId?: string
  bands?: [string, string, string]
  index?: CompositeIndex
  kind: CompositeKind
  rgbHints?: RgbChannelHints
  indexDef?: IndexDef
} {
  if (input.kind === "index") {
    const def = findIndexDef(input.index)
    return {
      kind: "index",
      index: input.index,
      title: def.label,
      label: def.label,
      description: def.description,
      indexDef: def,
    }
  }
  const preset = findRgbPreset(input.bands)
  const bandLabel = input.bands.join("-")
  if (preset) {
    return {
      kind: "rgb",
      bands: input.bands,
      presetId: preset.id,
      title: preset.label,
      label: `${preset.label} · ${bandLabel}`,
      description: preset.description,
      rgbHints: preset.hints,
    }
  }
  return {
    kind: "rgb",
    bands: input.bands,
    presetId: "custom",
    title: "Custom RGB",
    label: `RGB ${bandLabel}`,
    description:
      "Manual band assignment to red, green and blue channels (percentile stretch).",
    rgbHints: {
      colors: [
        { swatch: "#ef4444", meaning: `R ← ${input.bands[0]}` },
        { swatch: "#22c55e", meaning: `G ← ${input.bands[1]}` },
        { swatch: "#3b82f6", meaning: `B ← ${input.bands[2]}` },
      ],
    },
  }
}
