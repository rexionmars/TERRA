/**
 * The flood envelope, read in the column the parameters were set in.
 *
 * THE AGREEMENT RASTER IS THE PRODUCT AND IT IS ON THE MAP. This column
 * carries its legend, its switch and its figures; the raster itself is drawn
 * over the AOI beside them, placed on the payload's own `extent`. It used to
 * be a 200 px tile in this column, which is where a picture whose whole claim
 * is WHERE the products disagree cannot be read: the claim is a location, and
 * a thumbnail detached from the map has none. Everything else in this column
 * is evidence about that raster. The study this ports found that a HAND extent
 * is not reproducible across DEM products -- two products disagree about
 * roughly a fifth of the cells at the 1 m threshold -- so an extent shipped
 * alone is a shape one DEM chose, with the choice never shown. What is
 * shown instead is, per cell, how many products call it flooded: unanimous
 * cells are where the terrain decides, and the cells between are where the
 * choice of DEM decides. A single mask with an accuracy figure beside it
 * cannot carry that, because it does not say WHERE the disagreement is, which
 * is the one thing the study measured.
 *
 * THE LEGEND IS A LIST OF CLASSES, NOT A RAMP. See agreementLevels.ts: "3 of
 * 4" is a class and there is no cell between it and "4 of 4". A gradient bar
 * with two end labels would invite a reading the quantity does not support.
 * The swatches are the colours the renderer used, computed from the same stops.
 * The classes are split under two headings rather than listed as one run from
 * 4 down to 1, because a single run of darkening blue reads as a confidence
 * scale and is not one: unanimous is where the terrain decides the extent, and
 * every class below it is where the choice of DEM decides it. "0 of 4" is not
 * in the list at all -- on the recorded run it is 92 percent of the AOI, and
 * that every product calls a cell dry says nothing about how far the products
 * agree with each other -- and is reported under the classes as the dry
 * remainder, without a swatch, since the raster draws nothing there.
 *
 * THE QUALIFIER IS PINNED, NOT PLACED IN THE FLOW. This column scrolls past
 * several screens of figures, and the sentence has to be on screen with any of
 * them -- it is what separates TERRA's own measurement over its own product
 * set from the range the study published, and what stops a HAND threshold in
 * metres from being read as a flood depth. It is bounded in height and scrolls
 * within itself because at this measure the full text is about sixteen lines,
 * which would leave no room for the reading it qualifies. It is not a tooltip
 * and does not need a hover, a click or a pointer to be read.
 *
 * EVERY AREA HERE IS OVER THE AOI POLYGON. The terrain chain ran over the AOI
 * plus a buffer of 2 to 5 km, because HAND needs the contributing area
 * upstream of a cell, and the figures used to be taken over that whole window:
 * on one recorded run 37.5 km2 of classified ground against an AOI of 4.5 km2,
 * every number on screen inflated 8.3 times by a buffer that exists for
 * numerical reasons alone. The window is still reported, under "Computed
 * window", as provenance -- what a reader needs to re-run the analysis and
 * what the GeoTIFF is georeferenced on -- and nothing on this reading is
 * measured over it.
 *
 * A COLUMN, NOT A DIALOG, and no scroll-spy index. The energy reading has one
 * for nine blocks across four products; this reading is one run of six blocks,
 * and an index band over six entries would spend a row of the column on a
 * question a reader of six blocks does not have.
 */
import { useState } from "react"
import { Trash2 } from "lucide-react"

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
   * The switch lives here and not in the parameters column because this is
   * where the colours are named: a reader turning the layer down is reading
   * the legend at the time. The state is the screen's, so the map and this
   * column cannot disagree about what is drawn.
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
    and it is what a reader looks for before the classes that qualify it.
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
        {/* Verbatim from the payload. Nothing here composes a shorter version:
            a second qualifier written on this side can disagree with the one
            the sidecar wrote, which is the failure it exists to prevent. */}
        <p className="panel-scroll max-h-[7rem] overflow-y-auto text-micro leading-relaxed text-muted-foreground">
          {flood.qualifier}
        </p>
      </div>

      <div className="panel-scroll relative -mx-4 -mb-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <Block title="Agreement over the AOI">
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
            centre falls inside the AOI polygon. A null contested share means no
            product called anything flooded, which is not the same as agreement.
          </p>
        </Block>

        <Block title="Computed window">
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
            Provenance, not the reporting extent. HAND needs the contributing
            area upstream of a cell, so the terrain chain ran over the AOI plus
            the buffer, trimmed to the rectangle every product covers. No figure
            on this reading is measured over these cells. The inset statistics
            repeat every comparison over the AOI shrunk by the inset margin,
            where the contributing area is still short of whatever drains in
            from beyond the buffer and HAND reads high.
          </p>
          {/* A path on the machine that ran it. The webview cannot open it and
              does not pretend to: it is named so a reader can take the raster
              into a GIS, which is the only place the full-resolution counts can
              be interrogated cell by cell. The GeoTIFF is the WHOLE window and
              the overlay on the map is the AOI clip, so the two are not the
              same picture. */}
          <p className="telemetry break-all text-micro leading-relaxed text-muted-foreground">
            GeoTIFF, whole window: {flood.agreement_tif || "not written"}
          </p>
        </Block>

        <Block title={`Products at HAND <= ${flood.reference_threshold_m} m`}>
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

        <Block title="Envelope by threshold">
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
            that threshold, over the AOI polygon. The index is the Jaccard index
            between two binary extents, which for a binary mask is numerically
            the critical success index (CSI) of the flood literature. A wide gap
            between a row and its inset figures places the disagreement at the
            border of the AOI rather than through the middle of it.
          </p>
        </Block>

        <PairBlock flood={flood} />

        <Block title="Assumptions">
          {/* First, because it says which ground every area above is of, and
              an area quoted without it is a figure a reader attributes to the
              wrong extent. */}
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

function Block({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <span className="eyebrow !text-foreground">{title}</span>
      {children}
    </section>
  )
}

/**
 * The switch and the opacity of the raster this column describes.
 *
 * Beside the legend rather than in the parameters column: the legend is what
 * makes the colours mean anything, and turning the layer down is something a
 * reader does while reading it. The empty case is a sentence and not a hidden
 * control -- a rendering that could not be read leaves the map without an
 * overlay, and the figures below still stand.
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
        The rendering could not be read, so nothing is drawn on the map. Every
        figure below is unaffected.
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
        Cells no product calls flooded are transparent, so what shows through
        them is the imagery underneath.
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
 * The agreement classes, under the two headings that say what a class MEANS.
 *
 * Not one run of rows from 4 of 4 down to 1 of 4. That list is ordered
 * correctly and still reads as a scale of confidence, with 1 of 4 at the
 * shallow end -- and 1 of 4 is not a shallower flood, it is the widest
 * disagreement the product set can produce. The heading is what separates the
 * class where the terrain decides the extent from the classes where the choice
 * of DEM does, which is the distinction the whole analysis exists to draw.
 *
 * The dry remainder closes the accounting underneath, as a figure with no
 * swatch: the raster leaves those cells transparent, so a filled swatch would
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
      {/* Named once, at the head, rather than repeated on every row: without
          it the two figures on a row are a bare area and a bare percentage,
          and the percentage is of the AOI rather than of the flooded extent. */}
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
          The remainder of the AOI, not an agreement class: that every product
          calls a cell dry says nothing about how far the products agree with
          each other. The raster draws nothing there.
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
 * Split by threshold rather than listed whole: four products over five
 * thresholds is thirty rows, and a reader comparing two products is comparing
 * them at one threshold. The chips are the thresholds the run actually swept,
 * read from the payload, so a run with a different sweep names its own.
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
    <Block title="Pairwise agreement">
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
        means both extents are empty at this threshold, where the index is
        undefined rather than zero.
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
 * Three states, not two. A false is silent because it is the ordinary case; a
 * true has to be said, because that row's disagreement is terrain plus
 * alignment and the payload's chain_grid assumption quantifies how large that
 * can be; a null is said differently, because a fact that was not recorded is
 * not a fact that is false.
 */
function ResampledNote({ resampled }: { resampled: boolean | null }) {
  if (resampled === false) return null
  return (
    <span className="text-micro leading-relaxed text-muted-foreground">
      {resampled === true
        ? "Moved onto the shared grid before the terrain chain ran, so this figure carries a resampling component alongside the terrain difference."
        : "Whether this was resampled onto the shared grid was not recorded, which is not the same as it having been left alone."}
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
