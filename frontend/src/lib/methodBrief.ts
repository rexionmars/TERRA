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
import { fieldWindows, MIN_PERIOD_DAYS } from "@/lib/fields"

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

/*
  The mineral map. Not Sentinel-2, so `acquisition` does not describe it: the
  scene search is NASA CMR over EMIT L2A granules, no scene cloud ceiling is
  applied (the mask excludes cloud per cell), and the monthly pick has no meaning for a product that takes
  each cell's answer from one pass.
*/
function mineralBrief(i: MethodInputs): MethodBrief {
  return {
    subtitle: "Surface mineralogy from EMIT imaging spectroscopy",
    source: "sidecar/terra/mineral · Tetracorder",
    sections: [
      {
        title: "Acquisition",
        lines: [
          "EMIT L2A surface reflectance, 285 channels, 60 m, from the LP DAAC",
          `${i.start} to ${i.end}`,
          "passes of any scene cloud cover, ranked by the area they cover and then by cloud; the Passes card sets how many are compared",
          "each cell from the pass it is least covered in: NDVI -0.15 to 0.25 (the GEOS3 limit) and cellulose absorption index CAI <= 0 (Nagler et al., 2000) first, then lower NDVI",
          "cells under the EMIT L2A cloud mask are excluded, not answered",
          "read over OPeNDAP for the area's rows only, the mask by byte range; an Earthdata token is required",
        ],
        note: "The monthly pick does not apply here. Each cell takes its answer from one pass, never an average over passes.",
      },
      {
        title: "Identification",
        lines: [
          "Tetracorder (Clark et al., 2003; Clark et al., 2024), expert system t5.27e1, the public release nearest the one EMIT L2B V001 records (t5.27d1)",
          "USGS splib06 and sprlb06 reference spectra convolved to the EMIT channels",
          "continuum removal and least-squares fit of each diagnostic feature",
          "group 1: Fe2+/Fe3+ electronic absorptions, 0.4-1.3 um",
          "group 2: vibrational absorptions, 2.0-2.5 um",
        ],
      },
      {
        title: "Output",
        lines: [
          "one answer per group per 60 m cell: the best reference, its fit, its band depth, and its fit margin over the best reference of another class",
          "a class map per group; the pass used and whether it showed the ground exposed; the Fe3+ and Al-OH band positions; the acid-sulfate minerals",
          "from the same acquisitions: EMIT L2B FRCOV fractional cover, and the EMIT L2B MIN class compared pixel by pixel",
          "with draws set on the Passes card, each class's stability under the reflectance uncertainty",
          "a GeoTIFF of every per-cell quantity, one named band each",
          "the observed area reported beside every identified area",
        ],
        note: "Band depth is not abundance; no unmixing is done. Green vegetation, water and cloud suppress the mineral answer, so over most vegetated ground the identified area is a small part of the AOI.",
      },
    ],
  }
}

/*
  The field boundaries. Sentinel-2 like the classification, but two scenes and
  not a series: the period is cut into the two windows lib/fields.ts states,
  and the clearest scene over the area is taken from each.
*/
function fieldsBrief(i: MethodInputs): MethodBrief {
  const w = fieldWindows(i.start, i.end)
  return {
    subtitle: "Field boundaries from two Sentinel-2 dates",
    source: "sidecar/terra/fields · FTW PRUE",
    sections: [
      {
        title: "Acquisition",
        lines: [
          "Sentinel-2 L2A, B04 B03 B02 B08 at 10 m, from the Planetary Computer",
          w
            ? `window A ${w.a.start} to ${w.a.end}, window B ${w.b.start} to ${w.b.end}: the first and last third of the period`
            : `the first and last third of the period, which must span at least ${MIN_PERIOD_DAYS} days`,
          "one scene per window: the clearest over the area by its scene classification, all tiles of that pass mosaicked",
          "cells cloudy or missing in either scene are masked, not delineated",
        ],
        note: "The network was trained on a scene near sowing and one near harvest. A period that does not span a season gives it two scenes of one stage, in which neighbouring fields of one crop look alike.",
      },
      {
        title: "Delineation",
        lines: [
          "Fields of The World baselines (Kerner et al., 2025): U-Net, EfficientNet-B7, PRUE recipe (Muhawenayo et al., 2026)",
          "each cell labelled field interior, field boundary or neither, from the two scenes as eight channels divided by 3000",
          "input enlarged by two before the network, as ftw-tools does by default",
          "each connected interior region one polygon, simplified by 15 m, under 500 m² dropped, clipped to the area",
        ],
        note: "Reported on the FTW test set: pixel IoU 0.76, object F1 0.47. The training data hold no Paraná field; accuracy here is not measured.",
      },
      {
        title: "Output",
        lines: [
          "one polygon per field, with its area, perimeter and the network's mean interior vote",
          "the share of each field MapBiomas calls cropland, where MapBiomas is read",
          "a class map and its GeoTIFF; the fields can be made areas of their own",
        ],
        note: "The polygons are what the network separates. Adjacent fields sown with one crop on one day come out as one; pasture can be segmented as fields, which the cropland share is there to show.",
      },
    ],
  }
}

function healthBrief(i: MethodInputs): MethodBrief {
  return {
    subtitle: "NDVI and NDRE against the same days of earlier seasons",
    source: "sidecar/terra/health",
    sections: [
      {
        title: "Acquisition",
        lines: [
          "Sentinel-2 L2A, B04 B08 at 10 m and B05 B8A at 20 m, from the Planetary Computer",
          `every acquisition from ${i.start || "the start"} to ${i.end || "the end"} under ${i.maxCloud}% scene cloud, and the same days of the three seasons before`,
          "per acquisition, the cells its scene classification calls clear; one under 30% of the area clear is not counted",
          "reflectance with the 04.00 offset removed; NDVI (B08, B04) and NDRE (B8A, B05) averaged over the clear cells",
        ],
      },
      {
        title: "Comparison",
        lines: [
          "each date against the earlier seasons' dates within 16 days of the same day of the year",
          "departure (x - mean) / sd, the sd floored at 0.02; none with fewer than two earlier dates",
          "a map of the latest date at least 60% clear: its NDVI minus the median of the earlier seasons around that day, per cell",
          "in the compositor, the fields of a set can also be compared with each other on a date they share",
        ],
        note: "NDRE beside NDVI because NDVI saturates over a closed canopy, where the red edge still moves with chlorophyll (Gitelson and Merzlyak, 1994).",
      },
      {
        title: "Reading",
        lines: [
          "one and two standard deviations are the cuts between typical, below and well below",
        ],
        note: "A departure is not a diagnosis: a later sowing, another crop or a fallow field departs as a stressed one does. Earlier seasons of another crop in rotation widen or shift the reference.",
      },
    ],
  }
}

function overlapBrief(): MethodBrief {
  return {
    subtitle: "The area against the public registers of clearing, embargo, protection and property",
    source: "sidecar/terra/overlap",
    sections: [
      {
        title: "Registers",
        lines: [
          "PRODES yearly deforestation per biome, and DETER alerts over the Amazon and Cerrado (INPE, TerraBrasilis WFS)",
          "CAR property registrations of every state the area meets (SFB, SICAR WFS)",
          "IBAMA and ICMBio embargoes (IBAMA ArcGIS FeatureServer); the name and CPF/CNPJ they publish are not read",
          "indigenous lands (FUNAI WFS) and conservation units of every sphere (CNUC March 2026, MMA WFS)",
        ],
        note: "Each register is read as it stands when the job runs, and the run records that moment. A register that cannot be read is reported with its reason; the others are still read.",
      },
      {
        title: "Overlap",
        lines: [
          "features whose outline meets the area's box, cut to the area",
          "areas in a Lambert azimuthal equal-area plane centred on the area, GRS80",
          "a register's hectares are the union of its features inside the area, so overlapping features count once",
          "PRODES years against 22 Jul 2008 (Forest Code, art. 3, IV) and 31 Dec 2020 (Regulation (EU) 2023/1115); PRODES 2021 spans the second and is listed on its own",
        ],
      },
      {
        title: "Reading",
        lines: [
          "the map draws each register's part of the area, and for CAR the part no registration covers",
        ],
        note: "An overlap is not a finding of irregularity: a clearing can be authorised, an embargo lifted after publication, and a sustainable-use unit admits farming. APP and legal-reserve polygons are not published by WFS and are not read.",
      },
    ],
  }
}

function radarBrief(i: MethodInputs): MethodBrief {
  return {
    subtitle: "C-band backscatter through the period, by orbit, which cloud does not stop",
    source: "sidecar/terra/radar",
    sections: [
      {
        title: "Acquisition",
        lines: [
          "Sentinel-1 IW GRD with radiometric terrain correction (sentinel-1-rtc), gamma0 VV and VH at 10 m, from the Planetary Computer",
          `every pass from ${i.start || "the start"} to ${i.end || "the end"}; one pass is one date and one relative orbit`,
          "a pass covering under 90% of the area is not counted",
        ],
      },
      {
        title: "Series",
        lines: [
          "VV and VH: the mean gamma0 over the area in linear power, then in dB",
          "cross ratio VH/VV in dB, which rises as a canopy develops (Veloso et al., 2017)",
          "orbits kept apart: the incidence angle sets the level of the backscatter",
          "open water: VH below -23 dB and VV below -13 dB after a 7 x 7 Lee filter (Lee, 1980)",
        ],
        note: "VH carries the water test because wind roughens water and raises VV more than VH. Paved ground, radar shadow and very smooth bare soil can read as water.",
      },
      {
        title: "Canopy losses",
        lines: [
          "a VH drop of at least 3 dB between two passes of one orbit, with the cross ratio falling by at least 1 dB from above the orbit's median",
          "losses of several orbits whose windows overlap are one event, placed where they overlap",
        ],
        note: "A harvest most often; a lodged, hail-struck or desiccated canopy reads the same way. The thresholds were not calibrated against harvest records.",
      },
    ],
  }
}

function zonesBrief(i: MethodInputs): MethodBrief {
  return {
    subtitle: "Where a field grew alike over several seasons, after Management Zone Analyst",
    source: "sidecar/terra/zones",
    sections: [
      {
        title: "Seasons",
        lines: [
          `the period (${i.start || "start"} to ${i.end || "end"}) and the same days of the three years before, under ${i.maxCloud}% scene cloud`,
          "per season and 10 m cell, the 90th percentile of NDVI over clear acquisitions; a cell needs 3 of them",
          "a season is used where half the field has a value; each used season is standardised over the field",
        ],
      },
      {
        title: "Zones",
        lines: [
          "fuzzy c-means (Bezdek, 1981), fuzziness exponent 1.30, diagonal distance over the standardised seasons",
          "three, four and five zones; the number suggested ranks best on FPI (Odeh et al., 1992) and NCE together, as MZA reads them",
          "each cell takes its largest membership; patches under 0.3 ha merge into their surroundings; zone 1 is the lowest NDVI",
          "polygons exported as GeoJSON in WGS84",
        ],
        note: "The zones are where the canopy differed, not why: soil, drainage, compaction or a past management line draw the same boundary. Whether a zone gets more input or less is an agronomic call the product does not make.",
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
    case "mineral":
      return mineralBrief(i)
    case "fields":
      return fieldsBrief(i)
    case "health":
      return healthBrief(i)
    case "overlap":
      return overlapBrief()
    case "radar":
      return radarBrief(i)
    case "zones":
      return zonesBrief(i)
  }
}
