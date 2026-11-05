import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"
import { toGlobeArea, type GlobeArea } from "@/components/globe/globeArea"
import { ActivityPanel } from "@/components/shell/ActivityPanel"
import { useMapLayers, useRunAssets } from "@/components/shell/mapLayerState"
import { MapTools } from "@/components/shell/MapTools"
import { RunStatus } from "@/components/shell/RunStatus"
import { useRunsInHand, withRun } from "@/components/shell/runsInHand"
import { useRunWatch } from "@/components/shell/runWatch"
import { useShellNavigation } from "@/components/shell/shellNavigation"
import { useWorkflowBoard } from "@/components/shell/workflowBoard"
import { AreasPanel } from "@/components/shell/AreasPanel"
import { LayersPanel } from "@/components/shell/LayersPanel"
import { PointsPanel, type PointSlot } from "@/components/shell/PointsPanel"
import { ProductsPanel } from "@/components/shell/ProductsPanel"
import type { ClassificationView, ResultProduct } from "@/components/shell/ResultPanel"
import { ShellRail, ShellTopBar, keepRailOpen } from "@/components/shell/ShellChrome"
import { VisualizationPanel } from "@/components/shell/VisualizationPanel"
import { writeBoardMemory } from "@/components/workspace/boardMemory"
import { claimLaunchStart, StartScreen } from "@/components/workspace/StartScreen"
import { WorkflowManager } from "@/components/workspace/WorkflowManager"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import {
  GlobeOverlayMenu,
  type GlobeOverlayTarget,
} from "@/components/workspace/GlobeOverlayMenu"
import { RunOnMapContext } from "@/components/workspace/RunQueue"
import { RunBrowser } from "@/components/workspace/RunBrowser"
import type { Area } from "@/lib/areas"
import { useAppSurfaces } from "@/lib/appSurfaces"
import { useAuth } from "@/lib/auth"
import { geometryBounds } from "@/lib/geometry"
import type { MapPoint } from "@/lib/mapProbe"
import { countJobs, takeFinished, useJobs, type JobKind } from "@/lib/jobs"
import { notifyError } from "@/lib/notify"
import { mergePreferenceExtras, parsePreferenceExtras } from "@/lib/preferenceExtras"
import { openProjectFile } from "@/lib/projectFiles"
import { useReports } from "@/lib/reports"
import { cn } from "@/lib/utils"
import { useOperators } from "@/lib/operators"
import { jobReadingOf, type JobReading } from "@/lib/shellLayers"
import type { BoardToolId } from "@/lib/mapTools"
import type { AreaProps } from "@/session/areas"
import type { ClassificationProps } from "@/session/classification"
import type { CompositionProps } from "@/session/composition"
import type { FieldDelineationProps } from "@/session/fieldDelineation"
import type { MineralMapProps } from "@/session/mineralMap"
import type { OverlayDisplayProps, RunParameterProps } from "@/session/runParameters"
import type { SurfaceWaterProps } from "@/session/surfaceWater"
import type { WorkflowProps } from "@/session/workflows"
import { DEFAULT_MINERAL_RUN_OPTIONS } from "@/lib/mineral"
import type { Bounds, InferenceRun, PredictResult } from "@/lib/types"
import { ListProjectRuns } from "../../wailsjs/go/main/App"

/*
  Lazy: MapLibre is 945 kB, and the result panel
  brings the agreement figures, which a reader who has run nothing has no use for.
*/
const GlobeSurface = lazy(() =>
  import("@/components/globe/GlobeSurface").then((m) => ({ default: m.GlobeSurface }))
)
const ResultPanel = lazy(() =>
  import("@/components/shell/ResultPanel").then((m) => ({ default: m.ResultPanel }))
)
const CompareScreen = lazy(() =>
  import("@/components/shell/CompareScreen").then((m) => ({ default: m.CompareScreen }))
)
const WorkflowsScreen = lazy(() =>
  import("@/components/shell/WorkflowsScreen").then((m) => ({
    default: m.WorkflowsScreen,
  }))
)

/**
 * The whole contract between App and the surface it draws: App owns the parameters,
 * the handlers and the results, and each hook of `session/` says what it hands over.
 */
export interface MapShellProps
  extends
    RunParameterProps,
    OverlayDisplayProps,
    AreaProps,
    ClassificationProps,
    CompositionProps,
    SurfaceWaterProps,
    MineralMapProps,
    FieldDelineationProps,
    WorkflowProps {
  /** Where the map was left last session; null starts at the default view. */
  initialView?: { lat: number; lon: number; zoom: number } | null
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
  /** Results the map finished with, still in hand for Compare and Workflows. */
  retainedRuns: readonly { id: string; result: PredictResult }[]
  /** Let go of one. */
  onDropRetainedRun?: (id: string) => void
  activeProjectId?: string | null
  /** File new runs under another project, offered by the browser per project. */
  onActivateProject?: (id: string) => void
  activeProjectName?: string | null
  /** Load a saved run as the live one, and hand it back. */
  onOpenReading?: (run: InferenceRun) => void | Promise<PredictResult | null>
  onQueueJobs?: (kind: JobKind) => void
}

/** The panel's width, and the tool column's, as the camera has to clear them. */
const PANEL_CLEARANCE_PX = 480
const WIDE_PANEL_CLEARANCE_PX = 768

/**
 * The application as a map with panels held up in front of it.
 *
 * App owns the parameters, the handlers and
 * the results; what is here is how they are drawn.
 *
 * THE STATE THAT IS HERE is the state of this surface: which panel is open, which
 * product it shows, how each mineral and field raster is set. The last two sit
 * here because nothing above draws them.
 */
export function MapShell(props: MapShellProps) {
  const { projects, prefs, savePrefs, runs: savedRuns } = useAuth()
  const app = useAppSurfaces()
  /*
    The surfaces the Options menu opens, by name as well: F3 lists them, and with no
    owner here it would list them as unavailable.
  */
  useOperators({
    SPLASH: { run: app.items.splash.onSelect },
    RELEASE_NOTES: { run: app.items.releaseNotes.onSelect },
    ENVIRONMENT: { run: app.items.environment.onSelect },
    STORAGE: {
      run: app.items.storage.onSelect,
      poll: () => (app.items.storage.disabled ? "Still measuring" : true),
    },
    ABOUT: { run: app.items.about.onSelect },
  })
  const pageRef = useRef<HTMLDivElement>(null)

  const nav = useShellNavigation()
  const {
    startOpen,
    setStartOpen,
    destination,
    setDestination,
    compareOpened,
    workflowsOpened,
    analysesOpened,
    goAnalyses,
    goCompare,
    goWorkflows,
    railOpen,
    setRailOpen,
    panel,
    setPanel,
    togglePanel,
  } = nav
  /*
    How many reports had been read when the activity panel was last open, so the
    rail can say there is something new. A count and not a flag: the log only
    grows while a session lasts, and clearing it leaves nothing to announce.
  */
  const reports = useReports()
  const [seenReports, setSeenReports] = useState(0)
  const [product, setProduct] = useState<BoardToolId | null>(null)
  const [frame, setFrame] = useState<{ key: number; bounds: Bounds } | null>(null)
  const [coords, setCoords] = useState(props.initialView ?? null)
  const [spreadM, setSpreadM] = useState(0)
  /*
    A queued product's run, which App holds no state for: it reads a classification,
    water, a mineral map and a delineation.
  */
  const [job, setJob] = useState<JobReading | null>(null)
  const [resultView, setResultView] = useState<ClassificationView>("summary")
  const [resultFocus, setResultFocus] = useState<ResultProduct | null>(null)
  const [points, setPoints] = useState<Partial<Record<PointSlot, MapPoint>>>({})
  const [placing, setPlacing] = useState<PointSlot | null>(null)
  /** The area of the saved analysis being opened, while it loads. */
  const [opening, setOpening] = useState<string | null>(null)
  const openingRef = useRef(false)
  const [overlayMenu, setOverlayMenu] = useState<GlobeOverlayTarget | null>(null)
  const areas = useMemo<readonly Area[]>(() => props.areas ?? [], [props.areas])

  /** Choosing an area also goes to it, which a press on the map has no need to do. */
  const pickArea = (area: Area) => {
    props.onActivateArea?.(area.id)
    const b = geometryBounds(area.geometry)
    if (!b) return
    setFrame({
      key: Date.now(),
      bounds: {
        lon_min: b.lonMin,
        lat_min: b.latMin,
        lon_max: b.lonMax,
        lat_max: b.latMax,
      },
    })
  }

  const areaId = props.activeAreaId ?? "current"
  const areaName =
    areas.find((a) => a.id === props.activeAreaId)?.name ??
    (props.customPolygon ? props.areaLabel || "Drawn area" : "No area")

  const {
    setExtraRuns,
    loadingRuns,
    addRuns,
    session,
    dropRun,
    sessionRunIds,
    fieldSets,
    fieldsTargetOf,
    runRecordOf,
  } = useRunsInHand(props, areas, areaName)

  const {
    assets,
    mineralLayerState,
    fieldLayerState,
    assetLayerState,
    setAssetLayerState,
    showZones,
    changeLayer,
  } = useRunAssets(props, job)

  const board = useWorkflowBoard({
    props,
    assets,
    session,
    loadingRuns,
    addRuns,
    setExtraRuns,
    setJob,
    destination,
    goWorkflows,
    goCompare,
    setStartOpen,
  })
  const {
    compositor,
    setCompositor,
    compositorGlobe,
    setCompositorGlobe,
    savedId,
    setSavedId,
    savedName,
    setSavedName,
    naming,
    setNaming,
    pendingOpen,
    setPendingOpen,
    managing,
    setManaging,
    dirty,
    confirmName,
    askName,
    openWorkflow,
  } = board

  const extras = parsePreferenceExtras(prefs?.extras_json)
  const startAtLaunch = extras.start_screen !== false
  useEffect(() => {
    if (prefs && claimLaunchStart() && startAtLaunch) setStartOpen(true)
    // Once, on the first preferences: the claim makes any later run a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs])

  const { layers, classLayers, overlays } = useMapLayers({
    props,
    assets,
    mineralLayerState,
    fieldLayerState,
    assetLayerState,
    compositor,
    compositorGlobe,
    sessionRunIds,
    areaId,
    areaName,
  })
  /*
    The rasters whose legend the reader took off the map, from the raster's own
    menu. A ramp's legend is drawn beside it by default (mapLayerState says
    why); this is the way to put one away, and to bring it back.
  */
  const [legendsOff, setLegendsOff] = useState<ReadonlySet<string>>(() => new Set())
  const shownOverlays = useMemo(
    () =>
      overlays.map((o) => (legendsOff.has(o.key) ? { ...o, caption: undefined } : o)),
    [overlays, legendsOff]
  )
  const toggleLegend = (key: string) =>
    setLegendsOff((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const pins = useMemo(
    () =>
      (["A", "B"] as const).flatMap((slot) => {
        const p = points[slot]
        return p ? [{ id: slot, label: slot, lon: p.lon, lat: p.lat }] : []
      }),
    [points]
  )
  const placePin =
    panel === "points" && placing
      ? (lon: number, lat: number) => {
          setPoints((held) => ({ ...held, [placing]: { lon, lat } }))
          setPlacing(null)
        }
      : null

  const removeResult = (product: ResultProduct) => {
    switch (product) {
      case "classify":
        props.onCloseResult()
        break
      case "water":
        props.onClearWater()
        break
      case "mineral":
        props.onClearMineral?.()
        break
      case "fields":
        props.onClearFields?.()
        break
      default:
        setJob(null)
        setAssetLayerState({})
    }
  }

  const globeAreas = useMemo<GlobeArea[]>(() => {
    const selected = new Set(props.selectedAreaIds ?? [])
    return areas
      .map((a) => {
        const g = toGlobeArea(`aoi:${a.id}`, a.name, a.geometry, !!a.parent_id)
        return g && selected.has(a.id) ? { ...g, selected: true } : g
      })
      .filter((a): a is GlobeArea => a !== null)
  }, [areas, props.selectedAreaIds])

  // A delineation's polygons while they are only proposed.
  const fieldDrafts = useMemo<GeoJSON.FeatureCollection | null>(() => {
    const f = props.fields
    if (!f?.fields_geojson) return null
    if (f.run_id && areas.some((a) => a.source_run_id === f.run_id)) return null
    try {
      return JSON.parse(f.fields_geojson) as GeoJSON.FeatureCollection
    } catch {
      return null
    }
  }, [props.fields, areas])

  const { running, busy, runLog, wasBusy } = useRunWatch(props, (focus) => {
    setResultFocus(focus)
    setPanel("result")
  })
  /*
    A saved run, opened. App loads it and hands it back, so its queued
    products can be read: one load, not a second one here for what the first
    already fetched and did not keep.
  */
  const openRun = async (run: InferenceRun) => {
    /*
      ONE AT A TIME. The load takes seconds, and a second open started meanwhile
      raced the first for the map and the panel: whichever answered last won,
      which was not always the one pressed last. A ref, because two presses can
      land before a render would show the state.
    */
    if (openingRef.current) return
    openingRef.current = true
    setStartOpen(false)
    // Before the load, since its raster is what the globe frames as it arrives,
    // and so the map says what it is waiting for instead of standing still.
    setOpening(areaNameOf(run))
    setDestination("explore")
    let opened: PredictResult | null | void
    try {
      opened = await props.onOpenReading?.(run)
    } finally {
      openingRef.current = false
      setOpening(null)
    }
    setAssetLayerState({})
    const reading = opened ? jobReadingOf(run.id, areaNameOf(run), opened) : null
    setJob(reading)
    // App keeps no state for these, so the session's list is what holds them.
    if (reading && opened) setExtraRuns((prev) => withRun(prev, run, opened))
    setResultFocus(null)
    setPanel("result")
  }
  const areaNameOf = (run: InferenceRun) =>
    areas.find((a) => a.id === run.area_id)?.name ?? "Run"

  const openRunIds = async (ids: readonly string[]) => {
    const id = ids[ids.length - 1]
    if (!id || !props.activeProjectId) return
    try {
      const runs = await ListProjectRuns(props.activeProjectId, 1000)
      const run = runs.find((r) => r.id === id)
      if (run) await openRun(run)
    } catch (e) {
      notifyError("Could not open the run", e)
    }
  }

  /*
    A queue that has run out opens the last thing it finished. Not each one as it
    finishes: fifty fields would drag the map across the area fifty times while the
    reader is working on something else, and every one of them is saved anyway.
  */
  const jobs = useJobs()
  useEffect(() => {
    const fresh = takeFinished(jobs)
    if (!fresh.length) return
    const { queued, running: going } = countJobs(jobs)
    // Not over a run the reader is watching, which opens its own result when it ends.
    if (queued + going === 0 && !busy) void openRunIds(fresh.map((j) => j.run_id))
    // Read once per change of the queue; the rest is only what opening needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  /*
    What the camera has to clear. The ref is read here on purpose: a finishing
    run's raster arrives in the render before the effect above opens its panel,
    and that raster is what the globe frames, so waiting for the panel would put
    it behind one.
  */
  const rightInsetPx =
    panel === "result" && resultView !== "summary"
      ? WIDE_PANEL_CLEARANCE_PX
      : panel || busy || opening || wasBusy.current
        ? PANEL_CLEARANCE_PX
        : 80

  useEffect(() => {
    if (panel === "activity") setSeenReports(reports.length)
  }, [panel, reports.length])

  return (
    <div className="absolute inset-0 flex bg-app">
      {app.surfaces}
      <ShellRail
        place={
          destination === "analyses"
            ? "analyses"
            : destination === "compare" || destination === "workflows"
              ? destination
              : panel === "areas"
                ? "areas"
                : panel === "activity"
                  ? "activity"
                  : "explore"
        }
        open={railOpen}
        unseen={reports.length > seenReports}
        onExplore={() => {
          setDestination("explore")
          setPanel((p) => (p === "areas" || p === "activity" ? null : p))
        }}
        onAreas={() => {
          setDestination("explore")
          togglePanel("areas")
        }}
        onAnalyses={goAnalyses}
        onCompare={goCompare}
        onWorkflows={goWorkflows}
        onActivity={() => {
          setDestination("explore")
          togglePanel("activity")
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ShellTopBar
          projectName={props.activeProjectName ?? "No project"}
          projects={projects}
          activeProjectId={props.activeProjectId}
          onActivateProject={props.onActivateProject}
          areas={areas}
          areaName={areaName}
          activeAreaId={props.activeAreaId}
          onPickArea={pickArea}
          railOpen={railOpen}
          onToggleRail={() => {
            keepRailOpen(!railOpen)
            setRailOpen(!railOpen)
          }}
          app={app}
          recentFiles={extras.recent_project_files ?? []}
        />
        <main className="relative min-h-0 min-w-0 flex-1">
          <Suspense fallback={null}>
            <GlobeSurface
              className="h-full w-full"
              areas={globeAreas}
              onPickArea={(id, extend) => {
                const picked = id.slice(id.indexOf(":") + 1)
                if (extend && props.onSelectAreas) {
                  props.onSelectAreas([picked], "toggle")
                } else props.onActivateArea?.(picked)
              }}
              onBoxArea={
                props.onSelectAreas
                  ? (ids) =>
                      props.onSelectAreas?.(
                        ids.map((id) => id.slice(id.indexOf(":") + 1)),
                        "add"
                      )
                  : undefined
              }
              onClearSelection={
                props.selectedAreaIds?.length ? props.onClearSelection : undefined
              }
              polygon={props.customPolygon}
              // Deleting the area also drops what was made over it, as clearing does.
              onPolygonDrawn={(g) =>
                g ? props.onPolygonDrawn(g) : props.onClearArea()
              }
              onOverlayContext={(hits, at) => {
                const entries = hits.flatMap(({ key, fit }) => {
                  const l = layers.find((x) => x.id === key)
                  const hasLegend = !!overlays.find((o) => o.key === key)?.caption
                  return l
                    ? [
                        {
                          key,
                          title: l.title,
                          hasLegend,
                          legendOnMap: hasLegend && !legendsOff.has(key),
                          fit,
                        },
                      ]
                    : []
                })
                if (entries.length) setOverlayMenu({ at, entries })
              }}
              onImportPolygon={props.onImportPolygon}
              overlays={shownOverlays}
              fieldDrafts={fieldDrafts}
              spreadM={spreadM}
              onSpreadChange={setSpreadM}
              initialView={props.initialView}
              onViewChange={(v) => {
                setCoords(v)
                props.onViewChange(v)
              }}
              frame={frame}
              rightInsetPx={rightInsetPx}
              pins={pins}
              onPlacePin={placePin}
              leadingTools={<MapTools panel={panel} togglePanel={togglePanel} />}
            />
          </Suspense>

          {panel === "areas" && (
            <AreasPanel
              areas={areas}
              hasProject={!!props.activeProjectId}
              activeAreaId={props.activeAreaId}
              selectedAreaIds={props.selectedAreaIds}
              onActivate={pickArea}
              onRename={props.onRenameArea}
              onDelete={props.onDeleteArea}
              onSelect={props.onSelectAreas}
              onClearSelection={props.onClearSelection}
              onImport={props.onImportPolygon}
              onPickBoundary={
                props.onPickBoundary
                  ? (name, geometry) => {
                      props.onPickBoundary?.(name, geometry)
                      const b = geometryBounds(geometry)
                      if (b) {
                        setFrame({
                          key: Date.now(),
                          bounds: {
                            lon_min: b.lonMin,
                            lat_min: b.latMin,
                            lon_max: b.lonMax,
                            lat_max: b.latMax,
                          },
                        })
                      }
                    }
                  : undefined
              }
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "products" && (
            <RunOnMapContext.Provider value={(id) => void openRunIds([id])}>
              <ProductsPanel
                {...props}
                mineralOptions={props.mineralOptions ?? DEFAULT_MINERAL_RUN_OPTIONS}
                runLog={runLog}
                product={product}
                onProductChange={setProduct}
                onClose={() => setPanel(null)}
              />
            </RunOnMapContext.Provider>
          )}
          {panel === "visualization" && (
            <VisualizationPanel
              hasArea={props.hasArea}
              start={props.start}
              end={props.end}
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
              onApply={props.onApplyComposition}
              composition={props.composition}
              gallery={props.compositionGallery ?? []}
              assets={assets}
              onSelect={(id) => props.onSelectComposition?.(id)}
              onRemove={(id) => props.onRemoveComposition?.(id)}
              onClearAll={props.onClearComposition}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "result" && (
            <Suspense fallback={null}>
              <ResultPanel
                result={props.result}
                water={props.water}
                mineral={props.mineral}
                fields={props.fields}
                job={job}
                focus={resultFocus}
                view={resultView}
                onViewChange={setResultView}
                areas={areas}
                projectId={props.activeProjectId}
                runLabel={areaName}
                modelKind={props.modelKind}
                polygonGeoJSON={props.polygonGeoJSON}
                onAdoptFields={props.onAdoptFields}
                onPickZones={showZones}
                onRemove={removeResult}
                onClose={() => setPanel(null)}
              />
            </Suspense>
          )}
          {panel === "points" && (
            <PointsPanel
              result={props.result}
              classLayers={classLayers}
              points={points}
              placing={placing}
              onPlacing={setPlacing}
              onClear={(slot) =>
                setPoints((held) => {
                  const next = { ...held }
                  delete next[slot]
                  return next
                })
              }
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "layers" && (
            <LayersPanel
              layers={layers}
              assets={assets}
              smoothOverlay={props.smoothOverlay}
              onSmoothOverlayChange={props.onSmoothOverlayChange}
              confidenceOnTop={props.confidenceOnTop}
              onConfidenceOnTopChange={props.onConfidenceOnTopChange}
              onChange={changeLayer}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "activity" && <ActivityPanel onClose={() => setPanel(null)} />}

          <GlobeOverlayMenu
            target={overlayMenu}
            surface={document.body}
            onClose={() => setOverlayMenu(null)}
            onToggleLegend={toggleLegend}
            onTakeOff={(key) => changeLayer(key, { visible: false })}
          />

          {coords && (
            <span className="telemetry pointer-events-none absolute right-[3.5rem] bottom-3 z-410 rounded-sm bg-[rgb(var(--p-ink)/0.82)] px-2 py-1 text-label text-foreground tabular-nums">
              {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
            </span>
          )}

          {/* Hidden under Products, which shows the same runs in its own form. */}
          {((busy && panel !== "products") || opening) && (
            <RunStatus
              running={busy && panel !== "products" ? running : []}
              opening={opening}
            />
          )}

          {compareOpened && (
            <Suspense fallback={null}>
              <CompareScreen
                hidden={destination !== "compare"}
                runs={session}
                loading={loadingRuns}
                onAddRun={(run) => void addRuns([run])}
                onDropRun={dropRun}
              />
            </Suspense>
          )}

          {workflowsOpened && (
            <Suspense fallback={null}>
              <WorkflowsScreen
                hidden={destination !== "workflows"}
                runs={session}
                liveAssets={assets}
                loading={loadingRuns}
                onAddRun={(run) => void addRuns([run])}
                graph={compositor}
                onChange={setCompositor}
                onGlobe={setCompositorGlobe}
                fieldSets={fieldSets}
                fieldsTargetOf={fieldsTargetOf}
                onAdoptFields={props.onAdoptFields}
                onNeedRuns={(ids) =>
                  void addRuns(
                    ids.flatMap((id) => savedRuns.filter((r) => r.id === id))
                  )
                }
                runRecordOf={runRecordOf}
                saved={!!savedId}
                savedName={savedName}
                studios={props.studios ?? []}
                dirty={dirty}
                naming={naming}
                onNamingChange={setNaming}
                onConfirmName={confirmName}
                onOpenStudio={openWorkflow}
              />
            </Suspense>
          )}

          {managing && (
            <WorkflowManager
              boards={props.studios ?? []}
              openId={savedId}
              onDismiss={() => setManaging(false)}
              onChanged={async () => {
                await props.onStudiosMenu?.()
              }}
              // The work on screen outlived its record, and is still worth keeping.
              onOpenDeleted={() => {
                writeBoardMemory("savedId", null)
                writeBoardMemory("savedName", null)
                setSavedId(null)
                setSavedName(null)
              }}
            />
          )}

          {/* A second destructive act does not get a second way of asking. */}
          {pendingOpen && (
            <ConfirmDelete
              eyebrow="UNSAVED CHANGES"
              title={
                pendingOpen === "new"
                  ? "Start a new workflow?"
                  : `Open "${pendingOpen.name}"?`
              }
              subtitle={`This workflow has changes that were never saved${savedName ? ` to "${savedName}"` : ""}. They cannot be brought back. Cancel and save to keep both.`}
              confirmLabel={
                pendingOpen === "new" ? "Discard and start" : "Discard and open"
              }
              onCancel={() => setPendingOpen(null)}
              onConfirm={() => {
                const next = pendingOpen
                setPendingOpen(null)
                if (next === "new") askName(true)
                else props.onOpenStudio?.(next)
              }}
            />
          )}

          {startOpen && (
            <StartScreen
              onClose={() => setStartOpen(false)}
              studios={props.studios ?? []}
              openStudioId={savedId}
              onOpenStudio={openWorkflow}
              onBrowse={goAnalyses}
              showAtLaunch={startAtLaunch}
              onShowAtLaunchChange={(show) => {
                if (!prefs) return
                void savePrefs(
                  {
                    ...prefs,
                    extras_json: mergePreferenceExtras(prefs.extras_json, {
                      start_screen: show,
                    }),
                  },
                  { silent: true }
                ).catch(() => {
                  /* best-effort, as the other preference writers are */
                })
              }}
              recentFiles={extras.recent_project_files ?? []}
              onOpenFile={openProjectFile}
            />
          )}

          {/* Mounted once visited, so returning finds the folder the reader left open. */}
          {analysesOpened && (
            <div
              ref={pageRef}
              className={cn(
                "app-no-drag absolute inset-0 z-480 flex-col bg-app",
                destination === "analyses" ? "flex" : "hidden"
              )}
            >
              <div className="min-h-0 flex-1">
                <RunBrowser
                  surface={pageRef.current}
                  activeProjectId={props.activeProjectId ?? null}
                  onActivateProject={props.onActivateProject}
                  onOpenRun={(run) => void openRun(run)}
                  onOpenReading={(run) => void openRun(run)}
                  busy={opening !== null}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
