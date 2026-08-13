/**
 * What a solar terrain layer can depict, named once.
 *
 * The list was inline in SolarParameterSections, which was fine while one
 * surface drew it. It is now also read where a solar raster is DESCRIBED rather
 * than configured -- the board's data tree names each asset by what produced it
 * -- and a second copy is a second place for `winter_crop` to keep its
 * underscore. The same reason lib/classifyOptions.ts and lib/mapTools.ts exist.
 *
 * The ids are the sidecar's own (sidecar/infer.py action solar_terrain), so the
 * labels are presentation and the ids are the contract.
 */
import type { SolarSeason } from "@/lib/types"

export interface SolarSeasonOption {
  id: SolarSeason
  label: string
}

export const SOLAR_SEASONS: readonly SolarSeasonOption[] = [
  { id: "annual", label: "Annual" },
  { id: "winter", label: "Winter" },
  { id: "summer", label: "Summer" },
  { id: "winter_crop", label: "Winter crop" },
  { id: "anisotropy", label: "Winter / summer" },
  { id: "shading", label: "Horizon shading" },
]

/**
 * A season's label, or the raw value where the backend sent one we do not know.
 *
 * Falling back to the id rather than to a placeholder: a run produced by a
 * newer sidecar should read as `equinox` rather than as `Unknown`, which would
 * be this table asserting the run is malformed when it is merely newer.
 */
export function seasonLabel(id: string): string {
  return SOLAR_SEASONS.find((s) => s.id === id)?.label ?? id
}
