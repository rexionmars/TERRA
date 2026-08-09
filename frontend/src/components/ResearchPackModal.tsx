import { useEffect, useMemo, useState } from "react"
import { Braces, Download, Map as MapIcon, Shapes, Table2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import { ExportResearchPack } from "../../wailsjs/go/main/App"
import type { GeoJSONGeometry, PredictResult } from "@/lib/types"
import { allAnalysisTables, type DataTable } from "@/lib/analysisTables"
import { stripResearchPackRasters } from "@/lib/researchPack"
import { DataTableView } from "@/components/DataTableView"
import {
  geometryAreaHectares,
  geometryBounds,
  geometryCentroid,
  polygonParts,
} from "@/lib/geometry"

/**
 * Inspector for the research pack, opened from the analysis header.
 *
 * The export writes a manifest, the AOI geometry, one CSV per table the result
 * carries and the classification raster, and none of it could be read without
 * unzipping the archive elsewhere. This lists the same entries the ZIP contains
 * and renders each one, so the pack can be checked before it leaves the
 * application. The table count is not stated here because it follows from the
 * products in the result; allAnalysisTables is the list.
 *
 * Entries are named after the files the exporter writes, so what is inspected
 * here maps one-to-one onto what lands on disk.
 */

type EntryKind = "manifest" | "aoi" | "table" | "raster"

interface PackEntry {
  /** Path inside the ZIP. */
  name: string
  kind: EntryKind
  /** Short right-aligned annotation in the list. */
  detail: string
  table?: DataTable
}

function parseGeometry(raw?: string): GeoJSONGeometry | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as
      | GeoJSONGeometry
      | { geometry?: GeoJSONGeometry }
    const geom =
      (parsed as { geometry?: GeoJSONGeometry }).geometry ??
      (parsed as GeoJSONGeometry)
    return geom?.type === "Polygon" || geom?.type === "MultiPolygon"
      ? geom
      : null
  } catch {
    return null
  }
}

function iconFor(kind: EntryKind) {
  if (kind === "manifest") return <Braces className="h-3.5 w-3.5 shrink-0" />
  if (kind === "aoi") return <Shapes className="h-3.5 w-3.5 shrink-0" />
  if (kind === "raster") return <MapIcon className="h-3.5 w-3.5 shrink-0" />
  return <Table2 className="h-3.5 w-3.5 shrink-0" />
}

export function ResearchPackModal({
  result,
  modelKind,
  areaLabel,
  areaId,
  polygonGeoJSON,
  onClose,
}: {
  result: PredictResult
  modelKind: string
  areaLabel?: string
  areaId?: string
  /** AOI as GeoJSON text, the same value the exporter receives. */
  polygonGeoJSON?: string
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const geometry = useMemo(
    () => parseGeometry(polygonGeoJSON),
    [polygonGeoJSON]
  )

  /**
   * The run-metadata block of the manifest written by BuildResearchPackZIP.
   * The per-product keys that exporter adds after it — the solar, terrain,
   * energy and wind figures, each with the assumption that produced it — are
   * not listed here, so this is a preview of the manifest's head rather than
   * the whole of it.
   */
  const manifestRows = useMemo(() => {
    if (!result) return []
    return [
      ["schema_version", "1"],
      ["exported_at", "set when the pack is written"],
      ["model_kind", modelKind || ""],
      ["area_id", areaId ?? ""],
      ["aoi_label", areaLabel?.trim() ?? ""],
      ["n_dates", String(result.n_dates ?? 0)],
      ["date_range", (result.date_range ?? []).join(" → ")],
      ["mean_confidence", String(result.mean_confidence ?? 0)],
      [
        "extent",
        result.extent
          ? `${result.extent.lon_min}, ${result.extent.lat_min}, ${result.extent.lon_max}, ${result.extent.lat_max}`
          : "",
      ],
    ]
  }, [result, modelKind, areaId, areaLabel])

  const entries = useMemo((): PackEntry[] => {
    if (!result) return []
    const list: PackEntry[] = [
      { name: "manifest.json", kind: "manifest", detail: "run metadata" },
    ]
    if (geometry) {
      const parts = polygonParts(geometry).length
      list.push({
        name: "aoi.geojson",
        kind: "aoi",
        detail: parts === 1 ? "1 part" : `${parts} parts`,
      })
    }
    for (const t of allAnalysisTables(result)) {
      list.push({
        name: t.csvName,
        kind: "table",
        detail: `${t.rows.length} ${t.rows.length === 1 ? "row" : "rows"}`,
        table: t,
      })
    }
    if (result.raster_tif) {
      list.push({
        name: "rasters/classification.tif",
        kind: "raster",
        detail: "GeoTIFF",
      })
    }
    return list
  }, [result, geometry])

  const active = useMemo(
    () => entries.find((e) => e.name === selected) ?? entries[0] ?? null,
    [entries, selected]
  )

  const exportPack = async () => {
    if (!result) return
    setExporting(true)
    try {
      // Strip the bulky data URIs through the helper the analysis page also
      // calls. Inlined here, this path kept sending solar_terrain.overlay_uri
      // and solar_siting.overlay_uri while the other stripped them, so the two
      // buttons in the same row put payloads of different sizes on the bridge.
      const pack = stripResearchPackRasters(result)
      const dest = await ExportResearchPack(
        {
          model_kind: modelKind,
          area_id: areaId ?? "",
          aoi_label: areaLabel?.trim() || "",
          polygon_geojson: polygonGeoJSON?.trim() || "",
        },
        pack as never
      )
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    } finally {
      setExporting(false)
    }
  }

  // Escape closes, matching the other modals on this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="app-no-drag absolute inset-0 z-[2000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Research pack contents"
        className="terra-workspace flex h-[min(48rem,92vh)] w-full max-w-6xl overflow-hidden rounded-sm border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{
          borderColor: "var(--ar-border)",
          background: "var(--ar-panel)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
      <aside className="ar-sidebar flex w-[15rem] shrink-0 flex-col">
        <div className="shrink-0 px-3.5 pb-2 pt-4">
          <p className="font-display text-sm font-semibold tracking-wide text-foreground">
            Research pack
          </p>
          <p className="telemetry mt-0.5 text-[10px] text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {entries.map((e) => {
            const isActive = active?.name === e.name
            return (
              <button
                key={e.name}
                type="button"
                onClick={() => setSelected(e.name)}
                title={e.name}
                className={cn(
                  "ar-nav-item flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]",
                  isActive
                    ? "is-active"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {iconFor(e.kind)}
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                  {e.detail}
                </span>
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="ar-header flex shrink-0 flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="telemetry text-[10px] text-primary">DATA</p>
            <h1 className="mt-0.5 truncate font-display text-xl font-semibold tracking-wide">
              {active?.name ?? "Research pack"}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {areaLabel ? `${areaLabel} · ` : ""}
              Exactly what the research pack export writes to disk.
            </p>
          </div>
          <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportPack()}
            className="flex h-9 items-center gap-1.5 rounded-sm bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Export pack"}
          </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="ar-ghost flex size-9 shrink-0 items-center justify-center rounded-sm border text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">
          {active?.kind === "table" && active.table ? (
            <DataTableView table={active.table} />
          ) : active?.kind === "manifest" ? (
            <section className="ar-section p-4">
              <p className="eyebrow mb-3">manifest.json</p>
              <dl className="flex flex-col gap-1.5">
                {manifestRows.map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 border-b pb-1.5 text-[11px] last:border-b-0"
                    style={{ borderColor: "var(--ar-border)" }}
                  >
                    <dt className="telemetry text-muted-foreground">{k}</dt>
                    <dd className="telemetry break-words text-foreground">
                      {v || <span className="text-muted-foreground">—</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[10px] text-muted-foreground">
                exported_at is stamped by the exporter when the archive is
                written, so it is not known until then.
              </p>
            </section>
          ) : active?.kind === "aoi" && geometry ? (
            <AoiEntry geometry={geometry} raw={polygonGeoJSON ?? ""} />
          ) : active?.kind === "raster" ? (
            <section className="ar-section p-4">
              <p className="eyebrow mb-3">rasters/classification.tif</p>
              <p className="text-[11px] text-muted-foreground">
                The classification raster is copied into the archive from{" "}
                <span className="telemetry text-foreground">
                  {result.raster_tif}
                </span>
                . It is written in the Sentinel-2 UTM projection of the source
                scene, not in the lon/lat used by the extent above, so a tool
                reading it should take the CRS from the file itself.
              </p>
            </section>
          ) : null}
        </div>
      </main>
      </div>
    </div>
  )
}

function AoiEntry({
  geometry,
  raw,
}: {
  geometry: GeoJSONGeometry
  raw: string
}) {
  const bounds = geometryBounds(geometry)
  const centroid = geometryCentroid(geometry)
  const parts = polygonParts(geometry)
  const vertices = parts.reduce(
    (sum, part) => sum + part.reduce((s, ring) => s + ring.length, 0),
    0
  )
  const holes = parts.reduce((sum, part) => sum + Math.max(0, part.length - 1), 0)

  const facts: [string, string][] = [
    ["type", geometry.type],
    ["parts", String(parts.length)],
    ["interior rings", String(holes)],
    ["vertices", String(vertices)],
    ["area", `${geometryAreaHectares(geometry).toFixed(2)} ha`],
    [
      "centroid",
      centroid ? `${centroid[0].toFixed(5)}, ${centroid[1].toFixed(5)}` : "—",
    ],
    [
      "bbox W/S/E/N",
      bounds
        ? `${bounds.lonMin.toFixed(5)}, ${bounds.latMin.toFixed(5)}, ${bounds.lonMax.toFixed(5)}, ${bounds.latMax.toFixed(5)}`
        : "—",
    ],
    ["crs", "EPSG:4326 (WGS 84)"],
  ]

  return (
    <div className="flex flex-col gap-3">
      <section className="ar-section p-4">
        <p className="eyebrow mb-3">aoi.geojson</p>
        <dl className="flex flex-col gap-1.5">
          {facts.map(([k, v]) => (
            <div
              key={k}
              className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 border-b pb-1.5 text-[11px] last:border-b-0"
              style={{ borderColor: "var(--ar-border)" }}
            >
              <dt className="telemetry text-muted-foreground">{k}</dt>
              <dd className="telemetry break-words text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Area is a vertex-shoelace on an equirectangular projection about the
          AOI latitude, and the centroid is a vertex mean, adequate as a map
          target but not an area centroid.
        </p>
      </section>
      <section className="ar-section p-4">
        <p className="eyebrow mb-3">geometry source</p>
        <pre className="ar-inset max-h-64 overflow-auto p-3 text-[10px] leading-relaxed text-muted-foreground">
          {raw}
        </pre>
      </section>
    </div>
  )
}
