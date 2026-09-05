/**
 * The studio as a tree of areas, each holding one editor.
 *
 * WHAT THIS REPLACES. The studio's four surfaces each knew where they went:
 * the outliner anchored itself bottom-left-top, the readout bottom-right-top,
 * the two bands to the foot, and the comparison covered everything from a
 * fixed overlay. The arrangement was therefore a property of the components,
 * and no amount of resizing could change WHICH surface sat WHERE -- which is
 * the whole of the complaint that everything is still in the same place.
 *
 * A tree makes position a property of the arrangement instead. A leaf holds an
 * editor and nothing else; where it lands is decided by the splits above it,
 * and any leaf can hold any editor.
 *
 * ONE POSITION PER SPLIT, which is the point. A split stores a single fraction
 * and both children derive their rectangles from it, so moving a division
 * moves both sides by construction. Blender achieves this with corner vertices
 * shared between neighbouring areas -- overlap there is not discouraged, it is
 * unrepresentable -- and this is the same property expressed as a tree. Two
 * areas cannot overlap because no two rectangles are ever written down; they
 * are computed by walking one structure.
 *
 * PURE, AND GENERIC OVER THE EDITOR. No React, no three, and no knowledge of
 * what an editor is: the editor is a string this module never inspects. That
 * keeps the geometry checkable without a DOM, on the same reasoning that keeps
 * `lib/boardPartition.ts` free of React and `lib/boardLayout.ts` free of three.
 *
 * MINIMUM SIZES ARE NOT ENFORCED HERE. An editor's floor is measured in rem
 * against a rendered rectangle, and this module deals in fractions. The caller
 * clamps, because only the caller knows how large the viewport is.
 */

export type AreaId = string

/**
 * How a split lays its children out.
 *
 * `row` puts them side by side, `a` on the left; `col` stacks them, `a` on
 * top. Named for the arrangement rather than for the edge, because the edge's
 * orientation is the opposite of the arrangement's and one of the two readings
 * is always wrong for somebody.
 */
export type SplitDir = "row" | "col"

export type AreaNode<E extends string = string> =
  | { kind: "leaf"; id: AreaId; editor: E }
  | {
      kind: "split"
      id: AreaId
      dir: SplitDir
      /** Where the division falls, as a fraction of the split's own extent. */
      at: number
      a: AreaNode<E>
      b: AreaNode<E>
    }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface AreaLeafRect<E extends string = string> extends Rect {
  id: AreaId
  editor: E
}

export interface AreaSeam {
  /** The split this edge belongs to; dragging it changes that split's `at`. */
  id: AreaId
  dir: SplitDir
  /** The whole split's rectangle, which is what a drag measures against. */
  bounds: Rect
  /** Where the edge itself is, as a zero-thickness line. */
  at: number
}

export interface AreaLayout<E extends string = string> {
  leaves: AreaLeafRect<E>[]
  seams: AreaSeam[]
}

/**
 * The rectangles, from one walk of the tree.
 *
 * Nothing is stored: a leaf's position is a consequence of the splits above
 * it, so there is no second copy to fall out of step with the first.
 */
export function areaRects<E extends string>(
  root: AreaNode<E>,
  viewport: Rect
): AreaLayout<E> {
  const leaves: AreaLeafRect<E>[] = []
  const seams: AreaSeam[] = []

  const walk = (node: AreaNode<E>, r: Rect): void => {
    if (node.kind === "leaf") {
      leaves.push({ id: node.id, editor: node.editor, ...r })
      return
    }
    const at = clampFraction(node.at)
    seams.push({ id: node.id, dir: node.dir, bounds: r, at })
    if (node.dir === "row") {
      const wa = r.w * at
      walk(node.a, { x: r.x, y: r.y, w: wa, h: r.h })
      walk(node.b, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h })
    } else {
      const ha = r.h * at
      walk(node.a, { x: r.x, y: r.y, w: r.w, h: ha })
      walk(node.b, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha })
    }
  }

  walk(root, viewport)
  return { leaves, seams }
}

/**
 * A fraction kept off both edges.
 *
 * Never 0 or 1: a split at either extreme produces a leaf of zero extent,
 * which is an area that exists, takes pointer events and cannot be seen. The
 * caller's own minimum sizes are stricter; this is the floor under them.
 */
export function clampFraction(at: number): number {
  if (!Number.isFinite(at)) return 0.5
  return Math.min(0.95, Math.max(0.05, at))
}

/**
 * Ids that are unique within a session and readable in a debugger.
 *
 * A SESSION IS NOT THE LIFETIME OF AN ARRANGEMENT, which is what made this
 * counter alone insufficient. The studio's tree is stored in preferences and
 * restored on the next start, while this counter restarts at zero -- so the
 * first split of a new run claimed `a1`, an id a tree restored from the last
 * run was already using. Two nodes with one id is not a cosmetic clash:
 * `moveSplit` maps every node whose id matches, so dragging one division moved
 * the other as well, and a horizontal division appeared to resize the areas
 * either side of a vertical one.
 *
 * Two defences, because they fail differently: `seedAreaIds` puts the counter
 * past whatever a restored tree already holds, and `splitArea` refuses an id
 * the tree it is splitting is using whatever the counter says.
 */
let nextId = 0
export function makeAreaId(prefix = "a"): AreaId {
  nextId += 1
  return `${prefix}${nextId}`
}

/** Every id in the tree, splits and leaves alike. */
export function areaIds<E extends string>(root: AreaNode<E>): Set<AreaId> {
  const out = new Set<AreaId>()
  const walk = (node: AreaNode<E>): void => {
    out.add(node.id)
    if (node.kind === "split") {
      walk(node.a)
      walk(node.b)
    }
  }
  walk(root)
  return out
}

/**
 * The divisions a dragged one may line up with: every other one running the
 * same way, EXCEPT those inside it.
 *
 * A division nested under the one being dragged moves with it -- that is what
 * dragging a split does to its own subtree -- so it can never be a fixed thing
 * to line up against. Offering one would be offering a target that runs away
 * at exactly the rate the pointer approaches it.
 */
export function splitsWithin<E extends string>(
  root: AreaNode<E>,
  id: AreaId
): Set<AreaId> {
  const out = new Set<AreaId>()
  const collect = (n: AreaNode<E>): void => {
    if (n.kind === "leaf") return
    out.add(n.id)
    collect(n.a)
    collect(n.b)
  }
  const find = (n: AreaNode<E>): boolean => {
    if (n.kind === "leaf") return false
    if (n.id === id) {
      collect(n)
      return true
    }
    return find(n.a) || find(n.b)
  }
  find(root)
  return out
}

/**
 * Advance the counter past every generated id a tree already carries.
 *
 * Called wherever a stored arrangement is adopted. Only ids of the generator's
 * own shape are read -- a preset's `a-viewport` names an area rather than
 * counting one, and a tree of those leaves the counter where it was.
 */
export function seedAreaIds<E extends string>(root: AreaNode<E>): void {
  for (const id of areaIds(root)) {
    const n = /^[a-z]*(\d+)$/.exec(id)
    if (n) nextId = Math.max(nextId, Number(n[1]))
  }
}

/**
 * The same tree with every id used once, and the counter put past all of them.
 *
 * For arrangements that arrive from storage. A tree written before ids were
 * guarded can carry the same id twice, and every operation here matches by id:
 * a duplicate makes one drag move two divisions and one retype change two
 * areas. Repaired on the way in rather than tolerated, since nothing
 * downstream can tell which of the two a gesture meant.
 *
 * The SECOND occurrence is the one renamed, so the first keeps whatever else
 * is filed under its id. What the renamed area loses is its pane -- the modes
 * record is keyed by area id -- which is the editor opening on its default
 * pane once, against an arrangement that behaves.
 */
export function uniqueAreaIds<E extends string>(
  root: AreaNode<E>,
  mkId: () => AreaId = makeAreaId
): AreaNode<E> {
  seedAreaIds(root)
  const seen = new Set<AreaId>()
  const walk = (node: AreaNode<E>): AreaNode<E> => {
    const id = seen.has(node.id) ? mkId() : node.id
    seen.add(id)
    if (node.kind === "leaf") return id === node.id ? node : { ...node, id }
    const a = walk(node.a)
    const b = walk(node.b)
    return id === node.id && a === node.a && b === node.b
      ? node
      : { ...node, id, a, b }
  }
  return walk(root)
}

/**
 * Divide a leaf in two, the new editor taking the second half.
 *
 * The leaf keeps its own id and its editor: dividing an area should leave the
 * thing being read where it was, and open the new space beside it.
 */
export function splitArea<E extends string>(
  root: AreaNode<E>,
  leafId: AreaId,
  dir: SplitDir,
  editor: E,
  mkId: () => AreaId = makeAreaId
): AreaNode<E> {
  /*
    An id the tree is not already using, whatever the counter believes.

    The counter is per session and the tree can outlive one; see makeAreaId.
    Asked of the tree rather than trusted from the generator, so a stored
    arrangement, a hand-written preset and a session's own splits cannot
    collide however they are mixed.
  */
  const taken = areaIds(root)
  const fresh = (): AreaId => {
    let id = mkId()
    while (taken.has(id)) id = mkId()
    taken.add(id)
    return id
  }
  return mapTree(root, (node) => {
    if (node.kind !== "leaf" || node.id !== leafId) return node
    return {
      kind: "split",
      id: fresh(),
      dir,
      at: 0.5,
      a: node,
      b: { kind: "leaf", id: fresh(), editor },
    }
  })
}

/**
 * Close a leaf; its sibling takes the parent's place.
 *
 * The sibling grows into the space rather than the space being left empty,
 * which is what makes closing the inverse of splitting. Closing the last leaf
 * is refused: a studio with no areas has nothing to put one back with.
 */
export function joinArea<E extends string>(
  root: AreaNode<E>,
  leafId: AreaId
): AreaNode<E> {
  if (root.kind === "leaf") return root
  const drop = (node: AreaNode<E>): AreaNode<E> | null => {
    if (node.kind === "leaf") return node.id === leafId ? null : node
    const a = drop(node.a)
    const b = drop(node.b)
    if (a === null) return b
    if (b === null) return a
    return a === node.a && b === node.b ? node : { ...node, a, b }
  }
  return drop(root) ?? root
}

/** Point a leaf at a different editor, leaving the arrangement alone. */
export function retypeArea<E extends string>(
  root: AreaNode<E>,
  leafId: AreaId,
  editor: E
): AreaNode<E> {
  return mapTree(root, (node) =>
    node.kind === "leaf" && node.id === leafId ? { ...node, editor } : node
  )
}

/** Move one division. Both sides follow, because both are derived from it. */
export function moveSplit<E extends string>(
  root: AreaNode<E>,
  splitId: AreaId,
  at: number
): AreaNode<E> {
  return mapTree(root, (node) =>
    node.kind === "split" && node.id === splitId
      ? { ...node, at: clampFraction(at) }
      : node
  )
}

/**
 * One leaf, alone, filling the whole surface.
 *
 * Blender's Ctrl-Space, and it is not the same as closing the others: the tree
 * it replaces is kept by the caller and put back by the same keystroke. A
 * maximise that destroyed the arrangement would be a join with a friendlier
 * name.
 */
export function maximizeArea<E extends string>(
  root: AreaNode<E>,
  leafId: AreaId
): AreaNode<E> {
  const found = areaLeaves(root).find((l) => l.id === leafId)
  return found ?? root
}

/** Every leaf, in the order the walk reaches them. */
export function areaLeaves<E extends string>(
  root: AreaNode<E>
): Array<Extract<AreaNode<E>, { kind: "leaf" }>> {
  return root.kind === "leaf"
    ? [root]
    : [...areaLeaves(root.a), ...areaLeaves(root.b)]
}

/** The first leaf holding a given editor, or undefined. */
export function findEditor<E extends string>(
  root: AreaNode<E>,
  editor: E
): AreaId | undefined {
  return areaLeaves(root).find((l) => l.editor === editor)?.id
}

/**
 * Rebuild the tree, replacing whatever the visitor returns.
 *
 * Structurally shared where nothing changed, so React sees a new object only
 * on the branch that actually moved.
 */
function mapTree<E extends string>(
  node: AreaNode<E>,
  visit: (n: AreaNode<E>) => AreaNode<E>
): AreaNode<E> {
  const seen = visit(node)
  if (seen !== node) return seen
  if (node.kind === "leaf") return node
  const a = mapTree(node.a, visit)
  const b = mapTree(node.b, visit)
  return a === node.a && b === node.b ? node : { ...node, a, b }
}
