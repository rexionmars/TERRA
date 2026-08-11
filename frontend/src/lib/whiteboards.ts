/**
 * Saving a board and opening one again.
 *
 * The store keeps a whiteboard as a name, a view and a list of members, each
 * naming a run. What none of that says is how the board was ARRANGED -- where
 * areas sat, what was renamed, what was dropped to a base level -- and the
 * store is deliberately incurious about it: those fields are the surface's
 * vocabulary, not the database's, and a column per control would make every
 * new control a migration.
 *
 * So the arrangement travels as JSON, and this module is the one place that
 * knows its shape. Reading it back is guarded rather than trusted: a board
 * written by an older build is text of unknown shape, and the honest response
 * to a field that is missing is the default, not a crash.
 */
import {
  GetWhiteboard,
  ListWhiteboards,
  SaveWhiteboard,
} from "../../wailsjs/go/main/App"
import type { store } from "../../wailsjs/go/models"
import type { BoardSnapshot } from "@/components/isolate/boardMemory"

export type Whiteboard = store.Whiteboard

/** A board's own name is a label; a run's place in it is a member. */
export async function listWhiteboards(): Promise<Whiteboard[]> {
  return (await ListWhiteboards()) as unknown as Whiteboard[]
}

/**
 * Writes the arrangement whole, under a name.
 *
 * Members are the runs on the board, in the order their areas exist, so
 * reopening lays them out in the order they were saved in. The whole snapshot
 * rides on the board's own view field rather than being split across the
 * members: it is one document describing one board, and splitting it would
 * mean reassembling it correctly on the way back.
 */
export async function saveWhiteboard(
  name: string,
  snapshot: BoardSnapshot,
  id?: string
): Promise<Whiteboard> {
  const payload = {
    id: id ?? "",
    user_id: "",
    name,
    created_at: "",
    updated_at: "",
    view_json: JSON.stringify(snapshot),
    member_count: snapshot.runIds.length,
    members: snapshot.runIds.map((runId, i) => ({
      id: "",
      whiteboard_id: id ?? "",
      run_id: runId,
      position: i,
      name: "",
      state_json: "{}",
    })),
  }
  return (await SaveWhiteboard(payload as never)) as unknown as Whiteboard
}

export interface OpenedWhiteboard {
  board: Whiteboard
  snapshot: BoardSnapshot | null
  /** Members whose run has been deleted; their rasters cannot be drawn. */
  missingRunIds: string[]
}

/**
 * Reads a board back, with its arrangement parsed and its gaps reported.
 *
 * A member whose run is gone comes back marked rather than dropped -- the
 * store makes that distinction on purpose, and swallowing it here would turn
 * a two-area board into a one-area board with nothing saying so.
 */
export async function openWhiteboard(id: string): Promise<OpenedWhiteboard> {
  const board = (await GetWhiteboard(id)) as unknown as Whiteboard
  return {
    board,
    snapshot: parseSnapshot(board.view_json),
    missingRunIds: (board.members ?? [])
      .filter((m) => m.missing)
      .map((m) => m.run_id),
  }
}

/**
 * The arrangement, or null where it cannot be read.
 *
 * Every field is defaulted rather than assumed. A board saved by an older
 * build is text of unknown shape, and the useful answer to a missing field is
 * the value a fresh board would have -- not an exception thrown while opening
 * something the user asked for.
 */
export function parseSnapshot(text: string | undefined): BoardSnapshot | null {
  if (!text) return null
  let raw: Partial<BoardSnapshot>
  try {
    raw = JSON.parse(text) as Partial<BoardSnapshot>
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  return {
    runIds: Array.isArray(raw.runIds) ? raw.runIds : [],
    added: raw.added ?? {},
    removed: Array.isArray(raw.removed) ? raw.removed : [],
    flat: Array.isArray(raw.flat) ? raw.flat : [],
    order: raw.order ?? {},
    names: raw.names ?? {},
    extraState: raw.extraState ?? {},
    places: raw.places ?? {},
    planePlaces: raw.planePlaces ?? {},
    gap: typeof raw.gap === "number" ? raw.gap : 0.1,
    links: raw.links === true,
    labels: raw.labels === true,
  }
}
