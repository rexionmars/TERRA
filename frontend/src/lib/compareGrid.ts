/**
 * The arithmetic of the Compare board, apart from what draws it.
 *
 * Rasters of areas hundreds of kilometres apart cannot be set side by side on a
 * map, whose whole job is to keep them where they are. On a board they can, at
 * the price of each being drawn to its own scale, so every run states how much
 * ground it spans: two squares of one size are not two fields of one size.
 * Which runs a reading compares is lib/compareBoard.ts's.
 */
import type { DataTable } from "@/lib/analysisTables"
import {
  compareAccuracyDeltaTable,
  compareBlockAgreementTable,
  compareOverallDeltaTable,
  compareShareDeltaTable,
} from "@/lib/compareTables"
import { cornersOf } from "@/lib/mapLayers"
import type { Bounds, PredictResult } from "@/lib/types"

const EARTH_RADIUS_M = 6_371_008.8

/** Great-circle distance between two [lon, lat] points. */
function metresBetween([lon1, lat1]: number[], [lon2, lat2]: number[]): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** How wide a raster is on the ground, along its top edge. */
export function groundWidthM(e: Bounds): number {
  const [tl, tr] = cornersOf(e)
  return metresBetween(tl, tr)
}

/** "950 m", "12.4 km": a distance at the precision a tile caption can use. */
export function formatGroundWidth(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`
}

/** The pair's figures as tables, in the order they are drawn, for the clipboard. */
export function comparePairTables(
  a: { label: string; result: PredictResult },
  b: { label: string; result: PredictResult }
): DataTable[] {
  const agreementA = a.result.lulc?.agreement
  const agreementB = b.result.lulc?.agreement
  return [
    agreementA && agreementB ? compareOverallDeltaTable(agreementA, agreementB) : null,
    agreementA && agreementB ? compareAccuracyDeltaTable(agreementA, agreementB) : null,
    compareShareDeltaTable(a.result.class_stats ?? [], b.result.class_stats ?? []),
    agreementA && agreementB
      ? compareBlockAgreementTable(agreementA, agreementB, a.label, b.label)
      : null,
  ].filter((t): t is DataTable => !!t)
}
