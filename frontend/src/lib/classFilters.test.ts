/**
 * The filters' rules, on grids small enough to check by hand.
 *
 * Grids are written as rows of letters: `a` is ordinal 0, `b` 1, and so on,
 * and `.` is NO_CLASS. Each case names the rule it pins; the sieve is also
 * checked against its own definition on seeded random grids, by labelling the
 * output again rather than trusting the bookkeeping that produced it.
 */
import { describe, expect, it } from "vitest"

import { NO_CLASS } from "./classMask"
import {
  changedPixels,
  classCounts,
  closeClass,
  labelPatches,
  majorityFilter,
  openClass,
  sieveFilter,
  transitionCounts,
  type ClassGrid,
} from "./classFilters"

function grid(rows: string[]): ClassGrid {
  const height = rows.length
  const width = rows[0].length
  const index = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x]
      index[y * width + x] = ch === "." ? NO_CLASS : ch.charCodeAt(0) - 97
    }
  })
  return { width, height, index }
}

function rows(g: ClassGrid): string[] {
  const out: string[] = []
  for (let y = 0; y < g.height; y++) {
    let s = ""
    for (let x = 0; x < g.width; x++) {
      const v = g.index[y * g.width + x]
      s += v === NO_CLASS ? "." : String.fromCharCode(97 + v)
    }
    out.push(s)
  }
  return out
}

/** A seeded generator, so a failing case can be reproduced. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function randomGrid(w: number, h: number, classes: number, seed: number): ClassGrid {
  const rnd = seeded(seed)
  const index = new Uint8Array(w * h)
  for (let p = 0; p < index.length; p++) {
    index[p] = rnd() < 0.08 ? NO_CLASS : Math.floor(rnd() * classes)
  }
  return { width: w, height: h, index }
}

describe("majorityFilter", () => {
  it("replaces an isolated pixel with the surrounding class", () => {
    const g = grid(["aaaaa", "aaaaa", "aabaa", "aaaaa", "aaaaa"])
    expect(rows(majorityFilter(g, 3, 2))).toEqual(["aaaaa", "aaaaa", "aaaaa", "aaaaa", "aaaaa"])
  })

  it("keeps the centre where it ties for the most frequent", () => {
    // Every window here holds two of each class.
    const g = grid(["ab", "ab"])
    expect(rows(majorityFilter(g, 3, 2))).toEqual(["ab", "ab"])
  })

  it("breaks a tie between two other classes toward the lower ordinal", () => {
    const g = grid(["aab", "acb", "abb"])
    const out = majorityFilter(g, 3, 3)
    expect(out.index[1 * 3 + 1]).toBe(0)
  })

  it("neither counts nor changes pixels outside the area", () => {
    const g = grid([".b.", "bab", ".b."])
    expect(rows(majorityFilter(g, 3, 2))).toEqual([".b.", "bbb", ".b."])
  })

  it("reads a wider window when asked", () => {
    // A 2x2 block: survives a 3x3 window at its own pixels, not a 5x5 one.
    const g = grid(["aaaaaa", "aaaaaa", "aabbaa", "aabbaa", "aaaaaa", "aaaaaa"])
    expect(rows(majorityFilter(g, 3, 2))[2]).toBe("aaaaaa")
    expect(rows(majorityFilter(g, 5, 2))[2]).toBe("aaaaaa")
    const block = grid(["aaaaaa", "abbbaa", "abbbaa", "abbbaa", "aaaaaa"])
    expect(rows(majorityFilter(block, 3, 2))[2]).toBe("abbbaa")
  })
})

describe("sieveFilter", () => {
  it("merges a patch below the threshold into the class around it", () => {
    const g = grid(["aaaa", "abba", "aaaa"])
    expect(rows(sieveFilter(g, 3, 4))).toEqual(["aaaa", "aaaa", "aaaa"])
  })

  it("merges into the largest neighbouring patch", () => {
    const g = grid(["aaabbbbb", "aacbbbbb", "aaabbbbb"])
    expect(rows(sieveFilter(g, 2, 4))[1]).toBe("aabbbbbb")
  })

  it("follows the connectivity it is given", () => {
    const g = grid(["aaaaa", "abaaa", "aabaa", "aaaaa"])
    // Two single pixels under 4-connectivity; one patch of two under 8.
    expect(rows(sieveFilter(g, 2, 4))).toEqual(["aaaaa", "aaaaa", "aaaaa", "aaaaa"])
    expect(rows(sieveFilter(g, 2, 8))).toEqual(rows(g))
  })

  it("keeps an island that has no classified neighbour", () => {
    const g = grid(["...", ".b.", "..."])
    expect(rows(sieveFilter(g, 5, 8))).toEqual(rows(g))
  })

  it("does nothing at a threshold of one pixel", () => {
    const g = grid(["ab", "ba"])
    expect(rows(sieveFilter(g, 1, 4))).toEqual(rows(g))
  })

  it.each([
    [1, 4, 5],
    [2, 8, 5],
    [3, 4, 12],
    [4, 8, 30],
  ] as const)(
    "leaves no patch below the threshold that could still merge (seed %i, %i-connected, %i px)",
    (seed, connectivity, minPixels) => {
      const input = randomGrid(40, 30, 4, seed)
      const out = sieveFilter(input, minPixels, connectivity)
      const { label, size } = labelPatches(out, connectivity)
      const { w, h } = { w: out.width, h: out.height }
      // A small patch that survives must have no classified neighbour at all.
      const touches = new Set<number>()
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = label[y * w + x]
          if (a < 0 || size[a] >= minPixels) continue
          for (const [dx, dy] of connectivity === 8
            ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
            : [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const b = label[ny * w + nx]
            if (b >= 0 && b !== a) touches.add(a)
          }
        }
      }
      expect([...touches]).toEqual([])

      // And a patch that was already large enough is never touched.
      const before = labelPatches(input, connectivity)
      for (let p = 0; p < input.index.length; p++) {
        const l = before.label[p]
        if (l >= 0 && before.size[l] >= minPixels) expect(out.index[p]).toBe(input.index[p])
      }
      // NO_CLASS is where it was.
      for (let p = 0; p < input.index.length; p++) {
        expect(out.index[p] === NO_CLASS).toBe(input.index[p] === NO_CLASS)
      }
    }
  )
})

describe("openClass", () => {
  it("removes a line narrower than the square", () => {
    const g = grid(["aaaaaa", "abbbba", "aaaaaa"])
    expect(rows(openClass(g, 1, 3, 2))).toEqual(["aaaaaa", "aaaaaa", "aaaaaa"])
  })

  it("keeps a block the square fits inside, and takes off its spur", () => {
    const g = grid(["aaaaaa", "abbbba", "abbbaa", "abbbaa", "aaaaaa"])
    expect(rows(openClass(g, 1, 3, 2))).toEqual([
      "aaaaaa",
      "abbbaa",
      "abbbaa",
      "abbbaa",
      "aaaaaa",
    ])
  })

  it("does not erode a class toward the edge of the area", () => {
    const g = grid([".bba", ".bba", ".bba"])
    expect(rows(openClass(g, 1, 3, 2))).toEqual(rows(g))
  })

  it("gives a removed pixel the most frequent other class in its window", () => {
    // The line's left and middle pixels see mostly c; its right one, mostly a.
    const g = grid(["cccaa", "cbbba", "cccaa"])
    expect(rows(openClass(g, 1, 3, 3))[1]).toBe("cccaa")
  })
})

describe("closeClass", () => {
  it("fills a hole narrower than the square", () => {
    const g = grid(["bbbbb", "bbabb", "bbbbb"])
    expect(rows(closeClass(g, 1, 3))).toEqual(["bbbbb", "bbbbb", "bbbbb"])
  })

  it("joins two parts across a one-pixel break and leaves the rest", () => {
    const g = grid([
      "aaaaaaaaa",
      "aaaaaaaaa",
      "aabbabbaa",
      "aabbabbaa",
      "aaaaaaaaa",
      "aaaaaaaaa",
    ])
    expect(rows(closeClass(g, 1, 3))).toEqual([
      "aaaaaaaaa",
      "aaaaaaaaa",
      "aabbbbbaa",
      "aabbbbbaa",
      "aaaaaaaaa",
      "aaaaaaaaa",
    ])
  })

  it("never fills ground outside the area", () => {
    const g = grid(["bbb..", "bbb.."])
    expect(rows(closeClass(g, 1, 3))).toEqual(rows(g))
  })
})

describe("counting", () => {
  it("counts classes, changes and transitions over classified pixels only", () => {
    const a = grid(["aab.", "bbc."])
    const b = grid(["abb.", "bbb."])
    expect([...classCounts(a, 3)]).toEqual([2, 3, 1])
    expect(changedPixels(a, b)).toBe(2)
    const t = transitionCounts(a, b, 3)
    // a -> a once, a -> b once, b -> b three times, c -> b once.
    expect([...t]).toEqual([1, 1, 0, 0, 3, 0, 0, 1, 0])
  })
})
