/**
 * Post-classification filters for class rasters: the majority filter, the
 * sieve, and the opening and closing of one class.
 *
 * ON THE RECOVERED ORDINALS, NOT ON A PICTURE. lib/classMask.ts inverts a class
 * PNG back to its legend ordinals byte for byte, because the sidecar paints one
 * hard colour per class at the raster's own resolution (write_overlay_png in
 * sidecar/terra/landcover/raster.py). A filter run here therefore sees the grid
 * the GeoTIFF holds, and an area counted from its output is an area of that
 * grid. That is what separates this module from lib/smoothOverlay.ts, which
 * blurs a one-hot stack and takes the argmax: that one changes how boundaries
 * are drawn, and nothing it produces is a count of anything.
 *
 * PIXELS OUTSIDE THE AREA DO NOT VOTE. NO_CLASS marks them; every operation
 * leaves them NO_CLASS and gives them no weight, and the image's own edge is
 * treated the same way. Ground outside the AOI is not evidence about ground
 * inside it, so the AOI boundary is not a frontier the filters erode toward.
 * The consequence to state is in the morphology: a class that touches the
 * boundary is treated as though it continued past it.
 *
 * Every function takes and returns plain arrays, so the rules are exercised
 * without a DOM (classFilters.test.ts).
 */
import { NO_CLASS } from "@/lib/classMask"

/** A class raster as legend ordinals, row-major; NO_CLASS outside the area. */
export interface ClassGrid {
  width: number
  height: number
  index: Uint8Array
}

/** The side of the square window, in pixels. */
export type WindowSize = 3 | 5 | 7
export const WINDOW_SIZES: readonly WindowSize[] = [3, 5, 7]

/** Which pixels touch: edge neighbours only, or edges and corners. */
export type Connectivity = 4 | 8

/**
 * The plurality class in a size x size window around each pixel.
 *
 * A plurality, not a strict majority. ArcGIS's Majority Filter is a different
 * rule -- it reads only the 4 or 8 adjacent cells and replaces a cell only
 * where more than half of them agree -- and the two are not interchangeable in
 * a methods section.
 *
 * TIES KEEP THE CENTRE. Where the pixel's own class is among the most frequent,
 * it stays; otherwise the lowest legend ordinal among the tied wins, so the
 * output does not depend on iteration order. The window is clipped at the
 * image edge, and NO_CLASS pixels are neither counted nor changed.
 *
 * One pass. Iterating is a second node in the chain, where the reader can see
 * what the second pass moved.
 */
export function majorityFilter(
  grid: ClassGrid,
  size: WindowSize,
  classes: number
): ClassGrid {
  const { width: w, height: h, index } = grid
  const r = (size - 1) >> 1
  const out = new Uint8Array(index.length)
  const hist = new Int32Array(classes)

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r)
    hist.fill(0)
    // A running histogram along the row: one column enters and one leaves per
    // step, so a pixel costs the window's height rather than its area.
    const column = (x: number, delta: 1 | -1) => {
      if (x < 0 || x >= w) return
      for (let yy = y0; yy <= y1; yy++) {
        const c = index[yy * w + x]
        if (c < classes) hist[c] += delta
      }
    }
    for (let x = 0; x <= r && x < w; x++) column(x, 1)

    for (let x = 0; x < w; x++) {
      if (x > 0) {
        column(x + r, 1)
        column(x - r - 1, -1)
      }
      const p = y * w + x
      const centre = index[p]
      if (centre >= classes) {
        out[p] = centre
        continue
      }
      let best = centre
      let most = hist[centre]
      // Strictly greater: a tie with the centre keeps the centre, and a tie
      // between two others keeps the lower ordinal, reached first.
      for (let c = 0; c < classes; c++) {
        if (hist[c] > most) {
          most = hist[c]
          best = c
        }
      }
      out[p] = best
    }
  }
  return { width: w, height: h, index: out }
}

/** Neighbour offsets for labelling, both directions. */
function offsets(connectivity: Connectivity): { dx: number[]; dy: number[] } {
  return connectivity === 8
    ? { dx: [1, -1, 0, 0, 1, 1, -1, -1], dy: [0, 0, 1, -1, 1, -1, 1, -1] }
    : { dx: [1, -1, 0, 0], dy: [0, 0, 1, -1] }
}

/** Neighbour offsets looking forward only, so each adjacent pair is met once. */
function forward(connectivity: Connectivity): { dx: number[]; dy: number[] } {
  return connectivity === 8
    ? { dx: [1, 0, 1, -1], dy: [0, 1, 1, 1] }
    : { dx: [1, 0], dy: [0, 1] }
}

/**
 * Connected patches of one class, labelled in raster order.
 *
 * Exported for the tests, which check the sieve's result by labelling it
 * again rather than by trusting the bookkeeping that produced it.
 */
export function labelPatches(
  grid: ClassGrid,
  connectivity: Connectivity
): { label: Int32Array; size: number[]; cls: number[] } {
  const { width: w, height: h, index } = grid
  const n = w * h
  const label = new Int32Array(n).fill(-1)
  const size: number[] = []
  const cls: number[] = []
  const stack = new Int32Array(n)
  const { dx, dy } = offsets(connectivity)

  for (let p = 0; p < n; p++) {
    if (label[p] !== -1 || index[p] === NO_CLASS) continue
    const id = size.length
    const c = index[p]
    let top = 0
    let count = 0
    stack[top++] = p
    label[p] = id
    while (top > 0) {
      const q = stack[--top]
      count++
      const qx = q % w
      const qy = (q - qx) / w
      for (let k = 0; k < dx.length; k++) {
        const nx = qx + dx[k]
        const ny = qy + dy[k]
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const s = ny * w + nx
        if (label[s] !== -1 || index[s] !== c) continue
        // Labelled when pushed, so each pixel enters the stack once and the
        // stack cannot outgrow the image.
        label[s] = id
        stack[top++] = s
      }
    }
    size.push(count)
    cls.push(c)
  }
  return { label, size, cls }
}

/**
 * Patches smaller than `minPixels`, merged into their largest neighbour.
 *
 * The rule GDAL's sieve states -- "replaces them with the pixel value of the
 * largest neighbour polygon" (GDALSieveFilter, gdal_sieve.py) -- applied
 * smallest patch first, so a speck merges before the patch it sits in is
 * judged. Ties between neighbours of equal size go to the one labelled first
 * in raster order.
 *
 * A MERGE CAN JOIN TWO PATCHES, and the sizes follow that. When a patch takes
 * its neighbour's class it also connects that neighbour to every other patch
 * of the same class it touched, and those are one patch from then on. Without
 * this, two halves of a field split by a hedge-row speck would each be judged
 * small after the speck was gone.
 *
 * A patch with no classified neighbour -- an island in NO_CLASS -- has nothing
 * to merge into and is kept, whatever its size.
 */
export function sieveFilter(
  grid: ClassGrid,
  minPixels: number,
  connectivity: Connectivity
): ClassGrid {
  const { width: w, height: h, index } = grid
  if (minPixels <= 1) return { width: w, height: h, index: index.slice() }

  const { label, size, cls } = labelPatches(grid, connectivity)
  const m = size.length

  // Neighbours are recorded only for patches that may have to move. A patch
  // at or above the threshold never merges away, so its neighbours are never
  // asked for; on a noisy map this is most of the memory saved.
  const adj: (Set<number> | null)[] = new Array(m).fill(null)
  for (let id = 0; id < m; id++) if (size[id] < minPixels) adj[id] = new Set()
  const { dx, dy } = forward(connectivity)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = label[y * w + x]
      if (a < 0) continue
      for (let k = 0; k < dx.length; k++) {
        const nx = x + dx[k]
        const ny = y + dy[k]
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const b = label[ny * w + nx]
        if (b < 0 || b === a) continue
        adj[a]?.add(b)
        adj[b]?.add(a)
      }
    }
  }

  const parent = new Int32Array(m)
  for (let i = 0; i < m; i++) parent[i] = i
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }

  // A binary heap of (size, id), smallest first. Entries go stale when a patch
  // grows or is absorbed; they are recognised on the way out and skipped.
  const hs: number[] = []
  const hi: number[] = []
  const less = (i: number, j: number) => hs[i] < hs[j] || (hs[i] === hs[j] && hi[i] < hi[j])
  const swap = (i: number, j: number) => {
    ;[hs[i], hs[j]] = [hs[j], hs[i]]
    ;[hi[i], hi[j]] = [hi[j], hi[i]]
  }
  const push = (s: number, id: number) => {
    hs.push(s)
    hi.push(id)
    let i = hs.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!less(i, up)) break
      swap(i, up)
      i = up
    }
  }
  const pop = (): [number, number] => {
    const top: [number, number] = [hs[0], hi[0]]
    const lastS = hs.pop()!
    const lastI = hi.pop()!
    if (hs.length) {
      hs[0] = lastS
      hi[0] = lastI
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < hs.length && less(l, s)) s = l
        if (r < hs.length && less(r, s)) s = r
        if (s === i) break
        swap(i, s)
        i = s
      }
    }
    return top
  }

  for (let id = 0; id < m; id++) if (size[id] < minPixels) push(size[id], id)

  while (hs.length) {
    const [s, a] = pop()
    if (find(a) !== a || size[a] !== s || s >= minPixels) continue

    const around = new Set<number>()
    for (const b of adj[a]!) {
      const rb = find(b)
      if (rb !== a) around.add(rb)
    }
    if (!around.size) continue

    let target = -1
    for (const b of around) {
      if (target < 0 || size[b] > size[target] || (size[b] === size[target] && b < target)) {
        target = b
      }
    }
    const into = cls[target]

    // The patch, and every patch of the target's class it now connects.
    const members = [a]
    for (const b of around) if (b !== target && cls[b] === into) members.push(b)

    let root = target
    const sets: Set<number>[] = []
    if (adj[target]) sets.push(adj[target]!)
    for (const b of members) {
      if (adj[b]) sets.push(adj[b]!)
      const keep = size[root] >= size[b] ? root : b
      const gone = keep === root ? b : root
      parent[gone] = keep
      size[keep] += size[gone]
      cls[keep] = into
      adj[gone] = null
      root = keep
    }

    if (size[root] < minPixels) {
      // Still small: it will be judged again, and needs every neighbour its
      // parts had. The largest set is kept and the others poured into it.
      sets.sort((x, y) => y.size - x.size)
      const merged = sets[0] ?? new Set<number>()
      for (let i = 1; i < sets.length; i++) for (const v of sets[i]) merged.add(v)
      adj[root] = merged
      push(size[root], root)
    } else {
      adj[root] = null
    }
  }

  const out = new Uint8Array(index.length)
  for (let p = 0; p < out.length; p++) {
    const l = label[p]
    out[p] = l < 0 ? index[p] : cls[find(l)]
  }
  return { width: w, height: h, index: out }
}

/** A summed-area table over a width x height field, one extra row and column. */
function summedArea(w: number, h: number, on: (x: number, y: number) => number): Int32Array {
  const sat = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += on(x, y)
      sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + row
    }
  }
  return sat
}

/** The sum over the window of radius r centred at (cx, cy), clipped to the field. */
function windowSum(sat: Int32Array, w: number, h: number, cx: number, cy: number, r: number): number {
  const x0 = Math.max(0, cx - r)
  const y0 = Math.max(0, cy - r)
  const x1 = Math.min(w - 1, cx + r)
  const y1 = Math.min(h - 1, cy + r)
  if (x0 > x1 || y0 > y1) return 0
  const W = w + 1
  return (
    sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)] - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0]
  )
}

/**
 * Opening of one class by a size x size square: erosion, then dilation.
 *
 * Removes the parts of class `c` narrower than the square -- spurs, one-pixel
 * lines, specks -- and keeps every part the square fits inside (Soille, 2003,
 * Morphological Image Analysis, 2nd ed.). NO_CLASS and the space past the image
 * edge count as neither inside nor outside the class, so they never break a
 * fit; that is the boundary rule stated at the top of this file.
 *
 * A REMOVED PIXEL NEEDS A CLASS. It takes the plurality of the other classified
 * classes in its own window, ties to the lowest ordinal. One always exists: a
 * pixel is removed only where no square containing it fits, and the square
 * centred on it therefore holds a pixel of another class.
 */
export function openClass(
  grid: ClassGrid,
  c: number,
  size: WindowSize,
  classes: number
): ClassGrid {
  const { width: w, height: h, index } = grid
  const r = (size - 1) >> 1
  // Padded by the radius, so a square centred just past the image edge is a
  // square like any other -- the edge is no more a boundary than NO_CLASS is.
  const pw = w + 2 * r
  const ph = h + 2 * r
  const other = summedArea(pw, ph, (x, y) => {
    const ix = x - r
    const iy = y - r
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0
    const v = index[iy * w + ix]
    return v !== NO_CLASS && v !== c ? 1 : 0
  })
  const fits = summedArea(pw, ph, (x, y) => (windowSum(other, pw, ph, x, y, r) === 0 ? 1 : 0))

  const out = index.slice()
  const hist = new Int32Array(classes)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (index[p] !== c) continue
      if (windowSum(fits, pw, ph, x + r, y + r, r) > 0) continue
      hist.fill(0)
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
          const v = index[yy * w + xx]
          if (v !== c && v < classes) hist[v]++
        }
      }
      let best = -1
      for (let k = 0; k < classes; k++) if (hist[k] > 0 && (best < 0 || hist[k] > hist[best])) best = k
      if (best >= 0) out[p] = best
    }
  }
  return { width: w, height: h, index: out }
}

/**
 * Closing of one class by a size x size square: dilation, then erosion.
 *
 * Fills the gaps in class `c` narrower than the square -- holes, notches,
 * one-pixel breaks between two parts -- and never takes a pixel away from it.
 * The filled pixels become `c`. NO_CLASS is never filled, and, as in the
 * opening, it and the space past the edge do not stop a fill.
 */
export function closeClass(grid: ClassGrid, c: number, size: WindowSize): ClassGrid {
  const { width: w, height: h, index } = grid
  const r = (size - 1) >> 1
  const has = summedArea(w, h, (x, y) => (index[y * w + x] === c ? 1 : 0))
  // Classified pixels the dilation does not reach: the only thing that stops
  // the erosion. Everything else inside a window is either the dilated class
  // or ground that holds no evidence.
  const gap = summedArea(w, h, (x, y) => {
    const v = index[y * w + x]
    return v !== NO_CLASS && windowSum(has, w, h, x, y, r) === 0 ? 1 : 0
  })
  const out = index.slice()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const v = index[p]
      if (v === NO_CLASS || v === c) continue
      if (windowSum(gap, w, h, x, y, r) === 0) out[p] = c
    }
  }
  return { width: w, height: h, index: out }
}

/** Pixels per legend ordinal. */
export function classCounts(grid: ClassGrid, classes: number): Uint32Array {
  const counts = new Uint32Array(classes)
  for (const v of grid.index) if (v < classes) counts[v]++
  return counts
}

/** Pixels classified in both grids whose class differs. Same grid required. */
export function changedPixels(a: ClassGrid, b: ClassGrid): number {
  let n = 0
  for (let p = 0; p < a.index.length; p++) {
    const x = a.index[p]
    const y = b.index[p]
    if (x !== NO_CLASS && y !== NO_CLASS && x !== y) n++
  }
  return n
}

/**
 * How many pixels went from each class to each other class, as a flat
 * classes x classes table: row is the class in `a`, column the class in `b`.
 */
export function transitionCounts(a: ClassGrid, b: ClassGrid, classes: number): Uint32Array {
  const t = new Uint32Array(classes * classes)
  for (let p = 0; p < a.index.length; p++) {
    const x = a.index[p]
    const y = b.index[p]
    if (x < classes && y < classes) t[x * classes + y]++
  }
  return t
}

/**
 * The grid painted in its legend's colours, as RGBA bytes.
 *
 * Opaque where classified and transparent where not, as the sidecar paints
 * its own class maps. An ordinal with no colour is drawn transparent rather
 * than guessed at.
 */
export function paintClassGrid(
  grid: ClassGrid,
  colors: ReadonlyArray<readonly [number, number, number] | null>
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(grid.index.length * 4)
  for (let p = 0, o = 0; p < grid.index.length; p++, o += 4) {
    const rgb = colors[grid.index[p]]
    if (!rgb) continue
    rgba[o] = rgb[0]
    rgba[o + 1] = rgb[1]
    rgba[o + 2] = rgb[2]
    rgba[o + 3] = 255
  }
  return rgba
}
