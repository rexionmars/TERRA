/**
 * The mineral map, read in a column beside the planes it draws.
 *
 * The class maps are the product and they are drawn on the board and the
 * globe, one plane per Tetracorder group. This column carries what a plane
 * cannot: which passes the answer came from, how much of the area was seen at
 * all, what each group identified over the part that was seen, and which
 * reference spectra won the cells behind each class.
 *
 * THE OBSERVED AREA IS STATED BEFORE ANY IDENTIFIED AREA. Green vegetation,
 * water and cloud suppress the mineral answer entirely, so over most of Brazil
 * the identified hectares are a small part of the AOI; a class area read
 * without the ground it was taken over reads as the composition of the whole
 * area. Shares in the class tables are of the observed area for the same
 * reason, and the column heading says so.
 *
 * THE CAVEAT IS FIXED TEXT AND PINNED. Band depth rises with abundance at a
 * fixed grain size, but it is not an abundance, and a deeper band in one cell
 * than another is not a larger fraction of that mineral. It sits above the
 * scrolling figures because the mean depth columns are the ones it qualifies.
 *
 * The sidecar's notes are shown verbatim at the foot: they state what this
 * run could not do (a pass with no mask granule, a wavelength offset), and a
 * shorter version written here could disagree with them.
 */
import { DownloadSimple, Trash } from "@phosphor-icons/react"

import { Chip, Stat, WaterFigure } from "@/components/analysisPrimitives"
import { PanelSection } from "@/components/ui/PanelSection"
import { btnGhostDense, btnIcon } from "@/components/ui/buttons"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import {
  MINERAL_MASKED_COLOR,
  MINERAL_NO_ANSWER_COLOR,
  mineralCellAreaHa,
  mineralClassColor,
  mineralGroupTitle,
  mineralNoAnswerHa,
} from "@/lib/mineral"
import type { MineralAnalysis, MineralGroup } from "@/lib/types"
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
  const cellHa = mineralCellAreaHa(mineral)

  const exportGeoTIFF = async () => {
    try {
      const dest = await ExportOverlayFile(mineral.geotiff, "terra_mineral_map.tif")
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--hairline)] pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            <Chip>{mineral.sensor || "EMIT L2A reflectance"}</Chip>
            <Chip>{`${mineral.scenes.length} ${mineral.scenes.length === 1 ? "pass" : "passes"}`}</Chip>
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
        <p className="text-micro leading-relaxed text-muted-foreground">
          {MINERAL_CAVEAT}
        </p>
      </div>

      <div className="panel-scroll relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <PanelSection title="Coverage">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <WaterFigure
              dense
              label="Observed"
              value={ha(mineral.observed_area_ha)}
              sub={
                observedFrac !== null
                  ? `${pct(observedFrac)} of the AOI, cloud-free`
                  : "cloud-free"
              }
            />
            <WaterFigure
              dense
              label="AOI"
              value={ha(mineral.aoi_area_ha)}
              sub={`${mineral.aoi_cells.toLocaleString()} cells`}
            />
            <WaterFigure
              dense
              label="Masked"
              value={cellHa !== null ? ha(mineral.masked_cells * cellHa) : "–"}
              sub={`${mineral.masked_cells.toLocaleString()} cells under the cloud mask`}
            />
            {mineral.groups.map((g) => (
              <WaterFigure
                key={g.group}
                dense
                label={`Identified, group ${g.group}`}
                value={ha(g.detected_area_ha)}
                sub={
                  mineral.observed_area_ha > 0
                    ? `${pct(g.detected_area_ha / mineral.observed_area_ha)} of observed`
                    : "nothing observed"
                }
              />
            ))}
          </div>
          <p className="text-micro leading-relaxed text-muted-foreground">
            Areas are cell counts times the output cell size, over the cells
            inside the AOI polygon. Cells no pass covered are neither observed
            nor masked, and are transparent on the map.
          </p>
        </PanelSection>

        {mineral.groups.map((g) => (
          <GroupSection key={g.group} mineral={mineral} group={g} />
        ))}

        <PanelSection title="Passes">
          {mineral.scenes.length === 0 ? (
            <p className="text-micro text-muted-foreground">
              No pass contributed cells.
            </p>
          ) : (
            <div className="panel-scroll overflow-x-auto">
              <table className="telemetry w-full text-micro">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pr-2 font-normal">Date</th>
                    <th className="pr-2 font-normal">Granule</th>
                    <th className="pr-2 text-right font-normal">Cloud</th>
                    <th className="pr-2 text-right font-normal">Cells</th>
                    <th className="pr-2 text-right font-normal">Masked</th>
                    <th className="text-right font-normal" title="Largest band-centre offset against the convolved library">
                      Offset
                    </th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {mineral.scenes.map((s) => (
                    <tr key={s.granule} className="align-baseline">
                      <td className="whitespace-nowrap pr-2">{s.date}</td>
                      <td className="max-w-[12rem] truncate pr-2" title={s.granule}>
                        {s.granule}
                      </td>
                      <td className="pr-2 text-right">
                        {typeof s.cloud_cover === "number"
                          ? `${s.cloud_cover.toFixed(0)}%`
                          : "–"}
                      </td>
                      <td className="pr-2 text-right">{s.cells.toLocaleString()}</td>
                      <td className="pr-2 text-right">{s.masked_cells.toLocaleString()}</td>
                      <td className="whitespace-nowrap text-right">
                        {`${s.wavelength_offset_nm.toFixed(1)} nm`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-micro leading-relaxed text-muted-foreground">
            Cloud is the scene-level cover reported with the granule. Each cell
            takes its answer from one pass, never an average of several.
          </p>
        </PanelSection>

        <PanelSection title="Method">
          <Stat label="Expert system" value={mineral.expert_system || "not recorded"} />
          <Stat
            label="Libraries"
            value={mineral.libraries.length ? mineral.libraries.join(", ") : "not recorded"}
          />
          {mineral.cell_size_deg.length === 2 && (
            <Stat
              label="Cell size"
              value={`${mineral.cell_size_deg[0].toFixed(5)} x ${mineral.cell_size_deg[1].toFixed(5)} deg`}
            />
          )}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => void exportGeoTIFF()}
              disabled={!mineral.geotiff}
              className={`${btnGhostDense} self-start`}
              title="Every group's entry index, fit and depth, one band each, EPSG:4326"
            >
              <DownloadSimple className="size-3.5" />
              Export GeoTIFF
            </button>
            {!mineral.geotiff && (
              <p className="text-micro text-muted-foreground">
                This run has no GeoTIFF on disk.
              </p>
            )}
          </div>
        </PanelSection>

        {mineral.notes.length > 0 && (
          <PanelSection title="Notes">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {mineral.notes.map((line, n) => (
                <li
                  key={n}
                  className="text-micro leading-relaxed text-muted-foreground"
                >
                  {line}
                </li>
              ))}
            </ul>
          </PanelSection>
        )}
      </div>
    </div>
  )
}

/**
 * One group: its classes by area, then the references that won the cells.
 *
 * The class table closes with the two grey states the map draws, so the rows
 * account for the observed area rather than only for the part that answered.
 */
function GroupSection({
  mineral,
  group,
}: {
  mineral: MineralAnalysis
  group: MineralGroup
}) {
  const cellHa = mineralCellAreaHa(mineral)
  return (
    <PanelSection title={mineralGroupTitle(group.group)}>
      {group.label && (
        <p className="text-micro text-muted-foreground">{group.label}</p>
      )}
      <div className="panel-scroll overflow-x-auto">
        <table className="telemetry w-full text-micro">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-2 font-normal">Class</th>
              <th className="pr-2 text-right font-normal">Area</th>
              <th className="pr-2 text-right font-normal">Of observed</th>
              <th className="text-right font-normal">Mean depth</th>
            </tr>
          </thead>
          <tbody className="text-foreground">
            {group.classes.map((c) => (
              <tr key={c.class} className="align-baseline">
                <td className="pr-2">
                  <span className="flex items-center gap-1.5">
                    <Swatch color={mineralClassColor(mineral, c.class, c.color)} />
                    <span className="min-w-0 truncate" title={c.class}>
                      {c.label || c.class}
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap pr-2 text-right">{ha(c.area_ha)}</td>
                <td className="pr-2 text-right">{pct(c.fraction_of_observed)}</td>
                <td className="text-right">{c.mean_depth.toFixed(3)}</td>
              </tr>
            ))}
            <tr className="align-baseline text-muted-foreground">
              <td className="pr-2">
                <span className="flex items-center gap-1.5">
                  <Swatch color={MINERAL_NO_ANSWER_COLOR} />
                  Observed, no answer
                </span>
              </td>
              <td className="whitespace-nowrap pr-2 text-right">
                {ha(mineralNoAnswerHa(mineral, group))}
              </td>
              <td className="pr-2 text-right">
                {mineral.observed_area_ha > 0
                  ? pct(mineralNoAnswerHa(mineral, group) / mineral.observed_area_ha)
                  : "–"}
              </td>
              <td className="text-right">–</td>
            </tr>
            <tr className="align-baseline text-muted-foreground">
              <td className="pr-2">
                <span className="flex items-center gap-1.5">
                  <Swatch color={MINERAL_MASKED_COLOR} />
                  Masked (cloud)
                </span>
              </td>
              <td className="whitespace-nowrap pr-2 text-right">
                {cellHa !== null ? ha(mineral.masked_cells * cellHa) : "–"}
              </td>
              <td className="pr-2 text-right">–</td>
              <td className="text-right">–</td>
            </tr>
          </tbody>
        </table>
      </div>
      {group.classes.length === 0 && (
        <p className="text-micro leading-relaxed text-muted-foreground">
          No cell in this group matched a reference within its constraints.
        </p>
      )}

      {group.entries.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Top references</span>
          <div className="panel-scroll overflow-x-auto">
            <table className="telemetry w-full text-micro">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pr-2 font-normal">Reference</th>
                  <th className="pr-2 font-normal">Class</th>
                  <th className="pr-2 text-right font-normal">Cells</th>
                  <th className="pr-2 text-right font-normal">Mean fit</th>
                  <th className="text-right font-normal">Mean depth</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {group.entries.map((e) => (
                  <tr key={e.id} className="align-baseline">
                    <td className="max-w-[14rem] truncate pr-2" title={e.title}>
                      {e.title}
                    </td>
                    <td className="whitespace-nowrap pr-2">{e.class}</td>
                    <td className="pr-2 text-right">{e.cells.toLocaleString()}</td>
                    <td className="pr-2 text-right">{e.mean_fit.toFixed(3)}</td>
                    <td className="text-right">{e.mean_depth.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PanelSection>
  )
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="size-3 shrink-0 rounded-[2px] border border-[var(--hairline)]"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}
