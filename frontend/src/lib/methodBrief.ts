/**
 * What a run will actually do, stated where the reader chooses it.
 *
 * The band names a model and a window and stops there, which is enough to
 * START a run and not enough to READ one. "Temporal Transformer" does not say
 * which six bands it reads, that it pads the series to 22 dates, or that its
 * pooling is a mean over all of them; "Prithvi-EO 2.0" does not say the thing
 * about it a reader would most want to know, which is that it takes ONE
 * acquisition and discards the rest of the window. Those are the facts that
 * decide whether an output answers the question that was asked, and they were
 * only in the sidecar.
 *
 * WHAT THIS IS NOT. It is not a second copy of the choices -- the labels come
 * from MODEL_OPTIONS, for the reason lib/classifyOptions.ts gives about two
 * places a model can be added to. It is not documentation either: every line
 * here is a claim about what sidecar/infer.py does on the next run, so a line
 * that stops being true is a bug and not a stale doc. The `source` of each
 * brief names the file to check it against.
 *
 * The parameters are threaded through rather than described in the abstract,
 * so the panel reports THIS run: the dates the reader set, the cloud ceiling
 * they chose, and the cadence that follows from the toggle beside them.
 */
import { MODEL_OPTIONS } from "@/lib/classifyOptions"
import type { BoardToolId } from "@/lib/mapTools"
import type { ModelKind } from "@/lib/types"

export interface MethodSection {
  title: string
  lines: string[]
  /**
   * A caveat the code itself states, drawn apart from the plain lines.
   *
   * Reserved for what a reader would be wrong without -- a saturated
   * threshold, a discarded time series -- rather than for detail. A panel
   * where everything is flagged flags nothing.
   */
  note?: string
}

export interface MethodBrief {
  /** What this run is, in one line under the panel's title. */
  subtitle: string
  sections: MethodSection[]
  /** The file a reader checks these lines against. */
  source: string
}

export interface MethodInputs {
  tool: BoardToolId
  modelKind: ModelKind
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  solar?: {
    product: "terrain" | "siting"
    hourlyYears: number
    season: string
    slopeAcceptableDeg: number
    slopeRestrictiveDeg: number
  }
  wind?: {
    recordYears: number
    hubHeightM: number
    calmThresholdMS: number
    roughnessLowM: number
    roughnessHighM: number
  }
  flood?: {
    demIds: string[]
    referenceThresholdM: number
    drainageKm2: number
  }
}

/** MapBiomas legend the three classifiers share, named once. */
const CLASSES = "5 MapBiomas classes: 3, 21, 25, 39, 41"

/**
 * The scene search, which is the same for the three products that read a
 * window. Written once because it IS one code path -- list_stac_products --
 * and three copies would drift the moment one of them gained a filter.
 */
function acquisition(i: MethodInputs): MethodSection {
  return {
    title: "Acquisition",
    lines: [
      "Sentinel-2 L2A through the Planetary Computer STAC catalogue",
      `${i.start} to ${i.end}`,
      `scenes with cloud cover below ${i.maxCloud}%`,
      i.monthlyBest
        ? "one scene per calendar month, the least cloudy of it"
        : "every scene under the ceiling, no monthly pick",
      "bands read over /vsicurl: only the polygon window, only the bands the model needs",
    ],
    note: i.monthlyBest
      ? undefined
      : "The trained models were fitted on the roughly one-scene-per-month cadence of the training set. Keeping every scene changes the temporal statistics they expect.",
  }
}

function classifyBrief(i: MethodInputs): MethodBrief {
  const label =
    MODEL_OPTIONS.find((m) => m.id === i.modelKind)?.label ?? i.modelKind

  if (i.modelKind === "spectral") {
    return {
      subtitle: `Land cover with ${label}`,
      source: "sidecar/infer.py · build_feature_matrix",
      sections: [
        acquisition(i),
        {
          title: "Features",
          lines: [
            "B02, B03, B04 and B08 at 10 m, reflectance scaled by 1/10000",
            "NDVI, EVI and SAVI per date",
            "14 temporal statistics per index: mean, sd, max, min, amplitude, median, index of peak and of trough, first- and second-half means and their difference, mean change, largest rise, largest fall",
            "4 statistics per raw band, and the 22 raw NDVI dates",
            "80 features per pixel",
          ],
          note: "A pixel is kept only where at least half its dates are non-zero. Remaining gaps are filled by linear interpolation along time, so a cloud-masked date is inferred rather than dropped.",
        },
        {
          title: "Model",
          lines: [
            "Random forest, 300 trees, maximum depth 20",
            "features standardised by the scaler fitted at training",
          ],
        },
        {
          title: "Output",
          lines: [CLASSES, "confidence: the largest class probability"],
        },
      ],
    }
  }

  if (i.modelKind === "temporal_transformer") {
    return {
      subtitle: `Land cover with ${label}`,
      source: "sidecar/infer.py · classify_temporal_transformer",
      sections: [
        acquisition(i),
        {
          title: "Series",
          lines: [
            "B02, B03, B04 at 10 m; B8A, B11, B12 at 20 m",
            "reflectance scaled by 1/10000 and clipped to [0, 1]",
            "padded or truncated to 22 dates; a short series repeats its last acquisition",
            "pixels kept where mean red over the series is above zero",
          ],
        },
        {
          title: "Model",
          lines: [
            "Transformer encoder over acquisition-date tokens",
            "d_model 128, 4 heads, 3 layers, learned positional encoding",
            "mean pooling over the 22 dates, then a linear head",
          ],
          note: "The dates that separate crops are few — greenup and senescence — and a mean over all 22 spreads them across the rest.",
        },
        {
          title: "Output",
          lines: [CLASSES, "confidence: the softmax maximum"],
        },
      ],
    }
  }

  return {
    subtitle: `Land cover with ${label}`,
    source: "sidecar/infer.py · classify_prithvi",
    sections: [
      acquisition(i),
      {
        title: "Scene",
        lines: [
          "B02, B03, B04 at 10 m; B8A, B11, B12 at 20 m",
          "reflectance scaled by 1/10000 and clipped to [0, 1]",
          "pixels kept where red is above zero",
        ],
        note: "One acquisition, not the series. The middle scene of the window is taken and the rest are discarded, so widening the period changes WHICH scene is read rather than how many.",
      },
      {
        title: "Model",
        lines: [
          "Prithvi-EO 2.0, frozen — no fine-tuning, no gradient through it",
          "per-pixel or per-patch embeddings",
          "random forest head over the embeddings, with its own scaler",
        ],
      },
      {
        title: "Output",
        lines: [CLASSES, "confidence: the largest class probability"],
      },
    ],
  }
}

function waterBrief(i: MethodInputs): MethodBrief {
  return {
    subtitle: "Surface water from thresholded spectral indices",
    source: "sidecar/water.py",
    sections: [
      acquisition(i),
      {
        title: "Indices",
        lines: [
          "NDWI = (green − nir) / (green + nir) — McFeeters (1996)",
          "MNDWI = (green − swir1) / (green + swir1) — Xu (2006)",
          "AWEI_nsh = 4(green − swir1) − (0.25 nir + 2.75 swir2) — Feyisa et al. (2014)",
          "the index thresholded is the one chosen in the water panel; MNDWI is the default",
          "B03 green, B8A narrow NIR, B11 swir1, B12 swir2",
        ],
        note: "B8A rather than B08 is deliberate: the reference series was built on the Prithvi band set, whose NIR slot is B8A at 865 nm.",
      },
      {
        title: "Threshold",
        lines: [
          "Otsu per date, clipped to [−0.20, 0.40]",
          "zero is the literature cut for all three indices",
        ],
        note: "The lower clip binds often. On the reference properties it saturated on 12 of 22, 9 of 21 and 20 of 20 dates, so a saturated threshold is flagged rather than reported as an estimate.",
      },
      {
        title: "Output",
        lines: [
          "a water mask per date, and occurrence over the window",
          "occurrence between 0.15 and 0.70 is read as ephemeral rather than permanent",
        ],
        note: "No model and no trained legend, so none of the classifier's fixed-legend domain limitation applies here.",
      },
    ],
  }
}

function composeBrief(i: MethodInputs): MethodBrief {
  return {
    subtitle: "One scene rendered as a composite or an index",
    source: "sidecar/composite.py",
    sections: [
      acquisition(i),
      {
        title: "Recipes",
        lines: [
          "true colour B04 / B03 / B02",
          "false colour IR B08 / B04 / B03",
          "agriculture B11 / B08 / B02",
          "SWIR B12 / B8A / B04",
          "indices: NDVI, NDWI, NDMI, EVI",
        ],
      },
      {
        title: "Rendering",
        lines: [
          "linear stretch of the valid pixels between their 2nd and 98th percentile",
        ],
        note: "The stretch is per scene and per band, so two compositions of different dates are not on one radiometric scale and their colours are not comparable between runs.",
      },
    ],
  }
}

function solarBrief(i: MethodInputs): MethodBrief {
  const s = i.solar
  if (s?.product === "siting") {
    return {
      subtitle: "Photovoltaic siting classes on the DEM grid",
      source: "sidecar/infer.py · compute_siting",
      sections: [
        {
          title: "Terrain",
          lines: [
            "Copernicus DEM GLO-30",
            "slope from the elevation grid",
            `acceptable below ${s.slopeAcceptableDeg}°, restrictive below ${s.slopeRestrictiveDeg}°`,
          ],
        },
        {
          title: "Cover",
          lines: [
            "MapBiomas land cover for the area",
            "excluded and cropland classes withheld from the siting classes",
          ],
        },
        {
          title: "Output",
          lines: ["siting classes and the area of each"],
          note: "The same classification backs the capacity figure in the energy model, so a stated area and the raster it came from cannot disagree.",
        },
      ],
    }
  }

  return {
    subtitle: "Plane-of-array irradiation over this area's terrain",
    source: "sidecar/terra/energy",
    sections: [
      {
        title: "Record",
        lines: [
          "NASA POWER: radiation from SYN1DEG, meteorology from MERRA-2",
          `hourly over the last ${s?.hourlyYears ?? 10} years`,
          "cached per grid cell, so a repeated area does not refetch",
        ],
        note: "Surface irradiance is not retrievable from Sentinel-2: no broadband radiometer, a 5-day revisit and a fixed overpass. This product reads a different family entirely.",
      },
      {
        title: "Terrain",
        lines: [
          "Copernicus DEM GLO-30",
          "slope, aspect and the horizon at each cell",
        ],
      },
      {
        title: "Transposition",
        lines: [
          "plane-of-array lookup over tilt and azimuth",
          "interpolated onto each cell's own slope and aspect, in kWh/m2",
          s?.season ? `season: ${s.season}` : "over the whole record",
        ],
      },
    ],
  }
}

function windBrief(i: MethodInputs): MethodBrief {
  const w = i.wind
  return {
    subtitle: "Wind resource screening at hub height",
    source: "sidecar/terra/energy · wind screening",
    sections: [
      {
        title: "Record",
        lines: [
          "NASA POWER hourly wind at the area's centroid",
          w ? `${w.recordYears} years of record` : "the configured record",
          "no Sentinel-2 is read: the resource is a wind field, not a surface",
        ],
      },
      {
        title: "Extrapolation",
        lines: [
          w ? `hub height ${w.hubHeightM} m` : "the configured hub height",
          w
            ? `surface roughness swept from ${w.roughnessLowM} to ${w.roughnessHighM} m`
            : "surface roughness swept across a range",
          "the range is reported rather than one roughness chosen, because the class is not observed here",
        ],
      },
      {
        title: "Output",
        lines: [
          w
            ? `hours below ${w.calmThresholdMS} m/s reported as calm`
            : "calm hours reported against the configured threshold",
          "a screening, not a siting study",
        ],
        note: "The extrapolation is a log profile over an assumed roughness. Two roughness values that both fit the ground give materially different hub-height speeds, which is why the sweep is reported instead of a single figure.",
      },
    ],
  }
}

function floodBrief(i: MethodInputs): MethodBrief {
  const f = i.flood
  return {
    subtitle: "Flood extent from height above nearest drainage",
    source: "sidecar/terra/flood · HAND envelope",
    sections: [
      {
        title: "Terrain",
        lines: [
          f?.demIds.length
            ? `${f.demIds.length} elevation models compared: ${f.demIds.join(", ")}`
            : "several elevation models compared",
          f ? `cells above ${f.drainageKm2} km² of contributing area count as drainage` : "drainage by contributing area",
          "no imagery and no precipitation: this is terrain and drainage alone",
        ],
      },
      {
        title: "Envelope",
        lines: [
          f ? `agreement raster built at ${f.referenceThresholdM} m` : "agreement raster at the reference threshold",
          "each model votes, and the extent carries how many agreed",
        ],
        note: "Two products are the minimum the sidecar accepts. One yields an extent with no measure of how much of it that product chose, which is the whole reason the envelope exists.",
      },
      {
        title: "Output",
        lines: [
          "the extent, the agreement raster, and the area of each",
          "GLO-30 is a SURFACE model, so closed forest carries canopy height into the height above drainage",
        ],
      },
    ],
  }
}

/**
 * The brief for what the band is currently set to run.
 *
 * Every product has one. A panel that appeared on some tabs and not others
 * would read as "this one is documented and that one is not", which is a claim
 * about the products rather than about the panel.
 */
export function methodBrief(i: MethodInputs): MethodBrief {
  switch (i.tool) {
    case "classify":
      return classifyBrief(i)
    case "water":
      return waterBrief(i)
    case "compose":
      return composeBrief(i)
    case "solar":
      return solarBrief(i)
    case "wind":
      return windBrief(i)
    case "flood":
      return floodBrief(i)
  }
}
