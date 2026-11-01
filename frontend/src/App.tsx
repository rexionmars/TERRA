import { useCallback, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useTheme } from "next-themes"

import { OperatorHost } from "@/components/OperatorHost"
import { ProjectFileHost } from "@/components/ProjectFileHost"
import { SplashScreen } from "@/components/SplashScreen"
import { ThemeSync } from "@/components/ThemeSync"
import { TitleBar } from "@/components/TitleBar"
import { WhatsNewGate } from "@/components/WhatsNewGate"
import { AuthProvider, useAuth } from "@/lib/auth"
import { SCREEN } from "@/lib/motion"
import type { Preferences } from "@/lib/types"
import { AuthPage } from "@/pages/AuthPage"
import { MapShell } from "@/pages/MapShell"
import { ProfilePage } from "@/pages/ProfilePage"
import { useAnalysisResults } from "@/session/analysisResults"
import { useAreaActions } from "@/session/areas"
import { useBootReveal } from "@/session/boot"
import { useClassification } from "@/session/classification"
import { useComposition } from "@/session/composition"
import { useEnvironmentGate } from "@/session/environmentGate"
import { useFieldDelineation } from "@/session/fieldDelineation"
import { useGround } from "@/session/ground"
import { useJobQueue } from "@/session/jobQueue"
import { useMapView } from "@/session/mapView"
import { useMineralMap } from "@/session/mineralMap"
import { useProjectActions } from "@/session/project"
import { useProjectMemory } from "@/session/projectMemory"
import { useRetainedRuns, useRetainOnLeaving } from "@/session/retainedRuns"
import {
  useOverlayDisplay,
  useRunParameters,
  type OverlayDisplayProps,
  type RunParameterProps,
} from "@/session/runParameters"
import { useSharedProgress, useSidecarProgress } from "@/session/runProgress"
import { groundInHand, type RequestContext } from "@/session/runRequests"
import { useSavedRunLoader } from "@/session/savedRun"
import { useSurfaceWater } from "@/session/surfaceWater"
import { useWorkflows } from "@/session/workflows"

function App() {
  const parameters = useRunParameters()
  const display = useOverlayDisplay()
  const { onModelKindChange } = parameters
  const { onOpacityChange } = display
  const { booting, splashExiting } = useBootReveal()
  const { setTheme } = useTheme()

  /**
   * Stored preferences into the controls they own. LOAD ONLY.
   *
   * Called once when preferences arrive, and never as the echo of a save.
   * Every field here is a control the reader can also move by hand, so
   * re-running it after a save overwrites whatever they moved since -- which
   * is what silently put the model picker back on the stored default after any
   * of the five actions that write preferences on their own.
   */
  const applyPrefs = useCallback(
    (p: Preferences) => {
      if (
        p.default_model === "spectral" ||
        p.default_model === "prithvi" ||
        p.default_model === "temporal_transformer"
      ) {
        onModelKindChange(p.default_model)
      }
      if (typeof p.overlay_opacity === "number" && p.overlay_opacity > 0) {
        onOpacityChange(p.overlay_opacity)
      }
      if (p.theme === "dark" || p.theme === "light" || p.theme === "system") {
        setTheme(p.theme)
      }
    },
    [setTheme, onModelKindChange, onOpacityChange]
  )

  return (
    <AuthProvider onPrefsApplied={applyPrefs}>
      <ThemeSync />
      {booting ? (
        <SplashScreen exiting={splashExiting} />
      ) : (
        <div className="app-shell-enter h-full w-full">
          <WhatsNewGate />
          <AppBody parameters={parameters} display={display} />
        </div>
      )}
    </AuthProvider>
  )
}

/**
 * The session: each domain's state and handlers in a hook of `session/`, and how they
 * meet. A hook depends only on those above it, which is what orders them here. Each
 * hands over the slice of MapShellProps it owns.
 */
function AppBody({
  parameters,
  display,
}: {
  parameters: RunParameterProps
  display: OverlayDisplayProps
}) {
  const { screen, projects } = useAuth()
  useEnvironmentGate()

  const memory = useProjectMemory()
  const { activeProjectId, persistAoiLabel } = memory
  const ground = useGround(activeProjectId)
  const {
    customPolygon,
    setCustomPolygon,
    areas,
    activeAreaId,
    setActiveAreaId,
    analysisLabel,
    setAnalysisLabel,
    refreshAreas,
    aoiSignature,
  } = ground
  const mapView = useMapView()
  const { retainedRuns, retainRun, dropRetainedRun, clearRetainedRuns } =
    useRetainedRuns()

  /*
    The saved run on screen, by id.

    The label was the only run identity the frontend held, and a label can be
    renamed. Compositions attach to this, so it has to be the row's own id: a
    composition filed under a renamed label would come loose from its run.

    Null while a run is being made -- the id only exists once the backend has
    saved it -- and null when the result on screen is a live one nobody kept.
  */
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)

  const context: RequestContext = { ...parameters, projectId: activeProjectId }
  const inHand = groundInHand(customPolygon, activeAreaId, analysisLabel)
  const shared = useSharedProgress()
  const setShowPredictionOverlay = display.onShowPredictionOverlayChange

  const composition = useComposition({
    customPolygon,
    activeAreaId,
    activeProjectId,
    currentRunId,
    start: parameters.start,
    end: parameters.end,
    maxCloud: parameters.maxCloud,
    monthlyBest: parameters.monthlyBest,
    setShowPredictionOverlay,
  })
  const water = useSurfaceWater({
    context,
    inHand,
    customPolygon,
    aoiSignature,
    shared,
    setCurrentRunId,
  })
  const mineral = useMineralMap({
    context,
    inHand,
    customPolygon,
    aoiSignature,
    setCurrentRunId,
  })
  const fields = useFieldDelineation({
    context,
    customPolygon,
    activeAreaId,
    areas,
    analysisLabel,
    aoiSignature,
    refreshAreas,
    setCurrentRunId,
  })
  useSidecarProgress([mineral.channel, fields.channel], shared)
  const classification = useClassification({
    context,
    inHand,
    customPolygon,
    analysisLabel,
    setAnalysisLabel,
    activeProjectId,
    setShowPredictionOverlay,
    shared,
    retainRun,
    setCurrentRunId,
  })

  const { clearAnalysisResults, resultWithWater } = useAnalysisResults({
    result: classification.result,
    water: water.water,
    mineral: mineral.mineral,
    fields: fields.fields,
    currentRunId,
    setResult: classification.setResult,
    setCurrentRunId,
    setWater: water.setWater,
    setMineral: mineral.setMineral,
    setFields: fields.setFields,
  })
  const forgetLeaving = useRetainOnLeaving({ activeAreaId, resultWithWater, retainRun })

  const areaActions = useAreaActions({
    ground,
    activeProjectId,
    persistAoiLabel,
    takeCompositionOffMap: composition.takeOffMap,
    forgetCompositions: composition.forgetAll,
  })
  const queueJobs = useJobQueue({
    context,
    areas,
    activeAreaId,
    liveSelection: areaActions.liveSelection,
    waterIndex: water.waterIndex,
    mineralOptions: mineral.mineralOptions,
  })
  const activateProject = useProjectActions({
    analysisLabel,
    setAnalysisLabel,
    setActiveProjectId: memory.setActiveProjectId,
    setActiveAreaId,
    setCustomPolygon,
    activeProjectIdRef: memory.activeProjectIdRef,
    pendingActiveProjectRef: memory.pendingActiveProjectRef,
    persistActiveProjectId: memory.persistActiveProjectId,
    persistAoiLabel,
    clearAnalysisResults,
    clearRetainedRuns,
    clearGallery: composition.clearGallery,
    loadGallery: composition.loadGallery,
    setShowCompositionOverlay: composition.setShowCompositionOverlay,
  })
  const { openSavedAnalysis, loadingRun } = useSavedRunLoader({
    areas,
    analysisLabel,
    setAnalysisLabel,
    setCustomPolygon,
    setActiveAreaId,
    setResult: classification.setResult,
    setCurrentRunId,
    setShowPredictionOverlay,
    setModelKind: parameters.onModelKindChange,
    persistAoiLabel,
    restoreWater: water.restore,
    restoreMineral: mineral.restore,
    restoreFields: fields.restore,
  })
  const workflows = useWorkflows({
    activeProjectId,
    clearRetainedRuns,
    clearAnalysisResults,
    clearAreaAndComposition: areaActions.clearAreaAndComposition,
    forgetLeaving,
    setShowPredictionOverlay,
  })

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app text-foreground">
      {screen !== "map" && <TitleBar />}
      {/* The keymap and the operator search, on every screen. */}
      <OperatorHost />
      {/* Project files: opening, saving, and what the Finder hands over. */}
      <ProjectFileHost
        activeProjectId={activeProjectId}
        onActivateProject={activateProject}
      />

      <div className="flex min-h-0 flex-1">
        {/*
          NO NAVIGATION COLUMN. There is one destination that is work.

          The column named five, four of which were screens the studio has
          since absorbed -- the map it grew out of, three product screens that
          became cards on the run band before those products were removed, and
          the project hub, whose management moved into the studio itself. What
          was left named the studio, and a list of one is not navigation.

          Settings and sign-in are reached from the title bar, which is where
          an account control belongs and where this column had put it too.
        */}
        <div className="relative min-h-0 min-w-0 flex-1">
          {/*
            NOT mode="wait". Under it the leaving screen has to finish its exit
            before the arriving one is allowed to mount, so every change of
            screen was 240ms of an empty stage followed by the mount -- and the
            mount is the expensive half, since a screen here builds a map, its
            overlays and sometimes the studio. Serialised by construction, and
            felt as the transition being slow rather than as the animation being
            long.

            Without it the two overlap. They are both `absolute inset-0`, so
            overlapping is what the layout already expects, and the arriving
            screen starts building at the moment it is asked for.
          */}
          <AnimatePresence initial={false}>
            {screen === "map" && (
              <motion.div
                key="screen-map"
                className="absolute inset-0 min-h-0"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={SCREEN}
              >
                <MapShell
                  {...parameters}
                  {...display}
                  {...areaActions.props}
                  {...classification.props}
                  {...composition.props}
                  {...water.props}
                  {...mineral.props}
                  {...fields.props}
                  {...workflows.props}
                  {...mapView}
                  activeProjectId={activeProjectId}
                  activeProjectName={
                    projects.find((p) => p.id === activeProjectId)?.name ?? null
                  }
                  onActivateProject={(id) => void activateProject(id)}
                  onOpenReading={openSavedAnalysis}
                  onQueueJobs={(kind) => void queueJobs(kind)}
                  retainedRuns={retainedRuns}
                  onDropRetainedRun={dropRetainedRun}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {screen === "auth" && <AuthPage />}
          {screen === "profile" && (
            <ProfilePage loadingRun={loadingRun} onOpenRun={openSavedAnalysis} />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
