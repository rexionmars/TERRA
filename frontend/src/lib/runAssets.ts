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
import type {
  Bounds,
  CompositionOverlay,
  ModelKind,
  PredictResult,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
  WaterAnalysis,
} from "@/lib/types"
import { isZeroExtent, predictionSource } from "@/lib/mapLayers"
import { seasonLabel } from "@/lib/solarOptions"

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
   * The two solar products that produce a raster.
   *
   * Only two of the four do: solarProducts.ts declares `output` per product,
   * and resource and energy are figures. The other two carry the same
   * overlay_uri / raster_tif / extent triple every other raster here does, so
   * they need no new machinery -- they were simply never read.
   *
   * Optional because most callers have no solar in hand, and a run that
   * produced only a classification should not have to say so four times.
   */
  solarTerrain?: SolarTerrainAnalysis | null
  solarSiting?: SolarSitingAnalysis | null
  showSolarTerrain?: boolean
  showSolarSiting?: boolean
  solarTerrainOpacity?: number
  solarSitingOpacity?: number
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
    Solar irradiation over the terrain, and the siting classes cut from it.

    Terrain first, so siting lists after it: the suitability classes are what a
    siting decision reads and the continuous field is what they were cut from,
    which is the order the energy screen draws them in.

    `sceneId` carries the colon form because lib/mapLayers.ts names these layers
    `solar:<id>`. Asking whether the raster is already a plane by the asset's
    own id would answer no for one that is there, and adding it would build a
    second plane over the first -- the defect this field exists to prevent.
  */
  const st = i.solarTerrain
  if (st?.overlay_uri) {
    out.push({
      id: "solar-terrain",
      sceneId: "solar:terrain",
      title: "Solar irradiation",
      params: [
        seasonLabel(st.season),
        st.unit,
        st.dem_source,
        st.hourly_years > 0 ? `${st.hourly_years} yr` : null,
        `opacity ${Math.round((i.solarTerrainOpacity ?? 1) * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: st.overlay_uri,
      extent: placeable(st.extent),
      // A continuous field: interpolating between two irradiation values gives
      // a third irradiation value, which is the one case where it is honest.
      pixelated: false,
      onBoard: i.showSolarTerrain ?? false,
      selectId: null,
      removeId: null,
      exportPng: { src: st.overlay_uri, filename: "terra_solar_poa.png" },
      exportTif: st.raster_tif
        ? { via: "file", src: st.raster_tif, filename: "terra_solar_poa.tif" }
        : null,
    })
  }

  const ss = i.solarSiting
  if (ss?.overlay_uri) {
    out.push({
      id: "solar-siting",
      sceneId: "solar:siting",
      title: "Solar siting suitability",
      params: [
        `${ss.classes.length} classes`,
        `slope ${ss.thresholds.slope_acceptable_deg}-${ss.thresholds.slope_restrictive_deg} deg`,
        ss.dem_source,
        `opacity ${Math.round((i.solarSitingOpacity ?? 1) * 100)}%`,
      ]
        .filter(Boolean)
        .join(" · "),
      previewUri: ss.overlay_uri,
      extent: placeable(ss.extent),
      // Five codes, not a ramp. The same rule as the classification and the
      // water mask: a blend of two class colours names no class.
      pixelated: true,
      onBoard: i.showSolarSiting ?? false,
      selectId: null,
      removeId: null,
      exportPng: { src: ss.overlay_uri, filename: "terra_solar_siting.png" },
      exportTif: ss.raster_tif
        ? { via: "file", src: ss.raster_tif, filename: "terra_solar_siting.tif" }
        : null,
    })
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
      One without is the project's, and it earns a place here only by being the
      composition actually on the map, which is the case this list exists to
      report.
    */
    if (!item.runId && item.id !== i.composition?.id) continue
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
