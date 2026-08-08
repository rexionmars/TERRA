/**
 * Visibility and opacity for the rasters this screen draws.
 *
 * Deliberately not OverlayToolsPanel: that panel's overlay section is mostly
 * classification state -- smooth prediction, show confidence, keep prediction
 * under confidence, prediction opacity -- and its empty state reads "No
 * overlays yet, classify or apply a composition", naming two actions this
 * screen does not offer. Reusing it would put controls here for a run that
 * cannot be started here.
 *
 * One switch and one slider per raster, because terrain irradiation and siting
 * are different products that can describe an AOI at once: the suitability
 * classes are what a siting decision reads, and the irradiation underneath is
 * the continuous field they were cut from.
 */
import { Download } from "lucide-react"
import type { SolarLayers, SolarResults } from "@/lib/energyState"
import { PanelSection } from "@/components/ui/PanelSection"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import { ExportOverlayFile } from "../../../wailsjs/go/main/App"

interface RasterRow {
  label: string
  present: boolean
  visible: boolean
  opacity: number
  /** Raster as a data URI, for the export below. */
  uri?: string
  filename: string
  onVisibleChange: (v: boolean) => void
  onOpacityChange: (v: number) => void
}

async function exportRaster(src: string, filename: string) {
  try {
    const dest = await ExportOverlayFile(src, filename)
    if (dest) notifyExportOk(dest)
  } catch (e) {
    notifyExportFail(e)
  }
}

export function SolarLayerControls({
  results,
  layers,
  onChange,
}: {
  results: SolarResults
  layers: SolarLayers
  onChange: (patch: Partial<SolarLayers>) => void
}) {
  const rows: RasterRow[] = [
    {
      label: "Irradiation over terrain",
      present: !!results.terrain,
      visible: layers.showTerrain,
      opacity: layers.terrainOpacity,
      uri: results.terrain?.overlay_uri,
      filename: "terra_solar_terrain.png",
      onVisibleChange: (v) => onChange({ showTerrain: v }),
      onOpacityChange: (v) => onChange({ terrainOpacity: v }),
    },
    {
      label: "Photovoltaic siting",
      present: !!results.siting,
      visible: layers.showSiting,
      opacity: layers.sitingOpacity,
      uri: results.siting?.overlay_uri,
      filename: "terra_solar_siting.png",
      onVisibleChange: (v) => onChange({ showSiting: v }),
      onOpacityChange: (v) => onChange({ sitingOpacity: v }),
    },
  ]
  const held = rows.filter((r) => r.present)

  return (
    <PanelSection title="Layer">
      {held.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Nothing drawn yet. The map beside this column shows the AOI; the
          raster is added when a run finishes.
        </p>
      ) : (
        held.map((r) => (
          <div key={r.label} className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-[11px] text-foreground">
              <input
                type="checkbox"
                checked={r.visible}
                onChange={(e) => r.onVisibleChange(e.target.checked)}
                className="size-3.5 shrink-0 accent-primary"
              />
              {r.label}
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              Opacity {(r.opacity * 100).toFixed(0)}%
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={r.opacity}
                disabled={!r.visible}
                onChange={(e) => r.onOpacityChange(Number(e.target.value))}
                className="w-full accent-primary disabled:opacity-40"
                aria-label={`${r.label} opacity`}
              />
            </label>
            {/* The raster is exportable from where it is controlled. Overlay
                Tools carried this for the solar layers until they moved here,
                and dropping it would have removed a working capability rather
                than relocating it. */}
            {r.uri && (
              <button
                type="button"
                onClick={() => void exportRaster(r.uri!, r.filename)}
                className="inline-flex h-6 w-fit items-center gap-1 rounded-sm border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                title={`Export ${r.label} as PNG`}
              >
                <Download className="size-3" />
                PNG
              </button>
            )}
          </div>
        ))
      )}
      {held.length === 2 && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Both rasters are held for this AOI. Siting draws over terrain; neither
          replaces the other.
        </p>
      )}
    </PanelSection>
  )
}
