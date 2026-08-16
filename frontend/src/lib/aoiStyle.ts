/** Contour / label chrome for the active AOI on the map. */

export type AoiContourSchemeId =
  | "white"
  | "ochre"
  | "cyan"
  | "lime"
  | "rose"
  | "ink"

export interface AoiContourScheme {
  id: AoiContourSchemeId
  label: string
  /** Stroke color for the polygon outline. */
  stroke: string
  /** Label chip background. */
  chipBg: string
  /** Label chip text. */
  chipFg: string
}

export const AOI_CONTOUR_SCHEMES: AoiContourScheme[] = [
  {
    id: "white",
    label: "White",
    stroke: "#ffffff",
    chipBg: "rgb(245 245 243 / 0.97)",
    chipFg: "rgb(55 55 55)",
  },
  {
    id: "ochre",
    label: "Ochre",
    stroke: "#c2703d",
    chipBg: "rgb(194 112 61 / 0.95)",
    chipFg: "#fff8f0",
  },
  {
    id: "cyan",
    label: "Cyan",
    stroke: "#22d3ee",
    chipBg: "rgb(8 47 54 / 0.92)",
    chipFg: "#a5f3fc",
  },
  {
    id: "lime",
    label: "Lime",
    stroke: "#a3e635",
    chipBg: "rgb(26 46 5 / 0.92)",
    chipFg: "#d9f99d",
  },
  {
    id: "rose",
    label: "Rose",
    stroke: "#fb7185",
    chipBg: "rgb(76 5 25 / 0.92)",
    chipFg: "#fecdd3",
  },
  {
    id: "ink",
    label: "Ink",
    stroke: "#1c1917",
    chipBg: "rgb(28 25 23 / 0.94)",
    chipFg: "#fafaf9",
  },
]

export const DEFAULT_AOI_CONTOUR_SCHEME: AoiContourSchemeId = "white"

export function getAoiContourScheme(
  id: AoiContourSchemeId | string | undefined
): AoiContourScheme {
  return (
    AOI_CONTOUR_SCHEMES.find((s) => s.id === id) ?? AOI_CONTOUR_SCHEMES[0]
  )
}
