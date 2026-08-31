/**
 * The water indices, named once.
 *
 * They were a private constant inside WaterPanel, which was correct while that
 * panel was the only surface offering them. The run graph offers them too, and
 * lib/classifyOptions.ts and lib/solarOptions.ts already establish where a set
 * of choices lives when more than one surface renders it: two renderings are a
 * design decision, two copies are a bug waiting for someone to add an index.
 *
 * Each carries what it is computed FROM and who published it, because the
 * choice between them is a choice between definitions rather than a preference.
 */
import type { WaterIndex } from "@/lib/types"

export interface WaterIndexOption {
  id: WaterIndex
  label: string
  detail: string
}

export const WATER_INDICES: readonly WaterIndexOption[] = [
  { id: "MNDWI", label: "MNDWI", detail: "green + SWIR1 \u00b7 Xu (2006)" },
  { id: "NDWI", label: "NDWI", detail: "green + NIR \u00b7 McFeeters (1996)" },
  { id: "AWEI", label: "AWEI", detail: "4 bands, unbounded \u00b7 Feyisa (2014)" },
]
