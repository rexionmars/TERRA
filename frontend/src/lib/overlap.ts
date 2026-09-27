/**
 * An overlap run's registers as the compositor reads them: the hectares of
 * each, and the figures a field's row carries.
 *
 * The run reports every register it tried, read or not (sidecar
 * terra/overlap). A register that was not read has no hectares here -- null,
 * never zero -- because "no overlap" and "not known" are different answers, and
 * a zero in a table cannot say which it is.
 */
import type { OverlapAnalysis, OverlapLayer } from "@/lib/types"

/** The registers in the order the card and the table read them. */
export const REGISTER_ORDER = [
  "prodes",
  "deter",
  "embargo_ibama",
  "embargo_icmbio",
  "indigenous",
  "conservation",
  "car",
] as const
export type RegisterId = (typeof REGISTER_ORDER)[number]

/** The registers in reading order; any the run holds and this list does not, after them. */
export function registers(report: OverlapAnalysis): OverlapLayer[] {
  const rank = (id: string) => {
    const i = (REGISTER_ORDER as readonly string[]).indexOf(id)
    return i < 0 ? REGISTER_ORDER.length : i
  }
  return [...report.layers].sort((a, b) => rank(a.id) - rank(b.id))
}

/** A register's hectares inside the area, or null where it was not read. */
export function registerHa(report: OverlapAnalysis | null, id: string): number | null {
  const l = report?.layers.find((x) => x.id === id)
  return l && l.status === "read" ? l.overlap_ha : null
}

/**
 * The part of the area no CAR registration covers, in hectares; null where CAR
 * was not read. The register's own figure is the union of the registrations,
 * so what is left of the area is the gap.
 */
export function carGapHa(report: OverlapAnalysis | null): number | null {
  const car = registerHa(report, "car")
  if (car == null || !report) return null
  return Math.max(0, report.area_ha - car)
}

/** PRODES hectares in one period, or null where PRODES was not read. */
export function periodHa(report: OverlapAnalysis | null, id: string): number | null {
  if (registerHa(report, "prodes") == null || !report) return null
  return report.periods.find((p) => p.id === id)?.ha ?? 0
}

/** The registers that could not be read, by title. */
export function unread(report: OverlapAnalysis | null): string[] {
  return (report?.layers ?? []).filter((l) => l.status === "failed").map((l) => l.title)
}

/** What a field's row in the Field table carries of its overlap run. */
export interface OverlapFigures {
  readAt: string
  prodes2009to2020: number | null
  prodes2021: number | null
  prodesFrom2022: number | null
  deter: number | null
  embargoIbama: number | null
  embargoIcmbio: number | null
  indigenous: number | null
  conservation: number | null
  carGap: number | null
  unread: string[]
}

export function overlapFigures(report: OverlapAnalysis | null): OverlapFigures | null {
  if (!report) return null
  return {
    readAt: report.read_at,
    prodes2009to2020: periodHa(report, "forest_code_to_eudr"),
    prodes2021: periodHa(report, "straddles_eudr"),
    prodesFrom2022: periodHa(report, "after_eudr"),
    deter: registerHa(report, "deter"),
    embargoIbama: registerHa(report, "embargo_ibama"),
    embargoIcmbio: registerHa(report, "embargo_icmbio"),
    indigenous: registerHa(report, "indigenous"),
    conservation: registerHa(report, "conservation"),
    carGap: carGapHa(report),
    unread: unread(report),
  }
}

/** "0.43 ha", "1 286 ha": two decimals under ten hectares, none above a hundred. */
export function formatHa(ha: number): string {
  const digits = ha < 10 ? 2 : ha < 100 ? 1 : 0
  return `${ha.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/,/g, " ")} ha`
}
