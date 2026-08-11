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
 * nothing does, this returns the quantity and its domain without a bar rather
 * than inventing one. A legend that is wrong is worse than a plane with none:
 * the plane admits it needs explaining.
 */
import { INDICES } from "@/lib/compositeCatalog"
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
  /** The quantity is known and its colour mapping is not published. */
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
      The run's own stamped colours, not a shared palette. A classification and
      a MapBiomas map are both drawn here and they have different class sets;
      reading the legend off the result is what keeps the swatch and the pixel
      the same byte whichever produced it.
    */
    const lulc = src.result?.lulc
    if (lulc?.map_uri && lulc.composition?.length) {
      return {
        kind: "classes",
        subject: `MapBiomas ${lulc.year}`,
        entries: lulc.composition.map((c) => ({
          name: c.name,
          color: c.color,
          pct: c.pct,
        })),
      }
    }
    const stats = src.result?.class_stats
    if (stats?.length) {
      return {
        kind: "classes",
        subject: "Land cover",
        entries: stats.map((c) => ({ name: c.name, color: c.color, pct: c.pct })),
      }
    }
    return null
  }

  if (layerId === "solar:siting") {
    const cls = src.solarSiting?.classes
    if (!cls?.length) return null
    return {
      kind: "classes",
      subject: "Siting suitability",
      entries: cls.map((c) => ({ name: c.name, color: c.color, pct: c.pct })),
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
      No bar. The ramp this plane is drawn with lives in the sidecar and is
      published nowhere -- the CSS gradient the map's legend uses is a
      transcription, and it already drifts by 1/255 at two stops. The honest
      statement is the domain and the direction, which are facts.
    */
    return {
      kind: "note",
      subject: "Confidence",
      note: "0 to 100%, dark low to bright high",
    }
  }

  if (layerId === "water") {
    const w = src.water
    return {
      kind: "note",
      subject: "Water occurrence",
      note: w?.index
        ? `${w.index}, share of dates classified water`
        : "share of dates classified water",
    }
  }

  if (layerId === "ndvi") {
    return { kind: "note", subject: "NDVI mean", note: "temporal mean, 0 to 1" }
  }

  // True colour and anything unrecognised: a photograph explains itself, and a
  // legend invented for an unknown layer would be this table overreaching.
  return null
}
