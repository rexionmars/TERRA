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
  LeftDockTabsMode,
  ModelKind,
  PredictResult,
  WaterAnalysis,
  WaterIndex,
  SolarAnalysis,
  SolarTerrainAnalysis,
  SolarSeason,
  SolarSitingAnalysis,
  EnergyModelAnalysis,
  WindAnalysis,
} from "@/lib/types"
import type { AoiContourSchemeId } from "@/lib/aoiStyle"
import { MapView } from "@/components/MapView"
import { SearchBar } from "@/components/SearchBar"
import { ControlPanel } from "@/components/ControlPanel"
import { CompositionPanel } from "@/components/CompositionPanel"
import { WaterPanel } from "@/components/WaterPanel"
import { SolarPanel } from "@/components/SolarPanel"
import { SolarStatusPanel } from "@/components/SolarStatusPanel"
import { WaterStatusPanel } from "@/components/WaterStatusPanel"
import { LeftDockRail, type LeftDockPanel } from "@/components/LeftDockRail"
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
  solar?: SolarAnalysis | null
  solarRunning: boolean
  solarClimYears: number
  solarHourlyYears: number
  solarAzimuth: number
  solarPR: string
  onSolarClimYearsChange: (v: number) => void
  onSolarHourlyYearsChange: (v: number) => void
  onSolarAzimuthChange: (v: number) => void
  onSolarPRChange: (v: string) => void
  onRunSolar: () => void
  onClearSolar: () => void
  solarTerrain?: SolarTerrainAnalysis | null
  solarTerrainRunning: boolean
  showSolarOverlay: boolean
  solarOpacity: number
  onShowSolarOverlayChange: (v: boolean) => void
  onSolarOpacityChange: (v: number) => void
  onRunSolarTerrain: () => void
  onClearSolarTerrain: () => void
  solarSeason: SolarSeason
  onSolarSeasonChange: (v: SolarSeason) => void
  solarSiting?: SolarSitingAnalysis | null
  solarSitingRunning: boolean
  solarSlopeAcceptable: number
  solarSlopeRestrictive: number
  onSolarSlopeAcceptableChange: (v: number) => void
  onSolarSlopeRestrictiveChange: (v: number) => void
  onRunSolarSiting: () => void
  onClearSolarSiting: () => void
  /**
   * The photovoltaic energy model and the wind screening. Neither renders a
   * raster, so neither joins the map overlay chain or the bottom status slot;
   * both are read on the analysis screen and cleared from the panel that runs
   * them.
   */
  energyModel?: EnergyModelAnalysis | null
  energyRunning: boolean
  energyReportingBasis: "year_one" | "lifetime_mean"
  onEnergyReportingBasisChange: (v: "year_one" | "lifetime_mean") => void
  energyDegradationPct: number
  onEnergyDegradationPctChange: (v: number) => void
  energyAnalysisPeriod: number
  onEnergyAnalysisPeriodChange: (v: number) => void
  energyGcrFixed: number
  onEnergyGcrFixedChange: (v: number) => void
  energyGcrTracker: number
  onEnergyGcrTrackerChange: (v: number) => void
  energyTrackerMaxAngle: number
  onEnergyTrackerMaxAngleChange: (v: number) => void
  energyDensityBasis: string
  onEnergyDensityBasisChange: (v: string) => void
  energyBuildableFraction: number
  onEnergyBuildableFractionChange: (v: number) => void
  energyUtcOffset: string
  onEnergyUtcOffsetChange: (v: string) => void
  energyApplyShading: boolean
  onEnergyApplyShadingChange: (v: boolean) => void
  /** AOI-mean share of beam blocked, from a terrain run; null without one. */
  energyShadingMeanPct: number | null
  energyDeclaredLoss: Record<string, number>
  onEnergyDeclaredLossChange: (key: string, pct: number) => void
  energyOptionalLoss: Record<string, number>
  onEnergyOptionalLossChange: (key: string, pct: number) => void
  onRunEnergyModel: () => void
  onClearEnergyModel: () => void
  wind?: WindAnalysis | null
  windRunning: boolean
  windRecordYears: number
  onWindRecordYearsChange: (v: number) => void
  windHubHeight: number
  onWindHubHeightChange: (v: number) => void
  windCalmThreshold: number
  onWindCalmThresholdChange: (v: number) => void
  windRecordMaxFloor: number
  onWindRecordMaxFloorChange: (v: number) => void
  windRoughnessLow: number
  onWindRoughnessLowChange: (v: number) => void
  windRoughnessHigh: number
  onWindRoughnessHighChange: (v: number) => void
  onRunWind: () => void
  onClearWind: () => void
  leftDockTabs?: LeftDockTabsMode
}

export function MapScreen(props: MapScreenProps) {
  const [leftPanel, setLeftPanel] = useState<LeftDockPanel | null>("classify")
  const [overlayToolsOpen, setOverlayToolsOpen] = useState(false)
  const tabsMode = props.leftDockTabs ?? "retracted_only"
  const showDockTabs = tabsMode === "always" || leftPanel === null
  const panelOffsetClass =
    tabsMode === "always" && showDockTabs ? "left-14" : "left-3"

  const selectDock = (id: LeftDockPanel) => {
    setLeftPanel((cur) => (cur === id ? null : id))
  }

  // The four status panels share one slot at the bottom of the map, so only
  // the one matching the open tool is shown. With no classification to compete
  // for the slot the standalone product takes it whatever tab is open: this
  // screen is remounted on every return from the analysis page, which resets
  // the tab to classify and would otherwise leave a restored raster on the map
  // with nothing naming it and no way to clear it.
  //
  // The energy model and the wind screening are deliberately absent from all
  // four predicates: neither draws anything on the map, so there is nothing
  // here for a status panel to name, and adding either would render the solar
  // panel with every field null. Both are cleared from the section that ran
  // them and read on the analysis screen.
  const showSolarStatus =
    (leftPanel === "solar" || !props.result) &&
    (!!props.solar || !!props.solarTerrain || !!props.solarSiting)
  const showWaterStatus =
    !showSolarStatus && (leftPanel === "water" || !props.result) && !!props.water
  const showCompositionStatus =
    !showSolarStatus && !showWaterStatus &&
    (leftPanel === "compose" || (!props.result && !!props.composition))
  const showPredictionStatus =
    !showSolarStatus && !showWaterStatus && !showCompositionStatus && !!props.result

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
        solarOverlay={
          !props.showSolarOverlay
            ? null
            : props.solarSiting
              ? {
                  uri: props.solarSiting.overlay_uri,
                  extent: props.solarSiting.extent,
                  opacity: props.solarOpacity,
                }
              : props.solarTerrain
                ? {
                    uri: props.solarTerrain.overlay_uri,
                    extent: props.solarTerrain.extent,
                    opacity: props.solarOpacity,
                  }
                : null
        }
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
        solar={props.solarSiting ?? props.solarTerrain ?? null}
        showSolarOverlay={props.showSolarOverlay}
        onShowSolarOverlayChange={props.onShowSolarOverlayChange}
        solarOpacity={props.solarOpacity}
        onSolarOpacityChange={props.onSolarOpacityChange}
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

      <AnimatePresence initial={false}>
        {showDockTabs && (
          <LeftDockRail
            key="dock-rail"
            active={leftPanel}
            onSelect={selectDock}
          />
        )}
      </AnimatePresence>

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
        ) : leftPanel === "solar" ? (
          <SolarPanel
            key="solar"
            panelOffsetClass={panelOffsetClass}
            hasArea={props.hasArea}
            climatologyYears={props.solarClimYears}
            onClimatologyYearsChange={props.onSolarClimYearsChange}
            hourlyYears={props.solarHourlyYears}
            onHourlyYearsChange={props.onSolarHourlyYearsChange}
            surfaceAzimuth={props.solarAzimuth}
            onSurfaceAzimuthChange={props.onSolarAzimuthChange}
            performanceRatio={props.solarPR}
            onPerformanceRatioChange={props.onSolarPRChange}
            running={props.solarRunning}
            progress={props.progress}
            progressMsg={props.progressMsg}
            hasResult={!!props.solar}
            onRun={props.onRunSolar}
            onClear={props.onClearSolar}
            terrainRunning={props.solarTerrainRunning}
            hasTerrain={!!props.solarTerrain}
            onRunTerrain={props.onRunSolarTerrain}
            onClearTerrain={props.onClearSolarTerrain}
            season={props.solarSeason}
            onSeasonChange={props.onSolarSeasonChange}
            sitingRunning={props.solarSitingRunning}
            hasSiting={!!props.solarSiting}
            slopeAcceptable={props.solarSlopeAcceptable}
            slopeRestrictive={props.solarSlopeRestrictive}
            onSlopeAcceptableChange={props.onSolarSlopeAcceptableChange}
            onSlopeRestrictiveChange={props.onSolarSlopeRestrictiveChange}
            onRunSiting={props.onRunSolarSiting}
            onClearSiting={props.onClearSolarSiting}
            energyRunning={props.energyRunning}
            hasEnergy={!!props.energyModel}
            energyReportingBasis={props.energyReportingBasis}
            onEnergyReportingBasisChange={props.onEnergyReportingBasisChange}
            energyDegradationPct={props.energyDegradationPct}
            onEnergyDegradationPctChange={props.onEnergyDegradationPctChange}
            energyAnalysisPeriod={props.energyAnalysisPeriod}
            onEnergyAnalysisPeriodChange={props.onEnergyAnalysisPeriodChange}
            energyGcrFixed={props.energyGcrFixed}
            onEnergyGcrFixedChange={props.onEnergyGcrFixedChange}
            energyGcrTracker={props.energyGcrTracker}
            onEnergyGcrTrackerChange={props.onEnergyGcrTrackerChange}
            energyTrackerMaxAngle={props.energyTrackerMaxAngle}
            onEnergyTrackerMaxAngleChange={props.onEnergyTrackerMaxAngleChange}
            energyDensityBasis={props.energyDensityBasis}
            onEnergyDensityBasisChange={props.onEnergyDensityBasisChange}
            energyBuildableFraction={props.energyBuildableFraction}
            onEnergyBuildableFractionChange={
              props.onEnergyBuildableFractionChange
            }
            energyUtcOffset={props.energyUtcOffset}
            onEnergyUtcOffsetChange={props.onEnergyUtcOffsetChange}
            energyApplyShading={props.energyApplyShading}
            onEnergyApplyShadingChange={props.onEnergyApplyShadingChange}
            energyShadingMeanPct={props.energyShadingMeanPct}
            energyDeclaredLoss={props.energyDeclaredLoss}
            onEnergyDeclaredLossChange={props.onEnergyDeclaredLossChange}
            energyOptionalLoss={props.energyOptionalLoss}
            onEnergyOptionalLossChange={props.onEnergyOptionalLossChange}
            onRunEnergy={props.onRunEnergyModel}
            onClearEnergy={props.onClearEnergyModel}
            windRunning={props.windRunning}
            hasWind={!!props.wind}
            windRecordYears={props.windRecordYears}
            onWindRecordYearsChange={props.onWindRecordYearsChange}
            windHubHeight={props.windHubHeight}
            onWindHubHeightChange={props.onWindHubHeightChange}
            windCalmThreshold={props.windCalmThreshold}
            onWindCalmThresholdChange={props.onWindCalmThresholdChange}
            windRecordMaxFloor={props.windRecordMaxFloor}
            onWindRecordMaxFloorChange={props.onWindRecordMaxFloorChange}
            windRoughnessLow={props.windRoughnessLow}
            onWindRoughnessLowChange={props.onWindRoughnessLowChange}
            windRoughnessHigh={props.windRoughnessHigh}
            onWindRoughnessHighChange={props.onWindRoughnessHighChange}
            onRunWind={props.onRunWind}
            onClearWind={props.onClearWind}
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
        {showSolarStatus ? (
          <SolarStatusPanel
            key="solar-status"
            solar={props.solar ?? null}
            terrain={props.solarTerrain ?? null}
            siting={props.solarSiting ?? null}
            onClear={() => {
              props.onClearSolar()
              props.onClearSolarTerrain()
              props.onClearSolarSiting()
            }}
          />
        ) : showWaterStatus ? (
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
