/**
 * The simulation workflow's state, held once for the whole board.
 *
 * WHY THIS IS NOT IN THE EDITOR. A canopy area is a panel, and a panel shows
 * one reading of a subject; the subject itself belongs to the workflow. The
 * classification workflow already works that way and is the model for it: the
 * area, the period and the model are set once in the run band, and the
 * viewport, the outliner, the properties column and the tables each show what
 * that run produced without carrying a second copy of its controls.
 *
 * The canopy did the opposite. Every canopy area carried the species, the
 * sowing, the picker for which analysed area to read and the button that read
 * it, so two areas showing two different questions about ONE stand offered two
 * sets of controls over it -- and nothing said they were the same stand, since
 * each area answered only for its own state. Setting the row spacing twice to
 * ask two questions about one field is the duplication; the panels drawing
 * different figures was never the problem.
 *
 * So the stand, the sowing, the sun, which analysed area is read, the grown
 * mesh and the read season all live here, and the panels read them. Growing a
 * stand fills every Stand panel on the board; reading an area fills every
 * Season, Light and Ages panel at once.
 *
 * KEPT LIKE THE REST OF THE ARRANGEMENT, in `boardMemory`: a glance at the map
 * and back would otherwise cost a two-second grow and a re-read of the season,
 * which is the exact loss that module exists to prevent. It survives a close
 * and not a restart, as everything there does.
 *
 * WHAT IS NOT HERE. The WebGL scene, which is per panel: each Stand area builds
 * its own renderer and loads the mesh this holds the URL of. One stand, drawn
 * as many times as there are panels to draw it in.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { BuildCanopyFromAOI, BuildCanopyMesh } from "../../../wailsjs/go/main/App"
import { readBoardMemory, writeBoardMemory } from "./boardMemory"
import {
  canopyAOICentre,
  MIN_AOI_OBSERVATIONS,
  readableCanopyRuns,
  type AOICanopy,
  type CanopyRun,
} from "./CanopyAOIEditor"

/** What is grown: a species, an age and the sowing it stands in. */
export interface CanopyStand {
  species: string
  days: number
  rows: number
  perRow: number
  interRow: number
  interPlant: number
}

export const DEFAULT_STAND: CanopyStand = {
  // Sorghum because it is the crop the numerical studies grew, so a reader can
  // hold this beside the figures in that repository.
  species: "sorghum",
  days: 60,
  // Twelve plants is a stand that reads as a stand and still grows in about a
  // second. The mesh is roughly 264k triangles at day 60, most of it blade.
  rows: 3,
  perRow: 4,
  interRow: 0.8,
  interPlant: 0.25,
}

/** Where the sun is put for the drawn stand. Light, not agronomy. */
export interface CanopySun {
  elevation: number
  azimuth: number
}

const DEFAULT_SUN: CanopySun = { elevation: 50, azimuth: 35 }

/** What a grow produced, including the URL every Stand panel loads. */
export interface CanopyMesh {
  url: string
  species: string
  days: number
  plants: number
  leafArea: number
  bytes: number
  organs: Record<string, number>
}

interface CanopyWorkflowValue {
  /**
   * Whether an arrangement holds a band that can set any of this.
   *
   * Asked because an arrangement outlives the code that wrote it: the studio's
   * layout persists across restarts, so a workspace saved before the canopy
   * had a band of its own opens with panels and no way to change what they
   * show. A panel that can say so sends the reader to the editor to add;
   * a panel that cannot reads as broken.
   */
  hasBand: boolean
  /** Called by a band on mount; the returned function releases it. */
  registerBand: () => () => void
  /** Every board run whose series is long enough to be read as a season. */
  readable: readonly CanopyRun[]
  source: CanopyRun | null
  sourceId?: string
  setSourceId: (id?: string) => void

  stand: CanopyStand
  setStand: (patch: Partial<CanopyStand>) => void
  sun: CanopySun
  setSun: (patch: Partial<CanopySun>) => void

  mesh: CanopyMesh | null
  growing: boolean
  growError: string | null
  /** The staged stand no longer describes what was drawn. */
  standStale: boolean
  grow: () => Promise<void>

  aoi: AOICanopy | null
  reading: boolean
  readError: string | null
  /** The reading answers for a species or a sowing since changed. */
  aoiStale: boolean
  readArea: () => Promise<void>
}

const CanopyWorkflowContext = createContext<CanopyWorkflowValue | null>(null)

/**
 * The board's canopy state, or the refusal that says the band is missing.
 *
 * Null outside the provider rather than a default value: a panel drawing a
 * stand nobody can change is worse than a panel that says where the controls
 * are, and only the caller knows how to say it.
 */
export function useCanopyWorkflow(): CanopyWorkflowValue | null {
  return useContext(CanopyWorkflowContext)
}

/** Kept across a close, in the store the arrangement itself uses. */
function useKeptState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readBoardMemory(key, initial))
  useEffect(() => {
    writeBoardMemory(key, value)
  }, [key, value])
  return [value, setValue] as const
}

export function CanopyWorkflowProvider({
  runs,
  children,
}: {
  /** Every run on the board, which is where a season can be read from. */
  runs?: readonly CanopyRun[]
  children: React.ReactNode
}) {
  const [stand, setStandState] = useKeptState<CanopyStand>(
    "canopyStand",
    DEFAULT_STAND
  )
  const [sun, setSunState] = useKeptState<CanopySun>("canopySun", DEFAULT_SUN)
  const [sourceId, setSourceIdState] = useKeptState<string | undefined>(
    "canopySource",
    undefined
  )

  /*
    The answers are kept too, and not only the questions.

    A glance at the map unmounts the board, and a grow is about two seconds and
    a few hundred thousand triangles while a read can be a solar record fetched
    over the network. Remembering the parameters and throwing the results away
    would leave the reader watching the same two jobs run again for a canopy
    they had already seen. The mesh is a URL the asset server still serves for
    as long as the session lasts, which is exactly as long as this store keeps
    anything.

    The busy flags and the errors are NOT kept: a job in flight when the board
    closed is not in flight when it opens, and a spinner restored over nothing
    would be a lie about what the application is doing.
  */
  const [mesh, setMesh] = useKeptState<CanopyMesh | null>("canopyMesh", null)
  const [drawn, setDrawn] = useKeptState<CanopyStand | null>("canopyDrawn", null)
  const [growing, setGrowing] = useState(false)
  const [growError, setGrowError] = useState<string | null>(null)

  const [aoi, setAoi] = useKeptState<AOICanopy | null>("canopyRead", null)
  const [readFor, setReadFor] = useKeptState<string | null>("canopyReadFor", null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)

  const readable = useMemo(() => readableCanopyRuns(runs), [runs])
  const source = readable.find((r) => r.id === sourceId) ?? null

  // Counted rather than a flag, so a moment with two bands on screen -- a
  // workspace switch, an area retyped while another is closing -- does not
  // leave the count at zero when the second one goes.
  const [bands, setBands] = useState(0)
  const registerBand = useCallback(() => {
    setBands((n) => n + 1)
    return () => setBands((n) => n - 1)
  }, [])

  const setStand = useCallback(
    (patch: Partial<CanopyStand>) =>
      setStandState((prev) => ({ ...prev, ...patch })),
    [setStandState]
  )
  const setSun = useCallback(
    (patch: Partial<CanopySun>) => setSunState((prev) => ({ ...prev, ...patch })),
    [setSunState]
  )

  /*
    A reading belongs to the area it was made from, so naming another one
    clears it rather than leaving one area's season under another's name.
  */
  const setSourceId = useCallback(
    (id?: string) => {
      setSourceIdState(id)
      setAoi(null)
      setReadFor(null)
      setReadError(null)
    },
    [setSourceIdState, setAoi, setReadFor]
  )

  const standStale =
    drawn !== null && JSON.stringify(drawn) !== JSON.stringify(stand)

  /*
    Only one grow at a time, and the guard is a ref rather than the `growing`
    flag: two Stand panels mounting in the same frame both read the flag before
    either sets it, and the board would spend two sidecar processes and two
    meshes on one stand.
  */
  const busyRef = useRef({ grow: false, read: false })

  const grow = useCallback(async () => {
    if (busyRef.current.grow) return
    busyRef.current.grow = true
    setGrowing(true)
    /*
      Each await is labelled because the failure that took four attempts to
      place -- "Maximum call stack size exceeded" -- carries no stack that
      points anywhere useful and can be thrown by any of three different layers:
      the Wails bridge marshalling a reply, the fetch decoding a payload, or the
      loader walking a scene. Naming the step turns the next report into a
      location instead of a symptom.
    */
    let step = "calling the sidecar"
    try {
      const built = await BuildCanopyMesh({
        species: stand.species,
        days: stand.days,
        rows: stand.rows,
        per_row: stand.perRow,
        inter_row: stand.interRow,
        inter_plant: stand.interPlant,
      } as never)
      step = "recording what was grown"
      setMesh({
        url: built.url,
        species: built.species,
        days: built.days,
        plants: built.plants,
        leafArea: built.leaf_area,
        bytes: built.bytes,
        organs: (built.organs ?? {}) as Record<string, number>,
      })
      setDrawn(stand)
      setGrowError(null)
    } catch (e) {
      // Every refusal on the way here names what to change -- a missing
      // toolkit, an unknown species, a stand too large to carry -- so the
      // message is shown verbatim. The step is prefixed to it because the one
      // failure that did NOT name anything was a stack overflow, and knowing
      // which layer threw it is the whole difficulty.
      const detail = e instanceof Error ? e.message : String(e)
      setGrowError(`while ${step}: ${detail}`)
    } finally {
      busyRef.current.grow = false
      setGrowing(false)
    }
  }, [stand])

  /*
    What a reading answers for: the area, the species and the sowing.

    The same device as `drawn` above, and for the same reason -- a figure
    computed for sorghum at 0.80 m and still on screen after the reader picks
    maize at 0.50 m is a wrong answer, not a stale one, unless the surface says
    which question it answered.
  */
  const readRequest = source
    ? `${source.id}|${stand.species}|${stand.interRow}|${stand.interPlant}`
    : ""
  const aoiStale = aoi !== null && readFor !== null && readFor !== readRequest

  const readArea = useCallback(async () => {
    /*
      THE CROP'S SERIES WHEN THERE IS ONE, and the AOI's otherwise.

      An area mean over mixed cover is not the crop's index, and the gap is not
      small: on the soybean AOI this was built against, the peak reads 0.314 as
      an area mean with a standard deviation of 0.190, which for a roughly even
      two-population mix puts the crop pixels near 0.50 and everything else near
      0.12. Every leaf area below that flows from the AOI-wide series is an
      average of canopy and bare ground, and the canopy built from it is the
      wrong canopy.

      The sidecar computes both and the run carries both; this picks. Falling
      back matters as much as preferring: an AOI with no cropland has an empty
      crop series, and that is a statement rather than a failure -- the AOI-wide
      series still answers, and the payload still says which one it read.

      The bound is the same one that decides whether a run is offered at all:
      a crop series too short for the phenology smoother is not a series, and
      falling back to the AOI-wide one beats refusing the run.
    */
    const cropSeries = source?.result?.vi_series_crop
    const series =
      cropSeries && cropSeries.length >= MIN_AOI_OBSERVATIONS
        ? cropSeries
        : source?.result?.vi_series
    if (!source || !series || busyRef.current.read) return
    busyRef.current.read = true
    setReading(true)
    try {
      /*
        THE LOCATION, WHICH IS THE WHOLE OF WHAT THE LIGHT PANEL NEEDS.

        Without it the sidecar returns `sun: reference` and no light block at
        all, so that panel was drawn and could never be reached -- the surface
        offered a question it had made unanswerable one call earlier. The AOI
        already carries the box; its centre is a point POWER resolves to a cell.

        Slow on the first request for a cell and immediate afterwards, since the
        parquet cache outlives the run's work dir. That cost is why this is a
        button rather than an effect on the parameters, which is also what the
        stand does with Grow.
      */
      const centre = canopyAOICentre(source)
      const built = await BuildCanopyFromAOI({
        species: stand.species,
        vi_series: series,
        inter_row: stand.interRow,
        inter_plant: stand.interPlant,
        ...(centre ? { lat: centre.lat, lon: centre.lon } : {}),
        /*
          WHAT THE CLASSIFICATION ALREADY KNOWS GROWS HERE.

          The sidecar maps a dominant class to a plantarchitecture species and,
          as importantly, refuses -- cane, coffee and eucalyptus have no plant
          in the library, and the catch-all crop classes identify none. Without
          this the guard on the far side was never true, so the suggestion never
          fired and the species was always whatever the picker held: the
          classification and the simulation ran over the same ground and never
          spoke.

          It suggests; `species` above still wins, because a reader who
          overrides the classification means to.
        */
        ...(source.result?.class_stats?.length
          ? { class_stats: source.result.class_stats }
          : {}),
      } as never)
      setAoi(built as unknown as AOICanopy)
      setReadFor(readRequest)
      setReadError(null)
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e))
      setAoi(null)
      setReadFor(null)
    } finally {
      busyRef.current.read = false
      setReading(false)
    }
  }, [source, stand.species, stand.interRow, stand.interPlant, readRequest])

  // A source that leaves the board -- its area closed, its run removed -- takes
  // its reading with it, rather than leaving figures under a name that is gone.
  useEffect(() => {
    if (sourceId && !readable.some((r) => r.id === sourceId)) {
      setSourceId(undefined)
    }
  }, [sourceId, readable, setSourceId])

  const value = useMemo<CanopyWorkflowValue>(
    () => ({
      hasBand: bands > 0,
      registerBand,
      readable,
      source,
      sourceId,
      setSourceId,
      stand,
      setStand,
      sun,
      setSun,
      mesh,
      growing,
      growError,
      standStale,
      grow,
      aoi,
      reading,
      readError,
      aoiStale,
      readArea,
    }),
    [
      bands,
      registerBand,
      readable,
      source,
      sourceId,
      setSourceId,
      stand,
      setStand,
      sun,
      setSun,
      mesh,
      growing,
      growError,
      standStale,
      grow,
      aoi,
      reading,
      readError,
      aoiStale,
      readArea,
    ]
  )

  return (
    <CanopyWorkflowContext.Provider value={value}>
      {children}
    </CanopyWorkflowContext.Provider>
  )
}
