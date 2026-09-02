import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  Columns2,
  Download,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  History,
  LandPlot,
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
  Tooltip,
  ResponsiveContainer,
  Label,
  Legend,
} from "recharts"
import { useAuth } from "@/lib/auth"
import { PageBody, PageShell } from "@/components/ui/PageShell"
import { btnGhost, btnGhostDense, btnIcon, btnPrimary, btnPrimaryCommit } from "@/components/ui/buttons"
import type { MapToolId } from "@/lib/mapTools"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import type {
  InferenceRun,
  PredictResult,
  Project,
  ProjectOverlay,
} from "@/lib/types"
import {
  CreateProject,
  DeleteAnalysis,
  ListAreas,
  DeleteProject,
  ExportClassification,
  ExportOverlayFile,
  ExportResearchPack,
  ListProjectOverlays,
  ListProjectRuns,
  LoadAnalysis,
  SetRunProject,
} from "../../wailsjs/go/main/App"
import { toAreas, type Area } from "@/lib/areas"
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
  Chip,
  ContinuousRamp,
  PanelTile,
  rampStop,
  WaterFigure,
} from "@/components/analysisPrimitives"
import {
  classifiedAreaHa,
  dominantClass,
  formatHectares,
  modelDisplayName,
  parseRunSummary,
  runKindLabel,
  runSummaryObject,
  solarProductLabel,
} from "@/lib/runSummary"
import { qualifierHead } from "@/components/flood/floodFormat"
import {
  gapLimitMs,
  dateToMs,
  insertTimeGaps,
  timeAxisProps,
  timeLabelFormatter,
  timeTickFormatter,
} from "@/lib/chartAxis"


/**
 * The vegetation index series, one colour each.
 *
 * Data encoding rather than chrome, so these stay outside the sand palette: the
 * three curves share an axis and have to be told apart, which a family of one
 * hue cannot do.
 */
/**
 * The three index series, with a redundant channel each.
 *
 * The colours live in index.css, one value per theme, because no single hex
 * clears 3:1 against both a near-black and a near-white ground -- the previous
 * triple was tuned for the dark theme and measured 2.17, 2.04 and 2.04 on the
 * light one, under WCAG's floor for a non-text graphic on all three.
 *
 * The dash pattern is the second channel. Nature's guidance lists "relying
 * solely on colour for definition" among the things to avoid, and the measured
 * reason here is specific: converted to greyscale the old blue and amber were
 * the same value to eight decimals, so a desaturated chart showed one line
 * where there were three.
 */
const VI_LINES = [
  { key: "ndvi", label: "NDVI", stroke: "var(--series-ndvi)", dash: undefined },
  { key: "evi", label: "EVI", stroke: "var(--series-evi)", dash: "6 3" },
  { key: "savi", label: "SAVI", stroke: "var(--series-savi)", dash: "2 3" },
] as const

/**
 * One colour per product kind, declared once because two of these have to agree
 * across the file.
 *
 * `water` is read twice -- the dot beside a saved water run and the stroke of
 * the water fraction curve -- and the two saying the same thing is the point.
 * Written as literals in both places, they agreed by coincidence, and an edit
 * to one would have separated them silently. That is exactly how the two copies
 * of RdYlGn in compositeCatalog.ts drifted apart at every stop.
 *
 * `wind` is deliberately not the water blue: the two resolve on different
 * reanalyses and should not read as one product.
 *
 * `flood` is the darkest stop of the blues ramp the agreement raster is drawn
 * with (lib/palettes.ts), which is the colour of its unanimous class. It is
 * water-coloured on purpose and distinct from `water` on purpose: both are
 * about water on the ground, and one is an observed surface-water record while
 * the other is a terrain index with no observation in it at all.
 */
const PRODUCT_COLOR = {
  solar: "#f59e0b",
  water: "#3182bd",
  wind: "#2a9d8f",
  flood: "#07306b",
} as const

type ProjectTab = "analyses" | "compositions"

/** Project detail sections, in tab order. Drives the ARIA tabs wiring below. */
/*
  Named for what the tab opens on. It said "Runs", and opened on every run of
  the project in one grid; it opens on the project's GROUNDS now, and the runs
  are one level in. The id stays "analyses" because it is written into no
  stored state and renaming it would touch every reference for nothing.
*/
const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "analyses", label: "Areas" },
  { id: "compositions", label: "Compositions" },
]

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

/**
 * What a saved flood envelope produced, from the summary already in memory.
 *
 * Every part is optional and an absent one is dropped rather than defaulted: a
 * run written before a key existed must not be described with a figure nobody
 * measured. The contested share is the headline because it is what the
 * analysis is for -- how much of the wet extent the choice of DEM decides
 * rather than the terrain.
 */
function floodSummaryLine(summary?: string | null): string {
  const j = runSummaryObject(summary)
  const contested =
    typeof j.flood_contested_frac_of_wet === "number"
      ? `${(j.flood_contested_frac_of_wet * 100).toFixed(0)}% of the wet extent contested`
      : ""
  const unanimous =
    typeof j.flood_unanimous_wet_km2 === "number"
      ? `${j.flood_unanimous_wet_km2.toFixed(3)} km2 unanimous`
      : ""
  // The range at the reference threshold, which persistFloodRun stores only
  // when a pair was defined there. Both ends or neither: half a range names
  // nothing.
  const range =
    typeof j.flood_iou_min === "number" && typeof j.flood_iou_max === "number"
      ? `IoU ${j.flood_iou_min.toFixed(3)}–${j.flood_iou_max.toFixed(3)}`
      : ""
  const products =
    typeof j.flood_n_products === "number"
      ? `${j.flood_n_products} DEM products`
      : ""
  return (
    [contested, unanimous, range, products].filter(Boolean).join(" \u00b7 ") ||
    "flood envelope"
  )
}

/**
 * The qualifier that travels with a contested share in the run list.
 *
 * The sidecar's own sentence when the run stored one, cut to its first clause
 * for a row that has one line to give it: a summary written here instead would
 * be a second qualifier able to disagree with the one the payload carries. The
 * fallback is for rows written before the key existed, and states the claim
 * these figures cannot support -- that this is the reproducibility range the
 * study published, over a product set it never measured.
 */
function floodQualifierLine(summary?: string | null): string {
  const stored = runSummaryObject(summary).qualifier
  const head = typeof stored === "string" ? qualifierHead(stored) : ""
  return (
    head ||
    "TERRA's own measurement over its own DEM set, not the study's published " +
      "range; HAND ranks susceptibility and is not a flood depth."
  )
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

/**
 * Stands for "the runs of this project that are of no area".
 *
 * A run carries an area only when it was made over one. One restored from a
 * shape that was never catalogued carries none, and without a row to select it
 * would be listed nowhere -- present in the database, absent from the only
 * place that lists runs.
 */
const LOOSE_RUNS = "__loose__"

interface AnalysisPageProps {
  result: PredictResult | null
  modelKind: string
  areaLabel?: string
  /** Current AOI polygon as GeoJSON text (geometry or Feature). */
  polygonGeoJSON?: string
  loadingRun?: boolean
  onOpenRun: (run: InferenceRun) => Promise<void>
  onBackToList: () => void

  /** Starts a run of the chosen product; see startNewRun in App.tsx. */
  onStartRun: (product: MapToolId | "energy") => void
  /** Rename the active AOI (same path as map context-menu rename). */
  onAreaLabelChange?: (label: string) => void
  /** Set map active project when opening a project from the hub. */
  onActivateProject?: (projectId: string) => void | Promise<void>
  /** Show a saved band composition on the map (then navigate via goStudio). */
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
  areaLabel,
  polygonGeoJSON,
  loadingRun,
  onOpenRun,
  onBackToList,

  onStartRun,
  onAreaLabelChange,
  onActivateProject,
  onShowComposition,
  activeProjectId,
}: AnalysisPageProps) {
  const { goStudio, runs, refreshRuns, projects, refreshProjects } = useAuth()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [comparing, setComparing] = useState(false)
  const [hubView, setHubView] = useState<"list" | "detail" | "unassigned">("list")
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectRuns, setProjectRuns] = useState<InferenceRun[]>([])
  /*
    The middle level: Project > AREA > runs.

    The hub grouped by project alone and put every run of it in one flat grid,
    which is what let a project holding several fields read as one subject --
    fifty-eight runs under a single name with nothing saying which ground each
    was over. `selectedAreaId` is null while that project's grounds are being
    listed and holds one while its runs are.
  */
  const [projectAreas, setProjectAreas] = useState<Area[]>([])
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [projectOverlays, setProjectOverlays] = useState<ProjectOverlay[]>([])
  const [openedOverlay, setOpenedOverlay] = useState<ProjectOverlay | null>(null)
  /** Project detail sub-view: analyses first; compositions behind a tab. */
  const [projectTab, setProjectTab] = useState<ProjectTab>("analyses")
  const tabRefs = useRef<Partial<Record<ProjectTab, HTMLButtonElement | null>>>(
    {}
  )
  const [pendingDeleteRun, setPendingDeleteRun] = useState<InferenceRun | null>(
    null
  )
  const [deletingRun, setDeletingRun] = useState(false)
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
      // The project's runs, its grounds and its compositions together: the
      // three lists the detail view can show, and one round trip decides which
      // of them has anything in it.
      const [r, a, o] = await Promise.all([
        ListProjectRuns(projectId, 50) as unknown as Promise<InferenceRun[]>,
        ListAreas(projectId),
        ListProjectOverlays(projectId) as unknown as Promise<ProjectOverlay[]>,
      ])
      setProjectRuns(r ?? [])
      setProjectAreas(toAreas(a ?? []))
      setProjectOverlays(o ?? [])
    } catch (e) {
      notifyError("Could not load project", e)
      setProjectRuns([])
      setProjectAreas([])
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
      setProjectAreas([])
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

  /*
    A ground belongs to one project, so leaving the project leaves the ground.

    Without this the area selected in the previous project survives into the
    next one, where it matches nothing: the runs list would be empty and the
    heading would name a field that is not in this project.
  */
  useEffect(() => {
    setSelectedAreaId(null)
  }, [selectedProjectId, hubView])

  const handleOpenRun = useCallback(
    async (run: InferenceRun) => {
      setOpenedOverlay(null)
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

  /*
    Every run of the open project, whichever ground it is of.

    Distinct from `scopedRuns`, which narrows further to the selected area.
    The area list needs this one: it counts the runs of no ground, and a count
    taken from the already-narrowed list would count the runs of whatever area
    happened to be open.
  */
  const scopedProjectRuns = useMemo(() => {
    if (hubView !== "detail" || !selectedProjectId) return []
    // Belt-and-suspenders: never mix in legacy/unassigned runs.
    return projectRuns.filter(
      (r) => !r.project_id || r.project_id === selectedProjectId
    )
  }, [hubView, projectRuns, selectedProjectId])

  const scopedRuns = useMemo(() => {
    if (hubView === "detail" && selectedProjectId) {
      const ofProject = scopedProjectRuns
      if (!selectedAreaId) return ofProject
      // The sentinel for runs of no ground: a run put back from a shape that
      // was never made an area. They are reachable rather than hidden, which
      // is the same argument the projectless board is kept for.
      if (selectedAreaId === LOOSE_RUNS) {
        return ofProject.filter((r) => !r.area_id)
      }
      return ofProject.filter((r) => r.area_id === selectedAreaId)
    }
    if (hubView === "unassigned") {
      return projectRuns.filter((r) => !r.project_id)
    }
    if (selectedProjectId) {
      return runs.filter((r) => r.project_id === selectedProjectId)
    }
    return runs
  }, [hubView, projectRuns, runs, selectedProjectId, selectedAreaId, scopedProjectRuns])

  /**
   * The list's own heading, which only earns one where nothing above it says
   * the same thing.
   *
   * Inside a project the page already carries the name as its title and the
   * open tab already says which list this is, so `Analyses · Jose de Freitas`
   * was the third statement of both before a single row appeared.
   */
  const panelTitle = useMemo(() => {
    if (hubView === "unassigned") return "Unassigned runs"
    if (selectedProject) return undefined
    return "Saved runs"
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

  /*
    Asked through the application's own dialog, not the webview's.

    This guarded on `window.confirm`, which the host has to implement for a
    WKWebView to show at all -- where it does not, the call returns false and
    the deletion never runs, so the button reads as doing nothing. The project
    deletion a few lines up already had a modal; runs were the one act still
    asking the platform.
  */
  const handleDeleteRun = useCallback(
    async (run: InferenceRun) => {
      setDeletingRun(true)
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
        notifySuccess("Analysis deleted")
        setPendingDeleteRun(null)
      } catch (e) {
        notifyError("Could not delete analysis", e)
      } finally {
        setDeletingRun(false)
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

  if (!result) {
    /*
      Scoped to the hub, where the list IS the screen. It used to be built out
      here and placed a third time at the foot of an open analysis, so reading
      one result ended in the roster of every other one -- a list of forty-eight
      runs answering a question the reader had already left behind. The header
      of the detail view carries "Saved analyses" for going back, and comparing,
      deleting and assigning all live on the hub the button returns to.
    */
    /*
      The project's grounds, as the level between the project and its runs.

      Each row is one area and says how many runs are of it. A project with one
      field reads as one row, which is the shape it always had; a project with a
      dozen no longer reads as one subject with a hundred runs under it, which
      is what the flat grid made of it.

      A row for the runs of no ground appears only when there are some. Offering
      an empty category is a question the reader then has to answer to find out
      there was nothing in it.
    */
    const looseCount = scopedProjectRuns.filter((r) => !r.area_id).length
    const areasPanel = (
      <section className="flex flex-col gap-2">
        {projectAreas.length === 0 && looseCount === 0 ? (
          <p className="rounded-sm border border-border bg-secondary px-3 py-4 text-body text-muted-foreground">
            No areas yet. Open this project on the map and draw one; the runs
            you make over it are filed under it.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {projectAreas.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedAreaId(a.id)}
                  className="group flex w-full items-center gap-2.5 rounded-sm border border-border bg-secondary/50 px-3 py-2.5 text-left transition-colors hover:bg-secondary"
                >
                  <LandPlot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body text-foreground group-hover:text-primary">
                    {a.name}
                  </span>
                  <span className="telemetry shrink-0 text-meta text-muted-foreground">
                    {a.run_count} {a.run_count === 1 ? "run" : "runs"}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
            {looseCount > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setSelectedAreaId(LOOSE_RUNS)}
                  className="group flex w-full items-center gap-2.5 rounded-sm border border-dashed border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary"
                >
                  <LandPlot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body text-muted-foreground group-hover:text-foreground">
                    Not filed under an area
                  </span>
                  <span className="telemetry shrink-0 text-meta text-muted-foreground">
                    {looseCount} {looseCount === 1 ? "run" : "runs"}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )}
          </ul>
        )}
      </section>
    )

    const selectedArea =
      selectedAreaId && selectedAreaId !== LOOSE_RUNS
        ? (projectAreas.find((a) => a.id === selectedAreaId) ?? null)
        : null

    const areaCrumb = selectedAreaId ? (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedAreaId(null)}
          className={btnGhost}
        >
          <ArrowLeft className="h-3 w-3" />
          Areas
        </button>
        <span className="truncate text-body text-foreground">
          {selectedArea?.name ?? "Not filed under an area"}
        </span>
      </div>
    ) : null

    const runsPanel = (
      <SavedRunsPanel
        title={panelTitle}
        /*
          The list is filtered by project and by nothing else, so it holds every
          run kind -- classification, surface water, solar and wind alike. The
          caption named only the first and even listed its three models, twenty
          lines above the code that branches on r.kind to draw the other three.
          Inside a project it says nothing at all now: the tab above already does.
        */
        caption={
          hubView === "unassigned"
            ? "Runs of any product not yet assigned to a project."
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
        onDelete={(run) => setPendingDeleteRun(run)}
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

    const hubSelection =
      hubView === "list"
        ? ("all" as const)
        : hubView === "unassigned"
          ? ("unassigned" as const)
          : selectedProjectId ?? "all"

    const hubActions = (
      <>
        <NewRunMenu onStart={onStartRun} />
        <button
          type="button"
          onClick={() => {
            void (async () => {
              if (selectedProjectId && onActivateProject) {
                await onActivateProject(selectedProjectId)
              }
              goStudio()
            })()
          }}
          className={btnGhost}
        >
          <MapIcon className="h-3.5 w-3.5" />
          Go to map
        </button>
      </>
    )

    return (
      <div className="app-no-drag relative flex h-full min-h-0 flex-col overflow-hidden">
        <ProjectsHub
          projects={projects}
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
                /*
                  One line, not a card. A card announces a region of content;
                  this is a single fact and two actions on it, and boxed it took
                  the same weight as the list of 48 runs below.
                */
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  {/*
                    A PROJECT HAS GROUNDS, NOT AN AOI. This printed
                    `label || area_id || "Custom polygon"` from the project row
                    -- one shape per project, which is the model being replaced:
                    a project working a dozen fields still showed a single line
                    naming one of them, and nothing said the other eleven were
                    there. Those three columns lose their last reader here.
                  */}
                  <p className="text-body text-muted-foreground">
                    <span className="eyebrow mr-2">Areas</span>
                    {projectAreas.length === 0
                      ? "None drawn yet"
                      : `${projectAreas.length} ${projectAreas.length === 1 ? "ground" : "grounds"}`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (onActivateProject) {
                            await onActivateProject(selectedProject.id)
                          }
                          goStudio()
                        })()
                      }}
                      className={btnGhost}
                    >
                      <MapIcon className="h-3 w-3" />
                      Open on map
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteProjectId(selectedProject.id)}
                      className={cn(btnGhost, "hover:text-destructive-quiet")}
                      title="Delete project, its areas and their runs"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {hubView === "detail" && (
                /*
                  An underlined rule, not a filled segmented control.

                  Each tab was flex-1 inside a bordered plate, so the two split
                  the full width and the active one painted half the screen in
                  full accent -- an enormous amount of colour and space spent
                  saying which of two lists is open. Sized to its label and
                  marked by a 2px rule, the same statement costs a line.
                */
                <div
                  className="flex gap-4 border-b border-border"
                  role="tablist"
                  aria-label="Project sections"
                >
                  {PROJECT_TABS.map((tab) => {
                    const active = projectTab === tab.id
                    /*
                      What the tab is about to show, not what is behind it. The
                      analyses tab opens on the project's grounds, so it counts
                      those; once one is open it counts that ground's runs,
                      which is what is then on screen.
                    */
                    const count =
                      tab.id !== "analyses"
                        ? projectOverlays.length
                        : selectedAreaId
                          ? scopedRuns.length
                          : projectAreas.length + (looseCount > 0 ? 1 : 0)
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
                          "-mb-px flex h-8 items-center gap-1.5 border-b-2 px-0.5 text-body font-medium transition-colors",
                          active
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {tab.label}
                        {count > 0 ? (
                          <span
                            className={cn(
                              "telemetry rounded-sm px-1 text-micro",
                              active
                                ? "bg-primary/20 text-accent-quiet"
                                : "bg-secondary text-muted-foreground"
                            )}
                          >
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
                  className="rounded-sm border border-border bg-secondary/50 p-4"
                  role="tabpanel"
                  id={tabPanelId("compositions")}
                  aria-labelledby={tabId("compositions")}
                >
                  <p className="eyebrow mb-1 !text-muted-foreground">
                    Band compositions
                  </p>
                  <p className="mb-3 text-body text-muted-foreground">
                    RGB / indices applied from Compositions on the map. Click a
                    card for a preview modal.
                  </p>
                  {projectOverlays.length === 0 ? (
                    <p className="rounded-sm border border-border bg-secondary px-3 py-4 text-body text-muted-foreground">
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
                            className="rounded-sm border border-border bg-secondary group w-full overflow-hidden text-left transition-colors hover:bg-secondary/40"
                          >
                            <div className="rounded-sm border border-border bg-background aspect-square border-0">
                              {o.overlay_uri ? (
                                <img
                                  src={o.overlay_uri}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                            </div>
                            <div className="px-1.5 py-1">
                              <p className="truncate text-meta text-foreground group-hover:text-primary">
                                {o.title}
                              </p>
                              {/* Scene date and band triplet identify a
                                  composition; the title alone does not. */}
                              {compositionCaption(o.meta_json) && (
                                <p className="telemetry truncate text-micro text-muted-foreground">
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
                /*
                  Only a tab panel under the detail view; the unassigned view
                  renders the same list with no tablist above it.

                  TWO LEVELS INSIDE THE TAB. Without a ground chosen it lists
                  the project's grounds; with one, that ground's runs under a
                  way back. The tab used to open straight onto every run of the
                  project in one grid, which is the shape that let a project
                  holding several fields read as a single subject.
                */
                <div
                  role="tabpanel"
                  id={tabPanelId("analyses")}
                  aria-labelledby={tabId("analyses")}
                  className="flex flex-col gap-3"
                >
                  {areaCrumb}
                  {selectedAreaId ? runsPanel : areasPanel}
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
                goStudio()
              })()
            }}
          />
        ) : null}
        {pendingDeleteRun ? (
          <ConfirmDelete
            eyebrow="DELETE RUN"
            title={<>Delete “{displayRunLabel(pendingDeleteRun.label)}”?</>}
            subtitle="This cannot be undone. The run leaves this list, its project and the exports."
            confirmLabel="Delete run"
            busy={deletingRun}
            onCancel={() => {
              if (!deletingRun) setPendingDeleteRun(null)
            }}
            onConfirm={() => void handleDeleteRun(pendingDeleteRun)}
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
  /**
   * The index series on a real time axis, with its gaps left open.
   *
   * Keyed on the date string, recharts drew a category axis: every acquisition
   * at the same horizontal spacing whatever the interval. Sentinel-2 revisits
   * every five days at best and cloud masking makes the usable series
   * irregular, so a month and a week were drawn the same width and every slope
   * on the chart was wrong by whatever the gaps happened to be.
   *
   * A break is inserted where the interval is long relative to this run's own
   * cadence -- see gapLimitMs. Drawn through, a straight segment across a
   * six-week cloud gap asserts observations that were never made, and it is
   * indistinguishable from a segment across three good acquisitions.
   *
   * Relative to the cadence rather than a fixed number of days, because the
   * fixed 16-day rule that was here broke almost every real series: monthly
   * -best selection returns one scene per month, so the ordinary interval is
   * 30 days and every segment qualified as a gap.
   *
   * NOT memoised, deliberately. This point in the component is past two early
   * returns -- the hub and the project views render and return above it -- so a
   * hook here runs on one render path and not the other. React counts a
   * different number of hooks between renders and unmounts the tree, which
   * shows as the whole window going black the moment an analysis is opened.
   * The arrays are a few dozen rows; the render around them costs far more.
   */
  const viTimes = viSeries
    .map((p) => dateToMs(p.date))
    .filter((t) => Number.isFinite(t))
  const viSpan =
    viTimes.length > 1 ? Math.max(...viTimes) - Math.min(...viTimes) : 0
  /** Tick precision follows the span; see lib/chartAxis.ts. */
  const viAxis = { tickFormatter: timeTickFormatter(viSpan) }

  // The break threshold comes from this run's own cadence: monthly-best
  // selection samples once a month by construction, and a fixed 16-day rule
  // severed every segment of such a series.
  const viChart = insertTimeGaps(
    viSeries.map((p) => ({
      t: dateToMs(p.date),
      ndvi: p.ndvi_mean,
      evi: p.evi_mean,
      savi: p.savi_mean,
    })),
    gapLimitMs(viTimes)
  )

  // Same treatment for surface water: it is the same cloud-screened Sentinel-2
  // calendar, so it has the same irregular spacing and the same gaps.
  const waterRows = (result.water?.series ?? []).map((d) => ({
    t: dateToMs(d.date),
    water: d.water_fraction_pct,
  }))
  const waterTimes = waterRows.map((r) => r.t).filter((t) => Number.isFinite(t))
  const waterSpan =
    waterTimes.length > 1 ? Math.max(...waterTimes) - Math.min(...waterTimes) : 0
  const waterChart = insertTimeGaps(waterRows, gapLimitMs(waterTimes))

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
  /** Classified pixels behind the distribution: the sum of the class counts. */
  const classifiedPixels = (result.class_stats ?? []).reduce(
    (n, s) => n + (s.pixels ?? 0),
    0
  )

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
    <div className="rounded-sm border border-border bg-secondary flex min-h-[4.25rem] flex-col justify-center px-2.5 py-2">
      <div className="eyebrow">{label}</div>
      <div className="telemetry mt-0.5 text-emphasis text-foreground">
        {value == null ? "—" : `${Number(value).toFixed(value % 1 === 0 ? 0 : 2)}${suffix}`}
      </div>
    </div>
  )

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
    <PageShell className="flex-col">
      {/*
        The title stays where the settings header could not: it is the subject
        of the page and it carries the rename, which nothing else offers. What
        goes is the "ANALYSIS" eyebrow above it -- the title bar states the
        screen already -- and the separate banded header it sat in, which cost a
        full row of height to hold one line of text.
      */}
      <header className="shrink-0 px-4 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-semibold tracking-wide xl:text-2xl">
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
                <span className="telemetry shrink-0 text-meta text-muted-foreground">
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
                  className="rounded-sm border border-border bg-background min-w-0 flex-1 px-2 py-1 text-sm font-medium text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="submit"
                  className={cn(btnIcon, "text-primary")}
                  title="Save AOI name"
                >
                  <Check className="size-4" />
                </button>
              </form>
            ) : onAreaLabelChange || areaLabel ? (
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <span className="telemetry shrink-0 text-meta text-muted-foreground">
                  AOI
                </span>
                {onAreaLabelChange ? (
                  <button
                    type="button"
                    onClick={startTitleRename}
                    title="Rename AOI"
                    className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-secondary"
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
                  {/*
                    Named for what it is, and shown with the floor it cannot go
                    below. It is the mean of max(predict_proba) -- the share of
                    the ensemble that voted for the winning class -- so over K
                    classes it lives on [1/K, 1]. Printed as "mean conf 38%" it
                    read on a 0-100 scale it does not occupy: over five classes
                    that is a fifth of the way from maximum uncertainty to
                    certainty, not a third. It is also not a calibrated
                    probability of being correct, which is why it no longer
                    says "confidence".
                  */}
                  {result.mean_confidence > 0 && (
                    <>
                      {" "}
                      · mean vote share{" "}
                      {(result.mean_confidence * 100).toFixed(0)}%
                      {result.confidence_floor
                        ? ` (floor ${(result.confidence_floor * 100).toFixed(0)}%)`
                        : ""}
                    </>
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
                  goStudio()
                })()
              }}
              className={btnGhost}
            >
              <MapIcon className="h-3 w-3" />
              View on map
            </button>
            <NewRunMenu onStart={onStartRun} variant="ghost" />
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
                className={btnPrimary}
              >
                <Download className="h-3 w-3" />
                Export GeoTIFF
              </button>
            )}
          </div>
        </div>
      </header>

      <PageBody>
        <div className="flex w-full flex-col gap-3 p-4">
          {lulc && <LulcSection lulc={lulc} />}

          {hasClassification && (
            <section className="rounded-sm border border-border bg-secondary/50 p-4">
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
                style={{ borderColor: "var(--border)" }}
              >
                {MAPBIOMAS_CLASS_LEGEND.map((c) => (
                  <span
                    key={c.id}
                    className="flex items-center gap-1.5 text-meta text-muted-foreground"
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
                <section className="rounded-sm border border-border bg-secondary/50 p-4">
                  <p className="eyebrow mb-1">Predicted class distribution</p>
                  {/*
                    The denominator, and what the hectares are and are not.

                    Areas here are pixel counts times the nominal pixel area.
                    That is a biased estimator: omission and commission do not
                    cancel, so the figure carries an error the map alone cannot
                    bound (Olofsson et al. 2013). Stated, because a column of
                    hectares to one decimal reads as measurement.
                  */}
                  <p className="mb-3 text-[10px] text-muted-foreground">
                    {classifiedPixels > 0
                      ? `n = ${classifiedPixels.toLocaleString()} classified pixels at 10 m · `
                      : ""}
                    area from pixel count, uncorrected for classification error
                  </p>
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
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-sm bg-background">
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
                <section className="rounded-sm border border-border bg-secondary/50 p-4">
                  <p className="eyebrow mb-3">Vegetation indices · AOI mean</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart
                      data={viChart}
                      margin={{ top: 6, right: 14, left: 4, bottom: 22 }}
                    >
                      {/*
                        No gridlines. Nature's figure specification lists
                        "background gridlines" among the things it avoids for
                        graphs, and with five ticks on a panel this narrow the
                        eye reaches the axis without them.
                      */}
                      <XAxis
                        {...timeAxisProps}
                        {...viAxis}
                        stroke="var(--border)"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickMargin={6}
                        minTickGap={28}
                      >
                        <Label
                          value="Acquisition date"
                          position="insideBottom"
                          offset={-14}
                          style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                        />
                      </XAxis>
                      {/*
                        The domain is the data, not a forced 0..1. Clipped at
                        -0.1 it also cut the negative half of a range the index
                        is defined on: water and cloud shadow sit below zero,
                        and the chart silently dropped them.
                      */}
                      <YAxis
                        domain={["auto", "auto"]}
                        stroke="var(--border)"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickFormatter={(v: number) => v.toFixed(2)}
                        width={48}
                      >
                        <Label
                          value="Index value (dimensionless)"
                          angle={-90}
                          position="insideLeft"
                          style={{
                            fontSize: 12,
                            fill: "var(--muted-foreground)",
                            textAnchor: "middle",
                          }}
                        />
                      </YAxis>
                      <Tooltip
                        labelFormatter={timeLabelFormatter}
                        formatter={(v: number) => v.toFixed(2)}
                        contentStyle={{
                          backgroundColor: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          fontSize: 11,
                        }}
                      />
                      {/*
                        Above the plot, not below it.

                        Recharts lays a bottom legend in the same band the axis
                        title occupies, and the two were drawn on top of each
                        other: "Acquisition date" read through the NDVI/EVI/SAVI
                        keys. The axis title has to stay under the axis it
                        names, so the legend is what moves.
                      */}
                      <Legend
                        verticalAlign="top"
                        align="right"
                        height={20}
                        wrapperStyle={{ fontSize: 11, paddingBottom: 2 }}
                        iconType="plainline"
                      />
                      {VI_LINES.map((s) => (
                        <Line
                          key={s.key}
                          // Linear, not monotone. A spline draws curvature
                          // between two observations that the sampling does not
                          // support, and the phenology metrics printed beside
                          // this chart are computed on a linear interpolation --
                          // so the figure and the number disagreed about the
                          // same data.
                          type="linear"
                          dataKey={s.key}
                          name={s.label}
                          stroke={s.stroke}
                          strokeWidth={1.8}
                          // A second channel, so colour is never the only one.
                          strokeDasharray={s.dash}
                          // The observations themselves. Hidden, a reader could
                          // not tell a measurement from an interpolation, which
                          // is what made the two defects above invisible.
                          dot={{ r: 1.8, strokeWidth: 0, fill: s.stroke }}
                          activeDot={{ r: 3 }}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </section>
              )}
            </div>
          ) : null}

          {(pheno && hasClassification) || states.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-stretch">
              {pheno && hasClassification && (
                <section className="rounded-sm border border-border bg-secondary/50 p-4">
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
                <section className="rounded-sm border border-border bg-secondary/50 p-4">
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
                          <span className="telemetry text-micro text-place">
                            {s.date.slice(5)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-meta text-muted-foreground">
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
            Solar, the energy model and wind used to be read here, and are now
            read on the energy screen -- beside the parameters that produced
            them, which is the comparison somebody tuning a run actually makes.
            See components/energy/EnergyReadingColumn.tsx.
          */}

          {/*
            Surface water over the period. Fractions are a percentage of the
            pixels observed on each date, so the series is not comparable to a
            fraction of the AOI area.
          */}
          {result.water && result.water.series.length > 0 && (
            <section className="rounded-sm border border-border bg-secondary/50 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="eyebrow">
                  Surface water · {result.water.index}
                </p>
                <p className="telemetry text-meta text-muted-foreground">
                  {result.water.n_dates} dates ·{" "}
                  {result.water.date_range[0]} → {result.water.date_range[1]}
                </p>
              </div>
              {result.water.occurrence_uri && (
                <div className="mb-3">
                  {/* Spans the panel rather than sitting in a grid column, so
                      its height is bounded instead of following a 4:3 ratio of
                      the full width. */}
                  <PanelTile
                    title="Water occurrence"
                    uri={result.water.occurrence_uri}
                    empty="No occurrence raster"
                    fullWidth
                  />
                  <ContinuousRamp
                    palette="blues"
                    lowLabel="0% of observed dates"
                    highLabel="100%"
                  />
                </div>
              )}
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={waterChart}
                  margin={{ top: 6, right: 14, left: 4, bottom: 22 }}
                >
                  <XAxis
                    {...timeAxisProps}
                    tickFormatter={timeTickFormatter(waterSpan)}
                    stroke="var(--border)"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickMargin={6}
                    minTickGap={28}
                  >
                    <Label
                      value="Acquisition date"
                      position="insideBottom"
                      offset={-14}
                      style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    />
                  </XAxis>
                  <YAxis
                    stroke="var(--border)"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v: number) => v.toFixed(0)}
                    width={48}
                  >
                    <Label
                      value="Water fraction (%)"
                      angle={-90}
                      position="insideLeft"
                      style={{
                        fontSize: 12,
                        fill: "var(--muted-foreground)",
                        textAnchor: "middle",
                      }}
                    />
                  </YAxis>
                  <Tooltip
                    labelFormatter={timeLabelFormatter}
                    formatter={(v: number) => `${v.toFixed(1)} %`}
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      fontSize: 11,
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey="water"
                    name="Water fraction"
                    stroke={PRODUCT_COLOR.water}
                    strokeWidth={1.8}
                    dot={{ r: 1.8, strokeWidth: 0, fill: PRODUCT_COLOR.water }}
                    activeDot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4"
                   style={{ borderColor: "var(--border)" }}>
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
        </div>
      </PageBody>

      {packOpen && (
        <ResearchPackModal
          result={result}
          modelKind={modelKind}
          areaLabel={areaLabel}
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
    </PageShell>
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
    <ModalShell
      onDismiss={onCancel}
      dismissible={!busy}
      labelledBy="delete-project-title"
      className="w-full max-w-md"
    >
      <ModalHeader
        tone="destructive"
        eyebrow="DELETE PROJECT"
        titleId="delete-project-title"
        title={<>Delete “{project.name}”?</>}
        /*
          IT SAID THE RUNS SURVIVED. DeleteProject used to detach them --
          project_id = NULL -- and they reappeared under "Unassigned". It takes
          them now, with the areas they were measured on and their rasters,
          because a run without the ground it is of and the project that ground
          is in is not a run anyone can read. A dialog that promises the
          opposite of what the button does is worse than no dialog.
        */
        subtitle="This cannot be undone. The project's areas go with it, and every run measured on them, along with their rasters and band compositions."
      />
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={btnGhost}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-destructive px-3 text-body font-semibold text-destructive-foreground disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            {busy ? "Deleting…" : "Delete project"}
          </button>
        </div>
    </ModalShell>
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
    <ModalShell
      onDismiss={onClose}
      label={overlay.title || "Composition"}
      className="h-[min(40rem,90vh)] w-full max-w-3xl"
    >
      <ModalHeader
        eyebrow="COMPOSITION"
        title={`${overlay.title || "Band composition"}${
          projectName ? ` · ${projectName}` : ""
        }`}
        subtitle={metaBits.length > 0 ? metaBits.join(" · ") : undefined}
        onClose={onClose}
      />

        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
          style={{ background: "var(--background)" }}
        >
          <div className="rounded-sm border border-border bg-secondary flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
            {overlay.overlay_uri ? (
              <img
                src={overlay.overlay_uri}
                alt={overlay.title || "Composition"}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-body text-muted-foreground">
                Preview unavailable
              </p>
            )}
          </div>
          {meta.description?.trim() ? (
            <p className="shrink-0 text-body text-muted-foreground">
              {meta.description.trim()}
            </p>
          ) : null}
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--panel-solid)",
          }}
        >
          <button
            type="button"
            onClick={onViewOnMap}
            className={btnGhost}
          >
            <MapIcon className="h-3 w-3" />
            View on map
          </button>
          <div className="flex flex-wrap gap-2">
            {overlay.overlay_uri ? (
              <button
                type="button"
                onClick={() => void exportPng()}
                className={btnGhost}
              >
                <Download className="h-3 w-3" />
                Export PNG
              </button>
            ) : null}
            {overlay.raster_tif ? (
              <button
                type="button"
                onClick={() => void exportTif()}
                className={btnPrimary}
              >
                <Download className="h-3 w-3" />
                Export GeoTIFF
              </button>
            ) : null}
          </div>
        </div>
    </ModalShell>
  )
}

function SavedRunsPanel({
  title,
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
    <section className="rounded-sm border border-border bg-secondary/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {title && (
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="eyebrow !text-foreground">{title}</p>
            </div>
          )}
          {caption ? (
            <p className="mt-1 text-body text-muted-foreground">{caption}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-meta text-muted-foreground hover:text-foreground"
            >
              Clear selection
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="text-meta text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="rounded-sm border border-border bg-secondary mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p className="text-body text-muted-foreground">
            {selectedIds.length === 1
              ? "Select one more analysis to compare"
              : "Two analyses selected"}
          </p>
          <button
            type="button"
            disabled={!canCompare}
            onClick={onCompare}
            className={btnPrimary}
          >
            <Columns2 className="h-3 w-3" />
            {comparing ? "Loading…" : "Compare"}
          </button>
        </div>
      )}

      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No runs in this project yet. Run a product with this project active
          — or assign an unassigned run from the hub.
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
              /*
                A column, not a row with the actions beside the content.

                Side by side, the two buttons took about 7rem off a card that is
                a quarter of the list's width, and every identifying thing in it
                was truncated to make room: a label read "ru...", a solar result
                read "1495 kWh/m2/yr · t...". The card is where a run is
                recognised and managed now that reading it happens elsewhere, so
                the content gets the full measure and the actions get their own
                line under a rule.
              */
              <li
                key={r.id}
                className={cn(
                  "flex flex-col gap-2 rounded-sm border px-3 py-2.5 text-xs",
                  selected ? "border-primary bg-secondary" : "border-border bg-secondary/50"
                )}
              >
                <label className="flex min-w-0 flex-1 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={loading}
                    onChange={() => onToggleSelect(r.id)}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    {/* Wraps, so a long name pushes the scene count onto the
                        next line instead of squeezing itself into an ellipsis. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {slot && (
                        <span className="telemetry shrink-0 rounded-sm bg-primary/20 px-1 text-micro text-primary">
                          {slot}
                        </span>
                      )}
                      {/* Which product this is. The list is filtered by project
                          and by nothing else, so four kinds share it, and the
                          only way to tell them apart was to read the summary
                          sentence of each of forty-eight rows. */}
                      <span className="telemetry shrink-0 rounded-sm border border-border px-1 text-micro uppercase text-muted-foreground">
                        {runKindLabel(r.kind)}
                      </span>
                      {/*
                        Wraps rather than truncates. This is the run's name --
                        the one thing that tells two runs of one project apart --
                        and "ru..." tells them apart from nothing.
                      */}
                      <span className="min-w-0 break-words font-medium text-foreground">
                        {displayRunLabel(r.label)}
                      </span>
                      <span className="telemetry shrink-0 text-muted-foreground">
                        {/* Solar counts years of climatology and wind counts
                            years of hourly reanalysis. Neither reads a scene,
                            and a wind run listed as "10 scenes" understated a
                            ten-year record as ten observations. */}
                        {/* A flood envelope counts neither. It reads no
                            scene and no year: what it reads is a set of DEM
                            products, and the count of those is in the line
                            below, where it comes from the summary rather than
                            from a field that means something else. */}
                        {r.kind === "flood"
                          ? "terrain only"
                          : `${r.n_dates} ${
                              r.kind === "solar" || r.kind === "wind"
                                ? "years"
                                : "scenes"
                            }`}
                      </span>
                    </div>
                    {/* What the run produced, from summary already in memory —
                        saves a LoadAnalysis round trip just to see the result. */}
                    {r.kind === "solar" ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: PRODUCT_COLOR.solar }} />
                        <span className="min-w-0 text-foreground">
                          {solarSummaryLine(r.summary)}
                        </span>
                      </div>
                    ) : r.kind === "water" ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: PRODUCT_COLOR.water }} />
                        <span className="min-w-0 text-foreground">
                          {waterSummaryLine(r.summary)}
                        </span>
                      </div>
                    ) : r.kind === "flood" ? (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: PRODUCT_COLOR.flood }} />
                          <span className="min-w-0 text-foreground">
                            {floodSummaryLine(r.summary)}
                          </span>
                        </div>
                        {/* The qualifier travels with the figure, exactly as
                            it does for wind. A contested share read without it
                            is taken for the reproducibility range the study
                            published over a different product set. */}
                        {/* Two lines rather than one, and clamped rather than
                            truncated: the payload's sentence names the
                            catalogue and the product set, and one truncated
                            line of it names neither. */}
                        <span className="line-clamp-2 text-meta text-muted-foreground">
                          {floodQualifierLine(r.summary)}
                        </span>
                      </div>
                    ) : r.kind === "wind" ? (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          {/* Not the water blue: two products keyed on
                              different reanalyses should not read as one. */}
                          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: PRODUCT_COLOR.wind }} />
                          <span className="min-w-0 text-foreground">
                            {windSummaryLine(r.summary)}
                          </span>
                        </div>
                        {/* The qualifier travels with the figure. Without it a
                            gross, unbenchmarked capacity factor sits in the
                            same list as a photovoltaic one that is benchmarked
                            against the Global Solar Atlas. */}
                        <span className="truncate text-meta text-muted-foreground">
                          {windQualifierLine(r.summary)}
                        </span>
                      </div>
                    ) : dominant && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className="size-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: dominant.color }}
                        />
                        <span className="min-w-0 text-foreground">
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
                            : r.kind === "flood"
                              ? `Flood envelope · ${r.model_kind || "Planetary Computer DEM"}`
                              : modelDisplayName(r.model_kind)}
                      {/* Solar reports a climatology and has no observed
                          window. A wind run's row rendered as a bare arrow
                          until the record window was read from the summary.
                          The separator is emitted with the second part so
                          neither row ends in a dangling one. */}
                      {/* Neither a solar climatology nor a flood envelope has
                          an observed acquisition window; the envelope has no
                          period at all. */}
                      {r.kind === "solar" || r.kind === "flood" ? null : r.kind === "wind" ? (
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
                    <div className="telemetry mt-1 text-meta text-muted-foreground/80">
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                    {onAssignProject && projects && projects.length > 0 && (
                      <select
                        className="rounded-sm border border-border bg-background mt-1.5 max-w-full px-1.5 py-0.5 text-meta text-muted-foreground"
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
                <div className="flex items-center gap-1 border-t border-border/60 pt-2">
                  {/*
                    Named for where it goes, because it no longer goes to one
                    place. A solar or wind run is read on the energy screen now;
                    a classification is restored onto the map. "Open" said
                    neither, and a button that lands somewhere unannounced reads
                    as a navigation the reader did not ask for.
                  */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void onOpen(r)}
                    className={btnGhost}
                  >
                    <FolderOpen className="h-3 w-3" />
                    {r.kind === "solar" || r.kind === "wind"
                      ? "Open in Energy"
                      : r.kind === "flood"
                        ? "Open in Flood envelope"
                        : "Open on the map"}
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => onDelete(r)}
                      className={cn(btnGhost, "ml-auto px-2 hover:border-destructive-quiet/50 hover:text-destructive-quiet")}
                      title="Delete this run"
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
 * Start a run, of whichever product.
 *
 * The hub offered "New classification" and nothing else while the application
 * produces four run kinds and a composition, so four of the five had no way in
 * from here at all -- a user had to know which screen held them.
 *
 * A menu rather than five buttons: they are alternatives, only one is taken,
 * and five primary buttons in a header would say they are five separate
 * decisions.
 */
function NewRunMenu({
  onStart,
  variant = "primary",
}: {
  onStart: (product: MapToolId | "energy") => void
  /** Ghost where it sits among other secondary actions on an open analysis. */
  variant?: "primary" | "ghost"
}) {
  const [open, setOpen] = useState(false)

  const items: { id: MapToolId | "energy"; label: string; note: string }[] = [
    { id: "classify", label: "Classification", note: "Sentinel-2, per-pixel cover" },
    { id: "compose", label: "Composition", note: "band composite or index" },
    { id: "water", label: "Surface water", note: "flooded fraction per date" },
    { id: "energy", label: "Solar or wind", note: "NASA POWER, no scene needed" },
  ]

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={variant === "ghost" ? btnGhost : btnPrimaryCommit}
      >
        <Plus className="h-3.5 w-3.5" />
        New run
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          {/* Click-away, behind the menu and above everything else. */}
          <div
            className="fixed inset-0 z-[4000]"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="panel absolute right-0 z-[4001] mt-1 flex w-64 flex-col overflow-hidden rounded-md p-1"
          >
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onStart(it.id)
                }}
                className="flex flex-col items-start rounded-sm px-2.5 py-1.5 text-left hover:bg-secondary"
              >
                <span className="text-body font-medium text-foreground">
                  {it.label}
                </span>
                <span className="text-micro text-muted-foreground">{it.note}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
