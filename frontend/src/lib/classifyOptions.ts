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
import { modelName, modelTakesMode } from "@/lib/installedModels"
import type { ModelKind } from "@/lib/types"

/*
  THE MODELS ARE NOT LISTED HERE. They are the packages installed on this
  machine, which lib/installedModels.ts reads from the shell; a list written
  here would be a model the reader may not have, and a model they installed
  that no surface offers.
*/

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
 * Cumulative retention reruns the model over a growing stack, which only a
 * package that lists the mode can do; the others produce the map and nothing
 * to accumulate.
 */
export function modeBlockedBy(mode: ClassifyMode, model: ModelKind): string | null {
  if (!modelTakesMode(model, mode)) {
    return `${modelName(model)} does not run ${mode === "temporal" ? "temporal retention" : `the ${mode} mode`}.`
  }
  return null
}
