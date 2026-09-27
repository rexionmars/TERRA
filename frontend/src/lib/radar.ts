/**
 * A radar run's series as the compositor reads it: by orbit, its latest canopy
 * loss, and the figures a field's row carries.
 *
 * Orbits stay apart here as in the sidecar (terra/radar): the incidence angle
 * sets the level of the backscatter, so a line through passes of two orbits
 * would draw that difference as change.
 */
import type { RadarAnalysis, RadarLoss, RadarPoint } from "@/lib/types"

export interface OrbitSeries {
  relativeOrbit: number
  orbitState: string
  points: RadarPoint[]
}

/** The series split by relative orbit, each in date order, orbits by number. */
export function byOrbit(report: RadarAnalysis): OrbitSeries[] {
  const groups = new Map<number, RadarPoint[]>()
  for (const p of report.series) {
    const g = groups.get(p.relative_orbit) ?? []
    g.push(p)
    groups.set(p.relative_orbit, g)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([relativeOrbit, points]) => ({
      relativeOrbit,
      orbitState: points[0]?.orbit_state ?? "",
      points: [...points].sort((a, b) => a.date.localeCompare(b.date)),
    }))
}

/** The last canopy loss of the period, or null where none was found. */
export function lastLoss(report: RadarAnalysis | null): RadarLoss | null {
  const l = report?.losses ?? []
  return l.length ? l[l.length - 1] : null
}

/** The latest pass, the one the maps show. */
export function latestPass(report: RadarAnalysis | null): RadarPoint | null {
  const s = report?.series ?? []
  if (!s.length) return null
  return s.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.relative_orbit > a.relative_orbit) ? b : a))
}

/** What a field's row in the Field table carries of its radar run. */
export interface RadarFigures {
  passes: number
  losses: number
  lastLossFrom: string | null
  lastLossTo: string | null
  latestDate: string | null
  /** Share of the field read as open water on the latest pass, 0-1. */
  latestWater: number | null
}

export function radarFigures(report: RadarAnalysis | null): RadarFigures | null {
  if (!report) return null
  const l = lastLoss(report)
  const p = latestPass(report)
  return {
    passes: report.series.length,
    losses: report.losses.length,
    lastLossFrom: l?.date_from ?? null,
    lastLossTo: l?.date_to ?? null,
    latestDate: p?.date ?? null,
    latestWater: p?.water_fraction ?? null,
  }
}
