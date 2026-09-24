/**
 * The mineral map, summed up in a short column.
 *
 * THE FIGURES ARE COMPOSITOR CARDS, NOT THIS COLUMN. It used to carry every
 * table the run reported -- both groups' classes and references, the passes,
 * the fractional cover, the band positions, the acid-sulfate minerals, the
 * confidence, the agreement with L2B -- and a column of eleven tables is read
 * by scrolling past ten of them. Each is now a Mineral node in the compositor
 * (components/studio/mineralNodes.tsx), placed for a run when it finishes and
 * fed from its Run node's Mineral report. What stays here is what says what the
 * run was over: how much of the area was observed, and what was identified.
 *
 * THE OBSERVED AREA IS STATED BEFORE ANY IDENTIFIED AREA. Green vegetation,
 * water and cloud suppress the mineral answer entirely, so over most of Brazil
 * the identified hectares are a small part of the AOI; an identified area read
 * without the ground it was taken over reads as the composition of the whole.
 */
import { DownloadSimple, Trash } from "@phosphor-icons/react"

import { Chip, WaterFigure } from "@/components/analysisPrimitives"
import { btnGhostDense, btnIcon } from "@/components/ui/buttons"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import { mineralGroupTitle, mineralPassesUsed } from "@/lib/mineral"
import type { MineralAnalysis } from "@/lib/types"
import { ExportOverlayFile } from "../../../wailsjs/go/main/App"

/** Fixed, and the same on every run: it is a property of the method. */
const MINERAL_CAVEAT =
  "Band depth is not abundance; no unmixing is done. Vegetation, water and cloud suppress mineral identification."

const ha = (v: number) => `${v.toFixed(1)} ha`
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`

export function MineralReadingColumn({
  mineral,
  onClear,
}: {
  mineral: MineralAnalysis
  /** Drops the result. The AOI it was measured over stays. */
  onClear: () => void
}) {
  const observedFrac =
    mineral.aoi_area_ha > 0 ? mineral.observed_area_ha / mineral.aoi_area_ha : null
  const used = mineralPassesUsed(mineral)

  const exportGeoTIFF = async () => {
    try {
      const dest = await ExportOverlayFile(mineral.geotiff, "terra_mineral_map.tif")
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  return (
    <div className="panel-scroll flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <Chip>{mineral.sensor || "EMIT L2A reflectance"}</Chip>
          <Chip>
            {mineral.selection
              ? `${used} of ${mineral.selection.compared_passes} passes used`
              : `${used} ${used === 1 ? "pass" : "passes"}`}
          </Chip>
        </div>
        <button
          type="button"
          onClick={onClear}
          className={btnIcon}
          title="Clear the mineral map result"
          aria-label="Clear the mineral map result"
        >
          <Trash className="size-3.5" />
        </button>
      </div>
      <p className="text-micro leading-relaxed text-muted-foreground">{MINERAL_CAVEAT}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <WaterFigure
          dense
          label="Observed"
          value={ha(mineral.observed_area_ha)}
          sub={observedFrac !== null ? `${pct(observedFrac)} of the AOI` : "cloud-free"}
        />
        {mineral.groups.map((g) => (
          <WaterFigure
            key={g.group}
            dense
            label={mineralGroupTitle(g.group)}
            value={ha(g.detected_area_ha)}
            sub={
              mineral.observed_area_ha > 0
                ? `${pct(g.detected_area_ha / mineral.observed_area_ha)} of observed identified`
                : "nothing observed"
            }
          />
        ))}
      </div>
      <p className="text-micro leading-relaxed text-muted-foreground">
        The classes, references, passes, band positions, confidence and the comparison with EMIT
        L2B are cards in the Compositor, fed from the run's Mineral report: Add, then Mineral.
      </p>
      <button
        type="button"
        onClick={() => void exportGeoTIFF()}
        disabled={!mineral.geotiff}
        className={`${btnGhostDense} self-start`}
        title="Every quantity per cell, one named band each, EPSG:4326"
      >
        <DownloadSimple className="size-3.5" />
        Export GeoTIFF
      </button>
    </div>
  )
}
