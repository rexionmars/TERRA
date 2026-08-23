/**
 * The flood envelope screen: a HAND extent and the disagreement between the
 * DEM products it can be derived from.
 *
 * A DESTINATION OF ITS OWN, NOT A TAB OF ENERGY. The energy screen holds two
 * resources that share a chassis because both are read at an AOI centroid off
 * a reanalysis; this reads four DEM products over the AOI's terrain and
 * produces a raster whose subject is the disagreement between them. Filed as a
 * third energy tab it would inherit a comparison it does not belong to and a
 * record-window bar it has no record for.
 *
 * WHAT IT SHIPS AND WHY IT SHIPS THAT. The study this ports found the HAND
 * mask is not reproducible across DEM products: at the 1 m threshold, where
 * the map most resembles a real flood, the pairwise agreement between 30 m
 * products runs from about 0.43 to about 0.69, so two products disagree about
 * roughly a fifth of the cells. Shipping "the HAND extent" would ship a shape
 * that changes with a choice the reader never made and is never shown. So the
 * deliverable is the extent WITH its envelope, and the central representation
 * is an agreement count raster rather than a mask with an accuracy figure
 * beside it.
 *
 * THE MAP STAYS FULL BLEED even though the run draws nothing on it. The AOI is
 * drawn here -- this analysis reads no satellite scene, so sending the reader
 * to the classification panel to define one would make a classification a
 * precondition of a run that needs none -- and the agreement raster is read in
 * the result column, where its legend is. The raster is georeferenced on the
 * window's bounds and its GeoTIFF path is named in the reading, which is the
 * route to a GIS; the map here is the AOI's, not the result's.
 *
 * TWO COLUMNS OF ONE SPECIES, as on the energy screen: the parameters on the
 * left edge, the reading on the right, both 19rem PanelShells over the map
 * they describe.
 */
import { AnimatePresence } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { ChartColumn, SlidersHorizontal } from "lucide-react"

import { MapView } from "@/components/MapView"
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
import type { Area, FloodAnalysis, GeoJSONGeometry, LayoutMode } from "@/lib/types"

/**
 * What this analysis is and is not, stated before a run as well as after one.
 *
 * After a run the reading prints the payload's own qualifier. Before one there
 * is no payload, and the figures a reader is about to request are exactly the
 * ones that need the caveat in advance -- the same argument the wind tab's
 * qualifier makes on the energy screen.
 */
const FLOOD_QUALIFIER =
  "HAND is a terrain index -- the height of a cell above the drainage it " +
  "flows to -- and not a hydrodynamic model. There is no rainfall, no " +
  "discharge, no routing and no channel geometry here, so a threshold in " +
  "metres ranks susceptibility and does not state the depth, the extent or " +
  "the probability of any flood. What the run measures is how much the choice " +
  "of DEM decides the answer: the envelope is TERRA's own measurement over " +
  "its own product set, and it is not the range published by the study this " +
  "ports."

const AOI_NOTE =
  "The DEM is read beyond the AOI so drainage entering it is real terrain, " +
  "and every figure the run reports is over that larger window. The products " +
  "are read from Microsoft Planetary Computer at their native resolution; a " +
  "large AOI is refused before the first byte is fetched rather than read at " +
  "a coarser resolution, because resampling the products changes the very " +
  "disagreement being measured."

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
   * A request to show a restored result, counted rather than flagged. Same
   * shape and same reason as the energy screen's: see the module-scope note
   * below on why it is not compared against a ref inside the component.
   */
  openResultNonce?: number

  layoutMode?: LayoutMode
  onNavigate: (groupId: string, itemId?: string) => void

  hasArea: boolean
  areas: Area[]
  activeExample: string
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

  Module scope, because the screen unmounts on navigation and a ref inside it
  cannot tell a fresh request from one that outlived the previous visit. The
  energy screen carries the same value for the same reason.
*/
let lastHandledOpenNonce = 0

export function FloodScreen(props: FloodScreenProps) {
  const [setupOpen, setSetupOpen] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [resultOpen, setResultOpen] = useState(false)

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
    A run that finishes is the one moment the reader is certainly asking for
    the result, so the column opens on it; clearing the result folds it away
    rather than leaving an empty column on the edge.
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
        activeExample={props.activeExample}
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
        {/* Carried here as well as on the result: what a HAND threshold is and
            whose envelope this is have to be readable before the run as much
            as after it. */}
        <p className="text-meta leading-relaxed text-muted-foreground">
          {FLOOD_QUALIFIER}
        </p>
      </PanelSection>
    </PanelShell>
  )

  return (
    <div className="relative h-full min-h-0 w-full">
      {/*
        Full bleed. The run draws nothing here -- the agreement raster is read
        with its legend in the result column -- and the map still carries the
        AOI the whole measurement is over, so it stays rather than being
        swapped for an empty state.
      */}
      <MapView
        initialView={props.initialView}
        areas={props.areas}
        activeExample={props.activeExample}
        customPolygon={props.customPolygon}
        onPolygonDrawn={props.onPolygonDrawn}
        flyTo={props.flyTo}
        // The classification chrome is pinned off, as on the energy screen:
        // there is no prediction here to weigh against, so a confidence toggle
        // or a swipe compare would offer a comparison with nothing.
        result={null}
        overlayOpacity={1}
        showConfidence={false}
        confidenceOnTop={false}
        smoothOverlay={false}
        showPredictionOverlay={false}
        showCompositionOverlay={false}
        composition={null}
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
