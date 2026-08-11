/**
 * What a plane's colours mean, from the data that travelled with the run.
 *
 * The board draws six planes of pink, cream, blue and green and names each one
 * "Prediction" or "Confidence". That is legible to whoever ran it and to nobody
 * else: the colour is the whole content of a class raster, and without the
 * legend the plane is a picture rather than a map.
 *
 * EVERY ENTRY HERE COMES FROM THE PAYLOAD OR FROM A GENERATED TABLE, and that
 * restraint is the design. lib/palettes.ts says in its own header how a legend
 * hand-transcribed from the renderer came to disagree with the raster it
 * described by up to 40 of 255 on three stops. So a ramp is drawn only where
 * something names a PaletteName -- solar irradiation carries one in its
 * `scale`, an index composition through the catalogue's `cmap` -- and where
 * nothing does, this reports the FIGURES THE RUN MEASURED instead of a bar. A
 * legend that is wrong is worse than a plane with none: the plane at least
 * admits it needs explaining.
 *
 * And a line of prose about a ramp -- "0 to 100%, dark low to bright high" --
 * describes the colouring and says nothing about the data. Where the run
 * reported numbers, those are what belongs here: the mean confidence against
 * the floor it cannot go below, the persistent and ephemeral water areas kept
 * apart because the split is the finding, the dates that survived masking.
 */
import { INDICES } from "@/lib/compositeCatalog"
import { MAPBIOMAS_CLASS_LEGEND } from "@/lib/classPalette"
import { predictionSource } from "@/lib/mapLayers"
import { paletteGradient } from "@/lib/palettes"
import type {
  CompositionOverlay,
  PredictResult,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
  WaterAnalysis,
} from "@/lib/types"

export interface LegendClass {
  name: string
  color: string
  /** Share of the AOI, where the run reported one. */
  pct?: number
  /** Its extent on the ground; a share alone does not say how much land. */
  areaHa?: number
}

export type LayerLegend =
  | { kind: "classes"; subject: string; entries: LegendClass[] }
  | {
      kind: "ramp"
      subject: string
      /** A CSS gradient built from the generated stops, never written by hand. */
      gradient: string
      low: string
      high: string
    }
  /**
   * Figures the run reported, for a raster whose colour mapping is not
   * published. A prose line saying "0 to 100%, dark low to bright high"
   * describes the RAMP and says nothing about the data; these are what the run
   * actually measured.
   */
  | {
      kind: "stats"
      subject: string
      rows: { label: string; value: string }[]
      /** A caveat that changes how the figures must be read, where one applies. */
      note?: string
    }
  /** The quantity is known, the mapping is not published, and nothing was measured. */
  | { kind: "note"; subject: string; note: string }
  | null

export interface LegendSources {
  result?: PredictResult | null
  water?: WaterAnalysis | null
  solarTerrain?: SolarTerrainAnalysis | null
  solarSiting?: SolarSitingAnalysis | null
  composition?: CompositionOverlay | null
}

const num = (v: number, d = 0) => v.toFixed(d)

/**
 * The legend for one layer id, or null where the layer needs none.
 *
 * Ids are lib/mapLayers.ts's, which is also what the board's rows carry.
 */
export function legendFor(
  layerId: string,
  src: LegendSources
): LayerLegend {
  if (layerId === "prediction") {
    /*
      WHICH of the three maps is drawn decides which legend this is, and that
      question is answered in lib/mapLayers.ts and nowhere else. This file used
      to answer it separately -- preferring a MapBiomas map wherever one
      existed, while the layer prefers the run's own classification -- so a run
      carrying both drew the classification under the MapBiomas legend. The
      plane's purple was soybean and the legend called it 71% sugar cane.

      Within a source, the colours are the ones the run stamped rather than a
      shared palette, which is what keeps a swatch and its pixel the same byte.
    */
    const r = src.result
    const source = predictionSource(r)?.source
    if (!source) return null

    if (source === "lulc") {
      const lulc = r?.lulc
      if (!lulc?.composition?.length) return null
      return {
        kind: "classes",
        subject: `MapBiomas ${lulc.year}`,
        entries: lulc.composition.map((c) => ({
          name: c.name,
          color: c.color,
          pct: c.pct,
          areaHa: c.area_ha,
        })),
      }
    }

    if (source === "reference") {
      /*
        The reference map has no per-run statistics -- it is the ground truth a
        run was scored against, not something the run measured -- so its legend
        carries names and colours and no shares. Inventing shares from the
        classification's would describe a different raster.
      */
      return {
        kind: "classes",
        subject: "Reference map",
        entries: MAPBIOMAS_CLASS_LEGEND.map((e) => ({
          name: e.name,
          color: e.color,
        })),
      }
    }

    const stats = r?.class_stats
    if (!stats?.length) return null
    return {
      kind: "classes",
      subject: "Land cover",
      entries: stats.map((c) => ({
        name: c.name,
        color: c.color,
        pct: c.pct,
        areaHa: c.area_ha,
      })),
    }
  }

  if (layerId === "solar:siting") {
    const cls = src.solarSiting?.classes
    if (!cls?.length) return null
    return {
      kind: "classes",
      subject: "Siting suitability",
      entries: cls.map((c) => ({
        name: c.name,
        color: c.color,
        pct: c.pct,
        areaHa: c.area_ha,
      })),
    }
  }

  if (layerId === "solar:terrain") {
    const s = src.solarTerrain
    if (!s) return null
    /*
      The domain comes from `scale`, not from poa_min/poa_max: for a seasonal
      layer it deliberately spans both seasons so winter and summer are
      comparable, and the layer's own range is narrower than what it was drawn
      against. Reading the wrong one would label the ends with values no pixel
      on this plane carries.
    */
    return {
      kind: "ramp",
      subject: `Irradiation · ${s.unit}`,
      gradient: paletteGradient(s.scale.palette),
      low: num(s.scale.min, s.scale.decimals),
      high: num(s.scale.max, s.scale.decimals),
    }
  }

  if (layerId === "composition") {
    const c = src.composition
    if (!c) return null
    if (c.kind === "index" && c.index) {
      const spec = INDICES.find((i) => i.id === c.index)
      if (!spec) return null
      return {
        kind: "ramp",
        subject: spec.label,
        gradient: paletteGradient(spec.cmap),
        low: spec.lowLabel,
        high: spec.highLabel,
      }
    }
    // An RGB composite has no scale: three bands are painted into three
    // channels, and what a colour means is which band is bright.
    return c.bands
      ? {
          kind: "note",
          subject: "RGB composite",
          note: `R ${c.bands[0]} · G ${c.bands[1]} · B ${c.bands[2]}`,
        }
      : null
  }

  if (layerId === "confidence") {
    /*
      No bar: the ramp lives in the sidecar and is published nowhere, and the
      CSS gradient the map's legend uses is a transcription that already drifts
      by 1/255 at two stops.

      The figures instead, and the caveat with them. mean_confidence is the mean
      of max(predict_proba) over classified pixels -- an ensemble VOTE SHARE,
      not a calibrated probability of being right, and Random Forest vote
      fractions are biased toward the middle of their range. It is meaningless
      without the floor, which is 1/K and the value it cannot go below, so the
      two are reported together or not at all.
    */
    const r = src.result
    if (r?.mean_confidence === undefined) return null
    const rows = [
      { label: "Mean", value: `${(r.mean_confidence * 100).toFixed(1)}%` },
    ]
    if (r.confidence_floor !== undefined) {
      rows.push({
        label: "Floor",
        value: `${(r.confidence_floor * 100).toFixed(1)}%`,
      })
      rows.push({
        label: "Above floor",
        value: `${((r.mean_confidence - r.confidence_floor) * 100).toFixed(1)} pp`,
      })
    }
    if (r.class_stats?.length) {
      rows.push({ label: "Classes", value: String(r.class_stats.length) })
    }
    return {
      kind: "stats",
      subject: "Confidence",
      rows,
      note: "Ensemble vote share over classified pixels, not a calibrated probability. Read against the floor.",
    }
  }

  if (layerId === "water") {
    const w = src.water
    if (!w) return null
    /*
      Persistent and ephemeral are reported separately and are never summed
      here: the split IS the finding. A pond that is always there and a floodway
      that is water on a few dates are the same hectares and not the same thing.
    */
    return {
      kind: "stats",
      subject: `Water occurrence · ${w.index}`,
      rows: [
        { label: "Dates", value: String(w.n_dates) },
        { label: "Persistent", value: `${w.persistent_area_ha.toFixed(1)} ha` },
        { label: "Ephemeral", value: `${w.ephemeral_area_ha.toFixed(1)} ha` },
        { label: "AOI", value: `${w.aoi_area_ha.toFixed(1)} ha` },
        {
          label: "Peak",
          value: `${w.peak_water_fraction_pct.toFixed(1)}% · ${w.peak_date}`,
        },
      ],
      note: "Share of dates a pixel was classified water, on a fixed 0 to 1 scale.",
    }
  }

  if (layerId === "ndvi") {
    const r = src.result
    if (!r) return null
    const rows: { label: string; value: string }[] = []
    if (r.n_dates) rows.push({ label: "Dates", value: String(r.n_dates) })
    /*
      The range of the AOI mean ACROSS the series, labelled as that and not as
      the raster's own range. This plane is a per-pixel temporal mean; the mean
      of the series would equal it only if every pixel were valid on every date,
      which cloud masking is exactly what prevents. Reporting the series honestly
      says more than reporting a raster statistic nobody computed.
    */
    const series = r.vi_series?.map((v) => v.ndvi_mean) ?? []
    if (series.length) {
      rows.push({
        label: "AOI mean per date",
        value: `${Math.min(...series).toFixed(2)} to ${Math.max(...series).toFixed(2)}`,
      })
    }
    if (r.date_range?.length === 2) {
      rows.push({ label: "Window", value: r.date_range.join(" to ") })
    }
    if (!rows.length) return null
    return {
      kind: "stats",
      subject: "NDVI mean",
      rows,
      note: "Per-pixel mean over the dates that survived cloud masking.",
    }
  }

  // True colour and anything unrecognised: a photograph explains itself, and a
  // legend invented for an unknown layer would be this table overreaching.
  return null
}
