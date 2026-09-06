/**
 * Saving a board and opening one again.
 *
 * The store keeps a studio as a name, a view and a list of members, each
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
  GetStudio,
  ListStudios,
  SaveStudio,
  DeleteStudio,
  RenameStudio,
} from "../../wailsjs/go/main/App"
import type { store } from "../../wailsjs/go/models"
import type { BoardSnapshot } from "@/components/studio/boardMemory"

export type Studio = store.Studio

/**
 * The boards of one project, most recently saved first.
 *
 * SCOPED, because a menu that offered every board the user had ever saved is
 * what let one project's runs be arranged onto another's board. Passing no
 * project returns all of them, which is what a storage view wants and what a
 * board menu never does.
 *
 * Boards saved before boards had projects come back here too. They carry no
 * project, and hiding them would be indistinguishable from having lost them.
 */
export async function listStudios(projectId?: string | null): Promise<Studio[]> {
  return (await ListStudios(projectId ?? "")) as unknown as Studio[]
}

/**
 * Renames a board without touching its arrangement.
 *
 * Distinct from a save under another name, which is what the studio's own menu
 * offers: that one writes the arrangement CURRENTLY on screen under the name
 * given, and can only be aimed at the board that is open. This changes the
 * label on a stored board and nothing else, which is the operation a list of
 * boards needs and the only one that can be aimed at a board that is not open.
 */
export async function renameStudio(id: string, name: string): Promise<void> {
  await RenameStudio(id, name)
}

/**
 * Removes a board and the members that place its runs.
 *
 * THE RUNS THEMSELVES SURVIVE. A board is an arrangement of runs, not a
 * container for them: deleting one takes the arrangement and leaves every run
 * in the hub, listed and openable, exactly as a run that was never on a board.
 */
export async function deleteStudio(id: string): Promise<void> {
  await DeleteStudio(id)
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
export async function saveStudio(
  name: string,
  snapshot: BoardSnapshot,
  id?: string,
  projectId?: string | null
): Promise<Studio> {
  const payload = {
    id: id ?? "",
    user_id: "",
    project_id: projectId ?? "",
    name,
    created_at: "",
    updated_at: "",
    view_json: JSON.stringify(snapshot),
    member_count: snapshot.runIds.length,
    /*
      A member is the run and its place, and nothing else.

      It also carried `name` and `state_json`, sent as "" and "{}" from here
      every time: the name given on the board and the placement of its planes
      live in the snapshot above, keyed `stack::<runId>`, which is where the
      board reads them from when it reopens. The two constants were a second
      place for the same thing that never held it, and the columns behind them
      are gone.
    */
    members: snapshot.runIds.map((runId, i) => ({
      id: "",
      studio_id: id ?? "",
      run_id: runId,
      position: i,
    })),
  }
  return (await SaveStudio(payload as never)) as unknown as Studio
}

export interface OpenedStudio {
  board: Studio
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
export async function openStudio(id: string): Promise<OpenedStudio> {
  const board = (await GetStudio(id)) as unknown as Studio
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
    nodePlaces: raw.nodePlaces ?? {},
  }
}
