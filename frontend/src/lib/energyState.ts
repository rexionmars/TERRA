/**
 * State for the energy products, held in one place instead of threaded.
 *
 * The four photovoltaic products and the wind screening between them carried 37
 * pieces of state and 81 declared props on the map screen, of which that screen
 * used two. The rest existed only to reach the panel, so adding a parameter
 * meant editing three declarations in three files.
 *
 * SOLAR AND WIND ARE TWO STORES, deliberately. Wind resolves on the MERRA-2
 * grid rather than the 1 degree radiation grid, files under its own run kind,
 * and carries no external validation. Nothing about one product's validity
 * implies the other's, and a shared store would invite a shared invalidation.
 */
import { useReducer } from "react"
import type {
  EnergyModelAnalysis,
  SolarAnalysis,
  SolarSeason,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
  WindAnalysis,
} from "@/lib/types"
import {
  ENERGY_DECLARED_LOSSES,
  ENERGY_DEFAULTS,
  ENERGY_OPTIONAL_LOSSES,
} from "@/lib/energyDefaults"
import { WIND_DEFAULTS } from "@/lib/windDefaults"

/** The four products on the photovoltaic axis. */
export type SolarProductId = "resource" | "terrain" | "siting" | "energy"

/**
 * Request parameters, flat across products wherever a value is shared.
 *
 * There is one `climatologyYears` and one `slopeAcceptableDeg`, not one per
 * product. The resource run and the energy model resolve a single performance
 * ratio for an AOI, and the siting map and the energy model apply a single pair
 * of slope limits; splitting them per product would let the energy model report
 * a yield at a ratio the resource card never used, or a capacity over an area
 * the siting map never classified. The shape makes that unrepresentable.
 */
export interface SolarParams {
  // Resource and energy model.
  climatologyYears: number
  hourlyYears: number
  surfaceAzimuth: number
  /** Blank applies the reference ratio; a value overrides it. */
  performanceRatio: string
  // Terrain only.
  season: SolarSeason
  // Siting and energy model.
  slopeAcceptableDeg: number
  slopeRestrictiveDeg: number
  // Energy model only.
  reportingBasis: "year_one" | "lifetime_mean"
  degradationPct: number
  analysisPeriodYears: number
  gcrFixed: number
  gcrTracker: number
  trackerMaxAngleDeg: number
  densityBasis: string
  buildableFraction: number
  /** Blank labels the diurnal profile in UTC, which is what POWER publishes. */
  utcOffset: string
  applyShading: boolean
  declaredLoss: Record<string, number>
  optionalLoss: Record<string, number>
}

export interface SolarResults {
  resource: SolarAnalysis | null
  terrain: SolarTerrainAnalysis | null
  siting: SolarSitingAnalysis | null
  energy: EnergyModelAnalysis | null
}

/** Visibility and opacity per raster. Only two products draw. */
export interface SolarLayers {
  showTerrain: boolean
  terrainOpacity: number
  showSiting: boolean
  sitingOpacity: number
}

/**
 * Which product is running, and how far along.
 *
 * `active` names the product rather than being a boolean per product, so the
 * progress bar can be rendered by the section that owns the run. Only one
 * action runs at a time, which the sidecar's single progress channel already
 * assumes.
 */
export interface SolarRun {
  active: SolarProductId | null
  progress: number
  message: string
}

export interface SolarState {
  params: SolarParams
  results: SolarResults
  layers: SolarLayers
  run: SolarRun
  /** AOI the held results were computed over; results are dropped when it changes. */
  aoiSignature: string
}

export const initialSolarState: SolarState = {
  params: {
    climatologyYears: 30,
    hourlyYears: 10,
    surfaceAzimuth: 0,
    performanceRatio: "",
    season: "annual",
    slopeAcceptableDeg: 10,
    slopeRestrictiveDeg: 15,
    reportingBasis: ENERGY_DEFAULTS.reportingBasis,
    degradationPct: ENERGY_DEFAULTS.degradationRatePctPerYear,
    analysisPeriodYears: ENERGY_DEFAULTS.analysisPeriodYears,
    gcrFixed: ENERGY_DEFAULTS.gcrFixed,
    gcrTracker: ENERGY_DEFAULTS.gcrTracker,
    trackerMaxAngleDeg: ENERGY_DEFAULTS.trackerMaxAngleDeg,
    densityBasis: ENERGY_DEFAULTS.capacityDensityBasis,
    buildableFraction: ENERGY_DEFAULTS.buildableFraction,
    utcOffset: "",
    applyShading: false,
    declaredLoss: Object.fromEntries(
      ENERGY_DECLARED_LOSSES.map((t) => [t.key, t.defaultPct])
    ),
    optionalLoss: Object.fromEntries(
      ENERGY_OPTIONAL_LOSSES.map((t) => [t.key, t.defaultPct])
    ),
  },
  results: { resource: null, terrain: null, siting: null, energy: null },
  layers: {
    showTerrain: true,
    terrainOpacity: 0.85,
    showSiting: true,
    sitingOpacity: 0.85,
  },
  run: { active: null, progress: 0, message: "" },
  aoiSignature: "",
}

export type SolarAction =
  | { type: "params/set"; patch: Partial<SolarParams> }
  | { type: "params/loss"; group: "declared" | "optional"; key: string; pct: number }
  | { type: "layers/set"; patch: Partial<SolarLayers> }
  | { type: "run/start"; product: SolarProductId }
  | { type: "run/progress"; progress: number; message: string }
  | { type: "run/finish" }
  /** A finished run: its result and the AOI it was computed over, together. */
  | {
      type: "result/set"
      product: SolarProductId
      result: SolarAnalysis | SolarTerrainAnalysis | SolarSitingAnalysis | EnergyModelAnalysis
      aoiSignature: string
    }
  | { type: "result/clear"; product: SolarProductId }
  | { type: "results/clearAll" }
  /** Restoring a saved run: results and their AOI arrive in one step. */
  | { type: "results/restore"; results: Partial<SolarResults>; aoiSignature: string }
  | { type: "aoi/changed"; aoiSignature: string }

const RESULT_KEY: Record<SolarProductId, keyof SolarResults> = {
  resource: "resource",
  terrain: "terrain",
  siting: "siting",
  energy: "energy",
}

export function solarReducer(s: SolarState, a: SolarAction): SolarState {
  switch (a.type) {
    case "params/set":
      return { ...s, params: { ...s.params, ...a.patch } }
    case "params/loss": {
      const field = a.group === "declared" ? "declaredLoss" : "optionalLoss"
      return {
        ...s,
        params: {
          ...s.params,
          [field]: { ...s.params[field], [a.key]: a.pct },
        },
      }
    }
    case "layers/set":
      return { ...s, layers: { ...s.layers, ...a.patch } }
    case "run/start":
      return {
        ...s,
        run: { active: a.product, progress: 0, message: "starting" },
      }
    case "run/progress":
      return {
        ...s,
        run: { ...s.run, progress: a.progress, message: a.message },
      }
    case "run/finish":
      return { ...s, run: { active: null, progress: 0, message: "" } }
    case "result/set":
      // The AOI signature is recorded in the same step as the result. Assigned
      // separately, the invalidation below could observe the new result against
      // the old signature and drop what had just been produced.
      return {
        ...s,
        results: { ...s.results, [RESULT_KEY[a.product]]: a.result },
        aoiSignature: a.aoiSignature,
      }
    case "result/clear":
      return { ...s, results: { ...s.results, [RESULT_KEY[a.product]]: null } }
    case "results/clearAll":
      return { ...s, results: initialSolarState.results }
    case "results/restore":
      return {
        ...s,
        results: { ...initialSolarState.results, ...a.results },
        layers: { ...s.layers, showTerrain: true, showSiting: true },
        aoiSignature: a.aoiSignature,
      }
    case "aoi/changed":
      // A result describes the area it was computed over. Keyed on a recorded
      // signature rather than cleared at each call site, because the AOI moves
      // from drawing, from loading an example, from opening a project and from
      // restoring a run, and a missed path leaves one field's figures labelled
      // with another's name.
      if (a.aoiSignature === s.aoiSignature) return s
      return {
        ...s,
        results: initialSolarState.results,
        layers: { ...s.layers, showTerrain: true, showSiting: true },
        aoiSignature: a.aoiSignature,
      }
    default:
      return s
  }
}

export function useSolarState() {
  return useReducer(solarReducer, initialSolarState)
}

// ------------------------------------------------------------------- wind

export interface WindParams {
  recordYears: number
  hubHeightM: number
  calmThresholdMS: number
  recordMaxFloorMS: number
  roughnessLowM: number
  roughnessHighM: number
}

export interface WindState {
  params: WindParams
  result: WindAnalysis | null
  run: { active: boolean; progress: number; message: string }
  aoiSignature: string
}

export const initialWindState: WindState = {
  params: {
    recordYears: WIND_DEFAULTS.recordYears,
    hubHeightM: WIND_DEFAULTS.hubHeightM,
    calmThresholdMS: WIND_DEFAULTS.calmThresholdMS,
    recordMaxFloorMS: WIND_DEFAULTS.recordMaxFloorMS,
    roughnessLowM: WIND_DEFAULTS.roughnessLowM,
    roughnessHighM: WIND_DEFAULTS.roughnessHighM,
  },
  result: null,
  run: { active: false, progress: 0, message: "" },
  aoiSignature: "",
}

export type WindAction =
  | { type: "params/set"; patch: Partial<WindParams> }
  | { type: "run/start" }
  | { type: "run/progress"; progress: number; message: string }
  | { type: "run/finish" }
  | { type: "result/set"; result: WindAnalysis; aoiSignature: string }
  | { type: "result/clear" }
  | { type: "aoi/changed"; aoiSignature: string }

export function windReducer(s: WindState, a: WindAction): WindState {
  switch (a.type) {
    case "params/set":
      return { ...s, params: { ...s.params, ...a.patch } }
    case "run/start":
      return { ...s, run: { active: true, progress: 0, message: "starting" } }
    case "run/progress":
      return {
        ...s,
        run: { ...s.run, progress: a.progress, message: a.message },
      }
    case "run/finish":
      return { ...s, run: { active: false, progress: 0, message: "" } }
    case "result/set":
      return { ...s, result: a.result, aoiSignature: a.aoiSignature }
    case "result/clear":
      return { ...s, result: null }
    case "aoi/changed":
      // Its own signature, not the solar one. The wind cell is larger and does
      // not move on the same boundaries, so an AOI can leave the radiation cell
      // while staying inside the reanalysis cell, and neither result's validity
      // implies the other's.
      if (a.aoiSignature === s.aoiSignature) return s
      return { ...s, result: null, aoiSignature: a.aoiSignature }
    default:
      return s
  }
}

export function useWindState() {
  return useReducer(windReducer, initialWindState)
}
