/**
 * THE REQUESTS, built from the panel's parameters over a given ground.
 *
 * One builder per product, used by a product's own run over the area in hand and by a
 * queued job over each selected area. A job and a run then differ in the ground they
 * cover and in nothing else, which holds only while one function builds both: two
 * copies of a request would drift the way two copies of anything in this codebase have.
 */
import { makeRunLabel } from "@/lib/aoiLabel"
import type { MineralRunOptions } from "@/lib/mineral"
import type {
  GeoJSONGeometry,
  HealthRequest,
  MineralRequest,
  ModelKind,
  OverlapRequest,
  PredictRequest,
  RadarRequest,
  WaterIndex,
  WaterRequest,
  ZonesRequest,
} from "@/lib/types"

export interface RunGround {
  polygon: GeoJSONGeometry
  /** Which catalogued area the run is OF; see the note on area_id below. */
  areaId?: string
  label: string
}

/** What every request reads besides its ground. */
export interface RequestContext {
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  mode: "single" | "temporal"
  modelKind: ModelKind
  prithviMode: "pixel" | "patch"
  projectId: string | null
}

/** The area in hand, if there is one to run over. */
export function groundInHand(
  polygon: GeoJSONGeometry | null,
  areaId: string | undefined,
  label: string | undefined
): RunGround | null {
  return polygon ? { polygon, areaId, label: label?.trim() || "Custom AOI" } : null
}

export const predictRequest = (g: RunGround, c: RequestContext): PredictRequest => ({
  polygon_geojson: g.polygon,
  start: c.start,
  end: c.end,
  max_cloud: c.maxCloud,
  monthly_best: c.monthlyBest,
  tiles: [],
  mode: c.mode,
  model_kind: c.modelKind,
  prithvi_mode: c.prithviMode,
  project_id: c.projectId || undefined,
  label: g.label,
  run_label: makeRunLabel(g.label),
  // Which catalogued area this run is OF. Without it a drawing and the runs
  // over it are separate subjects on the board, and the same ground is drawn
  // once per drawing plus once per run.
  area_id: g.areaId,
})

export const waterRequest = (
  g: RunGround,
  c: RequestContext,
  index: WaterIndex
): WaterRequest => ({
  polygon_geojson: g.polygon,
  start: c.start,
  end: c.end,
  max_cloud: c.maxCloud,
  monthly_best: c.monthlyBest,
  index,
  label: g.label,
  run_label: makeRunLabel(g.label),
  area_id: g.areaId,
  project_id: c.projectId || undefined,
})

export const mineralRequest = (
  g: RunGround,
  c: RequestContext,
  options: MineralRunOptions
): MineralRequest => ({
  polygon_geojson: g.polygon,
  start: c.start,
  end: c.end,
  // Zero: the sidecar's ceiling of 100%, not the period card's value.
  // That value is chosen for Sentinel-2 scenes; an EMIT pass is scored
  // for cloud over its whole ~75 km scene, and over the humid tropics
  // every pass exceeds a typical card value while the area itself may be
  // clear. Passes are read least cloudy first and cloud is excluded per
  // cell by the EMIT mask.
  max_cloud: 0,
  max_scenes: options.passes,
  uncertainty_draws: options.draws,
  label: g.label,
  run_label: makeRunLabel(g.label),
  area_id: g.areaId,
  project_id: c.projectId || undefined,
})

export const healthRequest = (g: RunGround, c: RequestContext): HealthRequest => ({
  polygon_geojson: g.polygon,
  start: c.start,
  end: c.end,
  max_cloud: c.maxCloud,
  // Zero: the sidecar's default of three earlier seasons.
  baseline_years: 0,
  label: g.label,
  run_label: makeRunLabel(g.label),
  area_id: g.areaId,
  project_id: c.projectId || undefined,
})

// No period: each register is read as it stands on the day the job runs.
export const overlapRequest = (g: RunGround, c: RequestContext): OverlapRequest => ({
  polygon_geojson: g.polygon,
  label: g.label,
  run_label: makeRunLabel(g.label),
  area_id: g.areaId,
  project_id: c.projectId || undefined,
})

// The period's every Sentinel-1 pass; cloud does not stop the radar.
export const radarRequest = (g: RunGround, c: RequestContext): RadarRequest => ({
  polygon_geojson: g.polygon,
  start: c.start,
  end: c.end,
  label: g.label,
  run_label: makeRunLabel(g.label),
  area_id: g.areaId,
  project_id: c.projectId || undefined,
})

// The period is the latest season; the three before it are read as well.
export const zonesRequest = (g: RunGround, c: RequestContext): ZonesRequest => ({
  polygon_geojson: g.polygon,
  start: c.start,
  end: c.end,
  max_cloud: c.maxCloud,
  earlier_seasons: 0,
  label: g.label,
  run_label: makeRunLabel(g.label),
  area_id: g.areaId,
  project_id: c.projectId || undefined,
})
