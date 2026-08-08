import { useState } from "react"
import { AnimatePresence } from "motion/react"
import type {
  Area,
  CompositionOverlay,
  CompositeIndex,
  CompositeKind,
  DataCubeResult,
  DataCubeScene,
  GeoJSONGeometry,
  ModelKind,
  PredictResult,
  WaterAnalysis,
  WaterIndex,
} from "@/lib/types"
import type { AoiContourSchemeId } from "@/lib/aoiStyle"
import { MapView } from "@/components/MapView"
import { SearchBar } from "@/components/SearchBar"
import { ControlPanel } from "@/components/ControlPanel"
import { CompositionPanel } from "@/components/CompositionPanel"
import { WaterPanel } from "@/components/WaterPanel"
import { WaterStatusPanel } from "@/components/WaterStatusPanel"
import type { MapToolId } from "@/lib/mapTools"
import { ResultsPanel } from "@/components/ResultsPanel"
import { CompositionStatusPanel } from "@/components/CompositionStatusPanel"
import { DataCubeModal } from "@/components/DataCubeModal"
import { ConfidenceLegend } from "@/components/ConfidenceLegend"
import {
  OverlayToolsButton,
  OverlayToolsPanel,
} from "@/components/OverlayToolsPanel"

export interface MapScreenProps {
  /** Where the map was left last session; null starts at the default view. */
  initialView?: { lat: number; lon: number; zoom: number } | null
  /** Open tool tab, owned by the caller so it survives this screen unmounting. */
  leftPanel: MapToolId | null
  onLeftPanelChange: (id: MapToolId | null) => void
  areas: Area[]
  activeExample: string
  customPolygon: GeoJSONGeometry | null
  flyTo: { lat: number; lon: number; key: number } | null
  result: PredictResult | null
  overlayOpacity: number
  showConfidence: boolean
  confidenceOnTop: boolean
  smoothOverlay: boolean
  showPredictionOverlay: boolean
  showCompositionOverlay: boolean
  composition: CompositionOverlay | null
  /** Session gallery of applied compositions (newest first). */
  compositionGallery?: CompositionOverlay[]
  onSelectComposition?: (id: string) => void
  onRemoveComposition?: (id: string) => void
  swipeCompare: boolean
  swipeRatio: number
  areaLabel?: string
  onAreaLabelChange: (label: string) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void
  hasArea: boolean
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  mode: "single" | "temporal"
  modelKind: ModelKind
  prithviMode: "pixel" | "patch"
  running: boolean
  progress: number
  progressMsg: string
  composeRunning: boolean
  composeProgress: number
  composeProgressMsg: string
  composeScenes: DataCubeScene[]
  composeScenesLoading: boolean
  composeScenesError: string | null
  selectedSceneId: string
  composeKind: CompositeKind
  composeBands: [string, string, string]
  composeIndex: CompositeIndex
  composeStretchLow: number
  composeStretchHigh: number
  composeOpacity: number
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onSelectExample: (id: string) => void
  onLocationSelect: (lat: number, lon: number) => void
  onClearArea: () => void
  onImportPolygon: () => void
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  onMaxCloudChange: (v: number) => void
  onMonthlyBestChange: (v: boolean) => void
  onModeChange: (m: "single" | "temporal") => void
  onModelKindChange: (m: ModelKind) => void
  onPrithviModeChange: (m: "pixel" | "patch") => void
  onOpacityChange: (v: number) => void
  onShowConfidenceChange: (v: boolean) => void
  onConfidenceOnTopChange: (v: boolean) => void
  onSmoothOverlayChange: (v: boolean) => void
  onShowPredictionOverlayChange: (v: boolean) => void
  onShowCompositionOverlayChange: (v: boolean) => void
  onSelectScene: (id: string) => void
  onComposeKindChange: (k: CompositeKind) => void
  onComposeBandsChange: (b: [string, string, string]) => void
  onComposeIndexChange: (i: CompositeIndex) => void
  onComposeStretchChange: (low: number, high: number) => void
  onComposeOpacityChange: (v: number) => void
  onListComposeScenes: () => void
  onApplyComposition: () => void
  onClearComposition: () => void
  onSwipeCompareChange: (v: boolean) => void
  onSwipeRatioChange: (v: number) => void
  onRun: () => void
  onAnalyzeLULC: () => void
  lulcRunning?: boolean
  onCloseResult: () => void
  onNewClassification: () => void
  onViewDataCube: () => void
  dataCubeLoading?: boolean
  dataCubeOpen?: boolean
  dataCubeError?: string | null
  dataCubeResult?: DataCubeResult | null
  onCloseDataCube: () => void
  water?: WaterAnalysis | null
  waterIndex: WaterIndex
  waterRunning: boolean
  waterProgress: number
  waterProgressMsg: string
  showWaterOverlay: boolean
  onWaterIndexChange: (i: WaterIndex) => void
  onRunWater: () => void
  onClearWater: () => void
  onShowWaterOverlayChange: (v: boolean) => void
  waterOpacity: number
  onWaterOpacityChange: (v: number) => void
}

export function MapScreen(props: MapScreenProps) {
  // Held by the caller, not here. This screen is unmounted whenever the user
  // goes to another one, so local state put the dock back on "classify" on
  // every return -- including a return from a water run, which left a water
  // raster on the map with the classification panel open beside it.
  const { leftPanel, onLeftPanelChange } = props
  const [overlayToolsOpen, setOverlayToolsOpen] = useState(false)
  // The panel sits against the navigation column now that the tool rail is
  // gone: the column lists the same three tools and is always visible, so a
  // floating strip repeating them was a second answer to one question.
  const panelOffsetClass = "left-3"
  const setLeftPanel = onLeftPanelChange

  // The three status panels share one slot at the bottom of the map, so only
  // the one matching the open tool is shown. Water keeps its own rule: with no
  // classification to compete for the slot it takes it whatever tab is open,
  // because this screen is remounted on every return from the analysis page,
  // which resets the tab to classify and would otherwise leave a restored water
  // raster on the map with nothing naming it and no way to clear it.
  //
  // The solar chain used to sit above water here and to gate the two below it.
  // Its rasters are now drawn on the energy screen, which names and clears them
  // beside the run that produced them, so nothing on this map can be a solar
  // layer and the gate had no case left to exclude.
  const showWaterStatus =
    (leftPanel === "water" || !props.result) && !!props.water
  const showCompositionStatus =
    !showWaterStatus &&
    (leftPanel === "compose" || (!props.result && !!props.composition))
  const showPredictionStatus =
    !showWaterStatus && !showCompositionStatus && !!props.result

  const selectedSceneDate =
    props.composeScenes.find((s) => s.id === props.selectedSceneId)?.date ??
    null

  return (
    <div className="relative h-full min-h-0 w-full">
      <MapView
        initialView={props.initialView}
        areas={props.areas}
        activeExample={props.activeExample}
        customPolygon={props.customPolygon}
        onPolygonDrawn={props.onPolygonDrawn}
        onSelectExample={props.onSelectExample}
        flyTo={props.flyTo}
        result={props.result}
        overlayOpacity={props.overlayOpacity}
        showConfidence={props.showConfidence}
        confidenceOnTop={props.confidenceOnTop}
        smoothOverlay={props.smoothOverlay}
        showPredictionOverlay={props.showPredictionOverlay}
        showCompositionOverlay={props.showCompositionOverlay}
        composition={props.composition}
        waterOverlay={
          props.water && props.showWaterOverlay
            ? {
                uri: props.water.occurrence_uri,
                extent: props.water.extent,
                opacity: props.waterOpacity,
              }
            : null
        }
        swipeCompare={props.swipeCompare}
        swipeRatio={props.swipeRatio}
        onSwipeRatioChange={props.onSwipeRatioChange}
        areaLabel={props.areaLabel}
        onAreaLabelChange={props.onAreaLabelChange}
        aoiContourScheme={props.aoiContourScheme}
        onAoiContourSchemeChange={props.onAoiContourSchemeChange}
        onClearArea={props.onClearArea}
        onViewChange={props.onViewChange}
      />

      <SearchBar onSelectLocation={props.onLocationSelect} />

      <OverlayToolsButton
        active={overlayToolsOpen}
        onClick={() => setOverlayToolsOpen((o) => !o)}
      />
      <OverlayToolsPanel
        open={overlayToolsOpen}
        onClose={() => setOverlayToolsOpen(false)}
        result={props.result}
        composition={props.composition}
        compositionGallery={props.compositionGallery ?? []}
        onSelectComposition={props.onSelectComposition}
        onRemoveComposition={props.onRemoveComposition}
        areaLabel={props.areaLabel}
        modelKind={props.modelKind}
        composeSceneDate={
          props.composeScenes.find((s) => s.id === props.selectedSceneId)
            ?.date ?? null
        }
        showPredictionOverlay={props.showPredictionOverlay}
        onShowPredictionOverlayChange={props.onShowPredictionOverlayChange}
        showCompositionOverlay={props.showCompositionOverlay}
        onShowCompositionOverlayChange={props.onShowCompositionOverlayChange}
        water={props.water}
        showWaterOverlay={props.showWaterOverlay}
        onShowWaterOverlayChange={props.onShowWaterOverlayChange}
        waterOpacity={props.waterOpacity}
        onWaterOpacityChange={props.onWaterOpacityChange}
        showConfidence={props.showConfidence}
        onShowConfidenceChange={props.onShowConfidenceChange}
        confidenceOnTop={props.confidenceOnTop}
        onConfidenceOnTopChange={props.onConfidenceOnTopChange}
        smoothOverlay={props.smoothOverlay}
        onSmoothOverlayChange={props.onSmoothOverlayChange}
        swipeCompare={props.swipeCompare}
        onSwipeCompareChange={props.onSwipeCompareChange}
        overlayOpacity={props.overlayOpacity}
        onOverlayOpacityChange={props.onOpacityChange}
        composeOpacity={props.composeOpacity}
        onComposeOpacityChange={props.onComposeOpacityChange}
        aoiContourScheme={props.aoiContourScheme}
        onAoiContourSchemeChange={props.onAoiContourSchemeChange}
      />

      <ConfidenceLegend
        visible={
          !!props.showConfidence &&
          !!props.result?.confidence_uri &&
          (props.result.n_dates ?? 0) > 0
        }
      />

      <AnimatePresence mode="wait" initial={false}>
        {leftPanel === "classify" ? (
          <ControlPanel
            key="classify"
            panelOffsetClass={panelOffsetClass}
            areas={props.areas}
            activeExample={props.activeExample}
            onSelectExample={props.onSelectExample}
            customPolygon={props.customPolygon}
            hasArea={props.hasArea}
            onClearArea={props.onClearArea}
            onImportPolygon={props.onImportPolygon}
            start={props.start}
            end={props.end}
            onStartChange={props.onStartChange}
            onEndChange={props.onEndChange}
            maxCloud={props.maxCloud}
            onMaxCloudChange={props.onMaxCloudChange}
            monthlyBest={props.monthlyBest}
            onMonthlyBestChange={props.onMonthlyBestChange}
            mode={props.mode}
            onModeChange={props.onModeChange}
            modelKind={props.modelKind}
            onModelKindChange={props.onModelKindChange}
            prithviMode={props.prithviMode}
            onPrithviModeChange={props.onPrithviModeChange}
            running={props.running}
            progress={props.progress}
            progressMsg={props.progressMsg}
            onRun={props.onRun}
            onAnalyzeLULC={props.onAnalyzeLULC}
            onViewDataCube={props.onViewDataCube}
            lulcRunning={props.lulcRunning}
            dataCubeLoading={props.dataCubeLoading}
            onCollapse={() => setLeftPanel(null)}
          />
        ) : leftPanel === "water" ? (
          <WaterPanel
            key="water"
            panelOffsetClass={panelOffsetClass}
            hasArea={props.hasArea}
            start={props.start}
            end={props.end}
            onStartChange={props.onStartChange}
            onEndChange={props.onEndChange}
            maxCloud={props.maxCloud}
            onMaxCloudChange={props.onMaxCloudChange}
            monthlyBest={props.monthlyBest}
            onMonthlyBestChange={props.onMonthlyBestChange}
            index={props.waterIndex}
            onIndexChange={props.onWaterIndexChange}
            running={props.waterRunning}
            progress={props.waterProgress}
            progressMsg={props.waterProgressMsg}
            hasResult={!!props.water}
            onRun={props.onRunWater}
            onClear={props.onClearWater}
            onCollapse={() => setLeftPanel(null)}
          />
        ) : leftPanel === "compose" ? (
          <CompositionPanel
            key="compose"
            panelOffsetClass={panelOffsetClass}
            hasArea={props.hasArea}
            start={props.start}
            end={props.end}
            onStartChange={props.onStartChange}
            onEndChange={props.onEndChange}
            maxCloud={props.maxCloud}
            onMaxCloudChange={props.onMaxCloudChange}
            monthlyBest={props.monthlyBest}
            onMonthlyBestChange={props.onMonthlyBestChange}
            scenes={props.composeScenes}
            scenesLoading={props.composeScenesLoading}
            scenesError={props.composeScenesError}
            selectedSceneId={props.selectedSceneId}
            onSelectScene={props.onSelectScene}
            onListScenes={props.onListComposeScenes}
            kind={props.composeKind}
            onKindChange={props.onComposeKindChange}
            bands={props.composeBands}
            onBandsChange={props.onComposeBandsChange}
            index={props.composeIndex}
            onIndexChange={props.onComposeIndexChange}
            stretchLow={props.composeStretchLow}
            stretchHigh={props.composeStretchHigh}
            onStretchChange={props.onComposeStretchChange}
            running={props.composeRunning}
            progress={props.composeProgress}
            progressMsg={props.composeProgressMsg}
            hasOverlay={!!props.composition}
            onApply={props.onApplyComposition}
            onClear={props.onClearComposition}
            onCollapse={() => setLeftPanel(null)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {showWaterStatus ? (
          <WaterStatusPanel
            key="water-status"
            water={props.water ?? null}
            onClear={props.onClearWater}
          />
        ) : showCompositionStatus ? (
          <CompositionStatusPanel
            key="composition-status"
            composition={props.composition}
            sceneDate={selectedSceneDate}
            composeOpacity={props.composeOpacity}
            onClear={props.onClearComposition}
          />
        ) : showPredictionStatus ? (
          <ResultsPanel
            key="prediction-status"
            result={props.result!}
            onClose={props.onCloseResult}
            onNewClassification={props.onNewClassification}
          />
        ) : null}
      </AnimatePresence>

      <DataCubeModal
        open={!!props.dataCubeOpen}
        loading={!!props.dataCubeLoading}
        error={props.dataCubeError ?? null}
        result={props.dataCubeResult ?? null}
        onClose={props.onCloseDataCube}
      />
    </div>
  )
}
