/**
 * The payload the research pack export sends over the Wails bridge.
 *
 * Every field carrying a base64 data URI is blanked here. BuildResearchPackZIP
 * reads no overlay URI at all, so nothing downstream loses a field, while a
 * call that is otherwise a few kilobytes of tabular data stops carrying several
 * megabytes of raster.
 *
 * It lives in one function because the two export paths drifted: the analysis
 * page stripped the two solar rasters and the research pack modal, reaching the
 * same binding from the same button row, did not. A third caller cannot
 * reintroduce that difference without editing this file.
 */
import type { PredictResult } from "@/lib/types"

export function stripResearchPackRasters(result: PredictResult) {
  return {
    ...result,
    overlay_uri: "",
    confidence_uri: "",
    ndvi_mean_uri: "",
    true_color_uri: "",
    reference_uri: "",
    lulc: result.lulc ? { ...result.lulc, map_uri: "", map_png: "" } : result.lulc,
    water: result.water
      ? { ...result.water, occurrence_uri: "" }
      : result.water,
    solar_terrain: result.solar_terrain
      ? { ...result.solar_terrain, overlay_uri: "" }
      : result.solar_terrain,
    solar_siting: result.solar_siting
      ? { ...result.solar_siting, overlay_uri: "" }
      : result.solar_siting,
  }
}
