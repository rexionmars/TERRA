/**
 * That undo returns what was there before a step, and only that.
 */
import { describe, expect, it } from "vitest"

import { UndoHistory } from "./undoHistory"

const history = () => new UndoHistory<number>((a, b) => a === b, 800, 3)

describe("UndoHistory", () => {
  it("takes its first state as the baseline, not as a step", () => {
    const h = history()
    h.record(1, 0)
    expect(h.canUndo).toBe(false)
  })

  it("undoes and redoes a step", () => {
    const h = history()
    h.record(1, 0)
    h.record(2, 1000)
    expect(h.undo()).toBe(1)
    expect(h.canUndo).toBe(false)
    expect(h.redo()).toBe(2)
    expect(h.redo()).toBeNull()
  })

  it("makes changes close together one step, back to where they began", () => {
    const h = history()
    h.record(1, 0)
    h.record(2, 1000)
    h.record(3, 1200)
    h.record(4, 1500)
    expect(h.undo()).toBe(1)
    expect(h.undo()).toBeNull()
  })

  it("records nothing for a state equal to the current one", () => {
    const h = history()
    h.record(1, 0)
    h.record(1, 1000)
    expect(h.canUndo).toBe(false)
  })

  it("does not record the state an undo restored, and keeps the redo", () => {
    const h = history()
    h.record(1, 0)
    h.record(2, 1000)
    h.undo()
    h.record(1, 1100)
    expect(h.canRedo).toBe(true)
  })

  it("drops what was undone when a new edit is made", () => {
    const h = history()
    h.record(1, 0)
    h.record(2, 1000)
    h.undo()
    h.record(5, 1100)
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe(1)
  })

  it("starts a new step after an undo even within the merge window", () => {
    const h = history()
    h.record(1, 0)
    h.record(2, 1000)
    h.record(3, 3000)
    h.undo()
    h.record(4, 3100)
    expect(h.undo()).toBe(2)
  })

  it("keeps no more steps than its limit, dropping the oldest", () => {
    const h = history()
    h.record(0, 0)
    for (let i = 1; i <= 5; i++) h.record(i, i * 1000)
    expect(h.undo()).toBe(4)
    expect(h.undo()).toBe(3)
    expect(h.undo()).toBe(2)
    expect(h.undo()).toBeNull()
  })

  it("rebases without making a step", () => {
    const h = history()
    h.record(1, 0)
    h.rebase(7)
    expect(h.canUndo).toBe(false)
    h.record(8, 2000)
    expect(h.undo()).toBe(7)
  })

  it("forgets everything on reset", () => {
    const h = history()
    h.record(1, 0)
    h.record(2, 1000)
    h.reset()
    expect(h.canUndo).toBe(false)
    h.record(3, 2000)
    expect(h.canUndo).toBe(false)
  })
})
