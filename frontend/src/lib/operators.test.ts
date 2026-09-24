/**
 * That the keymap resolves a keystroke to one operator, and the one meant.
 *
 * The table is written by hand, and the failure it invites is silent: two
 * operators given the same keys in one scope do not error, the first one
 * declared simply wins, and the second becomes a row whose shortcut is printed
 * in its menu and never runs.
 */
import { describe, expect, it } from "vitest"

import { STUDIO_EDITORS } from "./studioEditors"
import {
  OPERATORS,
  OPERATOR_IDS,
  findOperator,
  formatKeys,
  keyMatches,
  operatorCompletions,
  operatorForKey,
  searchOperators,
  type KeyEventLike,
} from "./operators"

const key = (code: string, mods: Partial<KeyEventLike> = {}, k = ""): KeyEventLike => ({
  code,
  key: k || code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe("the table", () => {
  it("binds no key twice in the same scope", () => {
    // A narrower scope over a wider one is the override the keymap is built
    // to allow; the same scope twice is a clash, on either platform.
    for (const mac of [true, false]) {
      const seen = new Map<string, string>()
      for (const id of OPERATOR_IDS) {
        const scope = OPERATORS[id].scope ?? "window"
        for (const spec of OPERATORS[id].keys ?? []) {
          const slot = `${scope} ${formatKeys(spec, mac)}`
          const other = seen.get(slot)
          expect(other === undefined || other === id, `${slot}: ${other} and ${id}`).toBe(true)
          seen.set(slot, id)
        }
      }
    }
  })

  it("scopes only to editors the studio has", () => {
    const ids = new Set<string>(STUDIO_EDITORS.map((e) => e.id))
    expect(ids.has("viewport")).toBe(true)
    expect(ids.has("outliner")).toBe(true)
  })

  it("gives every operator a label, a description and a menu", () => {
    for (const id of OPERATOR_IDS) {
      const o = OPERATORS[id]
      expect(o.label.trim(), id).not.toBe("")
      expect(o.description.trim(), id).not.toBe("")
      expect(o.menu.trim(), id).not.toBe("")
    }
  })
})

describe("keyMatches", () => {
  it("reads Mod as Cmd on macOS and as Ctrl elsewhere", () => {
    expect(keyMatches("Mod+S", key("KeyS", { metaKey: true }), true)).toBe(true)
    expect(keyMatches("Mod+S", key("KeyS", { ctrlKey: true }), true)).toBe(false)
    expect(keyMatches("Mod+S", key("KeyS", { ctrlKey: true }), false)).toBe(true)
    expect(keyMatches("Mod+S", key("KeyS", { metaKey: true }), false)).toBe(false)
  })

  it("reads Ctrl as the Control key on every platform", () => {
    expect(keyMatches("Ctrl+Space", key("Space", { ctrlKey: true }, " "), true)).toBe(true)
    expect(keyMatches("Ctrl+Space", key("Space", { metaKey: true }, " "), true)).toBe(false)
  })

  it("matches the physical key, not the character a modifier types", () => {
    // Option-A types "å" on a US Mac layout.
    expect(keyMatches("Alt+A", key("KeyA", { altKey: true }, "å"), true)).toBe(true)
  })

  it("requires the modifiers exactly", () => {
    expect(keyMatches("A", key("KeyA", { shiftKey: true }), true)).toBe(false)
    expect(keyMatches("A", key("KeyA"))).toBe(true)
  })
})

describe("operatorForKey", () => {
  it("runs a plane key only with the pointer over the planes", () => {
    const a = key("KeyA")
    expect(operatorForKey(a, "viewport", true)).toBe("SELECT_ALL")
    expect(operatorForKey(a, "outliner", true)).toBe("SELECT_ALL")
    expect(operatorForKey(a, "globe", true)).toBeNull()
    expect(operatorForKey(a, null, true)).toBeNull()
  })

  it("keeps the window keys anywhere", () => {
    const save = key("KeyS", { metaKey: true })
    expect(operatorForKey(save, null, true)).toBe("STUDIO_SAVE")
    expect(operatorForKey(save, "globe", true)).toBe("STUDIO_SAVE")
  })

  it("frames only over the viewport", () => {
    expect(operatorForKey(key("Period", {}, "."), "viewport", true)).toBe("FRAME_SELECTED")
    expect(operatorForKey(key("Period", {}, "."), "outliner", true)).toBeNull()
  })
})

describe("formatKeys", () => {
  it("writes macOS symbols on macOS and words elsewhere", () => {
    expect(formatKeys("Shift+Mod+S", true)).toBe("⇧⌘S")
    expect(formatKeys("Shift+Mod+S", false)).toBe("Shift+Ctrl+S")
    expect(formatKeys("Ctrl+PageDown", true)).toBe("⌃PgDn")
    expect(formatKeys("Mod+Comma", false)).toBe("Ctrl+,")
  })
})

describe("the Console's names", () => {
  it("finds an operator by its id in any case, and nothing else", () => {
    expect(findOperator(" select_all ")).toBe("SELECT_ALL")
    expect(findOperator("toString")).toBeNull()
    expect(findOperator("")).toBeNull()
  })

  it("completes a prefix, and nothing once a space is typed", () => {
    expect(operatorCompletions("studio_s")).toEqual(["STUDIO_SAVE"])
    expect(operatorCompletions("SELECT_")).toEqual(["SELECT_ALL", "SELECT_NONE"])
    expect(operatorCompletions("SELECT ALL")).toEqual([])
    expect(operatorCompletions("")).toEqual([])
  })
})

describe("searchOperators", () => {
  it("lists everything for an empty query", () => {
    expect(searchOperators("  ")).toEqual(OPERATOR_IDS)
  })

  it("puts a label that starts with the query first", () => {
    expect(searchOperators("save")[0]).toBe("STUDIO_SAVE")
  })

  it("needs every word, in any field", () => {
    expect(searchOperators("hide planes")).toContain("HIDE_SELECTED")
    expect(searchOperators("hide xyzzy")).toEqual([])
  })
})
