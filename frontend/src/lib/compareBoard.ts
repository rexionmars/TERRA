/**
 * The Compare board: runs as nodes, and readings that take them as inputs.
 *
 * The grid it replaces held every run and compared two of them, the pair
 * marked A and B, so a second comparison meant giving up the first. Here a
 * reading is a node of its own, as a node of the Workflows compositor is, and
 * there are as many as the reader adds: field 20 against field 18 in one
 * Differences node, field 20 against drawn 9 in another, a cohort of five in a
 * third. A run feeds any number of readings.
 *
 * WHICH RUNS ARE ON THE BOARD IS NOT THIS MODULE'S. The runs in hand
 * (lib/sessionRuns) are, and this holds only what the reader built over them:
 * the readings, the links and where each node stands. A link or a place for a
 * run that has left is ignored rather than removed, so taking a run off and
 * putting it back finds it where it was.
 *
 * Data and rules only; components/shell/CompareScreen.tsx draws it.
 */
import type { Place } from "@/lib/compositorGraph"

export type ReadingKind =
  "differences" | "shift" | "cohort" | "spectra" | "separability" | "library" | "tables"

/**
 * What a reading takes.
 *
 * `pair` is A and B, `cohort` is a source and any number of targets measured
 * from it, and `many` is any number of runs read side by side. The last input
 * of the two growing shapes is always free, as a Blender node's growing inputs
 * are, so linking into it is how another is added.
 */
export type ReadingShape = "pair" | "cohort" | "many"

export interface ReadingDef {
  kind: ReadingKind
  label: string
  hint: string
  shape: ReadingShape
}

export const READINGS: readonly ReadingDef[] = [
  {
    kind: "differences",
    label: "Differences",
    hint: "Agreement, transitions and class shares between A and B",
    shape: "pair",
  },
  {
    kind: "shift",
    label: "Domain shift",
    hint: "How far apart two runs sit, as the model saw them",
    shape: "pair",
  },
  {
    kind: "cohort",
    label: "Cohort",
    hint: "Every target measured from one source run",
    shape: "cohort",
  },
  {
    kind: "spectra",
    label: "Spectra",
    hint: "What each class reflects, in every run linked",
    shape: "many",
  },
  {
    kind: "separability",
    label: "Separability",
    hint: "How far apart classes are, and where that changes",
    shape: "many",
  },
  {
    kind: "library",
    label: "Library",
    hint: "Each class against a spectral library",
    shape: "many",
  },
  { kind: "tables", label: "Tables", hint: "The runs' own tables", shape: "many" },
]

export function readingDef(kind: ReadingKind): ReadingDef {
  return READINGS.find((r) => r.kind === kind) ?? READINGS[0]
}

export interface ReadingNode {
  id: string
  kind: ReadingKind
}

/** A run feeding one input of one reading. An input takes one link. */
export interface BoardLink {
  run: string
  reading: string
  socket: string
}

export interface CompareBoard {
  readings: ReadingNode[]
  links: BoardLink[]
  /** Where each node stands, runs and readings alike, once placed or moved. */
  places: Record<string, Place>
  /**
   * Whether the board has put its first reading down. Two classifications on
   * an empty board get a Differences node linked to both, which is what the
   * grid showed on its own; once, so a reader who removes it is not given it
   * back.
   */
  seeded: boolean
}

export const EMPTY_BOARD: CompareBoard = {
  readings: [],
  links: [],
  places: {},
  seeded: false,
}

export interface ReadingInput {
  id: string
  label: string
  /** The run linked here, if any. */
  run?: string
}

const numbered = (prefix: string, socket: string): number | null => {
  const m = socket.startsWith(`${prefix}-`)
    ? Number(socket.slice(prefix.length + 1))
    : NaN
  return Number.isInteger(m) && m > 0 ? m : null
}

/** The growing inputs of one prefix, linked ones in order, then one free. */
function growing(
  links: readonly BoardLink[],
  reading: string,
  prefix: string,
  label: string
): ReadingInput[] {
  const linked = links
    .flatMap((l) => {
      const n = l.reading === reading ? numbered(prefix, l.socket) : null
      return n === null ? [] : [{ n, run: l.run, socket: l.socket }]
    })
    .sort((a, b) => a.n - b.n)
  const next = (linked.at(-1)?.n ?? 0) + 1
  return [
    ...linked.map((l) => ({ id: l.socket, label, run: l.run })),
    { id: `${prefix}-${next}`, label },
  ]
}

/**
 * The inputs a reading shows, in order.
 *
 * `present` is the runs on the board now: a link from one that has left is
 * not drawn, and its input reads as free.
 */
export function readingInputs(
  board: CompareBoard,
  reading: ReadingNode,
  present?: ReadonlySet<string>
): ReadingInput[] {
  const links = present ? board.links.filter((l) => present.has(l.run)) : board.links
  const at = (socket: string) =>
    links.find((l) => l.reading === reading.id && l.socket === socket)?.run
  const shape = readingDef(reading.kind).shape
  if (shape === "pair") {
    return [
      { id: "a", label: "A", run: at("a") },
      { id: "b", label: "B", run: at("b") },
    ]
  }
  if (shape === "cohort") {
    return [
      { id: "source", label: "Source", run: at("source") },
      ...growing(links, reading.id, "target", "Target"),
    ]
  }
  return growing(links, reading.id, "run", "Run")
}

/** The runs a reading reads, by its inputs, in their order. */
export function linkedRuns(
  board: CompareBoard,
  reading: ReadingNode,
  present?: ReadonlySet<string>
): ReadingInput[] {
  return readingInputs(board, reading, present).filter((i) => i.run !== undefined)
}

export type LinkResult = { board: CompareBoard } | { refused: string }

/**
 * A run linked into an input of a reading.
 *
 * Dropped on the node's body rather than on an input (`socket` null), it takes
 * the first free input. A link onto an input already taken replaces it, which
 * is how a pair's B is swapped. A run already feeding the reading is refused
 * at any other input: a run against itself compares nothing, and twice in a
 * list it is counted twice.
 */
export function linkRun(
  board: CompareBoard,
  run: string,
  readingId: string,
  socket: string | null,
  present?: ReadonlySet<string>
): LinkResult {
  const reading = board.readings.find((r) => r.id === readingId)
  if (!reading) return { refused: "That is not a reading." }
  const inputs = readingInputs(board, reading, present)
  const target = socket
    ? inputs.find((i) => i.id === socket)
    : inputs.find((i) => i.run === undefined)
  if (!target) return { refused: "This reading has no free input." }
  if (inputs.some((i) => i.run === run && i.id !== target.id)) {
    return { refused: "This run already feeds this reading." }
  }
  const links = board.links.filter(
    (l) => !(l.reading === readingId && l.socket === target.id)
  )
  return {
    board: {
      ...board,
      links: [...links, { run, reading: readingId, socket: target.id }],
    },
  }
}

export function unlink(
  board: CompareBoard,
  readingId: string,
  socket: string
): CompareBoard {
  return {
    ...board,
    links: board.links.filter((l) => !(l.reading === readingId && l.socket === socket)),
  }
}

export function addReading(
  board: CompareBoard,
  kind: ReadingKind,
  id: string,
  place: Place
): CompareBoard {
  return {
    ...board,
    readings: [...board.readings, { id, kind }],
    places: { ...board.places, [id]: place },
    seeded: true,
  }
}

export function removeReading(board: CompareBoard, id: string): CompareBoard {
  const places = { ...board.places }
  delete places[id]
  return {
    ...board,
    readings: board.readings.filter((r) => r.id !== id),
    links: board.links.filter((l) => l.reading !== id),
    places,
  }
}

/** Where the board's first reading goes, and the run grid beside it. */
export const RUN_W = 288
// A run card's height with its picture, its class line, the raster choice and its period.
export const RUN_H = 340
export const READING_W = 248
const GAP = 40
/*
  ONE COLUMN OF RUNS, with the readings to its right. In two columns a link
  from a run in the first ran behind the run beside it on its way to a
  reading, so a wire crossed a card it had nothing to do with.
*/
const RUN_COLUMNS = 1

/** Where a run stands before it is moved: the next place down the column. */
export function runSlot(index: number): Place {
  return {
    x: (index % RUN_COLUMNS) * (RUN_W + GAP),
    y: Math.floor(index / RUN_COLUMNS) * (RUN_H + GAP),
  }
}

/** The column right of the run grid, where readings stand. */
export const READING_X = RUN_COLUMNS * (RUN_W + GAP) + GAP

/**
 * The first reading, put down once: a Differences node linked to the first
 * two classifications, where the board has none and two are on it.
 */
export function seed(board: CompareBoard, classRuns: readonly string[]): CompareBoard {
  if (board.seeded) return board
  if (board.readings.length) return { ...board, seeded: true }
  if (classRuns.length < 2) return board
  const id = "reading-1"
  return {
    readings: [{ id, kind: "differences" }],
    links: [
      { run: classRuns[0], reading: id, socket: "a" },
      { run: classRuns[1], reading: id, socket: "b" },
    ],
    places: { ...board.places, [id]: { x: READING_X, y: 0 } },
    seeded: true,
  }
}

/** An id no reading on the board has. */
export function nextReadingId(board: CompareBoard): string {
  const taken = new Set(board.readings.map((r) => r.id))
  let n = board.readings.length + 1
  while (taken.has(`reading-${n}`)) n += 1
  return `reading-${n}`
}

/**
 * The board laid out by its links: the runs in their grid, in the order given,
 * and each reading beside the runs it reads, at the mean height of their
 * middles, pushed down where it would overlap the reading above.
 */
export function arrange(
  board: CompareBoard,
  runs: readonly string[],
  heights: Readonly<Record<string, number>>,
  present?: ReadonlySet<string>
): CompareBoard {
  const places: Record<string, Place> = { ...board.places }
  runs.forEach((id, i) => {
    places[id] = runSlot(i)
  })
  const wanted = board.readings.map((r, i) => {
    const ys = linkedRuns(board, r, present).flatMap((input) => {
      const p = input.run ? places[input.run] : undefined
      return p ? [p.y + (heights[input.run!] ?? RUN_H) / 2] : []
    })
    const y = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : i * 160
    return { id: r.id, y: y - (heights[r.id] ?? 140) / 2 }
  })
  wanted.sort((a, b) => a.y - b.y)
  let floor = -Infinity
  for (const w of wanted) {
    const y = Math.max(w.y, floor)
    places[w.id] = { x: READING_X, y }
    floor = y + (heights[w.id] ?? 140) + GAP / 2
  }
  return { ...board, places }
}
