/**
 * The flood envelope screen: a HAND extent and the disagreement between the
 * DEM products it can be derived from.
 *
 * A screen of its own. The energy screen holds two resources read at an AOI
 * centroid from a reanalysis; this reads four DEM products over the AOI's
 * terrain and produces a raster of the disagreement between them. As an
 * energy tab it would inherit that screen's comparison and its record-window
 * bar, neither of which applies here.
 *
 * The study this ports reports that the HAND mask is not reproducible across
 * DEM products: at the 1 m threshold the pairwise agreement between 30 m
 * products runs from about 0.43 to about 0.69, so two products disagree about
 * roughly a fifth of the cells. A HAND extent from a single product moves with
 * that choice. What this screen reports is the extent with its envelope, and
 * the central representation is an agreement count raster.
 *
 * The result is read on the map. This analysis reads no satellite scene and
 * requires no classification, so the AOI is drawn here, and the agreement
 * raster is drawn over it when a run finishes. Its legend, its switch and its
 * figures are in the result column beside it. The raster states where the
 * terrain decides the extent and where the choice of DEM decides it.
 *
 * The raster is placed on the payload's own extent and not on the grid the
 * chain ran over. The PNG is the counts clipped to the AOI bounding box; the
 * grid is that AOI plus 2 to 5 km of buffer on every side, so placing the clip
 * on the grid would stretch it over several times the ground it covers. The
 * GeoTIFF the reading names covers the full window, and is the route to a
 * GIS.
 *
 * Two columns, as on the energy screen: the parameters on the left edge, the
 * reading on the right, both 19rem PanelShells over the map they describe.
 */
import { AnimatePresence } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { ChartColumn, SlidersHorizontal } from "lucide-react"

import { MapSurface } from "@/components/map/MapSurface"
import { SearchBar } from "@/components/SearchBar"
import { WorkspaceBar } from "@/components/WorkspaceBar"
import { PanelSection } from "@/components/ui/PanelSection"
import { PanelShell, PanelTab, type PanelPlacement } from "@/components/ui/PanelShell"
import { AoiSection } from "@/components/energy/AoiSection"
import { RunButton, RunProgress } from "@/components/energy/controls"
import { FloodReadingColumn } from "@/components/flood/FloodReading"
import { FloodSetupSections } from "@/components/flood/FloodSetupSections"
import { floodRequestBlocker, type FloodParams } from "@/components/flood/floodSetup"
import type { AoiContourSchemeId } from "@/lib/aoiStyle"
import type { BasemapKind } from "@/lib/basemaps"
import { floodAgreementLayer } from "@/lib/mapLayers"
import type { FloodAnalysis, GeoJSONGeometry, LayoutMode } from "@/lib/types"

/**
 * The scope of the analysis, stated before a run as well as after one.
 *
 * After a run the reading prints the payload's own qualifier. Before a run
 * there is no payload, and the caveat applies to the figures being requested.
 * The wind tab carries its qualifier on the same terms.
 *
 * The wording follows sidecar/flood.py qualifier_text, minus the product list,
 * which is not fixed until the run names it. The two state the same claims in
 * the same order.
 */
const FLOOD_QUALIFIER =
  "The envelope is TERRA's measurement over its own product set. The range " +
  "published by the study this ports does not apply to it. HAND is the " +
  "height of a cell above the drainage cell it flows to. It is not a " +
  "hydrodynamic model: rainfall, discharge, routing and channel geometry are " +
  "not modelled. A threshold in metres ranks relative susceptibility; it is " +
  "not a flood depth, extent or probability. Disagreement between products " +
  "indicates cells where the result depends on the choice of DEM."

const AOI_NOTE =
  "The DEM is read beyond the AOI, so the drainage entering it is measured " +
  "terrain, and the terrain chain runs over that larger window. Every figure " +
  "the run reports is over the AOI itself, with the window beside it as " +
  "provenance. The products are read from Microsoft Planetary Computer at " +
  "their native resolution; reading them at a coarser resolution would " +
  "change the disagreement being measured, so an AOI above the size limit is " +
  "refused before the products are read."

/** Stable no-op: the swipe compare belongs to the classification map. */
const NO_SWIPE_CHANGE = () => {}

export interface FloodScreenProps {
  params: FloodParams
  onParamsChange: (patch: Partial<FloodParams>) => void
  result: FloodAnalysis | null
  onClearResult: () => void
  run: { active: boolean; progress: number; message: string }
  onRun: () => void
  /**
   * A request to show a restored result, carried as a counter. Same
   * shape and same reason as the energy screen's: see the module-scope note
   * below on why it is not compared against a ref inside the component.
   */
  openResultNonce?: number

  layoutMode?: LayoutMode
  onNavigate: (groupId: string, itemId?: string) => void

  hasArea: boolean
  customPolygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onImportPolygon: () => void
  onClearArea: () => void
  onLocationSelect: (lat: number, lon: number) => void
  areaLabel?: string
  onAreaLabelChange: (label: string) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void

  initialView?: { lat: number; lon: number; zoom: number } | null
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
  onCreditChange?: (c: { kind: BasemapKind; date: string | null }) => void
  flyTo: { lat: number; lon: number; key: number } | null
}

/*
  The last open-the-reading request this session has acted on.

  Module scope: the screen unmounts on navigation, and a ref inside it cannot
  distinguish a fresh request from one that outlived the previous visit. The
  energy screen carries the same value for the same reason.
*/
let lastHandledOpenNonce = 0

export function FloodScreen(props: FloodScreenProps) {
  const [setupOpen, setSetupOpen] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)
  /*
    The raster is drawn as soon as there is one, and its opacity is
    adjustable: the agreement classes are read against the terrain in the
    imagery underneath, and 0.85 keeps both legible. Held on this screen, so
    the map and the legend that names the colours cannot disagree about what
    is drawn, and outside the run state, since it describes how the result is
    displayed. The screen unmounts on navigation, so a later visit starts
    visible again.
  */
  const [showAgreement, setShowAgreement] = useState(true)
  const [agreementOpacity, setAgreementOpacity] = useState(0.85)

  /*
    Derived in lib/mapLayers.ts. That module owns which rasters are drawn, in
    what order and under which guard. A zero extent is what the sidecar
    returns when it resolved no window; drawn, it would stretch the overlay
    across the null island. A second derivation on this screen could drift
    from that one.
  */
  const agreement = floodAgreementLayer(
    props.result,
    showAgreement,
    agreementOpacity
  )

  const workspace = props.layoutMode === "workspace"
  const hasResult = !!props.result
  const blocker = floodRequestBlocker(props.params, props.hasArea)

  useEffect(() => {
    const n = props.openResultNonce
    if (n && n !== lastHandledOpenNonce) {
      lastHandledOpenNonce = n
      setResultOpen(true)
    }
  }, [props.openResultNonce])

  /*
    The column opens when a run finishes, and folds away when the result is
    cleared.
  */
  const hadResult = useRef(hasResult)
  useEffect(() => {
    if (hasResult && !hadResult.current) setResultOpen(true)
    if (!hasResult) setResultOpen(false)
    hadResult.current = hasResult
  }, [hasResult])

  const setup = (placement: PanelPlacement) => (
    <PanelShell
      placement={placement}
      title="Flood envelope"
      onCollapse={
        placement === "drawer"
          ? () => setConfigOpen(false)
          : () => setSetupOpen(false)
      }
    >
      <AoiSection
        note={AOI_NOTE}
        hasArea={props.hasArea}
        hasCustomPolygon={!!props.customPolygon}
        onImportPolygon={props.onImportPolygon}
        onClearArea={props.onClearArea}
        busy={props.run.active}
      />
      <FloodSetupSections
        params={props.params}
        onSet={props.onParamsChange}
        busy={props.run.active}
      />
      <PanelSection title="Run">
        <RunProgress
          active={props.run.active}
          progress={props.run.progress}
          message={props.run.message}
        />
        <RunButton
          label="Measure the envelope, returns an agreement raster"
          runningLabel="Measuring…"
          running={props.run.active}
          disabled={props.run.active || blocker !== null}
          onClick={props.onRun}
        />
        {blocker && (
          <p className="text-meta leading-relaxed text-muted-foreground">
            {blocker}
          </p>
        )}
        {/* Carried here as well as on the result: what a HAND threshold is
            and whose envelope this is are readable before the run as well as
            after it. */}
        <p className="text-meta leading-relaxed text-muted-foreground">
          {FLOOD_QUALIFIER}
        </p>
      </PanelSection>
    </PanelShell>
  )

  return (
    <div className="relative h-full min-h-0 w-full">
      {/*
        Full bleed. The map carries the AOI the measurement is over, before a
        run and after it; the agreement raster is drawn over it once there is
        one, and its legend is in the result column.
      */}
      <MapSurface
        initialView={props.initialView}
        customPolygon={props.customPolygon}
        onPolygonDrawn={props.onPolygonDrawn}
        flyTo={props.flyTo}
        // The classification chrome is pinned off, as on the energy screen.
        // There is no prediction here, so a confidence toggle and a swipe
        // compare have nothing to act on.
        result={null}
        overlayOpacity={1}
        showConfidence={false}
        confidenceOnTop={false}
        smoothOverlay={false}
        showPredictionOverlay={false}
        showCompositionOverlay={false}
        composition={null}
        floodOverlay={
          agreement?.visible
            ? {
                uri: agreement.uri,
                extent: agreement.extent,
                opacity: agreement.opacity,
                // The counts, where the run wrote them: with these the map
                // paints from the measurement and colours it with an
                // expression, and `uri` is the fallback for a run made before
                // the values existed.
                valuesUri: agreement.valuesUri,
                classes: agreement.classes,
              }
            : null
        }
        swipeCompare={false}
        swipeRatio={0.5}
        onSwipeRatioChange={NO_SWIPE_CHANGE}
        areaLabel={props.areaLabel}
        onAreaLabelChange={props.onAreaLabelChange}
        aoiContourScheme={props.aoiContourScheme}
        onAoiContourSchemeChange={props.onAoiContourSchemeChange}
        onClearArea={props.onClearArea}
        onViewChange={props.onViewChange}
        onCreditChange={props.onCreditChange}
      />

      <SearchBar onSelectLocation={props.onLocationSelect} />

      <AnimatePresence mode="wait" initial={false}>
        {workspace || !setupOpen ? null : setup("docked")}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {!workspace && !setupOpen && (
          <PanelTab
            key="setup-tab"
            placement="docked"
            label="Setup"
            icon={SlidersHorizontal}
            title="Show the run parameters"
            onOpen={() => setSetupOpen(true)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {workspace && configOpen ? setup("drawer") : null}
      </AnimatePresence>

      <AnimatePresence>
        {workspace && (
          <WorkspaceBar
            key="flood-bar"
            groupId="flood"
            // The group is a single place, so no item of it is in view.
            activeId={null}
            onNavigate={props.onNavigate}
            running={props.run.active}
            progress={props.run.progress}
            progressMsg={props.run.message}
            runLabel={props.run.active ? "Measuring…" : "Measure"}
            canRun={blocker === null}
            onRun={props.onRun}
            configOpen={configOpen}
            onConfigToggle={() => setConfigOpen((o) => !o)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false} mode="wait">
        {props.result && resultOpen && (
          <FloodReadingColumn
            key="flood-reading"
            flood={props.result}
            overlay={{
              visible: showAgreement,
              opacity: agreementOpacity,
              onVisibleChange: setShowAgreement,
              onOpacityChange: setAgreementOpacity,
            }}
            onClear={props.onClearResult}
            onCollapse={() => setResultOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {hasResult && !resultOpen && (
          <PanelTab
            key="result-tab"
            placement="reading"
            label="Result"
            icon={ChartColumn}
            title="Read the flood envelope"
            onOpen={() => setResultOpen(true)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
