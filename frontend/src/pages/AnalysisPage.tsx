import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  Columns2,
  Download,
  FolderOpen,
  History,
  Map as MapIcon,
  Pencil,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react"
import { notifyError, notifyExportFail, notifyExportOk, notifySuccess } from "@/lib/notify"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { useAuth } from "@/lib/auth"
import type {
  Area,
  EnergyModelAnalysis,
  EnergyCapacityDensity,
  EnergyPlantClass,
  InferenceRun,
  PredictResult,
  Project,
  ProjectOverlay,
  WindAnalysis,
  PowerProvenance,
} from "@/lib/types"
import {
  CreateProject,
  DeleteAnalysis,
  DeleteProject,
  ExportClassification,
  ExportOverlayFile,
  ExportResearchPack,
  ListProjectOverlays,
  ListProjectRuns,
  LoadAnalysis,
  SetRunProject,
} from "../../wailsjs/go/main/App"
import { LulcSection } from "@/components/LulcSection"
import { CompareAnalyses } from "@/components/CompareAnalyses"
import { ProjectsHub } from "@/components/ProjectsHub"
import { ResearchPackModal } from "@/components/ResearchPackModal"
import {
  AnalysisPlotModal,
  type AnalysisPlotAsset,
} from "@/components/AnalysisPlotModal"
import { cn } from "@/lib/utils"
import { displayRunLabel } from "@/lib/aoiLabel"
import { stripResearchPackRasters } from "@/lib/researchPack"
import { compositionCaption, parseOverlayMeta } from "@/lib/projectOverlays"
import { MAPBIOMAS_CLASS_LEGEND } from "@/lib/classPalette"
import {
  PALETTE_STOPS,
  paletteGradient,
  type PaletteName,
} from "@/lib/palettes"
import {
  classifiedAreaHa,
  dominantClass,
  formatHectares,
  modelDisplayName,
  parseRunSummary,
  runSummaryObject,
  solarProductLabel,
} from "@/lib/runSummary"


type ProjectTab = "analyses" | "compositions"

/** Project detail sections, in tab order. Drives the ARIA tabs wiring below. */
const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "analyses", label: "Analyses" },
  { id: "compositions", label: "Band compositions" },
]

/**
 * Display name for a model_kind enum. Shared so the run list and the detail
 * header cannot disagree; the list previously printed the raw enum.
 */
function WaterFigure({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="telemetry mt-0.5 truncate text-sm text-foreground">
        {value}
      </div>
      {sub && (
        <div className="telemetry truncate text-[10px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  )
}

/** Summary JSON of a saved run, or an empty object when there is none. */
// runSummaryObject, solarProductLabel and modelDisplayName live in
// lib/runSummary so the profile page describes a run the same way this one
// does. It had no branch for any of the standalone kinds and rendered a wind
// run's empty acquisition window as a bare arrow.

/**
 * The reporting basis a specific yield was computed on. Year one applies no
 * degradation; the lifetime mean applies the mean factor over the analysis
 * period, which at 0.5 %/yr over 25 years is 0.942. Two runs of the same AOI on
 * the two bases differ by that factor with nothing else to distinguish them, so
 * the row states which one produced its figure.
 */
function reportingBasisLabel(v: unknown): string {
  if (v === "lifetime_mean") return "lifetime-mean basis"
  if (typeof v === "string" && v.trim() && v !== "year_one") return `${v} basis`
  // Absent, not unknown. Only the energy model writes this key; the resource
  // run applies a performance ratio and no degradation term, so its yield is
  // year-one by construction. Returning nothing here left every resource row
  // showing a yield with no basis beside it, which is what the caller below
  // states cannot happen.
  return "year-one basis"
}

/** Headline figures from a saved solar run's summary. */
function solarSummaryLine(summary?: string | null): string {
  if (!summary?.trim()) return "solar resource"
  const j = runSummaryObject(summary)
  const ghi =
    typeof j.ghi_annual_kwh_m2 === "number"
      ? `${j.ghi_annual_kwh_m2.toFixed(0)} kWh/m2/yr`
      : ""
  const tilt =
    typeof j.optimal_tilt_deg === "number"
      ? `tilt ${j.optimal_tilt_deg.toFixed(0)}\u00b0`
      : ""
  const y =
    typeof j.specific_yield === "number"
      ? `${j.specific_yield.toFixed(0)} kWh/kWp/yr`
      : ""
  // The yield is scaled by the reporting basis, so it is never shown alone.
  const basis = y ? reportingBasisLabel(j.reporting_basis) : ""
  return (
    [ghi, tilt, y, basis].filter(Boolean).join(" \u00b7 ") || "solar resource"
  )
}

/**
 * Headline figures from a saved wind run's summary.
 *
 * The capacity factor is gross and carries no external benchmark, so it is
 * never shown without windQualifierLine beside it.
 */
function windSummaryLine(summary?: string | null): string {
  if (!summary?.trim()) return "wind screening"
  const j = runSummaryObject(summary)
  const cf =
    typeof j.wind_gross_capacity_factor_pct === "number"
      ? `gross CF ${j.wind_gross_capacity_factor_pct.toFixed(1)}%`
      : ""
  const speed =
    typeof j.wind_hub_mean_speed_ms === "number"
      ? `${j.wind_hub_mean_speed_ms.toFixed(2)} m/s`
      : ""
  const hub =
    typeof j.wind_hub_height_m === "number"
      ? `${j.wind_hub_height_m.toFixed(0)} m hub`
      : ""
  const at = [speed, hub].filter(Boolean).join(" at ")
  return [cf, at].filter(Boolean).join(" \u00b7 ") || "wind screening"
}

/**
 * The qualifier that travels with a wind capacity factor in the run list.
 *
 * The figure is the published power curve on a modelled free-stream series with
 * no plant loss applied and no comparison against an external wind reference,
 * unlike the photovoltaic ratio, which is benchmarked against the Global Solar
 * Atlas. Listed beside a photovoltaic row without this, it reads as the same
 * kind of number.
 */
function windQualifierLine(summary?: string | null): string {
  const j = runSummaryObject(summary)
  const base = "screening indication, gross of losses, unvalidated"
  if (j.wind_all_checks_passed === false) {
    const n = typeof j.wind_flag_count === "number" ? j.wind_flag_count : 0
    return n > 0
      ? `${base}; ${n} record check${n === 1 ? "" : "s"} did not pass`
      : `${base}; record checks did not pass`
  }
  return base
}

/** The window of record a wind run read, in place of a requested period. */
function windRecordWindow(summary?: string | null): string {
  const w = runSummaryObject(summary).record_window
  return typeof w === "string" ? w.trim() : ""
}

/** Peak water and occurrence areas from a saved water run's summary. */
function waterSummaryLine(summary?: string | null): string {
  if (!summary?.trim()) return "surface water"
  try {
    const j = JSON.parse(summary) as Record<string, unknown>
    const peak =
      typeof j.peak_water_fraction_pct === "number"
        ? `peak ${j.peak_water_fraction_pct.toFixed(1)}%`
        : ""
    const eph =
      typeof j.ephemeral_area_ha === "number"
        ? `${j.ephemeral_area_ha.toFixed(2)} ha ephemeral`
        : ""
    return [peak, eph].filter(Boolean).join(" · ") || "surface water"
  } catch {
    return "surface water"
  }
}

const tabId = (id: ProjectTab) => `project-tab-${id}`
const tabPanelId = (id: ProjectTab) => `project-panel-${id}`

interface AnalysisPageProps {
  result: PredictResult | null
  modelKind: string
  /** Embedded example areas, for resolving project AOIs stored as area_id. */
  areas?: Area[]
  areaLabel?: string
  areaId?: string
  /** Current AOI polygon as GeoJSON text (geometry or Feature). */
  polygonGeoJSON?: string
  loadingRun?: boolean
  onOpenRun: (run: InferenceRun) => Promise<void>
  onBackToList: () => void
  onNewClassification: () => void
  /** Rename the active AOI (same path as map context-menu rename). */
  onAreaLabelChange?: (label: string) => void
  /** Set map active project when opening a project from the hub. */
  onActivateProject?: (projectId: string) => void | Promise<void>
  /** Show a saved band composition on the map (then navigate via goMap). */
  onShowComposition?: (overlay: ProjectOverlay) => void
  /** Currently active project on the map (keeps Analysis list scoped). */
  activeProjectId?: string | null
}

type CompareState = {
  runA: InferenceRun
  runB: InferenceRun
  resultA: PredictResult
  resultB: PredictResult
}

export function AnalysisPage({
  result,
  modelKind,
  areas,
  areaLabel,
  areaId,
  polygonGeoJSON,
  loadingRun,
  onOpenRun,
  onBackToList,
  onNewClassification,
  onAreaLabelChange,
  onActivateProject,
  onShowComposition,
  activeProjectId,
}: AnalysisPageProps) {
  const { goMap, runs, refreshRuns, projects, refreshProjects } = useAuth()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [comparing, setComparing] = useState(false)
  const [hubView, setHubView] = useState<"list" | "detail" | "unassigned">("list")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectRuns, setProjectRuns] = useState<InferenceRun[]>([])
  const [projectOverlays, setProjectOverlays] = useState<ProjectOverlay[]>([])
  const [openedOverlay, setOpenedOverlay] = useState<ProjectOverlay | null>(null)
  /** Project detail sub-view: analyses first; compositions behind a tab. */
  const [projectTab, setProjectTab] = useState<ProjectTab>("analyses")
  const tabRefs = useRef<Partial<Record<ProjectTab, HTMLButtonElement | null>>>(
    {}
  )
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<
    string | null
  >(null)
  const [deletingProject, setDeletingProject] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [hubLoading, setHubLoading] = useState(false)
  const [selectedPlot, setSelectedPlot] = useState<AnalysisPlotAsset | null>(
    null
  )
  const [packOpen, setPackOpen] = useState(false)
  const [renamingTitle, setRenamingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const cancelTitleRenameRef = useRef(false)

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const analysisProject = useMemo(() => {
    const id = activeProjectId || selectedProjectId
    if (!id) return null
    return projects.find((p) => p.id === id) ?? selectedProject
  }, [activeProjectId, selectedProjectId, projects, selectedProject])

  const projectTitle = analysisProject?.name?.trim() || ""

  const unassignedCount = useMemo(
    () => runs.filter((r) => !r.project_id).length,
    [runs]
  )

  const loadProjectDetail = useCallback(async (projectId: string) => {
    setHubLoading(true)
    try {
      const [r, o] = await Promise.all([
        ListProjectRuns(projectId, 50) as unknown as Promise<InferenceRun[]>,
        ListProjectOverlays(projectId) as unknown as Promise<ProjectOverlay[]>,
      ])
      setProjectRuns(r ?? [])
      setProjectOverlays(o ?? [])
    } catch (e) {
      notifyError("Could not load project", e)
      setProjectRuns([])
      setProjectOverlays([])
    } finally {
      setHubLoading(false)
    }
  }, [])

  const loadUnassigned = useCallback(async () => {
    setHubLoading(true)
    try {
      const r = (await ListProjectRuns("", 50)) as unknown as InferenceRun[]
      setProjectRuns(r ?? [])
      setProjectOverlays([])
    } catch (e) {
      notifyError("Could not load unassigned runs", e)
      setProjectRuns([])
    } finally {
      setHubLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeProjectId) {
      setSelectedProjectId(activeProjectId)
      if (hubView === "list" && !result) {
        setHubView("detail")
      }
    }
  }, [activeProjectId]) // eslint-disable-line react-hooks/exhaustive-deps — only react to map project changes

  useEffect(() => {
    if (hubView === "detail" && selectedProjectId) {
      void loadProjectDetail(selectedProjectId)
    } else if (hubView === "unassigned") {
      void loadUnassigned()
    }
  }, [hubView, selectedProjectId, loadProjectDetail, loadUnassigned])

  const [openedRunId, setOpenedRunId] = useState<string | null>(null)

  const handleOpenRun = useCallback(
    async (run: InferenceRun) => {
      setOpenedOverlay(null)
      setOpenedRunId(run.id)
      if (run.project_id) {
        setSelectedProjectId(run.project_id)
        setHubView("detail")
      } else if (!run.project_id && hubView === "detail") {
        // Opening an unassigned run from elsewhere — keep context.
      }
      await onOpenRun(run)
    },
    [onOpenRun, hubView]
  )

  /**
   * Arrow / Home / End navigation across the project tabs, per the ARIA
   * authoring practices tabs pattern. Selection follows focus, which suits a
   * two-tab strip where switching is cheap.
   */
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const current = PROJECT_TABS.findIndex((t) => t.id === projectTab)
      let next: number
      switch (e.key) {
        case "ArrowRight":
          next = (current + 1) % PROJECT_TABS.length
          break
        case "ArrowLeft":
          next = (current - 1 + PROJECT_TABS.length) % PROJECT_TABS.length
          break
        case "Home":
          next = 0
          break
        case "End":
          next = PROJECT_TABS.length - 1
          break
        default:
          return
      }
      e.preventDefault()
      const id = PROJECT_TABS[next].id
      setProjectTab(id)
      tabRefs.current[id]?.focus()
    },
    [projectTab]
  )

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const scopedRuns = useMemo(() => {
    if (hubView === "detail" && selectedProjectId) {
      // Belt-and-suspenders: never mix in legacy/unassigned runs.
      return projectRuns.filter(
        (r) => !r.project_id || r.project_id === selectedProjectId
      )
    }
    if (hubView === "unassigned") {
      return projectRuns.filter((r) => !r.project_id)
    }
    if (selectedProjectId) {
      return runs.filter((r) => r.project_id === selectedProjectId)
    }
    return runs
  }, [hubView, projectRuns, runs, selectedProjectId])

  const panelTitle = useMemo(() => {
    if (hubView === "unassigned") return "Unassigned analyses"
    if (selectedProject) return `Analyses · ${selectedProject.name}`
    return "Saved analyses"
  }, [hubView, selectedProject])

  const startCompare = useCallback(async () => {
    if (selectedIds.length !== 2) return
    const pool = scopedRuns
    const runA = pool.find((r) => r.id === selectedIds[0])
    const runB = pool.find((r) => r.id === selectedIds[1])
    if (!runA || !runB) {
      notifyError("Selected analyses are no longer available")
      return
    }
    setComparing(true)
    try {
      const [resultA, resultB] = await Promise.all([
        LoadAnalysis(runA.id) as unknown as Promise<PredictResult>,
        LoadAnalysis(runB.id) as unknown as Promise<PredictResult>,
      ])
      setCompare({ runA, runB, resultA, resultB })
    } catch (e) {
      notifyError("Compare failed", e)
    } finally {
      setComparing(false)
    }
  }, [scopedRuns, selectedIds])

  const exitCompare = useCallback(() => {
    setCompare(null)
  }, [])

  const swapCompare = useCallback(() => {
    setCompare((prev) => {
      if (!prev) return prev
      return {
        runA: prev.runB,
        runB: prev.runA,
        resultA: prev.resultB,
        resultB: prev.resultA,
      }
    })
  }, [])

  const handleCreateProject = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const p = (await CreateProject(name, "")) as unknown as Project
      await refreshProjects()
      setNewName("")
      setSelectedProjectId(p.id)
      setHubView("detail")
      if (onActivateProject) await onActivateProject(p.id)
      notifySuccess("Project created", name)
    } catch (e) {
      notifyError("Could not create project", e)
    } finally {
      setCreating(false)
    }
  }

  const pendingDeleteProject = useMemo(
    () =>
      pendingDeleteProjectId
        ? projects.find((p) => p.id === pendingDeleteProjectId) ?? null
        : null,
    [pendingDeleteProjectId, projects]
  )

  const handleDeleteProject = async (id: string) => {
    setDeletingProject(true)
    try {
      await DeleteProject(id)
      await refreshProjects()
      await refreshRuns()
      if (selectedProjectId === id) {
        setSelectedProjectId(null)
        setHubView("list")
      }
      setPendingDeleteProjectId(null)
      notifySuccess("Project deleted")
    } catch (e) {
      notifyError("Could not delete project", e)
    } finally {
      setDeletingProject(false)
    }
  }

  const handleDeleteRun = useCallback(
    async (run: InferenceRun) => {
      const label = displayRunLabel(run.label)
      if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return
      try {
        await DeleteAnalysis(run.id)
        await refreshRuns()
        await refreshProjects()
        if (hubView === "detail" && selectedProjectId) {
          await loadProjectDetail(selectedProjectId)
        } else if (hubView === "unassigned") {
          await loadUnassigned()
        }
        clearSelection()
        if (result && openedRunId === run.id) {
          setOpenedRunId(null)
          onBackToList()
        }
        notifySuccess("Analysis deleted")
      } catch (e) {
        notifyError("Could not delete analysis", e)
      }
    },
    [
      refreshRuns,
      refreshProjects,
      hubView,
      selectedProjectId,
      loadProjectDetail,
      loadUnassigned,
      clearSelection,
      result,
      openedRunId,
      onBackToList,
    ]
  )

  const modelLabel = modelDisplayName(modelKind)

  const plotAssets = useMemo((): AnalysisPlotAsset[] => {
    if (!result) return []
    const items: AnalysisPlotAsset[] = []
    if (result.true_color_uri) {
      items.push({
        id: "satellite",
        title: "Satellite · true color",
        uri: result.true_color_uri,
        exportPngName: "terra_true_color.png",
      })
    }
    if (result.ndvi_mean_uri) {
      items.push({
        id: "ndvi",
        title: "NDVI (temporal mean)",
        uri: result.ndvi_mean_uri,
        exportPngName: "terra_ndvi_mean.png",
      })
    }
    if (result.reference_uri) {
      items.push({
        id: "reference",
        title: "MapBiomas reference",
        uri: result.reference_uri,
        exportPngName: "terra_mapbiomas_ref.png",
        showClassLegend: true,
        pixelated: true,
      })
    }
    if (result.overlay_uri) {
      items.push({
        id: "predicted",
        title: `Predicted · ${modelLabel}`,
        uri: result.overlay_uri,
        exportPngName: "terra_prediction.png",
        rasterTif: result.raster_tif || undefined,
        showClassLegend: true,
        pixelated: true,
      })
    }
    if (result.confidence_uri) {
      items.push({
        id: "confidence",
        title: "Confidence",
        uri: result.confidence_uri,
        exportPngName: "terra_confidence.png",
      })
    }
    return items
  }, [result, modelLabel])

  const openPlot = useCallback(
    (id: string) => {
      const hit = plotAssets.find((p) => p.id === id)
      if (hit) setSelectedPlot(hit)
    },
    [plotAssets]
  )

  useEffect(() => {
    if (renamingTitle) titleInputRef.current?.focus()
  }, [renamingTitle])

  if (compare) {
    return (
      <CompareAnalyses
        runA={compare.runA}
        runB={compare.runB}
        resultA={compare.resultA}
        resultB={compare.resultB}
        onBack={exitCompare}
        onSwap={swapCompare}
      />
    )
  }

  const runsPanel = (
    <SavedRunsPanel
      title={panelTitle}
      caption={
        hubView === "detail"
          ? "Classification runs (RF / Temporal Transformer / Prithvi)."
          : hubView === "unassigned"
            ? "Classification runs not yet assigned to a project."
            : undefined
      }
      runs={scopedRuns}
      loading={!!loadingRun || comparing || hubLoading}
      selectedIds={selectedIds}
      onToggleSelect={toggleSelect}
      onClearSelection={clearSelection}
      onCompare={() => void startCompare()}
      comparing={comparing}
      onOpen={handleOpenRun}
      onDelete={(run) => void handleDeleteRun(run)}
      onRefresh={() => {
        void refreshRuns()
        if (hubView === "detail" && selectedProjectId) void loadProjectDetail(selectedProjectId)
        if (hubView === "unassigned") void loadUnassigned()
      }}
      projects={projects}
      onAssignProject={
        hubView === "unassigned"
          ? async (runId, projectId) => {
              try {
                await SetRunProject(runId, projectId)
                await refreshRuns()
                await loadUnassigned()
                await refreshProjects()
                notifySuccess("Assigned to project")
              } catch (e) {
                notifyError("Could not assign run", e)
              }
            }
          : undefined
      }
    />
  )

  if (!result) {
    const hubSelection =
      hubView === "list"
        ? ("all" as const)
        : hubView === "unassigned"
          ? ("unassigned" as const)
          : selectedProjectId ?? "all"

    const hubActions = (
      <>
        <button
          type="button"
          onClick={onNewClassification}
          className="flex h-9 items-center gap-1.5 rounded-sm bg-primary px-4 text-xs font-semibold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          New classification
        </button>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              if (selectedProjectId && onActivateProject) {
                await onActivateProject(selectedProjectId)
              }
              goMap()
            })()
          }}
          className="ar-ghost flex h-9 items-center gap-1.5 rounded-sm border px-4 text-xs text-muted-foreground hover:text-foreground"
        >
          <MapIcon className="h-3.5 w-3.5" />
          Go to map
        </button>
      </>
    )

    return (
      <div className="terra-workspace app-no-drag relative flex h-full min-h-0 flex-col overflow-hidden">
        <ProjectsHub
          projects={projects}
          areas={areas}
          unassignedCount={unassignedCount}
          selection={hubSelection}
          creating={creating}
          newName={newName}
          onNewNameChange={setNewName}
          onCreate={() => void handleCreateProject()}
          onSelectAll={() => {
            setHubView("list")
            setSelectedProjectId(null)
            setOpenedOverlay(null)
            setProjectTab("analyses")
            clearSelection()
          }}
          onOpenProject={(id) => {
            setSelectedProjectId(id)
            setHubView("detail")
            setOpenedOverlay(null)
            setProjectTab("analyses")
            clearSelection()
            void (async () => {
              if (onActivateProject) await onActivateProject(id)
            })()
          }}
          onOpenUnassigned={() => {
            setHubView("unassigned")
            setSelectedProjectId(null)
            setOpenedOverlay(null)
            setProjectTab("analyses")
            clearSelection()
          }}
          headerActions={hubActions}
        >
          {(hubView === "detail" || hubView === "unassigned") && (
            <div className="flex flex-col gap-3">
              {hubView === "detail" && selectedProject && (
                <div className="ar-raised flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    AOI:{" "}
                    {selectedProject.label ||
                      selectedProject.area_id ||
                      (selectedProject.polygon_geojson
                        ? "Custom polygon"
                        : "Not set yet")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (onActivateProject) {
                            await onActivateProject(selectedProject.id)
                          }
                          goMap()
                        })()
                      }}
                      className="ar-ghost flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <MapIcon className="h-3 w-3" />
                      Open on map
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteProjectId(selectedProject.id)}
                      className="ar-ghost flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-destructive"
                      title="Delete project (runs become unassigned)"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {hubView === "detail" && (
                <div
                  className="ar-raised flex gap-1 p-1"
                  role="tablist"
                  aria-label="Project sections"
                >
                  {PROJECT_TABS.map((tab) => {
                    const active = projectTab === tab.id
                    const count =
                      tab.id === "analyses"
                        ? scopedRuns.length
                        : projectOverlays.length
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={tabId(tab.id)}
                        aria-selected={active}
                        // Only the selected panel is mounted, so pointing at it
                        // from an inactive tab would be a dangling IDREF.
                        // Selection follows focus, so the focused tab always has one.
                        aria-controls={active ? tabPanelId(tab.id) : undefined}
                        // Roving tabindex: the strip is one tab stop, arrows move within it.
                        tabIndex={active ? 0 : -1}
                        ref={(el) => {
                          tabRefs.current[tab.id] = el
                        }}
                        onClick={() => setProjectTab(tab.id)}
                        onKeyDown={handleTabKeyDown}
                        className={cn(
                          "flex h-8 flex-1 items-center justify-center rounded-sm px-3 text-[11px] font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {tab.label}
                        {count > 0 ? (
                          <span className="telemetry ml-1.5 opacity-80">
                            {count}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}

              {hubView === "detail" && projectTab === "compositions" ? (
                <section
                  className="ar-section p-4"
                  role="tabpanel"
                  id={tabPanelId("compositions")}
                  aria-labelledby={tabId("compositions")}
                >
                  <p className="eyebrow mb-1 !text-muted-foreground">
                    Band compositions
                  </p>
                  <p className="mb-3 text-[11px] text-muted-foreground">
                    RGB / indices applied from Compositions on the map. Click a
                    card for a preview modal.
                  </p>
                  {projectOverlays.length === 0 ? (
                    <p className="ar-raised px-3 py-4 text-[11px] text-muted-foreground">
                      No band compositions yet. Apply one on the map while this
                      project is active.
                    </p>
                  ) : (
                    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {projectOverlays.map((o) => (
                        <li key={o.id}>
                          <button
                            type="button"
                            onClick={() => setOpenedOverlay(o)}
                            className="ar-raised group w-full overflow-hidden text-left transition-colors hover:bg-secondary/40"
                          >
                            <div className="ar-inset aspect-square border-0">
                              {o.overlay_uri ? (
                                <img
                                  src={o.overlay_uri}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div className="px-1.5 py-1">
                              <p className="truncate text-[10px] text-foreground group-hover:text-primary">
                                {o.title}
                              </p>
                              {/* Scene date and band triplet identify a
                                  composition; the title alone does not. */}
                              {compositionCaption(o.meta_json) && (
                                <p className="telemetry truncate text-[9px] text-muted-foreground">
                                  {compositionCaption(o.meta_json)}
                                </p>
                              )}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : hubView === "detail" ? (
                // Only a tab panel under the detail view; the unassigned view
                // renders the same list with no tablist above it.
                <div
                  role="tabpanel"
                  id={tabPanelId("analyses")}
                  aria-labelledby={tabId("analyses")}
                >
                  {runsPanel}
                </div>
              ) : (
                runsPanel
              )}
            </div>
          )}
        </ProjectsHub>
        {openedOverlay ? (
          <CompositionOverlayModal
            overlay={openedOverlay}
            projectName={
              (
                projects.find((p) => p.id === openedOverlay.project_id) ??
                selectedProject
              )?.name
            }
            onClose={() => setOpenedOverlay(null)}
            onViewOnMap={() => {
              void (async () => {
                if (onActivateProject) {
                  await onActivateProject(openedOverlay.project_id)
                }
                onShowComposition?.(openedOverlay)
                setOpenedOverlay(null)
                goMap()
              })()
            }}
          />
        ) : null}
        {pendingDeleteProject ? (
          <ConfirmDeleteProjectModal
            project={pendingDeleteProject}
            busy={deletingProject}
            onCancel={() => {
              if (!deletingProject) setPendingDeleteProjectId(null)
            }}
            onConfirm={() => void handleDeleteProject(pendingDeleteProject.id)}
          />
        ) : null}
      </div>
    )
  }

  const viSeries = result.vi_series ?? []
  const states = result.phenology_states ?? []
  const pheno = result.phenology
  const lulc = result.lulc
  const hasClassification = (result.n_dates ?? 0) > 0 || !!result.overlay_uri
  const viChart = viSeries.map((p) => ({
    date: p.date,
    ndvi: p.ndvi_mean,
    evi: p.evi_mean,
    savi: p.savi_mean,
  }))

  const exportTif = async () => {
    if (!result.raster_tif) return
    try {
      const dest = await ExportClassification(result.raster_tif)
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  // Every product that contributes a table or a manifest field. solar_terrain
  // was missing, so an AOI carrying only a terrain run had both export buttons
  // hidden and no way to reach its own manifest.
  const canExportTables =
    !!result.solar ||
    !!result.solar_terrain ||
    !!result.solar_siting ||
    !!result.energy_model ||
    !!result.wind ||
    (result.water?.series?.length ?? 0) > 0 ||
    (result.class_stats?.length ?? 0) > 0 ||
    (result.vi_series?.length ?? 0) > 0 ||
    !!result.lulc ||
    (result.phenology_states?.length ?? 0) > 0 ||
    (result.temporal?.length ?? 0) > 0

  const exportTables = async () => {
    if (!canExportTables) return
    try {
      // Strip bulky data URIs — only tabular fields + raster path are needed.
      // Shared with the research pack modal, which reaches the same binding
      // from the button beside this one and once stripped a shorter list.
      const pack = stripResearchPackRasters(result)
      const dest = await ExportResearchPack(
        {
          model_kind: modelKind,
          area_id: areaId ?? "",
          aoi_label: areaLabel?.trim() || "",
          polygon_geojson: polygonGeoJSON?.trim() || "",
        },
        pack as never
      )
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  const metric = (label: string, value: number | null | undefined, suffix = "") => (
    <div className="ar-raised flex min-h-[4.25rem] flex-col justify-center px-2.5 py-2">
      <div className="eyebrow">{label}</div>
      <div className="telemetry mt-0.5 text-[12px] text-foreground">
        {value == null ? "—" : `${Number(value).toFixed(value % 1 === 0 ? 0 : 2)}${suffix}`}
      </div>
    </div>
  )

  const btnGhost =
    "ar-ghost flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground"

  const startTitleRename = () => {
    if (!onAreaLabelChange) return
    cancelTitleRenameRef.current = false
    setTitleDraft(areaLabel?.trim() || "")
    setRenamingTitle(true)
  }

  const commitTitleRename = () => {
    if (cancelTitleRenameRef.current) {
      cancelTitleRenameRef.current = false
      return
    }
    const next = titleDraft.trim()
    if (next && onAreaLabelChange) {
      onAreaLabelChange(next)
      void refreshRuns()
      if (selectedProjectId) void loadProjectDetail(selectedProjectId)
    }
    setRenamingTitle(false)
  }

  const cancelTitleRename = () => {
    cancelTitleRenameRef.current = true
    setRenamingTitle(false)
    setTitleDraft(areaLabel?.trim() || "")
  }

  return (
    <div className="terra-workspace app-no-drag flex h-full min-h-0 flex-col overflow-hidden">
      <header className="ar-header sticky top-0 z-10 shrink-0 px-5 py-3.5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="telemetry text-[10px] text-primary">ANALYSIS</p>
            <h1 className="mt-0.5 truncate font-display text-xl font-semibold tracking-wide xl:text-2xl">
              {hasClassification ? "Cover map" : "Land cover / land use"}
              {projectTitle ? ` — ${projectTitle}` : ""}
            </h1>
            {renamingTitle ? (
              <form
                className="mt-1.5 flex max-w-xl items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  commitTitleRename()
                }}
              >
                <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                  AOI
                </span>
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault()
                      cancelTitleRename()
                    }
                  }}
                  onBlur={() => commitTitleRename()}
                  maxLength={64}
                  placeholder="Area name"
                  aria-label="AOI name"
                  className="ar-inset min-w-0 flex-1 px-2 py-1 text-sm font-medium text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="submit"
                  className="flex size-8 shrink-0 items-center justify-center rounded-sm text-primary hover:bg-[var(--ar-raised)]"
                  title="Save AOI name"
                >
                  <Check className="size-4" />
                </button>
              </form>
            ) : onAreaLabelChange || areaLabel ? (
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                  AOI
                </span>
                {onAreaLabelChange ? (
                  <button
                    type="button"
                    onClick={startTitleRename}
                    title="Rename AOI"
                    className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-[var(--ar-raised)]"
                  >
                    <span className="truncate text-sm font-medium text-foreground">
                      {areaLabel || "Name this area…"}
                    </span>
                    <Pencil className="size-3 shrink-0 opacity-40 group-hover:opacity-90" />
                  </button>
                ) : (
                  <span className="truncate text-sm font-medium text-foreground">
                    {areaLabel}
                  </span>
                )}
              </div>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {hasClassification ? (
                <>
                  {result.n_dates} scenes
                  {result.date_range?.[0] && result.date_range?.[1]
                    ? ` · ${result.date_range[0]} → ${result.date_range[1]}`
                    : ""}{" "}
                  · {modelLabel}
                  {result.mean_confidence > 0 && (
                    <> · mean conf {(result.mean_confidence * 100).toFixed(0)}%</>
                  )}
                </>
              ) : (
                <>MapBiomas descriptive analysis · no Sentinel classification</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBackToList} className={btnGhost}>
              <ArrowLeft className="h-3 w-3" />
              Saved analyses
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  if (selectedProjectId && onActivateProject) {
                    await onActivateProject(selectedProjectId)
                  }
                  goMap()
                })()
              }}
              className={btnGhost}
            >
              <MapIcon className="h-3 w-3" />
              View on map
            </button>
            <button type="button" onClick={onNewClassification} className={btnGhost}>
              <Plus className="h-3 w-3" />
              New classification
            </button>
            {canExportTables && (
              <button
                type="button"
                onClick={() => setPackOpen(true)}
                className={btnGhost}
              >
                <Table2 className="h-3 w-3" />
                Research pack
              </button>
            )}
            {canExportTables && (
              <button
                type="button"
                onClick={() => void exportTables()}
                className={btnGhost}
              >
                <Download className="h-3 w-3" />
                Export tables
              </button>
            )}
            {hasClassification && result.raster_tif && (
              <button
                type="button"
                onClick={() => void exportTif()}
                className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
              >
                <Download className="h-3 w-3" />
                Export GeoTIFF
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-3 px-5 py-4 sm:px-6 lg:px-8">
          {lulc && <LulcSection lulc={lulc} areaId={areaId} />}

          {hasClassification && (
            <section className="ar-section p-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                <PanelTile
                  title="Satellite · true color"
                  uri={result.true_color_uri}
                  empty="Re-run analysis to capture AOI imagery"
                  onOpen={
                    result.true_color_uri
                      ? () => openPlot("satellite")
                      : undefined
                  }
                />
                <PanelTile
                  title="NDVI (temporal mean)"
                  uri={result.ndvi_mean_uri}
                  empty="NDVI mean unavailable"
                  onOpen={
                    result.ndvi_mean_uri ? () => openPlot("ndvi") : undefined
                  }
                />
                <PanelTile
                  title="MapBiomas reference"
                  uri={result.reference_uri}
                  empty="No MapBiomas for this AOI"
                  onOpen={
                    result.reference_uri
                      ? () => openPlot("reference")
                      : undefined
                  }
                />
                <PanelTile
                  title={`Predicted · ${modelLabel}`}
                  uri={result.overlay_uri}
                  empty="No prediction"
                  onOpen={
                    result.overlay_uri ? () => openPlot("predicted") : undefined
                  }
                />
                <PanelTile
                  title="Confidence"
                  uri={result.confidence_uri}
                  empty="No confidence map"
                  onOpen={
                    result.confidence_uri
                      ? () => openPlot("confidence")
                      : undefined
                  }
                />
              </div>
              <div
                className="mt-3 flex flex-wrap gap-3 border-t pt-3"
                style={{ borderColor: "var(--ar-border)" }}
              >
                {MAPBIOMAS_CLASS_LEGEND.map((c) => (
                  <span
                    key={c.id}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                  >
                    <span
                      className="size-2.5 rounded-[2px]"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.id}: {c.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {(hasClassification && (result.class_stats?.length ?? 0) > 0) ||
          viChart.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
              {hasClassification && (result.class_stats?.length ?? 0) > 0 && (
                <section className="ar-section p-4">
                  <p className="eyebrow mb-3">Predicted class distribution</p>
                  <ul className="flex flex-col gap-1.5">
                    {(result.class_stats ?? []).map((s) => (
                      <li key={s.class_id} className="flex items-center gap-2 text-xs">
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="w-40 shrink-0 truncate sm:w-44">
                          {s.name}
                        </span>
                        <span className="ar-track relative h-1.5 flex-1 overflow-hidden rounded-sm">
                          <span
                            className="absolute inset-y-0 left-0 rounded-sm"
                            style={{
                              width: `${s.pct}%`,
                              backgroundColor: s.color,
                            }}
                          />
                        </span>
                        <span className="telemetry w-12 shrink-0 text-right">
                          {s.pct.toFixed(1)}%
                        </span>
                        <span className="telemetry w-16 shrink-0 text-right text-muted-foreground">
                          {s.area_ha.toFixed(1)} ha
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {viChart.length > 0 && (
                <section className="ar-section p-4">
                  <p className="eyebrow mb-3">Vegetation indices · AOI mean</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={viChart}
                      margin={{ top: 5, right: 12, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="2 4"
                        stroke="var(--ar-border)"
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                        tickFormatter={(d: string) => d.slice(2, 7)}
                        interval="preserveStartEnd"
                        minTickGap={24}
                      />
                      <YAxis
                        domain={[-0.1, 1]}
                        tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--ar-raised)",
                          border: "1px solid var(--ar-border)",
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line
                        type="monotone"
                        dataKey="ndvi"
                        name="NDVI"
                        stroke="#22c55e"
                        strokeWidth={1.8}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="evi"
                        name="EVI"
                        stroke="#38bdf8"
                        strokeWidth={1.8}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="savi"
                        name="SAVI"
                        stroke="#f59e0b"
                        strokeWidth={1.8}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </section>
              )}
            </div>
          ) : null}

          {(pheno && hasClassification) || states.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
              {pheno && hasClassification && (
                <section className="ar-section p-4">
                  <p className="eyebrow mb-3">Phenology metrics · AOI NDVI</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7 xl:grid-cols-4 2xl:grid-cols-7">
                    {metric("SOS", pheno.sos_doy, " d")}
                    {metric("POS", pheno.pos_doy, " d")}
                    {metric("EOS", pheno.eos_doy, " d")}
                    {metric("LOS", pheno.los_days, " d")}
                    {metric("Peak", pheno.peak)}
                    {metric("Base", pheno.base)}
                    {metric("Amp", pheno.amplitude)}
                  </div>
                </section>
              )}

              {states.length > 0 && (
                <section className="ar-section p-4">
                  <p className="eyebrow mb-3">Phenological state timeline</p>
                  <div className="edge-fade-x -mx-1 overflow-x-auto px-1">
                    <div className="flex min-w-0 gap-1">
                      {states.map((s) => (
                        <div
                          key={s.date}
                          title={`${s.date}: ${s.state_name}${s.ndvi_mean != null ? ` · NDVI ${s.ndvi_mean}` : ""}`}
                          className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-0.5"
                        >
                          <span
                            className="h-3 w-full rounded-sm"
                            style={{ backgroundColor: s.color }}
                          />
                          <span className="telemetry text-[8px] text-place">
                            {s.date.slice(5)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    {[
                      ["#8c510a", "Bare / low"],
                      ["#66c2a5", "Green-up"],
                      ["#006d2c", "Peak"],
                      ["#fdae61", "Senescence"],
                      ["#bdbdbd", "Fallow"],
                    ].map(([c, n]) => (
                      <span key={n} className="flex items-center gap-1">
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ backgroundColor: c }}
                        />
                        {n}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : null}

          {/*
            Solar resource. Needs no scene, so it can be the only product a run
            carries. Every figure is shown with the assumption behind it.
          */}
          {result.solar && (
            <section className="ar-section p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="eyebrow">Solar resource</p>
                <p className="telemetry text-[10px] text-muted-foreground">
                  {result.solar.resource.n_years} years ·{" "}
                  {result.solar.lat.toFixed(2)}, {result.solar.lon.toFixed(2)}
                </p>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={result.solar.resource.monthly.map((m) => ({
                    month: String(m.month).padStart(2, "0"),
                    ghi: m.ghi,
                    dni: m.dni,
                    dhi: m.dhi,
                  }))}
                  margin={{ top: 5, right: 12, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--ar-border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--ar-raised)",
                      border: "1px solid var(--ar-border)",
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="ghi" name="GHI" stroke="#f59e0b" strokeWidth={1.8} dot={false} />
                  <Line type="monotone" dataKey="dni" name="DNI" stroke="#ef4444" strokeWidth={1.8} dot={false} />
                  <Line type="monotone" dataKey="dhi" name="DHI" stroke="#38bdf8" strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="telemetry mt-1 text-[10px] text-muted-foreground">
                daily mean kWh/m2 by month
              </p>

              <div
                className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4"
                style={{ borderColor: "var(--ar-border)" }}
              >
                <WaterFigure
                  label="GHI"
                  value={result.solar.resource.ghi_annual_kwh_m2.toFixed(0)}
                  sub={`kWh/m2/yr · CV ${result.solar.resource.ghi_cv_pct.toFixed(1)}%`}
                />
                <WaterFigure
                  label="Optimum tilt"
                  value={`${result.solar.geometry.optimal_tilt_deg.toFixed(0)}°`}
                  sub={`+${result.solar.geometry.gain_over_horizontal_pct.toFixed(1)}% over flat`}
                />
                <WaterFigure
                  label="Specific yield"
                  value={result.solar.pv.specific_yield_kwh_kwp_year.toFixed(0)}
                  sub={`kWh/kWp/yr · PR ${result.solar.pv.performance_ratio.toFixed(2)}`}
                />
                <WaterFigure
                  label="Capacity factor"
                  value={`${result.solar.pv.capacity_factor_pct.toFixed(1)}%`}
                  sub={`modelled PR ${result.solar.pv.performance_ratio_modelled.toFixed(3)}`}
                />
              </div>

              {result.solar.geometry.tilt_tolerance.length > 0 && (
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Tilt tolerance:{" "}
                  {result.solar.geometry.tilt_tolerance
                    .map(
                      (t) =>
                        `${t.deviation_deg.toFixed(0)}° costs ${t.loss_pct.toFixed(2)}%`
                    )
                    .join(" · ")}
                  . The optimum is a peak, not a requirement.
                </p>
              )}

              <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                <p>{result.solar.grid_note}</p>
                <PowerProvenanceNote provenance={result.solar.power_provenance} />
              </div>
            </section>
          )}

          {result.solar_terrain && (
            <section className="ar-section p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="eyebrow">
                  Terrain irradiation · {result.solar_terrain.season}
                </p>
                <p className="telemetry text-[10px] text-muted-foreground">
                  {result.solar_terrain.dem_source} ·{" "}
                  {result.solar_terrain.hourly_years} years
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <PanelTile
                    title={`Plane-of-array · ${result.solar_terrain.unit}`}
                    uri={result.solar_terrain.overlay_uri}
                    empty="No terrain raster"
                  />
                  {/* Endpoints come from the scale the sidecar drew on, not
                      from this layer's own range: a seasonal layer shares its
                      domain with the other season and is narrower than it. */}
                  <ContinuousRamp
                    palette={result.solar_terrain.scale.palette}
                    lowLabel={result.solar_terrain.scale.min.toFixed(
                      result.solar_terrain.scale.decimals
                    )}
                    highLabel={result.solar_terrain.scale.max.toFixed(
                      result.solar_terrain.scale.decimals
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 self-start">
                  <WaterFigure
                    label="Minimum"
                    value={result.solar_terrain.poa_min.toFixed(0)}
                  />
                  <WaterFigure
                    label="Maximum"
                    value={result.solar_terrain.poa_max.toFixed(0)}
                  />
                  <WaterFigure
                    label="Mean"
                    value={result.solar_terrain.poa_mean.toFixed(0)}
                    sub={result.solar_terrain.unit}
                  />
                  <WaterFigure
                    label="Spatial spread"
                    value={`${result.solar_terrain.poa_std_pct.toFixed(1)}%`}
                    sub="standard deviation"
                  />
                  <WaterFigure
                    label="Mean slope"
                    value={`${result.solar_terrain.slope_mean_deg.toFixed(1)}°`}
                    sub={`max ${result.solar_terrain.slope_max_deg.toFixed(1)}°`}
                  />
                  {result.solar_terrain.shading_mean_pct !== null && (
                    <WaterFigure
                      label="Horizon shading"
                      value={`${result.solar_terrain.shading_mean_pct.toFixed(2)}%`}
                      sub={
                        result.solar_terrain.shading_max_pct !== null
                          ? `max ${result.solar_terrain.shading_max_pct.toFixed(1)}% of beam`
                          : "of beam irradiance"
                      }
                    />
                  )}
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                The atmospheric resource has no spatial structure at this scale;
                what varies over the area is the irradiation reaching an inclined
                surface, because the surface is terrain. Horizon shading is a
                share of the beam component
                {/* Absent on runs saved before the field existed, where zero
                    would read as a measured beam share of nothing. */}
                {result.solar_terrain.beam_fraction > 0
                  ? `, which carries ${(result.solar_terrain.beam_fraction * 100).toFixed(0)}% of the horizontal irradiation here`
                  : ""}
                .
              </p>
              <PowerProvenanceNote
                provenance={result.solar_terrain.power_provenance}
              />
            </section>
          )}

          {result.solar_siting && (
            <section className="ar-section p-4">
              <p className="eyebrow mb-3">Photovoltaic siting</p>
              <PanelTile
                title="Suitability classes"
                uri={result.solar_siting.overlay_uri}
                empty="No siting raster"
              />
              <div className="mb-3 mt-3 grid grid-cols-2 gap-3">
                <WaterFigure
                  label="Suitable, no conflict"
                  value={`${result.solar_siting.suitable_no_conflict_ha.toFixed(1)} ha`}
                />
                <WaterFigure
                  label="Suitable, on cropland"
                  value={`${result.solar_siting.suitable_cropland_ha.toFixed(1)} ha`}
                  sub="reported apart, never summed"
                />
              </div>
              <ul className="flex flex-col gap-1.5">
                {result.solar_siting.classes.map((c) => (
                  <li key={c.code} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="telemetry w-20 shrink-0 text-right">
                      {c.area_ha.toFixed(1)} ha
                    </span>
                    <span className="telemetry w-12 shrink-0 text-right text-muted-foreground">
                      {c.pct.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                Slope limits {result.solar_siting.thresholds.slope_acceptable_deg}{" "}
                and {result.solar_siting.thresholds.slope_restrictive_deg} degrees.{" "}
                {result.solar_siting.thresholds.note}
              </p>
            </section>
          )}

          {/*
            The photovoltaic energy model, then the wind screening. The wind
            block is its own section and carries its own qualifier: it is gross
            of every plant loss and has no external benchmark, while the
            photovoltaic figures above are computed at a ratio bracketed by the
            Global Solar Atlas, so the two are never drawn in one comparison.
          */}
          {result.energy_model && (
            <EnergyModelSection energy={result.energy_model} />
          )}

          {result.wind && <WindScreening wind={result.wind} />}

          {/*
            Surface water over the period. Fractions are a percentage of the
            pixels observed on each date, so the series is not comparable to a
            fraction of the AOI area.
          */}
          {result.water && result.water.series.length > 0 && (
            <section className="ar-section p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="eyebrow">
                  Surface water · {result.water.index}
                </p>
                <p className="telemetry text-[10px] text-muted-foreground">
                  {result.water.n_dates} dates ·{" "}
                  {result.water.date_range[0]} → {result.water.date_range[1]}
                </p>
              </div>
              {result.water.occurrence_uri && (
                <div className="mb-3">
                  <PanelTile
                    title="Water occurrence"
                    uri={result.water.occurrence_uri}
                    empty="No occurrence raster"
                  />
                  <ContinuousRamp
                    palette="blues"
                    lowLabel="0% of observed dates"
                    highLabel="100%"
                  />
                </div>
              )}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={result.water.series.map((d) => ({
                    date: d.date,
                    water: d.water_fraction_pct,
                  }))}
                  margin={{ top: 5, right: 12, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--ar-border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    tickFormatter={(d: string) => d.slice(2, 7)}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--ar-raised)",
                      border: "1px solid var(--ar-border)",
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="water"
                    name="Water fraction"
                    stroke="#3182bd"
                    strokeWidth={1.8}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4"
                   style={{ borderColor: "var(--ar-border)" }}>
                <WaterFigure
                  label="Peak"
                  value={`${result.water.peak_water_fraction_pct.toFixed(1)}%`}
                  sub={result.water.peak_date}
                />
                <WaterFigure
                  label="Ephemeral"
                  value={`${result.water.ephemeral_area_ha.toFixed(2)} ha`}
                  sub="wet on some dates"
                />
                <WaterFigure
                  label="Persistent"
                  value={`${result.water.persistent_area_ha.toFixed(2)} ha`}
                  sub="standing water"
                />
                <WaterFigure
                  label="AOI"
                  value={`${result.water.aoi_area_ha.toFixed(1)} ha`}
                  sub="fraction denominator is per date"
                />
              </div>
            </section>
          )}

          {runsPanel}
        </div>
      </div>

      {packOpen && (
        <ResearchPackModal
          result={result}
          modelKind={modelKind}
          areaLabel={areaLabel}
          areaId={areaId}
          polygonGeoJSON={polygonGeoJSON}
          onClose={() => setPackOpen(false)}
        />
      )}

      {selectedPlot && (
        <AnalysisPlotModal
          plot={selectedPlot}
          plots={plotAssets}
          legend={MAPBIOMAS_CLASS_LEGEND}
          onClose={() => setSelectedPlot(null)}
        />
      )}
    </div>
  )
}

function ConfirmDeleteProjectModal({
  project,
  busy,
  onCancel,
  onConfirm,
}: {
  project: Project
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, onCancel])

  return (
    <div
      className="app-no-drag absolute inset-0 z-[2000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        className="terra-workspace flex w-full max-w-md flex-col overflow-hidden rounded-sm border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{
          borderColor: "var(--ar-border)",
          background: "var(--ar-panel)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ar-header flex shrink-0 flex-col gap-1 px-4 py-3">
          <p className="telemetry text-[10px] text-destructive">DELETE PROJECT</p>
          <h2
            id="delete-project-title"
            className="font-display text-lg font-semibold tracking-wide"
          >
            Delete “{project.name}”?
          </h2>
          <p className="text-[11px] text-muted-foreground">
            This cannot be undone. Classification runs stay on disk but become
            unassigned; band compositions for this project are removed.
          </p>
        </div>
        <div
          className="flex shrink-0 justify-end gap-2 px-4 py-3"
          style={{
            borderTop: "1px solid var(--ar-border)",
            background: "var(--ar-panel)",
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="ar-ghost flex h-8 items-center rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-destructive px-3 text-[11px] font-semibold text-destructive-foreground disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            {busy ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  )
}

function CompositionOverlayModal({
  overlay,
  projectName,
  onClose,
  onViewOnMap,
}: {
  overlay: ProjectOverlay
  projectName?: string
  onClose: () => void
  onViewOnMap: () => void
}) {
  const meta = parseOverlayMeta(overlay.meta_json)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const safeName =
    (overlay.title || "composition")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "composition"

  const exportPng = async () => {
    if (!overlay.overlay_uri) return
    try {
      const dest = await ExportOverlayFile(
        overlay.overlay_uri,
        `terra-${safeName}.png`
      )
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  const exportTif = async () => {
    if (!overlay.raster_tif) return
    try {
      const dest = await ExportOverlayFile(
        overlay.raster_tif,
        `terra-${safeName}.tif`
      )
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }

  const bandsLabel = meta.bands?.join("-")
  const metaBits = [
    meta.kind || overlay.kind,
    bandsLabel,
    meta.index,
    meta.sceneDate,
  ].filter(Boolean)

  return (
    <div
      className="app-no-drag absolute inset-0 z-[2000] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={overlay.title || "Composition"}
        className="terra-workspace flex h-[min(40rem,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-sm border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{
          borderColor: "var(--ar-border)",
          background: "var(--ar-panel)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ar-header flex shrink-0 items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="telemetry text-[10px] text-primary">COMPOSITION</p>
            <p className="eyebrow mt-0.5 !text-foreground">
              {overlay.title || "Band composition"}
              {projectName ? ` · ${projectName}` : ""}
            </p>
            {metaBits.length > 0 ? (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {metaBits.join(" · ")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-muted-foreground hover:bg-[var(--ar-raised)] hover:text-foreground"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
          style={{ background: "var(--ar-bg)" }}
        >
          <div className="ar-raised flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
            {overlay.overlay_uri ? (
              <img
                src={overlay.overlay_uri}
                alt={overlay.title || "Composition"}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Preview unavailable
              </p>
            )}
          </div>
          {meta.description?.trim() ? (
            <p className="shrink-0 text-[11px] text-muted-foreground">
              {meta.description.trim()}
            </p>
          ) : null}
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
          style={{
            borderTop: "1px solid var(--ar-border)",
            background: "var(--ar-panel)",
          }}
        >
          <button
            type="button"
            onClick={onViewOnMap}
            className="ar-ghost flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <MapIcon className="h-3 w-3" />
            View on map
          </button>
          <div className="flex flex-wrap gap-2">
            {overlay.overlay_uri ? (
              <button
                type="button"
                onClick={() => void exportPng()}
                className="ar-ghost flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3 w-3" />
                Export PNG
              </button>
            ) : null}
            {overlay.raster_tif ? (
              <button
                type="button"
                onClick={() => void exportTif()}
                className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
              >
                <Download className="h-3 w-3" />
                Export GeoTIFF
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SavedRunsPanel({
  title = "Saved analyses",
  caption,
  runs,
  loading,
  selectedIds,
  onToggleSelect,
  onClearSelection,
  onCompare,
  comparing,
  onOpen,
  onDelete,
  onRefresh,
  projects,
  onAssignProject,
}: {
  title?: string
  caption?: string
  runs: InferenceRun[]
  loading: boolean
  selectedIds: string[]
  onToggleSelect: (id: string) => void
  onClearSelection: () => void
  onCompare: () => void
  comparing: boolean
  onOpen: (run: InferenceRun) => Promise<void>
  onDelete?: (run: InferenceRun) => void
  onRefresh: () => void
  projects?: Project[]
  onAssignProject?: (runId: string, projectId: string) => void
}) {
  const canCompare = selectedIds.length === 2 && !comparing

  return (
    <section className="ar-section p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="eyebrow !text-foreground">{title}</p>
          </div>
          {caption ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{caption}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear selection
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="ar-raised mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {selectedIds.length === 1
              ? "Select one more analysis to compare"
              : "Two analyses selected"}
          </p>
          <button
            type="button"
            disabled={!canCompare}
            onClick={onCompare}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Columns2 className="h-3 w-3" />
            {comparing ? "Loading…" : "Compare"}
          </button>
        </div>
      )}

      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No analyses in this project yet. Classify with this project active on the
          map — or assign unassigned runs from the hub.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {runs.map((r) => {
            const selected = selectedIds.includes(r.id)
            const slot =
              selectedIds[0] === r.id ? "A" : selectedIds[1] === r.id ? "B" : null
            const summary = parseRunSummary(r.summary)
            const dominant = dominantClass(summary.classStats)
            const classified = classifiedAreaHa(summary.classStats)
            // A wind run has no requested period. The window that applies is
            // the record it read, which persistWindRun stores in the summary.
            const windWindow =
              r.kind === "wind" ? windRecordWindow(r.summary) : ""
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-sm border px-3 py-2.5 text-xs",
                  selected ? "ar-select" : "ar-raised"
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={loading}
                    onChange={() => onToggleSelect(r.id)}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {slot && (
                        <span className="telemetry shrink-0 rounded-sm bg-primary/20 px-1 text-[9px] text-primary">
                          {slot}
                        </span>
                      )}
                      <span className="truncate font-medium text-foreground">
                        {displayRunLabel(r.label)}
                      </span>
                      <span className="telemetry shrink-0 text-muted-foreground">
                        {/* Solar counts years of climatology and wind counts
                            years of hourly reanalysis. Neither reads a scene,
                            and a wind run listed as "10 scenes" understated a
                            ten-year record as ten observations. */}
                        {r.n_dates}{" "}
                        {r.kind === "solar" || r.kind === "wind"
                          ? "years"
                          : "scenes"}
                      </span>
                    </div>
                    {/* What the run produced, from summary already in memory —
                        saves a LoadAnalysis round trip just to see the result. */}
                    {r.kind === "solar" ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-[2px] bg-[#f59e0b]" />
                        <span className="truncate text-foreground">
                          {solarSummaryLine(r.summary)}
                        </span>
                      </div>
                    ) : r.kind === "water" ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-[2px] bg-[#3182bd]" />
                        <span className="truncate text-foreground">
                          {waterSummaryLine(r.summary)}
                        </span>
                      </div>
                    ) : r.kind === "wind" ? (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          {/* Not the water blue: two products keyed on
                              different reanalyses should not read as one. */}
                          <span className="size-2.5 shrink-0 rounded-[2px] bg-[#2a9d8f]" />
                          <span className="truncate text-foreground">
                            {windSummaryLine(r.summary)}
                          </span>
                        </div>
                        {/* The qualifier travels with the figure. Without it a
                            gross, unbenchmarked capacity factor sits in the
                            same list as a photovoltaic one that is benchmarked
                            against the Global Solar Atlas. */}
                        <span className="truncate text-[10px] text-muted-foreground">
                          {windQualifierLine(r.summary)}
                        </span>
                      </div>
                    ) : dominant && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: dominant.color }}
                        />
                        <span className="truncate text-foreground">
                          {dominant.name}
                          {typeof dominant.pct === "number"
                            ? ` ${dominant.pct.toFixed(1)}%`
                            : ""}
                        </span>
                        {classified > 0 && (
                          <span className="telemetry shrink-0 text-muted-foreground">
                            {formatHectares(classified)} classified
                          </span>
                        )}
                      </div>
                    )}
                    {/* The requested window is a query; date_range is the extent
                        actually observed. Older runs have no date_range. */}
                    <div className="mt-0.5 text-muted-foreground">
                      {r.kind === "water"
                        ? `Surface water · ${r.model_kind || "index"}`
                        : r.kind === "solar"
                          ? `${solarProductLabel(r.summary)} · ${r.model_kind || "NASA POWER"}`
                          : r.kind === "wind"
                            ? `Wind screening · ${r.model_kind || "NASA POWER MERRA-2"}`
                            : modelDisplayName(r.model_kind)}
                      {/* Solar reports a climatology and has no observed
                          window. A wind run's row rendered as a bare arrow
                          until the record window was read from the summary.
                          The separator is emitted with the second part so
                          neither row ends in a dangling one. */}
                      {r.kind === "solar" ? null : r.kind === "wind" ? (
                        windWindow ? <> · {windWindow}</> : null
                      ) : (
                        <>
                          {" · "}
                          {summary.dateRange ? (
                            <>
                              observed {summary.dateRange[0]} →{" "}
                              {summary.dateRange[1]}
                              <span className="opacity-70">
                                {" "}
                                (requested {r.period_start} → {r.period_end})
                              </span>
                            </>
                          ) : (
                            <>
                              {r.period_start} → {r.period_end}
                            </>
                          )}
                        </>
                      )}
                    </div>
                    <div className="telemetry mt-1 text-[10px] text-muted-foreground/80">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                    {onAssignProject && projects && projects.length > 0 && (
                      <select
                        className="ar-inset mt-1.5 max-w-full px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        defaultValue=""
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const pid = e.target.value
                          if (pid) onAssignProject(r.id, pid)
                        }}
                      >
                        <option value="">Add to project…</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void onOpen(r)}
                    className="ar-ghost flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                  >
                    <FolderOpen className="h-3 w-3" />
                    Open
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => onDelete(r)}
                      className="ar-ghost flex h-8 items-center justify-center rounded-sm border px-2 text-muted-foreground hover:border-destructive/50 hover:text-destructive disabled:opacity-60"
                      title="Delete analysis"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * Colour ramp for a continuous raster, labelled with the domain endpoints.
 *
 * The caller passes the endpoints of the scale the raster was DRAWN on, not the
 * layer's own range. For a seasonal layer the two differ: the domain spans both
 * seasons, so a ramp labelled from this layer's own minimum and maximum would
 * assert a contrast the image does not carry.
 */
function ContinuousRamp({
  palette,
  lowLabel,
  highLabel,
}: {
  palette: PaletteName
  lowLabel: string
  highLabel: string
}) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div
        className="h-2 w-full rounded-full"
        style={{ background: paletteGradient(palette) }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

function PanelTile({
  title,
  uri,
  empty,
  onOpen,
}: {
  title: string
  uri?: string
  empty: string
  onOpen?: () => void
}) {
  const preview = (
    <div className="ar-inset relative aspect-[4/3] overflow-hidden">
      {uri ? (
        <img src={uri} alt={title} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center px-3 text-center text-[10px] text-muted-foreground">
          {empty}
        </div>
      )}
    </div>
  )

  if (onOpen && uri) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-col gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        title={`Open ${title}`}
      >
        <p className="eyebrow !text-muted-foreground group-hover:text-foreground">
          {title}
        </p>
        <div className="transition-opacity group-hover:opacity-90">{preview}</div>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="eyebrow !text-muted-foreground">{title}</p>
      {preview}
    </div>
  )
}

/**
 * Position on a palette ramp by nearest stop.
 *
 * The stops are the ones the renderer itself uses, so a swatch drawn here is a
 * colour sidecar/composite.py defines. Interpolating between them would put a
 * colour on screen that no palette file contains.
 */
function rampStop(stops: string[], t: number): string {
  if (!Number.isFinite(t)) return stops[0]
  const clamped = Math.min(1, Math.max(0, t))
  return stops[Math.round(clamped * (stops.length - 1))]
}

/** Small caps tag for a row's kind or standing. */
function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "accent"
}) {
  return (
    <span
      className={cn(
        "telemetry shrink-0 rounded-[2px] border px-1 py-px text-[9px] uppercase tracking-wider",
        tone === "accent" ? "text-primary" : "text-muted-foreground"
      )}
      style={{ borderColor: "var(--ar-border)" }}
    >
      {children}
    </span>
  )
}

/**
 * The chain from global horizontal irradiation to delivered AC energy.
 *
 * The rail on the left is what separates the steps inside the performance
 * ratio from the ones outside it. The component-closure residual between the
 * published global horizontal irradiation and the horizontal plane rebuilt
 * from the beam and diffuse components is a property of the radiation product;
 * drawn inside the chain it reads as a plant loss the site would incur.
 */
function EnergyWaterfall({ energy }: { energy: EnergyModelAnalysis }) {
  const w = energy.loss_waterfall
  const steps = w.steps
  const factorSpan = Math.max(
    ...steps.map((s) => (s.factor == null ? 0 : Math.abs(1 - s.factor))),
    0.0001
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Loss waterfall · global horizontal to AC</p>
        <p className="telemetry text-[10px] text-muted-foreground">
          base {w.base.ghi_hourly_kwh_m2_year.toFixed(2)} kWh/m2/yr ·{" "}
          {w.base.hourly_window}
        </p>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        {w.base.note} The daily climatology over {w.base.climatology_window}{" "}
        gives {w.base.ghi_climatology_kwh_m2_year.toFixed(2)} kWh/m2/yr and is
        carried as context rather than as the base.
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-0 border-l-2"
            style={{ borderColor: "rgb(var(--p-accent))" }}
          />
          inside the performance ratio
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-0 border-l-2 border-dashed"
            style={{ borderColor: "var(--ar-border)" }}
          />
          outside it: not a plant loss and not multiplied into the ratio
        </span>
        <span>
          bar width is the departure from unity, on a common scale (largest{" "}
          {(factorSpan * 100).toFixed(1)}%)
        </span>
      </div>

      <ul className="flex flex-col gap-px">
        {steps.map((s) => {
          const inPR = s.in_performance_ratio
          const dev = s.factor == null ? 0 : s.factor - 1
          const width = (Math.abs(dev) / factorSpan) * 50
          return (
            <li
              key={s.step}
              className={cn(
                "border-l-2 py-1.5 pl-2.5 pr-1",
                inPR ? "" : "bg-[var(--ar-bg)]"
              )}
              style={{
                borderColor: inPR ? "rgb(var(--p-accent))" : "var(--ar-border)",
                borderLeftStyle: inPR ? "solid" : "dashed",
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="telemetry w-5 shrink-0 text-[10px] text-muted-foreground">
                  {s.step}
                </span>
                <span className="min-w-[12rem] flex-1 text-xs text-foreground">
                  {s.label}
                </span>
                <Chip>{s.kind.replace(/_/g, " ")}</Chip>
                {!inPR && <Chip>outside PR</Chip>}
                <span className="telemetry w-24 shrink-0 text-right text-[11px] text-foreground">
                  {s.factor == null ? "—" : s.factor.toFixed(6)}
                </span>
                <span className="ar-track relative hidden h-1.5 w-24 shrink-0 sm:block">
                  <span
                    className="absolute inset-y-0"
                    style={{
                      width: `${width}%`,
                      left: dev < 0 ? `${50 - width}%` : "50%",
                      backgroundColor:
                        dev === 0
                          ? "var(--ar-border)"
                          : dev < 0
                            ? PALETTE_STOPS.rdbu_r[13]
                            : PALETTE_STOPS.rdbu_r[3],
                    }}
                  />
                </span>
                <span className="telemetry w-36 shrink-0 text-right text-[11px] text-foreground">
                  {s.energy_after.toFixed(2)}{" "}
                  <span className="text-muted-foreground">{s.units}</span>
                </span>
                <span className="telemetry w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                  {s.cumulative_ratio == null
                    ? "—"
                    : s.cumulative_ratio.toFixed(6)}
                </span>
              </div>
              <p className="mt-1 pl-7 text-[10px] leading-relaxed text-muted-foreground">
                {s.source}
                {s.note ? ` — ${s.note}` : ""}
              </p>
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Carried outside the performance ratio:{" "}
        {w.outside_performance_ratio.join("; ")}.
      </p>
    </div>
  )
}

/**
 * The performance ratio against its external benchmark.
 *
 * The applied ratio is drawn on the same axis as the band the Global Solar
 * Atlas implies at this site, so a reader sees whether it is bracketed by an
 * external measurement or only asserted. The modelled and derived ratios are
 * on the axis too, at their distance from the band.
 */
function PerformanceRatioScale({ energy }: { energy: EnergyModelAnalysis }) {
  const pr = energy.performance_ratio
  const band = pr.gsa_implied_band
  const hasBand = band.length >= 2
  const lo = hasBand ? Math.min(...band) : 0
  const hi = hasBand ? Math.max(...band) : 0
  const marks = [
    { key: "derived", label: "derived", value: pr.derived, accent: false },
    { key: "applied", label: "applied", value: pr.applied, accent: true },
    { key: "modelled", label: "modelled", value: pr.modelled, accent: false },
  ]
  const values = marks.map((m) => m.value).concat(hasBand ? [lo, hi] : [])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min || 1) * 0.12
  const left = min - pad
  const width = max - min + 2 * pad
  const pos = (v: number) => ((v - left) / width) * 100
  const bracketed = hasBand && pr.applied >= lo && pr.applied <= hi

  return (
    <div>
      <p className="eyebrow mb-2">Performance ratio · applied against the band</p>
      <div className="relative h-9">
        <div className="ar-track absolute inset-x-0 top-4 h-1.5 rounded-sm" />
        {hasBand && (
          <div
            className="absolute top-2.5 h-4 rounded-sm"
            style={{
              left: `${pos(lo)}%`,
              width: `${pos(hi) - pos(lo)}%`,
              backgroundColor: "rgb(var(--p-accent) / 0.28)",
              border: "1px solid rgb(var(--p-accent) / 0.55)",
            }}
          />
        )}
        {marks.map((m) => (
          <div
            key={m.key}
            className="absolute top-1 h-7 w-px"
            style={{
              left: `${pos(m.value)}%`,
              backgroundColor: m.accent
                ? "rgb(var(--p-accent))"
                : "var(--ar-muted)",
            }}
            title={`${m.label} ${m.value.toFixed(6)}`}
          />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {marks.map((m) => (
          <div key={m.key}>
            <div className="eyebrow !text-[9px]">{m.label}</div>
            <div
              className={cn(
                "telemetry text-sm",
                m.accent ? "text-primary" : "text-foreground"
              )}
            >
              {m.value.toFixed(4)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {hasBand ? (
          <>
            The Global Solar Atlas implies {lo.toFixed(3)} to {hi.toFixed(3)} at
            this site. The applied ratio {pr.applied.toFixed(3)} (
            {pr.applied_source}){" "}
            {bracketed
              ? "lies inside that band, so it is bracketed by an external measurement rather than asserted"
              : `lies outside it by ${Math.min(Math.abs(pr.applied - lo), Math.abs(pr.applied - hi)).toFixed(4)}`}
            . The derived ratio {pr.derived.toFixed(4)}{" "}
            {pr.derived < lo
              ? `sits ${(lo - pr.derived).toFixed(4)} below the lower edge`
              : pr.derived > hi
                ? `sits ${(pr.derived - hi).toFixed(4)} above the upper edge`
                : "lies inside the band as well"}
            ; it is this chain decomposed plus its declared assumptions, and it
            does not replace the applied ratio.
          </>
        ) : (
          <>
            No external band was returned with this run, so the applied ratio{" "}
            {pr.applied.toFixed(3)} ({pr.applied_source}) is stated without one.
          </>
        )}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        At the values the reference suggests for the two optional terms the
        derived ratio becomes{" "}
        {pr.derived_if_optional_at_pvwatts_defaults.toFixed(4)}. Reporting basis{" "}
        {pr.reporting_basis}, degradation factor{" "}
        {pr.degradation_factor.toFixed(6)}. The rate is carried as a fraction
        per year and is shown here as a percentage:{" "}
        {(pr.degradation_rate_per_year * 100).toFixed(2)}% per year over{" "}
        {pr.analysis_period_years} years. {pr.degradation_source}
      </p>
    </div>
  )
}

/**
 * Identities the waterfall has to satisfy, kept apart from the loss rows.
 *
 * A checkpoint with no residual is not an identity; Go turning an absent
 * residual into 0.0 would read as one that closed exactly, so the null is
 * printed as a statement rather than as a number.
 */
function EnergyCheckpoints({ energy }: { energy: EnergyModelAnalysis }) {
  const checks = energy.loss_waterfall.checkpoints
  if (checks.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((c) => (
        <li key={c.name} className="ar-raised px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="telemetry text-[11px] text-foreground">
              {c.name.replace(/_/g, " ")}
            </span>
            <span className="telemetry text-sm text-foreground">
              {c.value.toFixed(6)}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {c.residual == null
              ? "Not an identity, so no residual is reported."
              : c.residual === 0
                ? "Residual 0 against the identity."
                : `Residual ${c.residual.toExponential(2)} against the identity.`}
            {c.external_band.length >= 2
              ? ` External band ${Math.min(...c.external_band).toFixed(3)} to ${Math.max(...c.external_band).toFixed(3)}.`
              : ""}{" "}
            {c.note}
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * Fixed tilt against one-axis tracking.
 *
 * The two published per-hectare measurements lead, because they answer the
 * per-hectare question directly on fleets of built plants and they disagree on
 * the sign. The figure this chain derives is a third line behind them, shown
 * with the ground-coverage pair that produced it.
 */
function TrackingComparison({ energy }: { energy: EnergyModelAnalysis }) {
  const t = energy.tracking
  const pub = t.per_hectare.published_measurements
  const bol = pub.bolinger_2022
  const ong = pub.ong_2013_table5
  const md = t.per_hectare.model_derived
  const seasonSpan = Math.max(
    ...t.seasonal.rows.map((r) => Math.abs(r.gain_pct)),
    0.001
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="eyebrow">Fixed tilt against one-axis tracking</p>

      <div>
        <p className="mb-2 text-[11px] leading-relaxed text-foreground">
          Per hectare, as published. {t.per_hectare.note}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="ar-raised px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow !text-[9px]">
                Bolinger and Bolinger (2022)
              </span>
              <span className="telemetry text-sm text-foreground">
                {bol.change_pct.toFixed(1)}%
              </span>
            </div>
            <div className="telemetry mt-1 text-[11px] text-muted-foreground">
              fixed {bol.fixed_gwh_ha_year.toFixed(2)} · tracking{" "}
              {bol.tracking_gwh_ha_year.toFixed(2)} GWh/ha/yr (
              {bol.fixed_mwh_acre_year.toFixed(0)} and{" "}
              {bol.tracking_mwh_acre_year.toFixed(0)} MWh/acre/yr)
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {bol.source}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {bol.note}
            </p>
          </div>
          <div className="ar-raised px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="eyebrow !text-[9px]">Ong et al. (2013), Table 5</span>
              <span className="telemetry text-sm text-foreground">
                {ong.band_pct.length >= 2
                  ? `${Math.min(...ong.band_pct).toFixed(1)} to ${Math.max(...ong.band_pct).toFixed(1)}%`
                  : "—"}
              </span>
            </div>
            <div className="telemetry mt-1 text-[11px] text-muted-foreground">
              nearest sites at this DNI of{" "}
              {ong.site_dni_kwh_m2_year.toFixed(1)} kWh/m2/yr:{" "}
              {ong.nearest_rows
                .map(
                  (r) =>
                    `${r.site} ${r.dni_kwh_m2_year.toFixed(0)} → ${r.land_use_change_pct.toFixed(1)}%`
                )
                .join(" · ")}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {ong.source}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {ong.note}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {pub.disagreement}
        </p>
      </div>

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow !text-[9px]">
            Derived here, third line · not measured
          </span>
          <span className="telemetry text-sm text-foreground">
            {md.change_pct.toFixed(2)}%
          </span>
        </div>
        <div className="telemetry mt-1 text-[11px] text-muted-foreground">
          energy per hectare ratio {md.energy_per_hectare_ratio.toFixed(4)} at
          ground coverage {md.gcr_fixed.toFixed(3)} fixed and{" "}
          {md.gcr_tracker.toFixed(3)} tracking, a ratio of{" "}
          {md.gcr_ratio.toFixed(4)}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {md.basis}. {md.note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Sign parity at a tracker ground coverage of{" "}
          {md.parity.gcr_tracker.toFixed(4)}, that is{" "}
          {md.parity.gcr_ratio.toFixed(3)} of the fixed-tilt value, searched
          over {md.parity.search_range.join(" to ")}. {md.parity.note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {md.module_efficiency_note}
        </p>
      </div>

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">Per kWp, this site's series</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label="Fixed"
            value={t.per_kwp.fixed.specific_yield_kwh_kwp_year.toFixed(0)}
            sub={`kWh/kWp/yr · tilt ${t.per_kwp.fixed.tilt_deg.toFixed(0)}° · CF ${t.per_kwp.fixed.capacity_factor_pct.toFixed(2)}%`}
          />
          <WaterFigure
            label="Tracking"
            value={t.per_kwp.tracking.specific_yield_kwh_kwp_year.toFixed(0)}
            sub={`kWh/kWp/yr · GCR ${t.per_kwp.tracking.gcr.toFixed(3)} · CF ${t.per_kwp.tracking.capacity_factor_pct.toFixed(2)}%`}
          />
          <WaterFigure
            label="Gain per kWp"
            value={`${t.per_kwp.gain_pct.toFixed(2)}%`}
            sub={`at the applied ratio ${t.performance_ratio.applied.toFixed(2)} (${t.performance_ratio.applied_source})`}
          />
          <WaterFigure
            label="Basis that inverts"
            value={t.per_hectare.inverts ? "per hectare" : "per kWp"}
            sub={
              t.per_kwp.inverts
                ? "both bases change sign across the configurations tested"
                : "the per-kWp comparison keeps its sign"
            }
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {t.per_kwp.note}
        </p>
      </div>

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Plane-of-array gain by season, kWh/m2
        </p>
        <ul className="flex flex-col gap-1.5">
          {t.seasonal.rows.map((r) => (
            <li
              key={r.season}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="w-24 shrink-0 truncate">
                {r.season.replace(/_/g, " ")}
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                {r.fixed_poa_kwh_m2_season.toFixed(1)}
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                {r.tracker_poa_kwh_m2_season.toFixed(1)}
              </span>
              <span className="ar-track relative h-1.5 min-w-[6rem] flex-1">
                <span
                  className="absolute inset-y-0"
                  style={{
                    width: `${(Math.abs(r.gain_pct) / seasonSpan) * 50}%`,
                    left:
                      r.gain_pct < 0
                        ? `${50 - (Math.abs(r.gain_pct) / seasonSpan) * 50}%`
                        : "50%",
                    backgroundColor:
                      r.gain_pct < 0
                        ? PALETTE_STOPS.rdbu_r[13]
                        : PALETTE_STOPS.rdbu_r[3],
                  }}
                />
              </span>
              <span className="telemetry w-16 shrink-0 text-right">
                {r.gain_pct.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {t.seasonal.note}
        </p>
      </div>

      <div
        className="border-t pt-3 text-[10px] leading-relaxed text-muted-foreground"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p>
          Axis tilt {t.configuration.axis_tilt_deg.toFixed(0)}°, axis azimuth{" "}
          {t.configuration.axis_azimuth_deg.toFixed(0)}° (
          {t.configuration.axis_azimuth_convention}), rotation limit{" "}
          {t.configuration.max_angle_deg.toFixed(0)}° (
          {t.configuration.max_angle_source}), backtracking{" "}
          {t.configuration.backtrack ? "on" : "off"}.{" "}
          {t.configuration.backtrack_note} {t.configuration.terrain}
        </p>
        <p className="mt-1">
          {t.performance_ratio.note} Measured across the wind assumption:{" "}
          {t.performance_ratio.transfer_between_configurations
            .map(
              (r) =>
                `${r.wind} ${r.performance_ratio_fixed.toFixed(6)} against ${r.performance_ratio_tracker.toFixed(6)}, ${r.difference_pct.toFixed(4)}%`
            )
            .join("; ")}
          .
        </p>
        <p className="mt-1">{t.excluded}</p>
        <p className="mt-1">{t.resolution_note}</p>
      </div>
    </div>
  )
}

/**
 * Mean AC power by month and hour, with the monthly peak sun hours beside it.
 *
 * The hour axis is labelled on the time standard the response reports, which
 * is not local time unless an offset was supplied: a diurnal profile read on
 * the wrong standard is shifted without any sign that it is.
 */
function GenerationProfile({ energy }: { energy: EnergyModelAnalysis }) {
  const g = energy.generation_profile
  const matrix = g.mean_ac_power_by_month_and_hour
  const peak = Math.max(
    ...matrix.rows.flatMap((r) => r.mean_ac_w_kwp),
    0.0001
  )
  const psh = g.monthly.rows
  const pshMax = Math.max(...psh.map((m) => m.peak_sun_hours_day), 0.0001)
  const shareMax = Math.max(
    ...g.share_of_annual_generation_by_hour.rows.map((h) => h.share_pct),
    0.0001
  )
  const offset = g.time_standard.utc_offset_hours

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Generation profile</p>
        <p className="telemetry text-[10px] text-muted-foreground">
          {g.time_standard.source_standard}
          {offset == null
            ? ""
            : ` ${offset >= 0 ? "+" : ""}${offset} h`} ·{" "}
          {g.time_standard.hour_label}
        </p>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {g.time_standard.note} {g.note}
      </p>

      <div className="edge-fade-x -mx-1 overflow-x-auto px-1">
        <div className="min-w-[34rem]">
          <div className="flex items-center gap-1">
            <span className="w-8 shrink-0" />
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="telemetry min-w-0 flex-1 text-center text-[8px] text-muted-foreground"
              >
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          {matrix.rows.map((row) => (
            <div key={row.month} className="flex items-center gap-1">
              <span className="telemetry w-8 shrink-0 text-[9px] text-muted-foreground">
                {String(row.month).padStart(2, "0")}
              </span>
              {Array.from({ length: 24 }, (_, h) => {
                const v = h < row.mean_ac_w_kwp.length ? row.mean_ac_w_kwp[h] : null
                return (
                  <span
                    key={h}
                    title={
                      v == null
                        ? `month ${row.month}, hour ${h}: not carried`
                        : `month ${row.month}, hour ${h}: ${v.toFixed(1)} ${matrix.units}`
                    }
                    className="h-4 min-w-0 flex-1 rounded-[1px]"
                    style={{
                      backgroundColor:
                        v == null
                          ? "var(--ar-border)"
                          : rampStop(PALETTE_STOPS.inferno, v / peak),
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span
          className="h-2 w-24 rounded-sm"
          style={{ background: paletteGradient("inferno") }}
        />
        <span className="telemetry">
          0 to {peak.toFixed(0)} {matrix.units}
        </span>
        <span>
          modelled AC power before any performance ratio is applied, so the
          shape is the model's and the level is not a reported yield
        </span>
      </div>

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Peak sun hours per day, module plane
        </p>
        <ul className="flex flex-col gap-1">
          {psh.map((m) => (
            <li key={m.month} className="flex items-center gap-2 text-xs">
              <span className="telemetry w-6 shrink-0 text-[10px] text-muted-foreground">
                {String(m.month).padStart(2, "0")}
              </span>
              <span className="ar-track relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${(m.peak_sun_hours_day / pshMax) * 100}%`,
                    backgroundColor: "#f59e0b",
                  }}
                />
              </span>
              <span className="telemetry w-14 shrink-0 text-right text-[11px]">
                {m.peak_sun_hours_day.toFixed(2)} h
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                {m.poa_kwh_m2_month.toFixed(1)} kWh/m2
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-[10px] text-muted-foreground">
                {m.ac_kwh_kwp_month.toFixed(1)} kWh/kWp
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {g.monthly.note}
        </p>
      </div>

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Share of annual AC energy by hour
        </p>
        <div className="flex items-end gap-1">
          {g.share_of_annual_generation_by_hour.rows.map((h) => (
            <div
              key={h.hour}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
              title={`hour ${h.hour}: ${h.share_pct.toFixed(3)} ${g.share_of_annual_generation_by_hour.units}`}
            >
              <span
                className="w-full rounded-t-[1px]"
                style={{
                  height: `${Math.max(1, (h.share_pct / shareMax) * 36)}px`,
                  backgroundColor: "#f59e0b",
                }}
              />
              <span className="telemetry text-[8px] text-muted-foreground">
                {h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {g.share_of_annual_generation_by_hour.units}, on the same time
          standard as the surface above.
        </p>
      </div>
    </div>
  )
}

/** One siting class, with the assumptions that produced its energy figures. */
function PlantClassCard({
  cls,
  density,
}: {
  cls: EnergyPlantClass
  density: EnergyCapacityDensity
}) {
  return (
    <div className="ar-raised px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-foreground">{cls.label}</span>
        <span className="telemetry text-sm text-foreground">
          {cls.area_ha.toFixed(3)} ha
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <WaterFigure
          label="Capacity"
          value={`${cls.capacity_dc_mw.toFixed(2)} MW`}
          sub={`DC at ${density.value_mw_dc_per_ha.toFixed(4)} MW/ha, ${density.area_basis.replace(/_/g, " ")}`}
        />
        <WaterFigure
          label="Capacity"
          value={`${cls.capacity_ac_mw.toFixed(2)} MW`}
          sub={`AC at a fleet DC/AC ratio of ${density.fleet_dc_ac_ratio.toFixed(4)}`}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <WaterFigure
          label="P50"
          value={cls.energy.p50_exceedance_gwh_year.toFixed(2)}
          sub="GWh/yr"
        />
        <WaterFigure
          label="P75"
          value={cls.energy.p75_exceedance_gwh_year.toFixed(2)}
          sub="GWh/yr"
        />
        <WaterFigure
          label="P90"
          value={cls.energy.p90_exceedance_gwh_year.toFixed(2)}
          sub="GWh/yr"
        />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Specific yield {cls.specific_yield_kwh_kwp_year.toFixed(2)} kWh/kWp/yr
        at a performance ratio of {cls.performance_ratio.toFixed(2)} (
        {cls.performance_ratio_source}), reporting basis {cls.reporting_basis}.
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        Largest contiguous patch {cls.contiguity.largest_ha.toFixed(3)} ha over{" "}
        {cls.contiguity.n_patches} patches at {cls.contiguity.connectivity}-way
        connectivity. {cls.contiguity.note}
      </p>
      {cls.note && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {cls.note}
        </p>
      )}
    </div>
  )
}

/**
 * Plant energy over the sited areas.
 *
 * The suitable area and the cropland-conflict area are drawn apart and are
 * never summed: the second is the same land counted against its current use,
 * and a total would erase the trade-off that is the result. The exceedance
 * band carries only the uncertainty component listed as included.
 */
function PlantEnergy({ energy }: { energy: EnergyModelAnalysis }) {
  const p = energy.plant
  const ex = p.exceedance
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Plant energy over the sited area</p>
        <p className="telemetry text-[10px] text-muted-foreground">
          basis {p.reporting_basis} · {ex.convention} convention
        </p>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {p.areas_note}
      </p>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {p.suitable.area_ha > 0 && (
          <PlantClassCard cls={p.suitable} density={p.capacity_density} />
        )}
        {p.cropland_conflict.area_ha > 0 && (
          <PlantClassCard
            cls={p.cropland_conflict}
            density={p.capacity_density}
          />
        )}
      </div>

      {p.restrictive.area_ha > 0 && (
        <div className="ar-raised px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-foreground">
              {p.restrictive.label}
            </span>
            <span className="telemetry text-sm text-foreground">
              {p.restrictive.area_ha.toFixed(3)} ha
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {p.restrictive.capacity_dc_mw == null
              ? "No capacity is reported for this class."
              : `Capacity ${p.restrictive.capacity_dc_mw.toFixed(2)} MW DC.`}{" "}
            {p.restrictive.note}
          </p>
        </div>
      )}

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Exceedance on {ex.n_years} years of annual global horizontal
          irradiation
        </p>
        <ul className="flex flex-col gap-1">
          {ex.levels.map((l) => (
            <li
              key={l.level}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="telemetry w-10 shrink-0 text-[11px]">
                P{l.level}
              </span>
              <span className="telemetry w-28 shrink-0 text-right text-[11px] text-foreground">
                {l.ghi_empirical_kwh_m2_year.toFixed(2)}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[11px] text-muted-foreground">
                ×{l.factor_empirical.toFixed(6)}
              </span>
              <span className="telemetry w-28 shrink-0 text-right text-[10px] text-muted-foreground">
                normal fit {l.ghi_normal_kwh_m2_year.toFixed(2)}
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-[10px] text-muted-foreground">
                ±{l.normal_fit_standard_error_kwh_m2.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Method applied: {ex.method_applied}. Mean{" "}
          {ex.mean_kwh_m2_year.toFixed(2)} kWh/m2/yr, standard deviation{" "}
          {ex.std_kwh_m2_year.toFixed(2)}, coefficient of variation{" "}
          {ex.cv_pct.toFixed(3)}%. {ex.convention_note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {ex.p50_note} {ex.normality.test} on the annual totals gives a
          statistic of {ex.normality.statistic.toFixed(5)} at p ={" "}
          {ex.normality.p_value.toFixed(4)}: {ex.normality.interpretation}.
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {ex.crosswalk.note} Exceedance P90{" "}
          {ex.crosswalk.exceedance_p90_kwh_m2_year.toFixed(2)} equals the
          statistical 10th percentile{" "}
          {ex.crosswalk.statistical_p10_kwh_m2_year.toFixed(2)} kWh/m2/yr.
          Energy is treated as {ex.linearity_assumption}.
        </p>
      </div>

      <div
        className="border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          What the band does and does not carry
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <div className="eyebrow !text-[9px]">included</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-[10px] leading-relaxed text-muted-foreground">
              {p.uncertainty.included.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow !text-[9px]">excluded</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-[10px] leading-relaxed text-muted-foreground">
              {p.uncertainty.excluded.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {p.uncertainty.statement} {p.uncertainty.dominant_term}
        </p>
      </div>

      <div
        className="border-t pt-3 text-[10px] leading-relaxed text-muted-foreground"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p>
          Capacity density {p.capacity_density.value_mw_dc_per_ha.toFixed(6)}{" "}
          MW DC per hectare on the{" "}
          {p.capacity_density.area_basis.replace(/_/g, " ")} basis, key{" "}
          {p.capacity_density.basis}, mounting{" "}
          {p.capacity_density.mounting.replace(/_/g, " ")}, buildable fraction{" "}
          {p.capacity_density.buildable_fraction.toFixed(2)}.{" "}
          {p.capacity_density.note}
        </p>
        <p className="mt-1">{p.capacity_density.source}</p>
        <p className="mt-1">
          Buildable fraction source: {p.capacity_density.buildable_fraction_source}
        </p>
        <p className="mt-1">
          Fleet DC/AC ratio {p.capacity_density.fleet_dc_ac_ratio.toFixed(6)}.{" "}
          {p.capacity_density.fleet_dc_ac_ratio_source}
        </p>
        <p className="mt-1">
          Energy density cross-check:{" "}
          {p.energy_density_cross_check.site_mwh_ha_year.toFixed(1)} against a
          published {p.energy_density_cross_check.reference_mwh_ha_year.toFixed(1)}{" "}
          MWh/ha/yr, a ratio of {p.energy_density_cross_check.ratio.toFixed(3)}{" "}
          on the {p.energy_density_cross_check.area_basis.replace(/_/g, " ")}{" "}
          basis. {p.energy_density_cross_check.note}
        </p>
        <p className="mt-1">
          Horizon shading derate {p.shading.derate.toFixed(4)},{" "}
          {p.shading.applied ? "applied" : "not applied"}. {p.shading.note}
        </p>
        <p className="mt-1">
          Slope limits {p.thresholds.slope_acceptable_deg} and{" "}
          {p.thresholds.slope_restrictive_deg} degrees.{" "}
          {p.thresholds.note}
        </p>
        <p className="mt-1">{p.limitations}</p>
      </div>
    </div>
  )
}

/**
 * The wind screening, in its own section.
 *
 * Its capacity factor is gross, carries no external validation and rests on a
 * power-law extrapolation above the highest level the reanalysis holds, while
 * the photovoltaic figure beside it is computed at a ratio benchmarked against
 * the Global Solar Atlas. The two are never placed in a shared comparison and
 * the qualifier is printed before the first number.
 */
function WindScreening({ wind }: { wind: WindAnalysis }) {
  const m = wind.measured
  const h = wind.hub
  const q = wind.data_quality
  const shear = q.shear
  const roseMax = Math.max(
    ...m.direction_energy_rose_50m.map((s) => Math.max(s.energy_pct, s.hours_pct)),
    0.001
  )
  const speedMax = Math.max(
    ...m.monthly_mean_speed_50m.map((r) => r.mean_speed_ms),
    0.001
  )

  return (
    <section className="ar-section p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="eyebrow">Wind screening</p>
          <Chip>separate product</Chip>
          <Chip>gross</Chip>
          <Chip>unvalidated</Chip>
        </div>
        <p className="telemetry text-[10px] text-muted-foreground">
          {wind.record_window} · {wind.record_years.toFixed(3)} years · cell
          centre {wind.grid_cell_centre[1]?.toFixed(3)},{" "}
          {wind.grid_cell_centre[0]?.toFixed(3)}
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {wind.qualifier}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {wind.assumptions.comparison_note}
      </p>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Carried by the reanalysis · no height extrapolation
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label="Mean speed 10 m"
            value={`${m.mean_speed_10m_ms.toFixed(4)} m/s`}
            sub="level held in the record"
          />
          <WaterFigure
            label="Mean speed 50 m"
            value={`${m.mean_speed_50m_ms.toFixed(4)} m/s`}
            sub="highest level held in the record"
          />
          <WaterFigure
            label="Weibull 50 m"
            value={`k ${m.weibull_k_50m.toFixed(4)}`}
            sub={`c ${m.weibull_c_50m_ms.toFixed(4)} m/s · ${m.weibull_fit_check_50m.estimator}`}
          />
          <WaterFigure
            label="Power density 50 m"
            value={`${m.wind_power_density_50m_w_m2.toFixed(2)} W/m2`}
            sub={`energy pattern factor ${m.energy_pattern_factor_50m.toFixed(4)}`}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {m.qualifier}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Weibull fit against the record: mean{" "}
          {m.weibull_fit_check_50m.weibull_mean_ms.toFixed(4)} against{" "}
          {m.weibull_fit_check_50m.empirical_mean_ms.toFixed(4)} m/s (
          {m.weibull_fit_check_50m.mean_error_pct.toFixed(3)}%), mean cube{" "}
          {m.weibull_fit_check_50m.weibull_mean_cube_m3s3.toFixed(3)} against{" "}
          {m.weibull_fit_check_50m.empirical_mean_cube_m3s3.toFixed(3)} m3/s3 (
          {m.weibull_fit_check_50m.mean_cube_error_pct.toFixed(3)}%). Air
          density mean {m.air_density_mean_kg_m3.toFixed(4)} kg/m3, range{" "}
          {m.air_density_min_kg_m3.toFixed(4)} to{" "}
          {m.air_density_max_kg_m3.toFixed(4)}. {m.humidity_note}
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          At the {wind.hub_height_m.toFixed(0)} m hub · extrapolated
        </p>
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
          {h.extrapolation.statement}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label="Hub speed"
            value={`${h.mean_speed_ms.toFixed(4)} m/s`}
            sub={`power law at ${wind.assumptions.shear_exponent.toFixed(4)}, ${h.extrapolation.height_ratio.toFixed(1)}x above the top level`}
          />
          <WaterFigure
            label="Gross capacity factor"
            value={`${h.gross_capacity_factor_pct.toFixed(3)}%`}
            sub={`no plant loss applied; ${h.gross_capacity_factor_no_density_correction_pct.toFixed(3)}% without the density correction`}
          />
          <WaterFigure
            label="Gross annual energy"
            value={`${h.gross_annual_energy_mwh_per_turbine.toFixed(1)} MWh`}
            sub={`per turbine over ${h.hours_per_year.toFixed(0)} hours; not to be multiplied by a plant size`}
          />
          <WaterFigure
            label="Power density"
            value={`${h.wind_power_density_w_m2.toFixed(2)} W/m2`}
            sub={`Weibull k ${h.weibull_k.toFixed(4)}, c ${h.weibull_c_ms.toFixed(4)} m/s`}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Operating regime: above cut-in{" "}
          {h.operating_regime.above_cut_in_pct.toFixed(3)}% of hours, at or
          above rated {h.operating_regime.at_or_above_rated_pct.toFixed(3)}%,
          above cut-out {h.operating_regime.above_cut_out_pct.toFixed(3)}%, on a
          curve with cut-in {h.operating_regime.cut_in_ms.toFixed(1)}, rated{" "}
          {h.operating_regime.rated_ms.toFixed(4)} and cut-out{" "}
          {h.operating_regime.cut_out_ms.toFixed(1)} m/s.
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {h.density_normalisation_note} {h.hours_per_year_note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Excluded from these figures: {h.excluded_losses.join("; ")}.
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">Field diagnostics</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WaterFigure
            label={`Hours below ${q.calm_threshold_ms} m/s`}
            value={`${(q.calm_fraction_pct["10m"] ?? 0).toFixed(3)}%`}
            sub={`at 10 m; 50 m ${(q.calm_fraction_pct["50m"] ?? 0).toFixed(3)}%, 2 m ${(q.calm_fraction_pct["2m"] ?? 0).toFixed(3)}%`}
          />
          <WaterFigure
            label="Record maximum 10 m"
            value={`${(q.record_maximum_ms["10m"] ?? 0).toFixed(2)} m/s`}
            sub={`over ${q.record_hours} hours; floor ${q.record_maximum_floor_ms.toFixed(1)} m/s, ${q.record_maximum_plausible ? "met" : "not met"}`}
          />
          <WaterFigure
            label="Shear exponent"
            value={shear.shear_exponent.toFixed(4)}
            sub={`10 m to 50 m long-term means; day ${shear.shear_exponent_day.toFixed(4)}, night ${shear.shear_exponent_night.toFixed(4)}`}
          />
          {/* Null when the exponent lies outside what a neutral logarithmic
              profile between 10 m and 50 m can produce for any roughness
              length. Rendered as a number it printed "0.000 m", a physically
              meaningful-looking roughness that was never computed, beside the
              flag stating that the inversion has no root. */}
          <WaterFigure
            label="Implied roughness"
            value={
              shear.implied_roughness_length_m == null
                ? "—"
                : `${shear.implied_roughness_length_m.toFixed(3)} m`
            }
            sub={
              shear.implied_roughness_length_m == null
                ? `no roughness length inverts this exponent; assumed cover ${shear.assumed_roughness_band_m.join(" to ")} m`
                : `assumed cover ${shear.assumed_roughness_band_m.join(" to ")} m, ${shear.consistent_with_assumed_cover ? "consistent" : "not consistent"}`
            }
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          The assumed roughness band supports a shear exponent of{" "}
          {shear.expected_shear_exponent_band.map((v) => v.toFixed(3)).join(" to ")}
          . {shear.roughness_band_note}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {q.record_maximum_floor_note} {q.calm_fraction_2m_note}
        </p>
        {q.flags.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {q.flags.map((f) => (
              <li
                key={f}
                className="border-l-2 pl-2 text-[10px] leading-relaxed text-muted-foreground"
                style={{ borderColor: PALETTE_STOPS.rdbu_r[14] }}
              >
                {f}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {q.all_checks_passed
            ? "Every record check passed."
            : `${q.flags.length} record check${q.flags.length === 1 ? "" : "s"} did not pass, so the hub figures rest on a series the checks do not support.`}{" "}
          Record {q.record_hours} hours against {q.expected_hours} expected.
        </p>
      </div>

      <div
        className="mt-3 border-t pt-3"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p className="eyebrow !text-[9px] mb-2">
          Hub result across the shear exponent
        </p>
        <ul className="flex flex-col gap-1">
          {wind.shear_sensitivity.map((s) => (
            <li
              key={`${s.basis}-${s.shear_exponent}`}
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <span className="telemetry w-16 shrink-0 text-[11px] text-foreground">
                {s.shear_exponent.toFixed(4)}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                {s.roughness_length_m == null
                  ? "—"
                  : `${s.roughness_length_m.toFixed(2)} m`}
              </span>
              <span className="min-w-[10rem] flex-1 truncate text-[10px] text-muted-foreground">
                {s.basis}
              </span>
              <span className="telemetry w-20 shrink-0 text-right text-[11px]">
                {s.hub_speed_ms.toFixed(4)} m/s
              </span>
              <span className="telemetry w-16 shrink-0 text-right text-[11px]">
                {s.capacity_factor_pct.toFixed(3)}%
              </span>
              <span className="telemetry w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                {s.annual_energy_mwh.toFixed(1)} MWh
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 lg:grid-cols-2"
           style={{ borderColor: "var(--ar-border)" }}>
        <div>
          <p className="eyebrow !text-[9px] mb-2">
            Mean speed at 50 m by month, m/s
          </p>
          <ul className="flex flex-col gap-1">
            {m.monthly_mean_speed_50m.map((r) => (
              <li key={r.month} className="flex items-center gap-2 text-xs">
                <span className="telemetry w-6 shrink-0 text-[10px] text-muted-foreground">
                  {String(r.month).padStart(2, "0")}
                </span>
                <span className="ar-track relative h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${(r.mean_speed_ms / speedMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[3],
                    }}
                  />
                </span>
                <span className="telemetry w-16 shrink-0 text-right text-[11px]">
                  {r.mean_speed_ms.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow !text-[9px] mb-2">
            Direction at 50 m · share of energy against share of hours
          </p>
          <ul className="flex flex-col gap-1">
            {m.direction_energy_rose_50m.map((s) => (
              <li key={s.sector} className="flex items-center gap-2 text-xs">
                <span className="telemetry w-10 shrink-0 text-[10px] text-muted-foreground">
                  {s.centre_deg.toFixed(1)}°
                </span>
                <span className="ar-track relative h-3 min-w-[4rem] flex-1 overflow-hidden rounded-sm">
                  <span
                    className="absolute inset-x-0 top-0 h-1.5"
                    style={{
                      width: `${(s.energy_pct / roseMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[2],
                    }}
                  />
                  <span
                    className="absolute inset-x-0 bottom-0 h-1.5"
                    style={{
                      width: `${(s.hours_pct / roseMax) * 100}%`,
                      backgroundColor: PALETTE_STOPS.rdbu_r[6],
                    }}
                  />
                </span>
                <span className="telemetry w-14 shrink-0 text-right text-[10px]">
                  {s.energy_pct.toFixed(2)}%
                </span>
                <span className="telemetry w-14 shrink-0 text-right text-[10px] text-muted-foreground">
                  {s.hours_pct.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Upper bar energy, lower bar hours; they differ because the power
            flux goes as the cube of speed. {m.direction.convention_note}{" "}
            Circular mean {m.direction.circular_mean_deg_50m.toFixed(2)}° at 50
            m and {m.direction.circular_mean_deg_10m.toFixed(2)}° at 10 m,
            median turning {m.direction.median_turning_deg.toFixed(1)}°.
          </p>
        </div>
      </div>

      <div
        className="mt-3 border-t pt-3 text-[10px] leading-relaxed text-muted-foreground"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p>
          Reference power curve: {wind.turbine.name},{" "}
          {(wind.turbine.rated_power_w / 1e6).toFixed(3)} MW,{" "}
          {wind.turbine.rotor_diameter_m.toFixed(0)} m rotor,{" "}
          {wind.turbine.blades} blades, {wind.turbine.iec_class} turbulence
          class {wind.turbine.turbulence_class}, hub{" "}
          {wind.turbine.hub_height_m.toFixed(0)} m,{" "}
          {wind.turbine.power_curve_points} curve points read from the{" "}
          {wind.turbine.power_curve_column} column. It is a reference curve, not
          a turbine selected for this site. {wind.turbine.drivetrain_note}
        </p>
        <p className="mt-1">{wind.turbine.citation}</p>
        <p className="mt-1">
          Hub height {wind.assumptions.hub_height_m.toFixed(0)} m:{" "}
          {wind.assumptions.hub_height_source} Shear exponent{" "}
          {wind.assumptions.shear_exponent.toFixed(4)}:{" "}
          {wind.assumptions.shear_exponent_source}
        </p>
        <p className="mt-1">{wind.assumptions.conventions_note}</p>
        <p className="mt-1">{wind.loads_note}</p>
        <p className="mt-1">{wind.grid_note}</p>
        <PowerProvenanceNote provenance={wind.power_provenance} />
      </div>
    </section>
  )
}

/**
 * The photovoltaic energy model over the AOI.
 *
 * Shares the radiation chain and the reported optimum with the solar resource
 * card above, so the two cannot disagree about one AOI. Every figure is shown
 * with the assumption that produced it, and the applied and derived yields are
 * shown together because they answer under different assumptions rather than
 * one correcting the other.
 */
function EnergyModelSection({ energy }: { energy: EnergyModelAnalysis }) {
  const d = energy.loss_waterfall.delivered
  const g = energy.geometry
  const mt = energy.module_type

  return (
    <section className="ar-section p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Photovoltaic energy model</p>
        <p className="telemetry text-[10px] text-muted-foreground">
          {energy.hourly_window} · {energy.climatology_window} ·{" "}
          {energy.lat.toFixed(2)}, {energy.lon.toFixed(2)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <WaterFigure
          label="Specific yield, applied"
          value={d.applied_kwh_kwp_year.toFixed(2)}
          sub={`kWh/kWp/yr at PR ${energy.performance_ratio.applied.toFixed(2)} (${energy.performance_ratio.applied_source}), basis ${d.reporting_basis}`}
        />
        <WaterFigure
          label="Specific yield, derived"
          value={d.derived_kwh_kwp_year.toFixed(2)}
          sub={`kWh/kWp/yr at PR ${energy.performance_ratio.derived.toFixed(4)}, this chain plus its declared terms`}
        />
        <WaterFigure
          label="Capacity factor"
          value={`${d.applied_capacity_factor_pct.toFixed(3)}%`}
          sub={`${d.derived_capacity_factor_pct.toFixed(3)}% on the derived ratio, a difference of ${d.difference_pct.toFixed(3)}%`}
        />
        <WaterFigure
          label="Optimum tilt"
          value={`${g.optimal_tilt_deg.toFixed(0)}°`}
          sub={`azimuth ${g.surface_azimuth_deg.toFixed(0)}° · plane-of-array ${g.poa_kwh_m2_year.toFixed(2)} kWh/m2/yr`}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {d.note}
      </p>

      <div
        className="mt-4 border-t pt-4"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <EnergyWaterfall energy={energy} />
      </div>

      <div
        className="mt-4 grid grid-cols-1 gap-4 border-t pt-4 lg:grid-cols-2"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <div>
          <p className="eyebrow mb-2">Checkpoints, outside the loss rows</p>
          <EnergyCheckpoints energy={energy} />
        </div>
        <PerformanceRatioScale energy={energy} />
      </div>

      <div
        className="mt-4 border-t pt-4"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <TrackingComparison energy={energy} />
      </div>

      <div
        className="mt-4 border-t pt-4"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <GenerationProfile energy={energy} />
      </div>

      <div
        className="mt-4 border-t pt-4"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <PlantEnergy energy={energy} />
      </div>

      <div
        className="mt-4 border-t pt-4 text-[10px] leading-relaxed text-muted-foreground"
        style={{ borderColor: "var(--ar-border)" }}
      >
        <p>
          Horizontal plane over the hourly window{" "}
          {g.ghi_hourly_kwh_m2_year.toFixed(2)} kWh/m2/yr; the same array laid
          flat receives {g.poa_horizontal_kwh_m2_year.toFixed(2)} kWh/m2/yr.
        </p>
        <p className="mt-1">
          Temperature coefficient {mt.gamma_pdc_per_c} per °C, module type{" "}
          {mt.module_type}. The alternatives are{" "}
          {Object.entries(mt.alternatives)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}
          . {mt.source}
        </p>
        <p className="mt-1">
          Transposition{" "}
          {energy.loss_waterfall.assumptions.transposition_model.value}:{" "}
          {energy.loss_waterfall.assumptions.transposition_model.source}
        </p>
        <p className="mt-1">
          Ground albedo {energy.loss_waterfall.assumptions.albedo.value}:{" "}
          {energy.loss_waterfall.assumptions.albedo.source}
        </p>
        <p className="mt-1">
          Wind field {energy.loss_waterfall.assumptions.wind_source.value}:{" "}
          {energy.loss_waterfall.assumptions.wind_source.source}
        </p>
        <p className="mt-1">
          Placing the declared losses physically rather than as one flat factor
          moves the yield by{" "}
          {energy.loss_waterfall.assumptions.flat_placement_bias_pct.value}%:{" "}
          {energy.loss_waterfall.assumptions.flat_placement_bias_pct.source}
        </p>
        <p className="mt-1">{energy.assumptions.resolution_note}</p>
        <p className="mt-1">{energy.assumptions.note}</p>
        <p className="mt-1">{energy.grid_note}</p>
        <PowerProvenanceNote provenance={energy.power_provenance} />
      </div>
    </section>
  )
}

/**
 * Which NASA POWER series the figures were read from, and when.
 *
 * POWER reprocesses historical data and the on-disk cache has no expiry, so a
 * run can be built on a superseded revision of the record. That is acceptable
 * only while the run says so: without this line a cached run and a fetched one
 * are indistinguishable on screen.
 */
function PowerProvenanceNote({
  provenance,
}: {
  provenance?: PowerProvenance | null
}) {
  if (!provenance) return null
  const series = [
    ["Daily", provenance.daily],
    ["Hourly", provenance.hourly],
  ] as const
  const present = series.filter(([, s]) => !!s)
  if (!present.length) return null
  return (
    <p className="mt-1">
      {present.map(([label, s], i) => (
        <span key={label}>
          {i > 0 ? " " : ""}
          {label} series{" "}
          {s!.source === "cache"
            ? `read from cache${s!.fetched_utc ? `, fetched ${s!.fetched_utc}` : ", fetch date not recorded"}`
            : "fetched during this run"}
          .
        </span>
      ))}
    </p>
  )
}
