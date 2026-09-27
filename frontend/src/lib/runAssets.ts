/**
 * What a run produced, as data rather than as cards.
 *
 * The overlay tools panel derived this inline: six blocks pushing JSX, each
 * assembling its own descriptive line and its own export call, inside a
 * useMemo three hundred lines long. That was tolerable while one surface
 * listed them. The board's outliner lists the same set with the same actions,
 * and a second derivation would disagree with the first within a release --
 * silently, because both would look plausible. It is the same reason
 * lib/mapLayers.ts exists.
 *
 * An asset is described here without saying how it is presented. The panel
 * turns one into a card with a 64 px thumbnail and a row of buttons; the
 * board's column turns one into a row of text with its actions in the
 * properties panel below. Neither belongs in a table about which rasters a run
 * produced.
 *
 * Distinct from lib/mapLayers.ts, and the distinction is not a technicality: a
 * LAYER is something drawn over the AOI right now, with a stacking order and
 * an opacity. An ASSET is something the run produced, whether or not anything
 * is drawing it. NDVI mean and the true-colour scene are assets and never
 * layers; the classification is both.
 */
import {
  ExportClassification,
  ExportOverlayFile,
} from "../../wailsjs/go/main/App"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import type { ClassLegendEntry } from "@/lib/classMask"
import { MAPBIOMAS_CLASS_LEGEND } from "@/lib/classPalette"
import type {
  Bounds,
  CompositionOverlay,
  FieldsAnalysis,
  HealthAnalysis,
  MineralAnalysis,
  OverlapAnalysis,
  RadarAnalysis,
  ZonesAnalysis,
  MineralLayer,
  ModelKind,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"
import { fieldsLayers, isZeroExtent, predictionSource } from "@/lib/mapLayers"
import { fieldLayerDefaultVisible, sceneDate } from "@/lib/fields"
import {
  MINERAL_MASKED_COLOR,
  MINERAL_NO_ANSWER_COLOR,
  mineralCellAreaHa,
  mineralGroupTitle,
  mineralDerivedLayerId,
  mineralLayerDefaultVisible,
  mineralLayerId,
  mineralPassesUsed,
} from "@/lib/mineral"

/**
 * One run's output, as a branch of the data tree.
 *
 * The board holds more than one run's worth of rasters, and two runs each have
 * an asset called `prediction`. Grouping them under the run they came from is
 * what makes the list readable at that point, and what gives every key a run
 * to be qualified by.
 */
export interface AssetRun {
  /** The board area this run's rasters are, or would be, drawn as. */
  areaId: string
  runId: string
  /** The run's name. */
  title: string
  /** The period analysed, which is what distinguishes two runs of one area. */
  period: string
  /**
   * What produced it, where the run says.
   *
   * The other thing that distinguishes two runs of one AOI, and the one the
   * board exists to compare: same ground, same window, different estimator.
   */
  model?: string
  /**
   * Whether a record exists to delete.
   *
   * A live result that has never been saved is listed here like any other run,
   * and there is nothing on disk behind it -- offering to delete it produced a
   * lookup for a run the store has never heard of. The tree asks this rather
   * than testing the id against a sentinel it should not have to know.
   */
  deletable?: boolean
  assets: RunAsset[]
}

/**
 * What a class raster's colours mean, and how much ground one of its pixels is.
 *
 * What lib/classMask.ts needs to invert the PNG back to classes, and what the
 * post-processing editor needs to turn a count of pixels into an area. Built
 * here, beside the asset, because this is the one place that already knows
 * which of a run's maps a raster is.
 */
export interface ClassRaster {
  /** One entry per colour the raster is painted in, in ordinal order. */
  legend: ClassLegendEntry[]
  /**
   * Ordinals painted on the raster that are not a class: cells no answer was
   * possible for, such as the mineral map's cloud-masked cells. They are
   * decoded so the legend explains every pixel, and then set aside.
   */
  excluded: number[]
  /** One pixel's ground area in hectares; null where the run reported none. */
  pixelAreaHa: number | null
  /**
   * Whether that area is every pixel's or their mean. The mineral map's cells
   * are a degree grid, so a cell's area follows its latitude and the payload
   * gives only the total.
   */
  areaIsMean: boolean
}

/** Hectares per pixel from rows that report both, or null where none do. */
function areaPerPixel(rows: ReadonlyArray<{ pixels: number; area_ha: number }> | null | undefined) {
  let px = 0
  let ha = 0
  for (const r of rows ?? []) {
    px += r.pixels
    ha += r.area_ha
  }
  return px > 0 && ha > 0 ? ha / px : null
}

/**
 * The legend of the map the `prediction` asset draws.
 *
 * Which map that is -- the run's classification, a MapBiomas map, or the
 * reference -- is predictionSource's answer, the same one the layer and its
 * legend read, so the classes here are the ones on the plane.
 */
function predictionClasses(r: PredictResult): ClassRaster | undefined {
  const source = predictionSource(r)?.source
  if (source === "classification") {
    const stats = r.class_stats
    if (!stats?.length) return undefined
    return {
      legend: stats.map((c) => ({ id: c.class_id, name: c.name, color: c.color })),
      excluded: [],
      pixelAreaHa: areaPerPixel(stats),
      areaIsMean: false,
    }
  }
  if (source === "lulc") {
    const rows = r.lulc?.composition
    if (!rows?.length) return undefined
    return {
      legend: rows.map((c) => ({ id: c.class_id, name: c.name, color: c.color })),
      excluded: [],
      pixelAreaHa: areaPerPixel(rows),
      areaIsMean: false,
    }
  }
  if (source === "reference") {
    const m = r.pixel_size_m
    return {
      legend: [...MAPBIOMAS_CLASS_LEGEND],
      excluded: [],
      pixelAreaHa: m && m > 0 ? (m * m) / 10_000 : null,
      areaIsMean: false,
    }
  }
  return undefined
}

/** `rgba(r, g, b, a)` as `#rrggbb`, for the two mineral greys the payload does not carry. */
function cssHex(css: string): string {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(css)
  if (!m) return ""
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`
}

/**
 * The legend of one mineral group's class raster.
 *
 * The payload's classes, then the two greys the sidecar paints under them
 * (sidecar/terra/mineral/mapping.py, class_rgba). "No answer" is an outcome of
 * the expert system over an observed cell and stays a class; "Masked" is a
 * cell that was never observed, and is excluded.
 */
function mineralClasses(m: MineralAnalysis): ClassRaster {
  const legend: ClassLegendEntry[] = m.legend.map((l, i) => ({
    id: i,
    name: l.label,
    color: l.color,
  }))
  const noAnswer = legend.length
  legend.push({ id: noAnswer, name: "No answer", color: cssHex(MINERAL_NO_ANSWER_COLOR) })
  legend.push({ id: noAnswer + 1, name: "Masked", color: cssHex(MINERAL_MASKED_COLOR) })
  return {
    legend,
    excluded: [noAnswer + 1],
    pixelAreaHa: mineralCellAreaHa(m),
    areaIsMean: true,
  }
}

/**
 * The legend of one derived class layer (MineralLayer of kind "classes"), in
 * its own colours; the colours marked `excluded` are not classes and are set
 * aside, as the group maps' masked grey is.
 */
function mineralLayerClasses(m: MineralAnalysis, l: MineralLayer): ClassRaster | undefined {
  if (l.kind !== "classes" || !l.legend?.length) return undefined
  return {
    legend: l.legend.map((e, i) => ({ id: i, name: e.label, color: e.color })),
    excluded: l.legend.flatMap((e, i) => (e.excluded ? [i] : [])),
    pixelAreaHa: mineralCellAreaHa(m),
    areaIsMean: true,
  }
}

/** How a GeoTIFF leaves the application. */
export type TifExport =
  /** The classification's own raster, which the backend writes itself. */
  | { via: "classification"; src: string }
  /** Any other file already on disk, copied to where the user chooses. */
  | { via: "file"; src: string; filename: string }

export interface RunAsset {
  id: string
  /**
   * The id this asset carries when it is a plane on the board.
   *
   * Not always its own, and the difference is not cosmetic: the water raster
   * is the asset `water-occurrence` and the layer `water`, and the active
   * composition is one gallery entry among many but the single layer
   * `composition`. Asking whether an asset is in the stack by its own id
   * answered no for both, which offered to add a raster that was already
   * there -- and adding it would have built a second plane over the first.
   *
   * A gallery composition that is NOT the active one has no layer of its own,
   * so it keeps its own id and goes on the board as an addition. That is the
   * case that makes two compositions on one board possible.
   */
  sceneId: string
  title: string
  /** The one-line description under the title: bands, dates, model, counts. */
  params: string
  previewUri: string
  /**
   * Where it sits on the ground, or null where the sidecar resolved no window.
   *
   * Carried because an asset can be put ONTO the board, and a raster without
   * an extent cannot be placed: it would be stretched across the null island
   * off the coast of Ghana. Null is the honest answer, and the reason the
   * control that adds it is refused rather than offered and then wrong.
   */
  extent: Bounds | null
  /** Class raster: its thumbnail must not be smoothed either. */
  pixelated: boolean
  /** Present on a class raster, which the post-processing editor can filter. */
  classes?: ClassRaster
  /**
   * Whether something is drawing it at this moment.
   *
   * Only meaningful where the asset has a switch. A prediction is always drawn
   * when it exists, so it reports false rather than claiming a state it does
   * not own.
   */
  onBoard: boolean
  /** The composition to switch to, for assets that are one. */
  selectId: string | null
  /** The composition to drop from the gallery, for assets that are one. */
  removeId: string | null
  exportPng: { src: string; filename: string }
  exportTif: TifExport | null
}

/** Exported: the board names a run's model where two of them are compared. */
export function modelLabel(kind?: ModelKind): string {
  switch (kind) {
    case "prithvi":
      return "Prithvi-EO"
    case "temporal_transformer":
      return "Temporal Transformer"
    case "spectral":
      return "Random Forest"
    default:
      return kind || "model"
  }
}

function fileStem(title: string): string {
  return title.replace(/\s+/g, "_").toLowerCase()
}

function dateRange(range?: string[] | null): string | null {
  return range?.length === 2 ? `${range[0]} → ${range[1]}` : null
}

/** An extent that can be drawn, or null. */
function placeable(e: Bounds | null | undefined): Bounds | null {
  return isZeroExtent(e) ? null : (e as Bounds)
}

export interface RunAssetInput {
  result: PredictResult | null
  composition: CompositionOverlay | null
  compositionGallery: CompositionOverlay[]
  /** The area these assets are listed under, which claims its own compositions. */
  areaId?: string
  water: WaterAnalysis | null | undefined
  areaLabel?: string
  modelKind?: ModelKind
  /** The date of the scene the current composition was built from. */
  composeSceneDate?: string | null
  showCompositionOverlay: boolean
  showWaterOverlay: boolean
  composeOpacity: number
  waterOpacity: number
  /**
   * The mineral map's class rasters, one per group, and the switches the
   * layer table reads them with (see VisibleLayerInput.mineralLayers).
   */
  mineral?: MineralAnalysis | null
  mineralLayers?: Readonly<Record<string, { visible?: boolean; opacity?: number }>>
  /** A field delineation's rasters, and their switches (see VisibleLayerInput.fieldLayers). */
  fields?: FieldsAnalysis | null
  /** A vegetation health run's two maps: the departure from earlier seasons, and the NDVI. */
  health?: HealthAnalysis | null
  /** An overlap run's map: where the area meets each register. */
  overlap?: OverlapAnalysis | null
  /** A radar run's two maps of its latest pass. */
  radar?: RadarAnalysis | null
  /** A zones run's maps, one per partition, the suggested first. */
  zones?: ZonesAnalysis | null
  fieldLayers?: Readonly<Record<string, { visible?: boolean; opacity?: number }>>
}

/**
 * The gallery, falling back to the one composition in hand.
 *
 * A run that produced a composition without the gallery having caught up still
 * has something to list, and which of the two supplied it has never been the
 * caller's business.
 */
export function compositionList(i: {
  composition: CompositionOverlay | null
  compositionGallery: CompositionOverlay[]
}): CompositionOverlay[] {
  if (i.compositionGallery.length > 0) return i.compositionGallery
  return i.composition?.overlay_uri ? [i.composition] : []
}

/**
 * What a run's prediction raster should be CALLED.
 *
 * Mirrors the naming in `rasterLayers` so the scene tree does not give one
 * raster two names depending on which area holds it.
 */
function predictionTitle(r: PredictResult | null | undefined): string {
  const src = predictionSource(r ?? undefined)?.source
  if (src === "lulc") return `MapBiomas ${r?.lulc?.year ?? ""}`.trim()
  if (src === "reference") return "Reference map"
  return "Classification"
}

/** Everything this run produced, in the order it is worth reading. */
export function runAssets(i: RunAssetInput): RunAsset[] {
  const out: RunAsset[] = []
  const r = i.result

  if (r?.overlay_uri) {
    out.push({
      id: "prediction",
      sceneId: "prediction",
      /*
        Named for what it IS, which is the rule `rasterLayers` already states
        for the same raster on the live area: the three sources are three
        different maps with three different class sets.

        This said "Prediction" flatly -- the slot's name, which is what that
        rule argues against -- so one board showed the same layer as
        "Classification" under the area the map is on and as "Prediction"
        under every other, and a reader had no way to tell whether they were
        looking at two things or at one thing named twice.
      */
      title: predictionTitle(r),
      params: [
        i.areaLabel?.trim() || null,
        modelLabel(i.modelKind),
        r.n_dates > 0 ? `${r.n_dates} scenes` : null,
        dateRange(r.date_range),
        r.mean_confidence > 0
          ? `conf ${(r.mean_confidence * 100).toFixed(0)}%`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: r.overlay_uri,
      extent: placeable(r.extent),
      pixelated: true,
      classes: predictionClasses(r),
      onBoard: false,
      selectId: null,
      removeId: null,
      exportPng: { src: r.overlay_uri, filename: "terra_prediction.png" },
      exportTif: r.raster_tif
        ? { via: "classification", src: r.raster_tif }
        : null,
    })
  }

  if (r?.confidence_uri) {
    out.push({
      id: "confidence",
      sceneId: "confidence",
      title: "Confidence",
      params: [
        "from classification",
        r.mean_confidence > 0
          ? `mean ${(r.mean_confidence * 100).toFixed(0)}%`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: r.confidence_uri,
      extent: placeable(r.extent),
      pixelated: false,
      onBoard: false,
      selectId: null,
      removeId: null,
      exportPng: { src: r.confidence_uri, filename: "terra_confidence.png" },
      exportTif: null,
    })
  }

  if (r?.ndvi_mean_uri) {
    out.push({
      id: "ndvi",
      sceneId: "ndvi",
      title: "NDVI mean",
      params: ["temporal mean NDVI", dateRange(r.date_range)]
        .filter(Boolean)
        .join(" · "),
      previewUri: r.ndvi_mean_uri,
      extent: placeable(r.extent),
      pixelated: false,
      onBoard: false,
      selectId: null,
      removeId: null,
      exportPng: { src: r.ndvi_mean_uri, filename: "terra_ndvi_mean.png" },
      exportTif: null,
    })
  }

  if (r?.true_color_uri) {
    out.push({
      id: "true-color",
      sceneId: "true-color",
      title: "Satellite true color",
      params: ["peak-NDVI scene · B04-B03-B02", dateRange(r.date_range)]
        .filter(Boolean)
        .join(" · "),
      previewUri: r.true_color_uri,
      extent: placeable(r.extent),
      pixelated: false,
      onBoard: false,
      selectId: null,
      removeId: null,
      exportPng: { src: r.true_color_uri, filename: "terra_true_color.png" },
      exportTif: null,
    })
  }

  const w = i.water
  if (w?.occurrence_uri) {
    out.push({
      id: "water-occurrence",
      // lib/mapLayers.ts calls the same raster `water`.
      sceneId: "water",
      title: "Surface water occurrence",
      params: [
        w.index,
        w.n_dates > 0 ? `${w.n_dates} dates` : null,
        dateRange(w.date_range),
        `opacity ${Math.round(i.waterOpacity * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: w.occurrence_uri,
      extent: placeable(w.extent),
      pixelated: true,
      onBoard: i.showWaterOverlay,
      selectId: null,
      removeId: null,
      exportPng: {
        src: w.occurrence_uri,
        filename: "terra_water_occurrence.png",
      },
      exportTif: null,
    })
  }

  /*
    The mineral map, one asset per group's class raster.

    `sceneId` is lib/mapLayers.ts's layer id for the same raster, for the
    reason RunAsset.sceneId gives. The GeoTIFF is one file carrying every
    group's entry, fit and depth as bands, so both assets export the same file:
    the class PNG is one group's picture and the GeoTIFF is the measurement
    behind both.
  */
  const m = i.mineral
  for (const g of m?.groups ?? []) {
    if (!m || !g.class_uri) continue
    const id = mineralLayerId(g.group)
    const state = i.mineralLayers?.[id]
    out.push({
      id: `mineral-group${g.group}`,
      sceneId: id,
      title: mineralGroupTitle(g.group),
      params: [
        m.expert_system || null,
        m.scenes.length ? `${mineralPassesUsed(m)} EMIT passes` : null,
        `${g.detected_area_ha.toFixed(0)} of ${m.observed_area_ha.toFixed(0)} ha observed identified`,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: g.class_uri,
      extent: placeable(m.extent),
      // One reference's class per cell: a blend of two colours names no mineral.
      pixelated: true,
      classes: mineralClasses(m),
      // Without switches the caller is listing a run the map is not drawing,
      // so no group of it reads as on the board.
      onBoard: i.mineralLayers
        ? (state?.visible ?? mineralLayerDefaultVisible(g.group))
        : false,
      selectId: null,
      removeId: null,
      exportPng: {
        src: g.class_uri,
        filename: `terra_mineral_group${g.group}.png`,
      },
      exportTif: m.geotiff
        ? { via: "file", src: m.geotiff, filename: "terra_mineral_map.tif" }
        : null,
    })
  }
  // The derived rasters. Their values are bands of the same GeoTIFF, so that is
  // what each exports as its measurement.
  for (const l of m?.layers ?? []) {
    if (!m || !l.uri) continue
    const id = mineralDerivedLayerId(l.id)
    out.push({
      id: `mineral-${l.id}`,
      sceneId: id,
      title: l.title,
      params: l.about,
      previewUri: l.uri,
      extent: placeable(m.extent),
      pixelated: true,
      classes: mineralLayerClasses(m, l),
      onBoard: i.mineralLayers ? (i.mineralLayers[id]?.visible ?? false) : false,
      selectId: null,
      removeId: null,
      exportPng: { src: l.uri, filename: `terra_mineral_${l.id}.png` },
      exportTif: m.geotiff
        ? { via: "file", src: m.geotiff, filename: "terra_mineral_map.tif" }
        : null,
    })
  }

  /*
    A field delineation: its class map and the two scenes, each exportable as
    the PNG on the board; the class map also as its GeoTIFF, which is the
    measurement the PNG is a picture of. The polygons are exported from the
    reading, where they are read.
  */
  const f = i.fields
  for (const layer of f ? fieldsLayers(f) : []) {
    if (!f) break
    const isClasses = layer.id === "fields:classes"
    out.push({
      id: layer.id.replace(":", "-"),
      sceneId: layer.id,
      title: layer.title,
      params: isClasses
        ? [
            f.checkpoint.title,
            `${f.n_fields} fields`,
            `${sceneDate(f.window_a.date)} and ${sceneDate(f.window_b.date)}`,
          ].join(" · ")
        : "Sentinel-2 L2A true colour, the scene the delineation read",
      previewUri: layer.uri,
      extent: placeable(f.extent),
      pixelated: layer.pixelated,
      onBoard: i.fieldLayers
        ? (i.fieldLayers[layer.id]?.visible ?? fieldLayerDefaultVisible(layer.id))
        : false,
      selectId: null,
      removeId: null,
      exportPng: {
        src: layer.uri,
        filename: `terra_${layer.id.replace(/[:-]/g, "_")}.png`,
      },
      exportTif:
        isClasses && f.classes_tif
          ? { via: "file", src: f.classes_tif, filename: "terra_field_classes.tif" }
          : null,
    })
  }

  /*
    Vegetation health: the departure map first, since it is the product's
    answer and the one a finished job puts on the globe; the NDVI it was taken
    from beside it.
  */
  const h = i.health
  if (h && !isZeroExtent(h.extent)) {
    const years = h.baseline_years.length
      ? `${h.baseline_years[0]}-${h.baseline_years[h.baseline_years.length - 1]}`
      : "no earlier season"
    for (const [id, title, uri, params] of [
      [
        "health-anomaly",
        `NDVI against earlier seasons, ${sceneDate(h.map_date)}`,
        h.anomaly_uri,
        `NDVI minus the median of ${years} within ${h.window_days} days of the day of the year · colours span \u00b1${h.map_range}`,
      ],
      ["health-ndvi", `NDVI, ${sceneDate(h.map_date)}`, h.ndvi_uri, "Sentinel-2 L2A, the clear cells of the date the map shows"],
    ] as const) {
      if (!uri) continue
      out.push({
        id,
        sceneId: id,
        title,
        params,
        previewUri: uri,
        extent: placeable(h.extent),
        pixelated: true,
        onBoard: false,
        selectId: null,
        removeId: null,
        exportPng: { src: uri, filename: `terra_${id.replace(/-/g, "_")}.png` },
        exportTif: null,
      })
    }
  }

  /*
    Socio-environmental overlap: one map, the area in grey and each register's
    part of it in the register's colour; for CAR, the part no registration
    covers. The legend is the overlap card's, which names each colour.
  */
  const o = i.overlap
  if (o && o.map_uri && !isZeroExtent(o.extent)) {
    const met = o.layers
      .filter((l) => l.status === "read" && l.overlap_ha > 0 && l.id !== "car")
      .map((l) => l.title)
    out.push({
      id: "overlap-map",
      sceneId: "overlap-map",
      title: `Public registers, read ${o.read_at.slice(0, 10)}`,
      params: met.length ? `meets ${met.join(", ")}` : "meets no register but CAR",
      previewUri: o.map_uri,
      extent: placeable(o.extent),
      pixelated: true,
      onBoard: false,
      selectId: null,
      removeId: null,
      exportPng: { src: o.map_uri, filename: "terra_overlap_map.png" },
      exportTif: null,
    })
  }

  /*
    Sentinel-1 radar: the false colour of the latest pass first, since it shows
    the ground as the sensor saw it; the water read from it beside it.
  */
  const s1 = i.radar
  if (s1 && !isZeroExtent(s1.extent)) {
    for (const [id, title, uri, params] of [
      [
        "radar-composite",
        `Sentinel-1 VV, VH, VV/VH, ${sceneDate(s1.map_date)}`,
        s1.composite_uri,
        `orbit ${s1.map_orbit} · red VV -20 to 0 dB, green VH -28 to -8 dB, blue VV/VH 2 to 14 dB, Lee-filtered`,
      ],
      [
        "radar-water",
        `Open water, Sentinel-1, ${sceneDate(s1.map_date)}`,
        s1.water_uri,
        `VH below ${s1.water_vh_db} dB and VV below ${s1.water_vv_db} dB after a Lee filter`,
      ],
    ] as const) {
      if (!uri) continue
      out.push({
        id,
        sceneId: id,
        title,
        params,
        previewUri: uri,
        extent: placeable(s1.extent),
        pixelated: true,
        onBoard: false,
        selectId: null,
        removeId: null,
        exportPng: { src: uri, filename: `terra_${id.replace(/-/g, "_")}.png` },
        exportTif: null,
      })
    }
  }

  /*
    Management zones: one map per partition, the suggested number first since
    it is what a finished job puts on the board.
  */
  const mz = i.zones
  if (mz && !isZeroExtent(mz.extent)) {
    const parts = [...mz.partitions].sort((a, b) => Number(b.k === mz.suggested_k) - Number(a.k === mz.suggested_k) || a.k - b.k)
    for (const p of parts) {
      if (!p.map_uri) continue
      const id = `zones-${p.k}`
      out.push({
        id,
        sceneId: id,
        title: `Management zones, ${p.k}${p.k === mz.suggested_k ? " (suggested)" : ""}`,
        params: `FPI ${p.fpi.toFixed(3)} · NCE ${p.nce.toFixed(3)} · zone 1 the lowest NDVI · ${mz.seasons.filter((s) => s.used).length} seasons`,
        previewUri: p.map_uri,
        extent: placeable(mz.extent),
        pixelated: true,
        onBoard: false,
        selectId: null,
        removeId: null,
        exportPng: { src: p.map_uri, filename: `terra_zones_${p.k}.png` },
        exportTif: null,
      })
    }
  }

  for (const item of compositionList(i)) {
    if (!item.overlay_uri) continue
    /*
      A RUN'S ASSETS ARE WHAT THE RUN PRODUCED, and a project's compositions
      are not that.

      The gallery is loaded whole when a project is activated -- see
      activateProject, where the comment says so deliberately: the compositions
      stay one press away in Overlay Tools. `scopeCompositionsToView` then
      decides which of them are RELEVANT, and its rule for one with no run of
      its own is whether its extent meets the AOI on screen.

      That is the right rule for Overlay Tools and the wrong one here. Drawing
      an area over ground a stored composition happens to cover brought it into
      scope, and this loop listed it under the current run as though that run
      had made it -- a composition appearing from nothing, attributed to a run
      that never produced one.

      One with a `runId` has already been filtered to this run by the scoping.
      One without earns a place here by being the composition actually on the
      map, or by having been made over this area.

      THE SECOND CASE WAS MISSING, and it is the common one. An area worked
      only by composition has no run, so every composition made over it has
      none either, and the rule above listed exactly one of them: the one on
      the map. Each new composition replaced the last in the list, though all
      of them were saved. What it needed was the area each was made over,
      which nothing recorded. Now the saved row and the entry in hand both
      carry it, and a match is as good as a run -- while a composition of
      another area, or one written before the area was carried, still needs to
      be the one on the map to be listed.
    */
    const ownArea = !!item.areaId && !!i.areaId && item.areaId === i.areaId
    if (!item.runId && !ownArea && item.id !== i.composition?.id) continue
    const title = item.title || item.label || "Composition"
    const bandOrIndex =
      item.kind === "index" && item.index
        ? item.index.toUpperCase()
        : item.bands?.join("-")
    out.push({
      id: item.id || item.overlay_uri,
      // The active one IS the composition layer; the rest are their own.
      sceneId:
        item.id && item.id === i.composition?.id
          ? "composition"
          : item.id || item.overlay_uri,
      title,
      params: [
        bandOrIndex,
        item.sceneDate ||
          (item.id === i.composition?.id ? i.composeSceneDate : null) ||
          null,
        item.kind === "rgb"
          ? "RGB composite"
          : item.kind === "index"
            ? "Spectral index"
            : null,
        `opacity ${Math.round((item.opacity ?? i.composeOpacity) * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: item.overlay_uri,
      extent: placeable(item.extent),
      pixelated: false,
      onBoard: i.composition?.id === item.id && i.showCompositionOverlay,
      selectId: item.id || null,
      removeId: item.id || null,
      exportPng: {
        src: item.overlay_uri,
        filename: `terra_${fileStem(title)}.png`,
      },
      exportTif: item.raster_tif
        ? {
            via: "file",
            src: item.raster_tif,
            filename: `terra_${fileStem(title)}.tif`,
          }
        : null,
    })
  }

  return out
}

/**
 * Writes an asset out, and reports what happened.
 *
 * Here rather than at each surface for the same reason as the table above: two
 * places calling the bindings would be two chances to differ over the file
 * name, over which binding a GeoTIFF goes through, or over whether a failure
 * is reported at all.
 */
export async function exportPng(a: RunAsset): Promise<void> {
  try {
    const dest = await ExportOverlayFile(a.exportPng.src, a.exportPng.filename)
    if (dest) notifyExportOk(dest)
  } catch (e) {
    notifyExportFail(e)
  }
}

export async function exportTif(a: RunAsset): Promise<void> {
  if (!a.exportTif) return
  try {
    const t = a.exportTif
    // The classification's raster goes through its own binding: the backend
    // writes that file rather than copying one that already exists.
    const dest =
      t.via === "classification"
        ? await ExportClassification(t.src)
        : await ExportOverlayFile(t.src, t.filename)
    if (dest) notifyExportOk(dest)
  } catch (e) {
    notifyExportFail(e)
  }
}
