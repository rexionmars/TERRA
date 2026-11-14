import { useEffect, useMemo, useRef, useState } from "react"

import {
  ArrowsClockwise,
  CaretRight,
  CornersOut,
  Copy,
  Minus,
  Path,
  Plus,
  Trash,
  X,
} from "@/components/icons"
import { ConfusionMatrix } from "@/components/workspace/AgreementCharts"
import {
  PredictionComparison,
  type PredictionCompareSide,
} from "@/components/workspace/PredictionComparison"
import { DomainShiftEditor } from "@/components/workspace/DomainShiftEditor"
import { HeaderMenu } from "@/components/workspace/HeaderControls"
import {
  LibraryLimitEditor,
  type LibraryLimitMode,
} from "@/components/workspace/LibraryLimitEditor"
import { ContextMenu, MenuItem, MenuPopover } from "@/components/workspace/MenuPopover"
import { RadialMenu, type RadialItem } from "@/components/workspace/RadialMenu"
import { RunList, RunPicker } from "@/components/workspace/RunPicker"
import { SeparabilityEditor } from "@/components/workspace/SeparabilityEditor"
import {
  SocketCanvas,
  type CanvasApi,
  type ContextTarget,
  type Place,
  type SocketLink,
  type SocketNode,
} from "@/components/workspace/SocketCanvas"
import { SpectraEditor } from "@/components/workspace/SpectraEditor"
import { RunTables } from "@/components/workspace/RunTables"
import { Head } from "@/components/workspace/nodeCard"
import { btnGhost } from "@/components/ui/buttons"
import { tableToCSV } from "@/lib/analysisTables"
import { useAuth } from "@/lib/auth"
import type { SessionRun } from "@/lib/sessionRuns"
import {
  GridMismatchError,
  compareClassMaps,
  type ClassMapCompare,
} from "@/lib/boardProbe"
import {
  EMPTY_BOARD,
  READINGS,
  READING_W,
  READING_X,
  RUN_W,
  RUN_H,
  addReading,
  arrange,
  linkRun,
  linkedRuns,
  nextReadingId,
  readingDef,
  readingInputs,
  removeReading,
  runSlot,
  seed,
  unlink,
  type CompareBoard,
  type ReadingKind,
  type ReadingNode,
} from "@/lib/compareBoard"
import { comparePairTables, formatGroundWidth, groundWidthM } from "@/lib/compareGrid"
import { predictionSource } from "@/lib/mapLayers"
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify"
import { readingPicture } from "@/lib/piePictures"
import { loadedRunAssets, type RunAsset } from "@/lib/runAssets"
import { datesByMonth } from "@/lib/runSummary"
import { PHOTO_CHIP } from "@/components/ui/TabbedBanner"
import type { InferenceRun } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelChoices, PanelHeading } from "@/components/shell/ShellPanel"
import { titled } from "@/components/workspace/readingParts"

/** Every raster the run can show, of whichever product it is. */
const assetsOf = (run: SessionRun): RunAsset[] =>
  loadedRunAssets(run.result).filter((a) => a.extent && a.previewUri)

/*
  The compositor's colours, so a node here reads as a node there: a run in the
  source part's colour, as the compositor's Run node is, and a reading in the
  value part's, as its Analysis nodes are. A class map's socket is the source
  part's head colour, the compositor's classes socket.
*/
const RUN_PAINT = {
  head: "var(--b-source-head)",
  lit: { band: "var(--b-source-head)", ink: "var(--b-source-ink)" },
}
const READING_PAINT = {
  head: "var(--b-value-head)",
  lit: { band: "var(--b-value-head)", ink: "var(--b-value-ink)" },
}
const CLASSES = "var(--b-source-head)"

/** The pie a right-click opens on the board, and the ring of it showing. */
interface ComparePie {
  at: { x: number; y: number }
  /** The press that opened it is still down. */
  held: boolean
  target: ContextTarget
  /** What can be done there, or the readings to add after a run. */
  ring: "root" | "readings"
}

/** The pie's option that opens the run picker rather than adding a reading. */
const ADD_RUN = "add-run"

/*
  The readings round the pie that adds, clockwise from the top: the pair
  readings first, where the board's own first reading stands, and adding a
  run on the left, the side the runs stand on.
*/
const PIE_ADD: readonly (ReadingKind | typeof ADD_RUN)[] = [
  "differences",
  "shift",
  "cohort",
  "spectra",
  "separability",
  "library",
  ADD_RUN,
  "tables",
]

const shapeNote = (kind: ReadingKind) => {
  const shape = readingDef(kind).shape
  return shape === "pair" ? "A, B" : shape === "cohort" ? "1 + n" : "n"
}
const FREE = "var(--b-card-ink)"
const READING_GUESS_H = 150

/*
  A RUN'S CARD, as a run is shown on Analyses and in the Differences reading:
  its raster whole on a plate, with how much ground the picture spans set on it
  as a scale, the bar of its classes under it, the class covering most of it
  and the model, and the period by month. The raster to show is chosen under
  the picture where the run keeps more than one.
*/
function RunCard({ run, onRemove }: { run: SessionRun; onRemove?: () => void }) {
  const assets = useMemo(() => assetsOf(run), [run])
  const [assetId, setAssetId] = useState<string | null>(null)
  const asset = assets.find((a) => a.id === assetId) ?? assets[0]
  const stats = [...(run.result.class_stats ?? [])].sort((a, b) => b.pct - a.pct)
  const top = stats[0]
  const across = asset?.extent ? formatGroundWidth(groundWidthM(asset.extent)) : null
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.45)]">
        <div className="relative h-40 bg-[radial-gradient(120%_90%_at_50%_40%,rgb(var(--p-surface)),rgb(var(--p-sunk)))]">
          {asset ? (
            <img
              src={asset.previewUri}
              alt={`${asset.title} of ${titled(run.label)}`}
              draggable={false}
              className="absolute inset-0 size-full object-contain p-3"
              style={{ imageRendering: asset.pixelated ? "pixelated" : undefined }}
            />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-label text-muted-foreground">
              This run keeps no raster to show.
            </p>
          )}
          {across && (
            <span
              className={cn(
                PHOTO_CHIP,
                "telemetry absolute bottom-2 left-2 px-2 py-0.5 text-meta"
              )}
              title="The ground the picture spans. Each card is drawn to its own scale."
            >
              {across} across
            </span>
          )}
        </div>
        {stats.length > 0 && (
          <div aria-hidden className="flex h-1">
            {stats.map((c) => (
              <span
                key={c.class_id}
                style={{ width: `${c.pct}%`, background: c.color }}
              />
            ))}
          </div>
        )}
      </div>

      {(top || run.model) && (
        <p className="flex min-w-0 items-center gap-1.5 text-label">
          {top && (
            <>
              <span
                className="size-2 shrink-0 rounded-xs"
                style={{ background: top.color }}
              />
              <span className="truncate text-foreground">
                {top.name} {Math.round(top.pct)}%
              </span>
            </>
          )}
          {run.model && (
            <span className="truncate text-muted-foreground">
              {top ? "· " : ""}
              {run.model}
            </span>
          )}
        </p>
      )}

      {assets.length > 1 && (
        <select
          aria-label={`Raster of ${titled(run.label)}`}
          className="field-input h-7 text-label"
          value={asset?.id ?? ""}
          onChange={(e) => setAssetId(e.target.value)}
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2">
        <p
          className="telemetry min-w-0 flex-1 truncate text-meta text-muted-foreground"
          title={run.period ?? undefined}
        >
          {run.period ? datesByMonth(run.period) : "No period recorded"}
        </p>
        {onRemove && (
          <button
            type="button"
            aria-label={`Take ${titled(run.label)} off the board`}
            title="Take off the board. A saved run stays saved."
            onClick={onRemove}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Runs and the readings that compare them, as nodes on a board.
 *
 * A BOARD, AS THE WORKFLOWS COMPOSITOR IS, AND NOT THE GRID IT REPLACES. The grid
 * held every run and compared one pair, marked A and B on two tiles, so a second
 * comparison cost the first. Here each reading is a node with its own inputs,
 * added as many times as wanted and fed by any run (lib/compareBoard.ts), and
 * the one selected is read in full in the panel beside the board, where the
 * readings have the width they were drawn for. Each run still states how much
 * ground its raster spans, since every card is drawn to its own scale.
 */
export function CompareScreen({
  runs: gridRuns,
  loading,
  onAddRun,
  onDropRun,
  hidden,
}: {
  /** The runs in hand; see lib/sessionRuns. */
  runs: readonly SessionRun[]
  loading: boolean
  onAddRun: (run: InferenceRun) => void
  onDropRun: (run: SessionRun) => void
  hidden: boolean
}) {
  const { runs: savedRuns, projects } = useAuth()
  const [surface, setSurface] = useState<HTMLElement | null>(null)
  const [board, setBoard] = useState<CompareBoard>(EMPTY_BOARD)
  const [selected, setSelected] = useState<string | null>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [menu, setMenu] = useState<"view" | "add" | null>(null)
  const [libraryModes, setLibraryModes] = useState<Record<string, LibraryLimitMode>>({})
  const api = useRef<CanvasApi | null>(null)
  const [pie, setPie] = useState<ComparePie | null>(null)
  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null)
  /** Where the pie's run list is open, in window coordinates. */
  const [runAt, setRunAt] = useState<{ x: number; y: number } | null>(null)
  /**
   * A run chosen from that list, and the board point it was asked for at:
   * it arrives on the board once loaded, and is set down there then.
   */
  const placing = useRef<{ id: string; at: Place } | null>(null)

  /* What can feed a reading: a class map with a legend to read it by. */
  const sides = useMemo<PredictionCompareSide[]>(
    () =>
      gridRuns.flatMap((r) => {
        const src = predictionSource(r.result)
        return src && r.result.class_stats?.length
          ? [
              {
                areaId: r.id,
                label: r.label,
                model: r.model,
                period: r.period,
                result: r.result,
                uri: src.uri,
                pixelated: true,
              },
            ]
          : []
      }),
    [gridRuns]
  )
  const sideOf = (id: string | undefined) => sides.find((s) => s.areaId === id)
  const present = useMemo(() => new Set(sides.map((s) => s.areaId)), [sides])
  const sideKey = sides.map((s) => s.areaId).join("|")

  useEffect(() => {
    setBoard((b) =>
      seed(
        b,
        sides.map((s) => s.areaId)
      )
    )
    // The key stands for the list of classifications; the array is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideKey])

  const placeOf = (id: string, index: number) => board.places[id] ?? runSlot(index)

  // A run asked for from the pie stands where it was asked for, once it is here.
  const runKey = gridRuns.map((r) => r.id).join("|")
  useEffect(() => {
    const wanted = placing.current
    if (!wanted || !gridRuns.some((r) => r.id === wanted.id)) return
    placing.current = null
    setBoard((b) =>
      b.places[wanted.id]
        ? b
        : { ...b, places: { ...b.places, [wanted.id]: freeSpot(wanted.at) } }
    )
    // The key stands for the runs in hand; the array is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  const pairOf = (
    r: ReadingNode
  ): [PredictionCompareSide, PredictionCompareSide] | null => {
    const [a, b] = readingInputs(board, r, present)
    const sa = sideOf(a?.run)
    const sb = sideOf(b?.run)
    return sa && sb ? [sa, sb] : null
  }
  const sidesOf = (r: ReadingNode) =>
    linkedRuns(board, r, present).flatMap((i) => {
      const s = sideOf(i.run)
      return s ? [s] : []
    })

  /*
    EVERY DIFFERENCES NODE'S PAIR IS COMPARED, not only the one selected, since
    each node shows its agreement on its card. Keyed by the pair, so two nodes
    over one pair compute once, and a node relinked to a pair already read
    answers at once.
  */
  const [compares, setCompares] = useState<
    Record<
      string,
      { compare: ClassMapCompare | null; error: string | null; apart: boolean }
    >
  >({})
  const pairKey = (p: [PredictionCompareSide, PredictionCompareSide]) =>
    `${p[0].areaId}|${p[1].areaId}`
  const wanted = board.readings.flatMap((r) => {
    const p = r.kind === "differences" ? pairOf(r) : null
    return p ? [p] : []
  })
  const wantedKey = wanted.map(pairKey).join(",")
  useEffect(() => {
    let live = true
    const legend = (s: PredictionCompareSide) =>
      (s.result.class_stats ?? []).map((c) => ({
        id: c.class_id,
        name: c.name,
        color: c.color,
      }))
    for (const p of wanted) {
      const key = pairKey(p)
      if (compares[key]) continue
      compareClassMaps(p[0].uri, legend(p[0]), p[1].uri, legend(p[1]))
        .then(
          (compare) =>
            live &&
            setCompares((c) => ({
              ...c,
              [key]: { compare, error: null, apart: false },
            }))
        )
        .catch(
          (e: unknown) =>
            live &&
            setCompares((c) => ({
              ...c,
              [key]:
                e instanceof GridMismatchError
                  ? { compare: null, error: null, apart: true }
                  : {
                      compare: null,
                      error:
                        e instanceof Error
                          ? e.message
                          : "Could not compare these rasters.",
                      apart: false,
                    },
            }))
        )
    }
    return () => {
      live = false
    }
    // The key stands for the pairs wanted; the arrays are rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey])

  const add = (kind: ReadingKind) => {
    const id = nextReadingId(board)
    const below = board.readings.reduce(
      (y, r) =>
        Math.max(y, (board.places[r.id]?.y ?? 0) + (heights[r.id] ?? READING_GUESS_H)),
      -40
    )
    setBoard((b) => addReading(b, kind, id, { x: READING_X, y: below + 40 }))
    setSelected(id)
  }
  const remove = (id: string) => {
    setBoard((b) => removeReading(b, id))
    if (selected === id) setSelected(null)
  }
  const runIds = gridRuns.map((r) => r.id)
  const doArrange = () => {
    setBoard((b) => arrange(b, runIds, heights, present))
    requestAnimationFrame(() => api.current?.fit())
  }

  /* ---- The pie a right-click opens --------------------------------------- */

  /** `at`, stepped down past any node already standing there. */
  const freeSpot = (at: Place): Place => {
    let p = { x: Math.round(at.x), y: Math.round(at.y) }
    const taken = [
      ...gridRuns.map((r, i) => placeOf(r.id, i)),
      ...board.readings.flatMap((r) => board.places[r.id] ?? []),
    ]
    while (taken.some((q) => Math.abs(q.x - p.x) < 40 && Math.abs(q.y - p.y) < 40)) {
      p = { ...p, y: p.y + 56 }
    }
    return p
  }

  /** A reading set down at `at`, fed from `feed` where a run is given. */
  const addAt = (kind: ReadingKind, at: Place, feed?: string) => {
    const id = nextReadingId(board)
    let next = addReading(board, kind, id, freeSpot(at))
    if (feed) {
      const linked = linkRun(next, feed, id, null, present)
      if (!("refused" in linked)) next = linked.board
    }
    setBoard(next)
    setSelected(id)
  }

  /** A copy of a reading under it, reading the same runs at the same inputs. */
  const duplicate = (id: string) => {
    const r = board.readings.find((x) => x.id === id)
    if (!r) return
    const copyId = nextReadingId(board)
    const at = board.places[id] ?? { x: READING_X, y: 0 }
    const next = addReading(
      board,
      r.kind,
      copyId,
      freeSpot({ x: at.x, y: at.y + (heights[id] ?? READING_GUESS_H) + 32 })
    )
    const copied = board.links
      .filter((l) => l.reading === id)
      .map((l) => ({ ...l, reading: copyId }))
    setBoard({ ...next, links: [...next.links, ...copied] })
    setSelected(copyId)
  }

  /** A pair reading's A and B, each where the other was. */
  const swap = (id: string) =>
    setBoard((b) => ({
      ...b,
      links: b.links.map((l) =>
        l.reading !== id
          ? l
          : l.socket === "a"
            ? { ...l, socket: "b" }
            : l.socket === "b"
              ? { ...l, socket: "a" }
              : l
      ),
    }))

  const openPie = (
    target: ContextTarget,
    at: { x: number; y: number },
    held: boolean
  ) => {
    setMenu(null)
    if (target.kind === "node") setSelected(target.id)
    setPie({ at, held, target, ring: "root" })
  }

  const readingItem = (kind: ReadingKind): RadialItem => ({
    id: kind,
    label: readingDef(kind).label,
    picture: readingPicture(kind),
    note: shapeNote(kind),
  })

  /** The title and the options of the ring showing. */
  const pieRing = (p: ComparePie): { title: string; items: RadialItem[] } => {
    const t = p.target
    if (p.ring === "readings") {
      return {
        title: "Read with",
        items: PIE_ADD.flatMap((k) => (k === ADD_RUN ? [] : [readingItem(k)])),
      }
    }
    if (t.kind === "field") {
      return {
        title: "Add",
        items: PIE_ADD.map((k) =>
          k === ADD_RUN
            ? { id: ADD_RUN, label: "Add a run", icon: <Plus className="size-3.5" /> }
            : readingItem(k)
        ),
      }
    }
    if (t.kind === "link") {
      return {
        title: "Link",
        items: [
          {
            id: "read",
            label: "Open the reading",
            icon: <CaretRight className="size-3.5" />,
          },
          { id: "unlink", label: "Remove link", icon: <Trash className="size-3.5" /> },
        ],
      }
    }
    const folded = api.current?.isFolded(t.id) ?? false
    const fold: RadialItem = {
      id: "fold",
      label: folded ? "Unfold" : "Fold",
      icon: folded ? (
        <CornersOut className="size-3.5" />
      ) : (
        <Minus className="size-3.5" />
      ),
    }
    const run = gridRuns.find((r) => r.id === t.id)
    if (run) {
      return {
        title: titled(run.label),
        items: [
          {
            id: "read",
            label: "Read with",
            icon: <Plus className="size-3.5" />,
            opens: true,
            blockedBy: present.has(run.id) ? null : "It has no class map to read.",
          },
          fold,
          {
            id: "remove",
            label: "Remove",
            icon: <Trash className="size-3.5" />,
            blockedBy: run.live
              ? "The run on the map stays here while it is on the map."
              : null,
          },
        ],
      }
    }
    const r = board.readings.find((x) => x.id === t.id)
    if (!r) return { title: "Node", items: [] }
    const pair = readingDef(r.kind).shape === "pair"
    const linked = linkedRuns(board, r, present).length
    return {
      title: readingDef(r.kind).label,
      items: [
        { id: "duplicate", label: "Duplicate", icon: <Copy className="size-3.5" /> },
        ...(pair
          ? [
              {
                id: "swap",
                label: "Swap A and B",
                icon: <ArrowsClockwise className="size-3.5" />,
                blockedBy: linked ? null : "Nothing is linked into it.",
              },
            ]
          : []),
        {
          id: "detach",
          label: "Disconnect inputs",
          icon: <Path className="size-3.5" />,
          blockedBy: linked ? null : "Nothing is linked into it.",
        },
        {
          id: "remove",
          label: "Remove",
          icon: <Trash className="size-3.5" />,
          note: "X",
        },
        fold,
      ],
    }
  }

  const pickPie = (p: ComparePie, id: string) => {
    const t = p.target
    setPie(null)
    if (p.ring === "readings" && t.kind === "node") {
      const at = placeOf(t.id, runIds.indexOf(t.id))
      addAt(
        id as ReadingKind,
        { x: Math.max(READING_X, at.x + RUN_W + 60), y: at.y },
        t.id
      )
      return
    }
    if (t.kind === "field") {
      if (id === ADD_RUN) setRunAt(p.at)
      else {
        const at = api.current?.toBoard(p.at.x, p.at.y) ?? { x: READING_X, y: 0 }
        addAt(id as ReadingKind, { x: at.x - 24, y: at.y - 14 })
      }
      return
    }
    if (t.kind === "link") {
      if (id === "unlink") setBoard((b) => unlink(b, t.to, t.toSocket))
      else setSelected(t.to)
      return
    }
    const run = gridRuns.find((r) => r.id === t.id)
    switch (id) {
      case "read":
        setPie({ ...p, held: false, ring: "readings" })
        return
      case "fold":
        api.current?.toggleFold(t.id)
        return
      case "remove":
        if (run) onDropRun(run)
        else remove(t.id)
        return
      case "duplicate":
        duplicate(t.id)
        return
      case "swap":
        swap(t.id)
        return
      case "detach":
        setBoard((b) => ({ ...b, links: b.links.filter((l) => l.reading !== t.id) }))
        return
    }
  }

  const readingSummary = (r: ReadingNode): string => {
    const def = readingDef(r.kind)
    if (def.shape === "pair") {
      const p = pairOf(r)
      if (!p) return "Link two classifications into A and B."
      if (r.kind === "differences") {
        const got = compares[pairKey(p)]
        if (!got) return "Comparing the two maps."
        if (got.apart) {
          return "Two different areas, each read against the reference at right."
        }
        if (got.error || !got.compare) return "These two maps could not be compared."
        return `${got.compare.pct.toFixed(1)} % of shared pixels agree.`
      }
      return "Read at the right when selected."
    }
    const n = sidesOf(r).length
    if (def.shape === "cohort") {
      const [source] = readingInputs(board, r, present)
      return source.run
        ? `${n - 1} ${n - 1 === 1 ? "target" : "targets"} measured from the source.`
        : "Link the source run, then the targets."
    }
    return n ? `${n} ${n === 1 ? "run" : "runs"} read together.` : "Link runs into it."
  }

  const runNodes: SocketNode[] = gridRuns.map((run, i) => ({
    id: run.id,
    place: placeOf(run.id, i),
    w: RUN_W,
    h: heights[run.id] ?? RUN_H,
    header: <Head label={titled(run.label)} />,
    ...RUN_PAINT,
    selected: selected === run.id,
    outputs: present.has(run.id)
      ? [{ id: "classes", label: "Classes", colour: CLASSES }]
      : [],
    inputs: [],
    children: (
      <RunCard
        run={run}
        // The run on the map is on the board for as long as it is on the map.
        onRemove={run.live ? undefined : () => onDropRun(run)}
      />
    ),
  }))
  const readingNodes: SocketNode[] = board.readings.map((r) => ({
    id: r.id,
    place: board.places[r.id] ?? { x: READING_X, y: 0 },
    w: READING_W,
    h: heights[r.id] ?? READING_GUESS_H,
    header: <Head label={readingDef(r.kind).label} />,
    ...READING_PAINT,
    selected: selected === r.id,
    outputs: [],
    inputs: readingInputs(board, r, present).map((i) => ({
      id: i.id,
      /*
        A linked input names the run, with its role where it has one; a free
        one says what it wants. "Run · field 23" said the role twice.
      */
      label: i.run
        ? i.label === "Run"
          ? titled(sideOf(i.run)?.label ?? i.run)
          : `${i.label} · ${titled(sideOf(i.run)?.label ?? i.run)}`
        : i.label === "Run"
          ? "Link a run here"
          : `${i.label}: link a run`,
      colour: i.run ? CLASSES : FREE,
      linked: !!i.run,
    })),
    children: (
      <div className="flex flex-col gap-2">
        <p className="text-label text-muted-foreground">{readingSummary(r)}</p>
        <button
          type="button"
          onClick={() => remove(r.id)}
          className="-ml-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-sm px-1.5 text-label text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <Trash className="size-3.5" />
          Remove
        </button>
      </div>
    ),
  }))
  const links: SocketLink[] = board.links
    .filter((l) => present.has(l.run) && board.readings.some((r) => r.id === l.reading))
    .map((l) => ({
      from: l.run,
      fromSocket: "classes",
      to: l.reading,
      toSocket: l.socket,
      colour: CLASSES,
    }))

  const onLink = (
    from: string,
    _fromSocket: string,
    to: string,
    toSocket: string | null
  ) => {
    if (!present.has(from)) return
    const out = linkRun(board, from, to, toSocket, present)
    if ("refused" in out) notifyInfo(out.refused)
    else setBoard(out.board)
  }

  const reading = board.readings.find((r) => r.id === selected) ?? null
  const n = gridRuns.length
  const empty = (msg: string) => (
    <p className="flex h-full items-center justify-center px-6 text-center text-read text-muted-foreground">
      {msg}
    </p>
  )

  const copyDeltas = async (pair: [PredictionCompareSide, PredictionCompareSide]) => {
    const tables = comparePairTables(pair[0], pair[1])
    const text = tables.map((t) => `# ${t.csvName}\n${tableToCSV(t)}`).join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      notifySuccess(
        `${tables.length} tables copied`,
        tables.map((t) => t.csvName).join(", ")
      )
    } catch (e) {
      notifyError("Could not copy the deltas", e)
    }
  }

  const readingBody = (r: ReadingNode) => {
    const runs = sidesOf(r).map((s) => ({
      id: s.areaId,
      label: s.label,
      result: s.result,
    }))
    switch (r.kind) {
      case "differences": {
        const pair = pairOf(r)
        if (!pair) {
          const sole = sidesOf(r)[0]
          return sole?.result.lulc?.agreement ? (
            <div className="panel-scroll h-full overflow-auto p-3">
              <ConfusionMatrix a={sole.result.lulc.agreement} title={sole.label} />
              <p className="mt-3 text-label text-muted-foreground">
                Link a second classification into B to read this against another run.
              </p>
            </div>
          ) : (
            empty("Link two classifications into this node's A and B.")
          )
        }
        const got = compares[pairKey(pair)]
        return (
          <PredictionComparison
            sides={pair}
            compare={got?.compare ?? null}
            compareError={got?.error ?? null}
            apart={got?.apart ?? false}
          />
        )
      }
      case "shift": {
        const pair = pairOf(r)
        return pair ? (
          <DomainShiftEditor mode="pair" sides={pair} available={sides} />
        ) : (
          empty("Link two classifications into this node's A and B.")
        )
      }
      case "cohort": {
        const linked = sidesOf(r)
        const [source] = readingInputs(board, r, present)
        return linked.length >= 2 && source.run ? (
          <DomainShiftEditor
            mode="cohort"
            sides={null}
            available={linked}
            sourceId={source.run}
          />
        ) : (
          empty("Link a source run, and at least one target measured from it.")
        )
      }
      case "spectra":
        return runs.length ? (
          <SpectraEditor runs={runs} />
        ) : (
          empty("Link classifications into this node.")
        )
      case "separability":
        return runs.length ? (
          <SeparabilityEditor runs={runs} />
        ) : (
          empty("Link classifications into this node.")
        )
      case "library":
        return runs.length ? (
          <LibraryLimitEditor
            runs={runs}
            mode={libraryModes[r.id] ?? "distance"}
            surface={surface}
          />
        ) : (
          empty("Link classifications into this node.")
        )
      case "tables":
        return runs.length ? (
          <RunTables runs={runs} />
        ) : (
          empty("Link classifications into this node.")
        )
    }
  }

  return (
    <div
      ref={setSurface}
      hidden={hidden}
      className={cn(
        "app-no-drag absolute inset-0 z-480 flex-col bg-app pt-[var(--frame-reach,0px)]",
        hidden ? "hidden" : "flex"
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="text-title font-medium text-foreground">Compare</h1>
        <span className="text-label text-muted-foreground">
          {n === 0
            ? "No runs on the board"
            : `${n} ${n === 1 ? "run" : "runs"}, each to its own scale · ${board.readings.length} ${
                board.readings.length === 1 ? "reading" : "readings"
              }`}
        </span>
        <div className="flex items-center gap-0.5">
          <MenuPopover
            open={menu === "view"}
            onOpenChange={(o) => setMenu(o ? "view" : null)}
            surface={surface}
            trigger={(p) => <HeaderMenu {...p} label="View" />}
          >
            <MenuItem
              label="Frame all"
              note="Home"
              onSelect={() => {
                api.current?.fit()
                setMenu(null)
              }}
            />
            <MenuItem
              label="Arrange"
              disabled={!n}
              onSelect={() => {
                doArrange()
                setMenu(null)
              }}
            />
          </MenuPopover>
          <MenuPopover
            open={menu === "add"}
            onOpenChange={(o) => setMenu(o ? "add" : null)}
            surface={surface}
            widthRem={20}
            trigger={(p) => <HeaderMenu {...p} label="Add" />}
          >
            {READINGS.map((d) => (
              <MenuItem
                key={d.kind}
                label={d.label}
                title={d.hint}
                note={
                  d.shape === "pair" ? "A, B" : d.shape === "cohort" ? "1 + n" : "n"
                }
                onSelect={() => {
                  add(d.kind)
                  setMenu(null)
                }}
              />
            ))}
          </MenuPopover>
        </div>
        <div className="ml-auto">
          <RunPicker
            runs={savedRuns}
            projects={projects}
            excludeRunIds={new Set(runIds)}
            busy={loading}
            surface={surface}
            onPick={onAddRun}
          />
        </div>
      </header>

      <ContextMenu
        at={runAt}
        surface={surface}
        title="Add a run"
        widthRem={24}
        onClose={() => setRunAt(null)}
      >
        <RunList
          runs={savedRuns}
          projects={projects}
          excludeRunIds={new Set(runIds)}
          onPick={(run) => {
            const at = runAt && api.current?.toBoard(runAt.x, runAt.y)
            placing.current = at
              ? { id: run.id, at: { x: at.x - 24, y: at.y - 14 } }
              : null
            setRunAt(null)
            onAddRun(run)
          }}
          onEscape={() => setRunAt(null)}
        />
      </ContextMenu>

      {pie && (
        <RadialMenu
          key={`${pie.target.kind}-${pie.ring}`}
          at={pie.at}
          held={pie.held}
          surface={surface}
          within={boardEl}
          {...pieRing(pie)}
          onPick={(id) => pickPie(pie, id)}
          onBack={
            pie.ring === "readings"
              ? () => setPie({ ...pie, held: false, ring: "root" })
              : undefined
          }
          onClose={() => setPie(null)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <div
          ref={setBoardEl}
          className="relative min-w-0 flex-1 outline-none"
          tabIndex={-1}
          onKeyDown={(e) => {
            const t = e.target as HTMLElement
            if (t.closest("input, select, textarea")) return
            if (e.key === "Home") {
              api.current?.fit()
              e.preventDefault()
            } else if (
              reading &&
              (e.key === "Delete" ||
                e.key === "Backspace" ||
                e.key.toLowerCase() === "x")
            ) {
              remove(reading.id)
              e.preventDefault()
            }
          }}
        >
          {n === 0 && !board.readings.length ? (
            <div
              className="h-full"
              onContextMenu={(e) => {
                e.preventDefault()
                openPie(
                  { kind: "field" },
                  { x: e.clientX, y: e.clientY },
                  (e.buttons & 2) !== 0
                )
              }}
            >
              {empty(
                "Add a saved run to set it beside another. Runs of any area and any product can stand here. A right-click opens what can be added."
              )}
            </div>
          ) : (
            <SocketCanvas
              className="absolute inset-0"
              nodes={[...runNodes, ...readingNodes]}
              links={links}
              onMove={(id, place) =>
                setBoard((b) => ({ ...b, places: { ...b.places, [id]: place } }))
              }
              onMeasure={(id, h) =>
                setHeights((held) => (held[id] === h ? held : { ...held, [id]: h }))
              }
              onLink={onLink}
              onUnlink={(to, toSocket) => setBoard((b) => unlink(b, to, toSocket))}
              onSelect={(id) => setSelected(id)}
              selectedLink={null}
              onSelectLink={(to) => setSelected(to)}
              apiRef={api}
              onArrange={doArrange}
              onContext={openPie}
            />
          )}
        </div>

        <aside
          aria-label="Reading of the node selected"
          className="flex w-[34rem] shrink-0 flex-col border-l border-border bg-[rgb(var(--p-surface))]"
        >
          {reading ? (
            <>
              <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-read font-medium text-foreground">
                    {readingDef(reading.kind).label}
                  </h2>
                  <span className="min-w-0 flex-1 truncate text-label text-muted-foreground">
                    {/* A, B, Source and Target say a run's role; "Run" says nothing. */}
                    {linkedRuns(board, reading, present)
                      .map((i) =>
                        readingDef(reading.kind).shape === "many"
                          ? titled(sideOf(i.run)?.label ?? "")
                          : `${i.label} ${titled(sideOf(i.run)?.label ?? "")}`
                      )
                      .join(" · ")}
                  </span>
                  {reading.kind === "differences" && pairOf(reading) && (
                    <button
                      type="button"
                      onClick={() => void copyDeltas(pairOf(reading)!)}
                      className={cn(btnGhost, "shrink-0")}
                    >
                      <Copy className="size-3.5" />
                      Copy deltas
                    </button>
                  )}
                </div>
                <p className="text-label text-muted-foreground">
                  {readingDef(reading.kind).hint}
                </p>
                {reading.kind === "library" && (
                  <PanelChoices
                    label="Library reading"
                    value={libraryModes[reading.id] ?? "distance"}
                    options={[
                      { id: "distance", label: "Distance" },
                      { id: "mechanism", label: "Mechanism" },
                    ]}
                    onChange={(m) =>
                      setLibraryModes((held) => ({ ...held, [reading.id]: m }))
                    }
                  />
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">{readingBody(reading)}</div>
            </>
          ) : (
            <div className="flex h-full flex-col gap-3 overflow-auto p-4">
              <p className="text-read text-muted-foreground">
                Select a reading on the board to read it here. Add one from Add, or
                right-click a run and choose Read with, then pull a link from a run's
                Classes onto its inputs. A run can feed any number of readings.
              </p>
              {board.readings.length > 0 && (
                <section className="flex flex-col gap-2">
                  <PanelHeading>Readings on the board</PanelHeading>
                  {/*
                    EACH ROW IS DRAWN AS A CONTROL, not as text that lights on
                    hover: a border and the control ground say it can be pressed
                    before the pointer finds out, and the arrow says where it
                    goes. The band on its left is the reading node's colour, so
                    a row and its node on the board are seen to be one thing.
                  */}
                  <ul className="flex flex-col gap-1.5">
                    {board.readings.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(r.id)}
                          aria-label={`Read ${readingDef(r.kind).label}: ${readingSummary(r)}`}
                          className="group flex w-full items-stretch overflow-hidden rounded-sm border border-line/40 bg-control text-left transition-colors hover:border-line/70 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span
                            aria-hidden
                            className="w-1 shrink-0"
                            style={{ background: "var(--b-value-head)" }}
                          />
                          <span className="min-w-0 flex-1 px-2.5 py-2">
                            <span className="block text-read font-medium text-foreground">
                              {readingDef(r.kind).label}
                            </span>
                            <span className="block truncate text-label text-muted-foreground">
                              {readingSummary(r)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center pr-2.5">
                            <CaretRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
