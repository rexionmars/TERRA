/** Every product's result, seen together: to retain it, and to drop it. */
import { useCallback, useMemo } from "react"

import type {
  FieldsAnalysis,
  MineralAnalysis,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"

/**
 * A result with no classification in it.
 *
 * Water needs no classification, so it can be the only product an AOI
 * carries. The analysis view keys "is there a classification" off n_dates and the overlay
 * URI, so those stay at zero and the page presents only what was actually run.
 */
const EMPTY_RESULT: PredictResult = {
  extent: { lon_min: 0, lat_min: 0, lon_max: 0, lat_max: 0 },
  overlay_uri: "",
  confidence_uri: "",
  ndvi_mean_uri: "",
  true_color_uri: "",
  reference_uri: "",
  raster_tif: "",
  mean_confidence: 0,
  n_dates: 0,
  date_range: [],
  class_stats: [],
  temporal: [],
  vi_series: [],
  phenology: {
    sos_doy: null,
    pos_doy: null,
    eos_doy: null,
    los_days: null,
    peak: null,
    base: null,
    amplitude: null,
  },
  phenology_states: [],
}

export function useAnalysisResults({
  result,
  water,
  mineral,
  fields,
  currentRunId,
  setResult,
  setCurrentRunId,
  setWater,
  setMineral,
  setFields,
}: {
  result: PredictResult | null
  water: WaterAnalysis | null
  mineral: MineralAnalysis | null
  fields: FieldsAnalysis | null
  currentRunId: string | null
  setResult: (r: PredictResult | null) => void
  setCurrentRunId: (id: string | null) => void
  setWater: (w: WaterAnalysis | null) => void
  setMineral: (m: MineralAnalysis | null) => void
  setFields: (f: FieldsAnalysis | null) => void
}) {
  /*
    Every result the screens can be holding, dropped together.

    ONE PLACE BECAUSE A PARTIAL COPY HAS ALREADY COST US ONE. The comment this
    replaces recorded it: a standalone product was added to `resultWithWater`
    and not to the clearing, so the two disagreed about what a standalone
    product is -- the payload counted the loaded result, the clearing did not
    remove it, and the detail view rebuilt itself from that result the moment
    the reader asked for the list. The list was then unreachable for the rest
    of the session.

    A third caller was about to be written with the same shape and the same
    chance of missing one, which is what turned three copies into this.

    THE RETAIN IS NOT HERE. Two callers keep the run they are leaving so the
    board can still show it; one does not, because it is leaving the project
    that run belongs to. That is a decision about the caller's subject rather
    than about what a result is, so it stays with them.
  */
  const clearAnalysisResults = useCallback(() => {
    setResult(null)
    setCurrentRunId(null)
    setWater(null)
    setMineral(null)
    setFields(null)
  }, [setResult, setCurrentRunId, setWater, setMineral, setFields])

  /**
   * The analysis payload as the Analysis screen and the exporter see it.
   *
   * Water comes from its own action, so it is merged at render time rather
   * than written into the classification result: either can be produced first,
   * and neither must overwrite the other.
   */
  const resultWithWater = useMemo(() => {
    // Every standalone product counts. A run that carries only one of them
    // no longer sets a classification result, so leaving any out here would
    // hand the analysis screen nothing to show for it.
    //
    // THE SAME LIST APPEARS IN clearAnalysisResults, WHICH CLEARS IT. A
    // product added to one and not the other is a defect that has shipped
    // once: this counted a loaded result, the clearing did not remove it, and
    // the detail view rebuilt itself from what the clearing left behind.
    // Adding a product here means adding it there.
    if (!result && !water && !mineral && !fields) {
      return null
    }
    return {
      ...(result ?? EMPTY_RESULT),
      /*
          Whatever produced this state, not only a classification.

          The spread above supplies `run_id` from `result`, which a
          standalone product never sets -- so this object described a water
          run and carried no id for it, and every reader of
          `result.run_id` was told there was none. `currentRunId` is set by
          every handler that records a run and by opening a saved run, so it
          answers for each.
        */
      run_id: currentRunId ?? "",
      water,
      mineral,
      fields,
    }
  }, [result, water, mineral, fields, currentRunId])

  return { clearAnalysisResults, resultWithWater }
}
