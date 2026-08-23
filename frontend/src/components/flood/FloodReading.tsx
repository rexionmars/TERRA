/**
 * The flood envelope, read in the column the parameters were set in.
 *
 * The agreement raster is the product, and it is drawn on the map. This column
 * carries its legend, its switch and its figures; the raster itself is drawn
 * over the AOI beside them, placed on the payload's own `extent`. What it
 * states is a location, which a thumbnail inside this column cannot carry.
 * Everything else in this column is evidence about that raster. The study this
 * ports found that a HAND extent is not reproducible across DEM products: two
 * products disagree about roughly a fifth of the cells at the 1 m threshold.
 * What is shown is, per cell, how many products call it flooded. Unanimous
 * cells are where the terrain decides; the cells between are where the choice
 * of DEM decides. A single mask with an accuracy figure beside it does not
 * show where the disagreement is.
 *
 * The legend is a list of classes. See agreementLevels.ts: "3 of 4" is a class
 * and there is no cell between it and "4 of 4", so a gradient bar with two end
 * labels would report a quantity that has no values between the classes. The
 * swatches are the colours the renderer used, computed from the same stops.
 * The classes are split under two headings, because one run of darkening blue
 * from 4 down to 1 reads as a confidence scale: unanimous is where the terrain
 * decides the extent, and every class below it is where the choice of DEM
 * decides it. "0 of 4" is 92 percent of the AOI on the recorded run, and a
 * cell no product calls flooded carries no measure of agreement between the
 * products, so it is reported under the classes as the dry remainder, without
 * a swatch, since the raster draws nothing there.
 *
 * The qualifier is pinned above the scrolling flow, which runs several screens
 * of figures. It separates TERRA's measurement over its own product set from
 * the range the study published, and a HAND threshold in metres from a flood
 * depth. It is bounded in height and scrolls within itself: at this measure
 * the full text is about sixteen lines, and it is readable without a hover or
 * a click.
 *
 * Every area here is over the AOI polygon. The terrain chain ran over the AOI
 * plus a buffer of 2 to 5 km, since HAND needs the contributing area upstream
 * of a cell. The figures were once taken over that whole window: on one
 * recorded run 37.5 km2 of classified ground against an AOI of 4.5 km2, every
 * number inflated 8.3 times by the buffer. The window is reported under
 * "Computed window" as provenance, being what a reader needs to re-run the
 * analysis and what the GeoTIFF is georeferenced on. No figure on this reading
 * is measured over it.
 *
 * A column, with no scroll-spy index. The energy reading has one for nine
 * blocks across four products; this reading is one run of six blocks, which is
 * short enough to read without one.
 *
 * The blocks open and close, and four of the six start closed. Six open blocks
 * are most of a screen of evidence in front of the one thing the product is
 * read on. Which blocks open is decided at Block by the caller and not by a
 * default, so a seventh block cannot be added without deciding whether it is
 * the answer or the evidence for it.
 */
import { useId, useState } from "react"
import { ChevronDown, Trash2 } from "lucide-react"

import { Chip, Stat, WaterFigure } from "@/components/analysisPrimitives"
import { PanelShell } from "@/components/ui/PanelShell"
import { btnIcon } from "@/components/ui/buttons"
import {
  agreementDry,
  agreementLevelLabel,
  agreementLevels,
  agreementStandingLabel,
  type AgreementDry,
  type AgreementLevel,
} from "@/components/flood/agreementLevels"
import {
  cells,
  iou,
  km2,
  metres,
  pct,
  ratio,
} from "@/components/flood/floodFormat"
import { cn } from "@/lib/utils"
import type { FloodAnalysis, FloodPair } from "@/lib/types"

export function FloodReadingColumn({
  flood,
  overlay,
  onClear,
  onCollapse,
}: {
  flood: FloodAnalysis
  /**
   * The raster on the map, controlled from beside its legend.
   *
   * The switch is here, where the colours are named, and not in the parameters
   * column. The state is the screen's, so the map and this column cannot
   * disagree about what is drawn.
   */
  overlay: {
    visible: boolean
    opacity: number
    onVisibleChange: (v: boolean) => void
    onOpacityChange: (v: number) => void
  }
  /** Drops the result. The AOI it was measured over stays on the map. */
  onClear: () => void
  onCollapse: () => void
}) {
  const levels = agreementLevels(flood.agreement, flood.cell_size_m)
  const dry = agreementDry(flood.agreement, flood.cell_size_m)
  /*
    Darkest first: the unanimous class is the extent every product agrees on,
    and the classes below it qualify that extent.
  */
  const ordered = [...levels].reverse()

  return (
    <PanelShell
      placement="reading"
      title="Flood envelope"
      onCollapse={onCollapse}
    >
      <div className="-mx-4 flex shrink-0 flex-col gap-1.5 border-b border-[var(--hairline)] px-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            <Chip>{`HAND <= ${flood.reference_threshold_m} m`}</Chip>
            <Chip>{`${flood.products.length} DEM products`}</Chip>
          </div>
          <button
            type="button"
            onClick={onClear}
            className={btnIcon}
            title="Clear the flood envelope result"
            aria-label="Clear the flood envelope result"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        {/* Verbatim from the payload. Nothing here composes a shorter
            version: a second qualifier written on this side could disagree
            with the one the sidecar wrote. */}
        <p className="panel-scroll max-h-[7rem] overflow-y-auto text-micro leading-relaxed text-muted-foreground">
          {flood.qualifier}
        </p>
      </div>

      <div className="panel-scroll relative -mx-4 -mb-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <Block title="Agreement over the AOI" defaultOpen={true}>
          <MapLayerControl
            drawn={!!flood.agreement_uri}
            threshold={flood.reference_threshold_m}
            overlay={overlay}
          />
          <AgreementLegend levels={ordered} dry={dry} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <WaterFigure
              dense
              label="Every product agrees"
              value={km2(flood.agreement.unanimous_wet_km2)}
              sub="terrain decides"
            />
            <WaterFigure
              dense
              label="Products disagree"
              value={km2(flood.agreement.contested_km2)}
              sub="the DEM decides"
            />
            <WaterFigure
              dense
              label="Contested share of wet"
              value={pct(flood.agreement.contested_frac_of_wet)}
              sub="of the union of the extents"
            />
            <WaterFigure
              dense
              label="Reported over"
              value={km2(flood.aoi.area_km2)}
              sub={`${cells(flood.aoi.cells)} cells inside the polygon`}
            />
          </div>
          <p className="text-micro leading-relaxed text-muted-foreground">
            Areas are cell counts times the cell size, over the cells whose
            centre falls inside the AOI polygon. A null contested share means
            no product called any cell flooded, and the share is undefined.
          </p>
        </Block>

        <Block title="Computed window" defaultOpen={false}>
          <Stat
            label="Grid"
            value={`${flood.grid.width} x ${flood.grid.height} cells`}
          />
          <Stat
            label="Cell size"
            value={`${flood.cell_size_m.x.toFixed(1)} x ${flood.cell_size_m.y.toFixed(1)} m`}
          />
          <Stat label="Buffer beyond the AOI" value={metres(flood.buffer_m)} />
          <Stat
            label="Window solved"
            value={`${cells(flood.aoi.window_cells)} cells, ${km2(flood.aoi.window_area_km2)}`}
          />
          <Stat
            label="Reported share of it"
            value={pct(flood.aoi.frac_of_window)}
          />
          <Stat
            label="Inset margin"
            value={`${flood.inset_margin_cells} cells, ${cells(flood.aoi.inset_cells)} cells left`}
          />
          <Stat
            label="Bounds"
            value={`${flood.grid.bounds.lon_min.toFixed(3)}, ${flood.grid.bounds.lat_min.toFixed(3)} to ${flood.grid.bounds.lon_max.toFixed(3)}, ${flood.grid.bounds.lat_max.toFixed(3)}`}
          />
          <p className="text-micro leading-relaxed text-muted-foreground">
            These figures are provenance; the reporting extent is the AOI.
            HAND needs the contributing area upstream of a cell, so the terrain
            chain ran over the AOI plus the buffer, trimmed to the rectangle
            every product covers. No figure on this reading is measured over
            these cells. The inset statistics repeat every comparison over the
            AOI shrunk by the inset margin, where the contributing area does
            not include drainage from beyond the buffer and HAND reads high.
          </p>
          {/* A path on the machine that ran it. The webview cannot open it;
              it is named so a reader can take the raster into a GIS, where the
              full-resolution counts can be read cell by cell. The GeoTIFF
              covers the whole window and the overlay on the map is the AOI
              clip, so the two are different pictures. */}
          <p className="telemetry break-all text-micro leading-relaxed text-muted-foreground">
            GeoTIFF, whole window: {flood.agreement_tif || "not written"}
          </p>
        </Block>

        <Block title={`Products at HAND <= ${flood.reference_threshold_m} m`} defaultOpen={true}>
          <ul className="flex flex-col gap-2">
            {flood.products.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-emphasis text-foreground">
                    {p.id}
                  </span>
                  <span className="telemetry shrink-0 text-emphasis text-foreground">
                    {km2(p.area_km2)}
                  </span>
                </div>
                <div className="telemetry flex flex-wrap gap-x-2 text-micro text-muted-foreground">
                  <span>{p.collection}</span>
                  <span>
                    {typeof p.native_resolution_m === "number"
                      ? `${p.native_resolution_m} m native`
                      : "native resolution not recorded"}
                  </span>
                  <span>{cells(p.cells)} cells</span>
                  <span>{pct(p.area_frac)} of AOI</span>
                </div>
                <ResampledNote resampled={p.resampled} />
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Envelope by threshold" defaultOpen={false}>
          <ul className="flex flex-col gap-1.5">
            {flood.envelope.map((row) => {
              const reference = row.threshold_m === flood.reference_threshold_m
              return (
                <li
                  key={row.threshold_m}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-sm border px-2 py-1.5",
                    reference
                      ? "border-primary/60 bg-primary/10"
                      : "border-border"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-emphasis text-foreground">
                      {`HAND <= ${row.threshold_m} m`}
                      {reference && (
                        <span className="ml-1.5 text-micro text-muted-foreground">
                          reference
                        </span>
                      )}
                    </span>
                    <span className="telemetry shrink-0 text-emphasis text-foreground">
                      {iou(row.iou_min)} – {iou(row.iou_max)}
                    </span>
                  </div>
                  <div className="telemetry text-micro text-muted-foreground">
                    inset {iou(row.iou_min_inset)} – {iou(row.iou_max_inset)}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-micro leading-relaxed text-muted-foreground">
            The narrowest and widest agreement any pair of products reaches at
            that threshold, over the AOI polygon. The index is the Jaccard
            index between two binary extents, numerically the critical success
            index (CSI) of the flood literature. A wide gap between a row and
            its inset figures indicates that the disagreement is concentrated
            near the AOI boundary.
          </p>
        </Block>

        <PairBlock flood={flood} />

        <Block title="Assumptions" defaultOpen={false}>
          {/* First, because it states which ground every area above is
              measured over. */}
          <AssumptionText label="Reporting extent" text={flood.assumptions.reporting_extent} />
          <AssumptionText label="Reference threshold" text={flood.assumptions.reference_threshold} />
          <AssumptionText label="Thresholds swept" text={flood.assumptions.thresholds} />
          <AssumptionText label="Drainage threshold" text={flood.assumptions.drainage_threshold} />
          <AssumptionText label="Cell size" text={flood.assumptions.cell_size} />
          <AssumptionText label="Alignment" text={flood.assumptions.alignment} />
          <AssumptionText label="Chain and grid" text={flood.assumptions.chain_grid} />
          <AssumptionText label="Buffer" text={flood.assumptions.buffer} />
          <AssumptionText label="Inset margin" text={flood.assumptions.inset_margin} />
          <AssumptionText label="Rasters" text={flood.assumptions.rasters} />
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Excluded</span>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {flood.assumptions.excluded.map((line) => (
                <li
                  key={line}
                  className="text-micro leading-relaxed text-muted-foreground"
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </Block>
      </div>
    </PanelShell>
  )
}

/*
One block of the reading, openable and closable.

The column carries six of these: the agreement raster, the window it was
computed over, the per-product areas, the pairwise table, the envelope sweep
and the assumptions. All six open at once is most of a screen of evidence in
front of the one thing the product is read on.

So the two blocks that are the reading open by default and the four that
support it start closed. Which is which is the caller's decision:
`defaultOpen` is required and has no default, so adding a block forces the
question of whether it is the answer or the evidence for it.

The whole header is the control, and not a chevron beside it. A 14 px target
is easy to miss for something toggled while comparing two rows.

State is per mount and is not persisted. Closing the assumptions closes them
for this reading only; a preference that outlived the run would hide
provenance from the next one.
*/
function Block({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        className="app-no-drag -mx-1 flex items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-surface-raised/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="eyebrow !text-foreground">{title}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "" : "-rotate-90"
          }`}
          aria-hidden
        />
      </button>
      {open && <div id={panelId}>{children}</div>}
    </section>
  )
}

/**
 * The switch and the opacity of the raster this column describes.
 *
 * Beside the legend, which is where the colours are named, and not in the
 * parameters column. When the rendering could not be read the map has no
 * overlay; the empty case says so as a sentence, and the figures below still
 * stand.
 */
function MapLayerControl({
  drawn,
  threshold,
  overlay,
}: {
  drawn: boolean
  threshold: number
  overlay: {
    visible: boolean
    opacity: number
    onVisibleChange: (v: boolean) => void
    onOpacityChange: (v: number) => void
  }
}) {
  if (!drawn) {
    return (
      <p className="text-micro leading-relaxed text-muted-foreground">
        The rendering could not be read, so nothing is drawn on the map. The
        figures below are unaffected.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-meta text-foreground">
        <input
          type="checkbox"
          checked={overlay.visible}
          onChange={(e) => overlay.onVisibleChange(e.target.checked)}
          className="size-3.5 shrink-0 accent-primary"
        />
        Draw the agreement raster on the map
      </label>
      <p className="text-micro leading-relaxed text-muted-foreground">
        {`Products calling each cell flooded at HAND <= ${threshold} m, clipped to the AOI.`}{" "}
        Cells no product calls flooded are transparent, showing the imagery
        underneath.
      </p>
      <label className="flex flex-col gap-1 text-micro text-muted-foreground">
        Opacity {(overlay.opacity * 100).toFixed(0)}%
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={overlay.opacity}
          disabled={!overlay.visible}
          onChange={(e) => overlay.onOpacityChange(Number(e.target.value))}
          className="w-full accent-primary disabled:opacity-40"
          aria-label="Agreement raster opacity"
        />
      </label>
    </div>
  )
}

/**
 * The agreement classes, under the two headings that state what a class means.
 *
 * One run of rows from 4 of 4 down to 1 of 4 is ordered correctly and reads as
 * a scale of confidence, with 1 of 4 at the shallow end. 1 of 4 is in fact the
 * widest disagreement the product set can produce. The headings separate the
 * class where the terrain decides the extent from the classes where the choice
 * of DEM decides it.
 *
 * The dry remainder closes the accounting underneath, as a figure with no
 * swatch. The raster leaves those cells transparent, so a filled swatch would
 * put a colour in the legend that appears nowhere on the map, and a class row
 * would put 92 percent of the AOI at the top of a list about disagreement.
 */
function AgreementLegend({
  levels,
  dry,
}: {
  levels: AgreementLevel[]
  dry: AgreementDry
}) {
  const unanimous = levels.filter((l) => l.standing === "unanimous")
  const contested = levels.filter((l) => l.standing === "contested")
  return (
    <div className="flex flex-col gap-2">
      {/* Named once, at the head, and not repeated on every row. Without it
          the two figures on a row are a bare area and a bare percentage, and
          the percentage is of the AOI, not of the flooded extent. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">Agreement class</span>
        <span className="eyebrow shrink-0">Area · share of AOI</span>
      </div>
      <LegendGroup heading="The terrain decides" levels={unanimous} />
      <LegendGroup heading="The choice of DEM decides" levels={contested} />
      <div className="flex flex-col gap-0.5 border-t border-[var(--hairline)] pt-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-emphasis text-foreground">
            No product calls it flooded
          </span>
          <span className="telemetry shrink-0 text-micro text-muted-foreground">
            {km2(dry.areaKm2)} · {pct(dry.frac)}
          </span>
        </div>
        <p className="text-micro leading-relaxed text-muted-foreground">
          The remainder of the AOI, reported outside the agreement classes: a
          cell no product calls flooded carries no measure of agreement between
          the products. The raster draws nothing there.
        </p>
      </div>
    </div>
  )
}

/** One heading and the classes under it, darkest first. */
function LegendGroup({
  heading,
  levels,
}: {
  heading: string
  levels: AgreementLevel[]
}) {
  if (levels.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{heading}</span>
      <ul className="flex flex-col gap-1">
        {levels.map((level) => (
          <li key={level.count} className="flex items-start gap-2">
            <span
              className="mt-0.5 size-3 shrink-0 rounded-[2px]"
              style={{ backgroundColor: level.color }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="telemetry text-emphasis text-foreground">
                  {agreementLevelLabel(level)}
                </span>
                <span className="telemetry shrink-0 text-micro text-muted-foreground">
                  {km2(level.areaKm2)} · {pct(level.frac)}
                </span>
              </div>
              <div className="text-micro leading-relaxed text-muted-foreground">
                {agreementStandingLabel(level)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Every unordered pair, at one threshold at a time.
 *
 * Split by threshold: four products over five thresholds is thirty rows, and a
 * comparison of two products is made at one threshold. The chips are the
 * thresholds the run swept, read from the payload, so a run with a different
 * sweep names its own.
 */
function PairBlock({ flood }: { flood: FloodAnalysis }) {
  const thresholds = [...new Set(flood.pairs.map((p) => p.threshold_m))].sort(
    (a, b) => a - b
  )
  const [at, setAt] = useState<number>(
    thresholds.includes(flood.reference_threshold_m)
      ? flood.reference_threshold_m
      : (thresholds[0] ?? flood.reference_threshold_m)
  )
  const rows = flood.pairs.filter((p) => p.threshold_m === at)

  return (
    <Block title="Pairwise agreement" defaultOpen={false}>
      {thresholds.length > 1 && (
        <div
          role="group"
          aria-label="Threshold of the pairs below"
          className="panel-scroll flex items-center gap-1 overflow-x-auto"
        >
          {thresholds.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAt(t)}
              aria-pressed={t === at}
              className={cn(
                "telemetry shrink-0 rounded-[2px] border px-1.5 py-0.5 text-micro transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                t === at
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {t} m
            </button>
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <PairRow key={`${row.dem_a}-${row.dem_b}`} row={row} />
        ))}
      </ul>
      <p className="text-micro leading-relaxed text-muted-foreground">
        Ratio is the second product's extent over the first's. A null index
        means both extents are empty at this threshold and the index is
        undefined.
      </p>
    </Block>
  )
}

function PairRow({ row }: { row: FloodPair }) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-foreground">
          {row.dem_a} · {row.dem_b}
        </span>
        <span className="telemetry shrink-0 text-emphasis text-foreground">
          {iou(row.iou)}
        </span>
      </div>
      <div className="telemetry flex flex-wrap gap-x-2 text-micro text-muted-foreground">
        <span>inset {iou(row.iou_inset)}</span>
        <span>ratio {ratio(row.area_ratio_b_over_a)}</span>
      </div>
      <ResampledNote resampled={row.resampled} />
    </li>
  )
}

/**
 * Whether the figure beside it includes a resampling component.
 *
 * Three states. A false is silent, being the ordinary case. A true is stated:
 * that row's disagreement is terrain plus alignment, and the payload's
 * chain_grid assumption bounds the alignment part. A null is stated in its own
 * words, a fact that was not recorded being unknown and not false.
 */
function ResampledNote({ resampled }: { resampled: boolean | null }) {
  if (resampled === false) return null
  return (
    <span className="text-micro leading-relaxed text-muted-foreground">
      {resampled === true
        ? "Moved onto the shared grid before the terrain chain ran, so this figure carries a resampling component alongside the terrain difference."
        : "Whether this was resampled onto the shared grid was not recorded, so this figure may carry a resampling component."}
    </span>
  )
}

function AssumptionText({ label, text }: { label: string; text: string }) {
  if (!text?.trim()) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <p className="text-micro leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}
