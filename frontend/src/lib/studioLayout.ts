/**
 * The studio's arrangement, kept across restarts.
 *
 * WHY THIS IS NOT boardMemory. That module states its own position and gives a
 * reason: it survives a close and not a restart, because saving is a thing
 * someone asks for by name. The distinction it draws is between putting
 * something down and throwing it away, and it is the right one for WORK -- the
 * selection, the names, which runs are on the board.
 *
 * An arrangement is not work. Which areas exist, what each holds and where the
 * divisions fall is a preference in the same sense `layout_mode` already is,
 * and that one carries the argument verbatim: the two layouts are different
 * enough that landing in the other one reads as the application having changed
 * rather than as a setting having persisted. A reader who widens a column and
 * finds it narrow again tomorrow reads the same way.
 *
 * So: the arrangement persists, the contents do not. Reopening the studio
 * gives back the shape that was left and an empty board to put in it.
 *
 * STORED AS THE TREE, not as a dump of the runtime. Naming the fields is what
 * makes an old saved arrangement readable by a newer application -- the same
 * argument boardMemory's own snapshot makes for itself -- and an unknown
 * editor id or a malformed node falls back to the preset rather than throwing.
 */
import type { AreaNode } from "@/lib/boardAreas"
import { STUDIO_EDITORS, type EditorId } from "@/lib/studioEditors"
import { STUDIO_WORKSPACES, type StudioTree } from "@/lib/studioWorkspaces"

export interface StudioLayout {
  /** Which workspace tab the studio was left on. */
  workspace?: string
  /** The live arrangement per workspace, as the reader left it. */
  trees?: Record<string, StudioTree>
  /**
   * Which pane each area's editor was left on, keyed `areaId:editorId`.
   *
   * Part of the arrangement rather than of the work: two outliners set to
   * different panes is a layout decision, and Blender keeps exactly this in
   * the file -- a per-area record of every editor that has occupied the space.
   */
  modes?: Record<string, string>
}

const KNOWN_EDITORS = new Set<string>(STUDIO_EDITORS.map((e) => e.id))
const KNOWN_WORKSPACES = new Set(STUDIO_WORKSPACES.map((w) => w.id))

/**
 * A tree from storage, or null where it cannot be trusted.
 *
 * Validated rather than cast. A stored arrangement outlives the code that
 * wrote it: an editor removed from the registry, a split without children, a
 * fraction that is not a number. Any of those reaching `areaRects` would place
 * an area nobody can see or throw while the studio opens, so a tree that fails
 * to parse is discarded and the preset takes over -- which is what a reader
 * expects from a layout that has gone stale, and is what `layoutModeFromPrefs`
 * already does by defaulting through exception.
 */
export function parseStudioTree(value: unknown): StudioTree | null {
  if (!value || typeof value !== "object") return null
  const n = value as Record<string, unknown>
  if (n.kind === "leaf") {
    if (typeof n.id !== "string" || typeof n.editor !== "string") return null
    if (!KNOWN_EDITORS.has(n.editor)) return null
    return { kind: "leaf", id: n.id, editor: n.editor as EditorId }
  }
  if (n.kind === "split") {
    if (typeof n.id !== "string") return null
    if (n.dir !== "row" && n.dir !== "col") return null
    if (typeof n.at !== "number" || !Number.isFinite(n.at)) return null
    const a = parseStudioTree(n.a)
    const b = parseStudioTree(n.b)
    // A split with one child is not a split; the tree it came from is broken
    // in a way this cannot repair without guessing which half was meant.
    if (!a || !b) return null
    return { kind: "split", id: n.id, dir: n.dir, at: n.at, a, b }
  }
  return null
}

/** What the studio should open with, from whatever was stored. */
export function parseStudioLayout(value: unknown): StudioLayout {
  if (!value || typeof value !== "object") return {}
  const raw = value as Record<string, unknown>
  const out: StudioLayout = {}

  if (typeof raw.workspace === "string" && KNOWN_WORKSPACES.has(raw.workspace)) {
    out.workspace = raw.workspace
  }

  if (raw.modes && typeof raw.modes === "object") {
    const modes: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.modes as object)) {
      // Strings only. The editor that reads one falls back on a value it does
      // not recognise, which is the same defaulting-by-exception the rest of
      // this file uses.
      if (typeof v === "string") modes[k] = v
    }
    if (Object.keys(modes).length) out.modes = modes
  }

  if (raw.trees && typeof raw.trees === "object") {
    const trees: Record<string, StudioTree> = {}
    for (const [id, tree] of Object.entries(raw.trees as object)) {
      // Only for workspaces that still exist: a tree filed under a removed one
      // would be carried forever and never opened.
      if (!KNOWN_WORKSPACES.has(id)) continue
      const parsed = parseStudioTree(tree)
      if (parsed) trees[id] = parsed
    }
    if (Object.keys(trees).length) out.trees = trees
  }

  return out
}

/**
 * The tree as it goes to storage.
 *
 * Rebuilt field by field rather than serialised whole, so a field added to the
 * runtime shape does not silently start being written to a preference nobody
 * decided to store.
 */
export function serializeStudioTree(tree: AreaNode<EditorId>): StudioTree {
  return tree.kind === "leaf"
    ? { kind: "leaf", id: tree.id, editor: tree.editor }
    : {
        kind: "split",
        id: tree.id,
        dir: tree.dir,
        // Rounded: a fraction carried to fifteen places is noise in a stored
        // preference, and a hundredth is finer than a division can be dragged.
        at: Math.round(tree.at * 1000) / 1000,
        a: serializeStudioTree(tree.a),
        b: serializeStudioTree(tree.b),
      }
}

export function serializeStudioLayout(
  workspace: string,
  trees: Readonly<Record<string, AreaNode<EditorId>>>,
  modes: Readonly<Record<string, string>> = {}
): StudioLayout {
  const out: Record<string, StudioTree> = {}
  for (const [id, tree] of Object.entries(trees)) {
    if (KNOWN_WORKSPACES.has(id)) out[id] = serializeStudioTree(tree)
  }
  return { workspace, trees: out, modes: { ...modes } }
}
