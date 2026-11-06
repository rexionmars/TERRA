/**
 * The legend the sidecar computed for a composition, read from its response.
 *
 * For a change, a canopy variable, a biomass map, the components and the
 * clusters, the scale is set when the raster is drawn, so the legend arrives
 * with it (sidecar terra/scenes/views.py, terra/biomass/actions.py). It is read
 * here with every field checked: the response is JSON the client did not write,
 * and a legend that drew a ramp from a palette it does not have would describe
 * colours the raster was not painted in.
 */
import type { LayerLegend } from "@/lib/layerLegend"
import { PALETTE_STOPS, paletteGradient, type PaletteName } from "@/lib/palettes"
import type { CompositionLegend } from "@/lib/types"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined

function isPalette(name: string | undefined): name is PaletteName {
  return !!name && Object.prototype.hasOwnProperty.call(PALETTE_STOPS, name)
}

/** The legend in a composite response's meta, or undefined where it carries none. */
export function compositionLegendOf(meta: unknown): CompositionLegend | undefined {
  if (!isRecord(meta) || !isRecord(meta.legend)) return undefined
  const l = meta.legend
  const kind = l.kind
  const subject = str(l.subject)
  if ((kind !== "stats" && kind !== "classes" && kind !== "note") || !subject) {
    return undefined
  }
  const rows = Array.isArray(l.rows)
    ? l.rows.flatMap((r) => {
        if (!isRecord(r)) return []
        const label = str(r.label)
        const value = str(r.value)
        return label && value ? [{ label, value }] : []
      })
    : undefined
  const entries = Array.isArray(l.entries)
    ? l.entries.flatMap((e) => {
        if (!isRecord(e)) return []
        const name = str(e.name)
        const color = str(e.color)
        return name && color
          ? [{ name, color, pct: num(e.pct), area_ha: num(e.area_ha) }]
          : []
      })
    : undefined
  return {
    kind,
    subject,
    palette: str(l.palette),
    low: str(l.low),
    high: str(l.high),
    rows,
    entries,
    note: str(l.note),
  }
}

/**
 * As the map's legend model.
 *
 * A ramp is drawn only from a palette the generated table has: an unknown name
 * drops the ramp and keeps the figures, rather than borrowing another ramp.
 */
export function layerLegendOfComposition(
  l: CompositionLegend
): NonNullable<LayerLegend> {
  if (l.kind === "classes") {
    return {
      kind: "classes",
      subject: l.subject,
      entries: (l.entries ?? []).map((e) => ({
        name: e.name,
        color: e.color,
        pct: e.pct,
        areaHa: e.area_ha,
      })),
    }
  }
  if (l.kind === "note") return { kind: "note", subject: l.subject, note: l.note ?? "" }
  const ramp =
    isPalette(l.palette) && l.low !== undefined && l.high !== undefined
      ? { gradient: paletteGradient(l.palette), low: l.low, high: l.high }
      : undefined
  return { kind: "stats", subject: l.subject, rows: l.rows ?? [], ramp, note: l.note }
}
