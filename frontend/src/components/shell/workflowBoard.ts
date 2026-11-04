/** The graph on Workflows, the name it is saved under, and the operators that save it. */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import {
  COMPOSITOR,
  boardIsDirty,
  clearBoardDirty,
  markBoardDirty,
  onBoardDirtyChange,
  readBoardMemory,
  snapshotBoard,
  writeBoardMemory,
} from "@/components/workspace/boardMemory"
import type { CompositorGlobeOverlay } from "@/components/workspace/CompositorEditor"
import { useAuth } from "@/lib/auth"
import {
  EMPTY_GRAPH,
  withFieldNodes,
  withMineralNodes,
  type CompositorGraph,
} from "@/lib/compositorGraph"
import { notifyError, notifySuccess } from "@/lib/notify"
import { pollOperator, runOperator, useOperators } from "@/lib/operators"
import { loadedRunAssets, type runAssets } from "@/lib/runAssets"
import type { SessionRun } from "@/lib/sessionRuns"
import type { JobReading } from "@/lib/shellLayers"
import { saveStudio, type Studio } from "@/lib/studios"
import type { InferenceRun, PredictResult } from "@/lib/types"
import type { MapShellProps } from "@/pages/MapShell"

export function useWorkflowBoard({
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
}: {
  props: MapShellProps
  assets: ReturnType<typeof runAssets>
  session: SessionRun[]
  loadingRuns: boolean
  addRuns: (list: readonly InferenceRun[]) => Promise<void>
  setExtraRuns: Dispatch<SetStateAction<{ run: InferenceRun; result: PredictResult }[]>>
  setJob: (job: JobReading | null) => void
  destination: string
  goWorkflows: () => void
  goCompare: () => void
  setStartOpen: (open: boolean) => void
}) {
  const { runs: savedRuns } = useAuth()
  const [compositor, setCompositorState] = useState<CompositorGraph | null>(() =>
    readBoardMemory<CompositorGraph | null>(COMPOSITOR, null)
  )
  const setCompositor = (next: CompositorGraph) => {
    writeBoardMemory(COMPOSITOR, next)
    markBoardDirty()
    setCompositorState(next)
  }
  const [compositorGlobe, setCompositorGlobe] = useState<CompositorGlobeOverlay[]>([])
  const [savedId, setSavedId] = useState<string | null>(() =>
    readBoardMemory("savedId", null)
  )
  const [savedName, setSavedName] = useState<string | null>(() =>
    readBoardMemory("savedName", null)
  )
  const [naming, setNaming] = useState<string | null>(null)
  const namingNew = useRef(false)
  const [pendingOpen, setPendingOpen] = useState<Studio | "new" | null>(null)
  const [managing, setManaging] = useState(false)
  const [dirty, setDirty] = useState(boardIsDirty)
  useEffect(() => onBoardDirtyChange(setDirty), [])

  /*
    A finished delineation's and mineral map's nodes are placed for it, once per run:
    what is done with them is graph work, and a run whose nodes had to be built by
    hand would leave those actions out of sight.
  */
  const placedRuns = useRef(new Set<string>())
  const mineralRunId = props.mineral?.run_id
  useEffect(() => {
    const m = props.mineral
    if (!m || !mineralRunId || placedRuns.current.has(mineralRunId)) return
    placedRuns.current.add(mineralRunId)
    setCompositor(
      withMineralNodes(compositor ?? EMPTY_GRAPH, mineralRunId, {
        cover: !!m.cover,
        bands: (m.positions ?? [])
          .map((p) => p.key)
          .filter((k): k is "fe3" | "aloh" => k === "fe3" || k === "aloh"),
        acid: (m.acid_sulfate ?? []).length > 0,
        agreement: (m.agreement ?? [])
          .map((a) => a.group)
          .filter((g): g is 1 | 2 => g === 1 || g === 2),
      })
    )
    // The run id is what decides; the graph is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineralRunId])
  const fieldsRunId = props.fields?.run_id
  useEffect(() => {
    if (!fieldsRunId || placedRuns.current.has(fieldsRunId)) return
    placedRuns.current.add(fieldsRunId)
    const classOutput = assets.some((a) => a.id === "fields-classes")
      ? "fields-classes"
      : null
    setCompositor(withFieldNodes(compositor ?? EMPTY_GRAPH, fieldsRunId, classOutput))
    // As above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsRunId])

  /*
    What opening a saved workflow left in the board's memory: its name, its graph and
    the runs it is made of. App wrote them; the nonce says when. A board saved with no
    graph was arranging rasters, which is what the grid is for now.
  */
  const takeOpened = () => {
    setSavedId(readBoardMemory<string | null>("savedId", null))
    setSavedName(readBoardMemory<string | null>("savedName", null))
    const graph = readBoardMemory<CompositorGraph | null>(COMPOSITOR, null)
    setCompositorState(graph)
    const ids = readBoardMemory<string[]>("pendingRunIds", [])
    writeBoardMemory("pendingRunIds", [])
    setExtraRuns([])
    setJob(null)
    void addRuns(ids.flatMap((id) => savedRuns.filter((r) => r.id === id)))
    return { graph, ids }
  }
  const seenNonce = useRef(props.openBoardNonce)
  useEffect(() => {
    if (props.openBoardNonce === seenNonce.current) return
    seenNonce.current = props.openBoardNonce
    const { graph, ids } = takeOpened()
    if (graph || !ids.length || destination === "workflows") goWorkflows()
    else goCompare()
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.openBoardNonce])
  // Runs sent here before this surface mounted.
  useEffect(() => {
    if (readBoardMemory<string[]>("pendingRunIds", []).length) takeOpened()
    // Once, on mount: the list is emptied as it is taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveWorkflow = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (loadingRuns) {
      notifyError(
        "Still opening this workflow",
        new Error(
          "its runs are still being fetched, and saving now would store it without them"
        )
      )
      return
    }
    const members = session
      .filter((r) => r.record)
      .map((r) => ({
        runId: r.id,
        layerIds: (r.live ? assets : loadedRunAssets(r.result)).map((a) => a.sceneId),
      }))
    if (!members.length && !compositor?.nodes.length) {
      notifyError(
        "Nothing to save yet",
        new Error(
          "a workflow is a graph and the saved runs it reads, and this has neither. Run a product, or add a saved run"
        )
      )
      return
    }
    try {
      const board = await saveStudio(
        trimmed,
        snapshotBoard(members),
        savedId ?? undefined,
        props.activeProjectId
      )
      writeBoardMemory("savedId", board.id)
      writeBoardMemory("savedName", board.name)
      setSavedId(board.id)
      setSavedName(board.name)
      setNaming(null)
      clearBoardDirty()
      notifySuccess(`Workflow "${board.name}" saved.`)
      void props.onStudiosMenu?.()
      // The project's file too, or the two would say different things.
      if (pollOperator("PROJECT_SAVE") === true) runOperator("PROJECT_SAVE")
    } catch (e) {
      notifyError("Could not save this workflow", e)
    }
  }
  const confirmName = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (namingNew.current) {
      namingNew.current = false
      setNaming(null)
      void props.onNewStudio?.(trimmed)
      return
    }
    void saveWorkflow(trimmed)
  }
  const askName = (forNew: boolean, initial = "") => {
    goWorkflows()
    namingNew.current = forNew
    setNaming(initial)
  }
  const openWorkflow = (board: Studio) => {
    if (board.id === savedId) {
      goWorkflows()
      return
    }
    if (boardIsDirty()) setPendingOpen(board)
    else props.onOpenStudio?.(board)
  }
  const newWorkflow = () => {
    if (boardIsDirty()) setPendingOpen("new")
    else askName(true)
  }

  useOperators({
    WORKFLOW_SAVE: {
      run: () => {
        if (savedName) {
          void saveWorkflow(savedName)
          return
        }
        // Nothing to name, and a project file to write: the save is the file's.
        if (
          !session.some((r) => r.record) &&
          !compositor?.nodes.length &&
          pollOperator("PROJECT_SAVE") === true
        ) {
          runOperator("PROJECT_SAVE")
          return
        }
        askName(false)
      },
    },
    WORKFLOW_RENAME: {
      run: () => askName(false, savedName ?? ""),
      poll: () => (savedName ? true : "This workflow has no name yet"),
    },
    WORKFLOW_NEW: { run: newWorkflow },
    WORKFLOW_MANAGE: { run: () => setManaging(true) },
    START: { run: () => setStartOpen(true) },
  })

  return {
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
  }
}
