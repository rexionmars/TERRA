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
  description: string
  /** Matches sidecar colormaps in composite.py */
  cmap: "rdylgn" | "blues"
  lowLabel: string
  highLabel: string
}

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

export const INDICES: IndexDef[] = [
  {
    id: "ndvi",
    label: "NDVI",
    description:
      "Normalized Difference Vegetation Index. Higher values mean denser green biomass.",
    cmap: "rdylgn",
    lowLabel: "Sparse / bare",
    highLabel: "Dense vegetation",
  },
  {
    id: "ndwi",
    label: "NDWI",
    description:
      "Normalized Difference Water Index. Emphasizes open water and wet surfaces.",
    cmap: "blues",
    lowLabel: "Dry / land",
    highLabel: "Water",
  },
  {
    id: "ndmi",
    label: "NDMI",
    description:
      "Normalized Difference Moisture Index. Relates to canopy / soil moisture stress.",
    cmap: "blues",
    lowLabel: "Drier",
    highLabel: "Wetter",
  },
  {
    id: "evi",
    label: "EVI",
    description:
      "Enhanced Vegetation Index. Similar to NDVI with better sensitivity in dense canopy.",
    cmap: "rdylgn",
    lowLabel: "Sparse / bare",
    highLabel: "Dense vegetation",
  },
]

/** Sidecar RdYlGn stops (approx) for legend gradient. */
export const RDYLGN_STOPS = [
  "#a60026",
  "#f46d43",
  "#fee08b",
  "#ffffbf",
  "#a6d96a",
  "#66bd63",
  "#1a9850",
]

export const BLUES_STOPS = [
  "#f7fbff",
  "#c6dbef",
  "#6baed6",
  "#3182bd",
  "#08519c",
]

export function findRgbPreset(
  bands: [string, string, string]
): RgbPresetDef | undefined {
  const key = bands.join(",")
  return RGB_PRESETS.find((p) => p.bands.join(",") === key)
}

export function findIndexDef(id: CompositeIndex): IndexDef {
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
