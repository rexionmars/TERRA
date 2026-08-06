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
  InferenceRun,
  PredictResult,
  Project,
  ProjectOverlay,
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
import { compositionCaption, parseOverlayMeta } from "@/lib/projectOverlays"
import { MAPBIOMAS_CLASS_LEGEND } from "@/lib/classPalette"
import {
  classifiedAreaHa,
  dominantClass,
  formatHectares,
  parseRunSummary,
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

/** Headline figures from a saved solar run's summary. */
function solarSummaryLine(summary?: string | null): string {
  if (!summary?.trim()) return "solar resource"
  try {
    const j = JSON.parse(summary) as Record<string, unknown>
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
    return [ghi, tilt, y].filter(Boolean).join(" \u00b7 ") || "solar resource"
  } catch {
    return "solar resource"
  }
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

function modelDisplayName(kind: string): string {
  if (kind === "temporal_transformer") return "Temporal Transformer"
  if (kind === "prithvi") return "Prithvi-EO 2.0"
  if (kind === "spectral" || kind === "") return "Random Forest"
  // Anything else names itself. The old fallback returned Random Forest for
  // every unknown value, so a solar run recorded as NASA POWER was listed as a
  // classification by a model that never touched it.
  return kind
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

  const canExportTables =
    !!result.solar ||
    !!result.solar_siting ||
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
      const pack = {
        ...result,
        overlay_uri: "",
        confidence_uri: "",
        ndvi_mean_uri: "",
        true_color_uri: "",
        reference_uri: "",
        lulc: result.lulc
          ? { ...result.lulc, map_uri: "", map_png: "" }
          : result.lulc,
        water: result.water
          ? { ...result.water, occurrence_uri: "" }
          : result.water,
      }
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

          {(hasClassification && result.class_stats?.length > 0) ||
          viChart.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
              {hasClassification && result.class_stats?.length > 0 && (
                <section className="ar-section p-4">
                  <p className="eyebrow mb-3">Predicted class distribution</p>
                  <ul className="flex flex-col gap-1.5">
                    {result.class_stats.map((s) => (
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

              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {result.solar.grid_note}
              </p>
            </section>
          )}

          {result.solar_siting && (
            <section className="ar-section p-4">
              <p className="eyebrow mb-3">Photovoltaic siting</p>
              <div className="mb-3 grid grid-cols-2 gap-3">
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
                        {/* Solar counts years of climatology, not scenes: it
                            never reads one. */}
                        {r.n_dates} {r.kind === "solar" ? "years" : "scenes"}
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
                          ? `Solar resource · ${r.model_kind || "NASA POWER"}`
                          : modelDisplayName(r.model_kind)}
                      {" · "}
                      {r.kind === "solar" ? null : summary.dateRange ? (
                        <>
                          observed {summary.dateRange[0]} → {summary.dateRange[1]}
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
