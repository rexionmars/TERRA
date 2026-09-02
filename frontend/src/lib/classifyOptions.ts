/**
 * What a classification can be run with, named once.
 *
 * These lists were inline in the map's control panel, which was fine while one surface
 * drew them. The studio draws the same choices in its own vocabulary --
 * rows in a column rather than cards in a panel -- and a second copy of the
 * list is a second place a model can be added to, or a constraint forgotten.
 * The same reason lib/mapTools.ts and lib/mapLayers.ts exist.
 *
 * What is shared is the CHOICES and the RULES between them. How they are drawn
 * is each surface's own business, and deliberately not here: a panel with room
 * shows a subtitle under each model, a 15rem column does not, and neither of
 * those is a fact about the models.
 */
import type { ModelKind } from "@/lib/types"

export interface ModelOption {
  id: ModelKind
  label: string
  /** What it is for. Read while choosing, not while reading the choice back. */
  detail: string
}

export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "spectral",
    label: "Random Forest",
    detail: "spectro-temporal features",
  },
  {
    id: "temporal_transformer",
    label: "Temporal Transformer",
    detail: "lightweight series model",
  },
  { id: "prithvi", label: "Prithvi-EO 2.0", detail: "embeddings (NASA/IBM)" },
]

export type ClassifyMode = "single" | "temporal"

export interface ModeOption {
  id: ClassifyMode
  label: string
  detail: string
}

export const MODE_OPTIONS: readonly ModeOption[] = [
  { id: "single", label: "Map", detail: "full temporal stack" },
  { id: "temporal", label: "Temporal", detail: "cumulative retention" },
]

/**
 * Why a mode cannot be chosen, or null where it can.
 *
 * A rule rather than a boolean, so a surface that refuses one can say why.
 * Cumulative retention is a Random Forest procedure: the other two models
 * produce the map and nothing to accumulate.
 */
export function modeBlockedBy(
  mode: ClassifyMode,
  model: ModelKind
): string | null {
  if (mode === "temporal" && model !== "spectral") {
    return "Temporal retention runs on Random Forest."
  }
  return null
}
