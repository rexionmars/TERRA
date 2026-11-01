/**
 * Every command the application offers, named once, with the keys that run it.
 *
 * Blender calls these operators, and Solara -- the sibling application built on
 * this studio -- keeps them the same way. A command is written once and reached
 * every way: from its menu row, from its keys, and from the operator search
 * (F3). The menu row draws its shortcut from here rather than from a string
 * typed beside it, which is how "Clear selection" came to advertise an Esc that
 * nothing bound, and the keymap in Settings is this table, drawn.
 *
 * DEFINITIONS HERE, IMPLEMENTATIONS WHERE THE STATE IS. Solara's operators are
 * module functions over module stores. This application keeps its state in the
 * components that own it -- what a workflow is called lives in MapShell -- so an
 * operator's `run` is registered by that component with
 * `useOperators`, and withdrawn when it unmounts. The definition outlives it:
 * the search and the keymap list a command on every screen, and one whose
 * owner is not mounted says so instead of disappearing.
 *
 * An implementation's `poll` says whether it can run now, and if not, why.
 * Menus draw the row disabled with that reason as its tooltip, so an action
 * that cannot run is explained before it is tried rather than failing after.
 */
import { useEffect, useRef } from "react"
import {
  FileArrowDown,
  FloppyDisk,
  FolderOpen,
  FolderSimpleUser,
  Gear,
  House,
  HardDrive,
  ImageSquare,
  Info,
  Keyboard,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  Sparkle,
  Terminal,
  type Icon,
} from "@/components/icons"

import { notifyError, notifyInfo } from "@/lib/notify"
import { report } from "@/lib/reports"

export interface OperatorDef {
  label: string
  description: string
  /** Where its row lives, for the operator search: "Options". */
  menu: string
  icon?: Icon
  /**
   * Key combinations: "Mod+S" is Cmd on macOS and Ctrl elsewhere, "Ctrl" is
   * the Control key everywhere. Letters and punctuation match the physical
   * key, so Alt+A is A with Alt and not the character macOS types for it.
   */
  keys?: readonly string[]
  /** Whether its keys work while the focus is in a text field. */
  inFields?: boolean
}

const DEFS = {
  // ---- Studio: the application menu ----------------------------------------
  WORKFLOW_SAVE: {
    label: "Save workflow",
    description:
      "Save this workflow under its name, or ask for one, and the project file when the project has one",
    menu: "Options",
    icon: FloppyDisk,
    keys: ["Mod+S"],
    inFields: true,
  },
  WORKFLOW_RENAME: {
    label: "Save under another name\u2026",
    description: "Give the open workflow a new name",
    menu: "Options",
    icon: PencilSimple,
    keys: ["Shift+Mod+S"],
    inFields: true,
  },
  WORKFLOW_NEW: {
    label: "New workflow",
    description: "Clear the graph and the runs in hand, and start an empty workflow",
    menu: "Options",
    icon: Plus,
    keys: ["Mod+N"],
  },
  PROJECT_OPEN: {
    label: "Open project file\u2026",
    description: "Bring a .terra project file into this installation and open it",
    menu: "Options \u203a Project file",
    icon: FolderOpen,
    keys: ["Mod+O"],
    inFields: true,
  },
  PROJECT_SAVE: {
    label: "Save project file",
    description: "Write the open project to its .terra file",
    menu: "Options \u203a Project file",
    icon: FileArrowDown,
    keys: ["Alt+Mod+S"],
    inFields: true,
  },
  PROJECT_SAVE_AS: {
    label: "Save project file as\u2026",
    description: "Write the open project to a new .terra file",
    menu: "Options \u203a Project file",
    icon: FileArrowDown,
    keys: ["Shift+Alt+Mod+S"],
    inFields: true,
  },
  PROJECT_REVEAL: {
    label: "Reveal project file",
    description: "Show the open project's .terra file in the file manager",
    menu: "Options \u203a Project file",
    icon: FolderSimpleUser,
  },
  WORKFLOW_MANAGE: {
    label: "Manage workflows\u2026",
    description: "Rename or delete saved workflows",
    menu: "Options",
    icon: SlidersHorizontal,
  },
  SEARCH: {
    label: "Search operators\u2026",
    description: "Find any command by name and run it",
    menu: "Options",
    icon: MagnifyingGlass,
    keys: ["F3", "Mod+K"],
    inFields: true,
  },
  PREFERENCES: {
    label: "Settings\u2026",
    description: "Account, telemetry, keymap and the Python environment",
    menu: "Options",
    icon: Gear,
    keys: ["Mod+Comma"],
    inFields: true,
  },
  KEYMAP: {
    label: "Keymap",
    description: "Every command and the keys that run it",
    menu: "Options",
    icon: Keyboard,
  },
  START: {
    label: "Start screen",
    description: "What to begin and what to reopen, as the application opens with",
    menu: "Options",
    icon: House,
  },
  SPLASH: {
    label: "Splash screen",
    description: "Show the splash again",
    menu: "Options",
    icon: ImageSquare,
  },
  RELEASE_NOTES: {
    label: "What\u2019s new",
    description: "The notes for the release that is running",
    menu: "Options",
    icon: Sparkle,
  },
  ENVIRONMENT: {
    label: "Python environment\u2026",
    description: "The interpreter the analyses run in, and what is installed in it",
    menu: "Options",
    icon: Terminal,
  },
  STORAGE: {
    label: "Storage\u2026",
    description: "What the application keeps on disk, and what can be cleared",
    menu: "Options",
    icon: HardDrive,
  },
  ABOUT: {
    label: "About TERRA",
    description: "The version, the licence and where the source is",
    menu: "Options",
    icon: Info,
  },

  // ---- Areas ---------------------------------------------------------------

  // ---- The planes, in the viewport and the outliner ------------------------
} satisfies Record<string, OperatorDef>

export type OperatorId = keyof typeof DEFS

export const OPERATORS: Readonly<Record<OperatorId, OperatorDef>> = DEFS

/** In the order they are declared, which is the order the menus use. */
export const OPERATOR_IDS = Object.keys(DEFS) as OperatorId[]

// ---- Implementations --------------------------------------------------------

export interface OperatorImpl {
  run: () => void | Promise<void>
  /** true when it can run now; otherwise the reason it cannot. */
  poll?: () => true | string
}

/*
  A stack per operator rather than one slot, so that two owners mounted at once
  -- a screen leaving while the next arrives, which the screen transition does
  on purpose -- hand the command over instead of the leaving one deleting the
  arriving one's registration on its way out.
*/
const live = new Map<OperatorId, { impl: () => OperatorImpl | undefined }[]>()

const NOT_HERE = "Not available on this screen"

function current(id: OperatorId): OperatorImpl | undefined {
  const stack = live.get(id)
  return stack?.[stack.length - 1]?.impl()
}

/**
 * Register the implementations a component owns, for as long as it is mounted.
 *
 * Read through a ref, so `run` and `poll` see the component's state as of its
 * latest render rather than as of the render that registered them. The set of
 * ids is fixed per call site: an operator that cannot run says so from `poll`
 * rather than by being left out, since a row that vanishes explains nothing.
 */
export function useOperators(impls: Partial<Record<OperatorId, OperatorImpl>>): void {
  const ref = useRef(impls)
  ref.current = impls
  const ids = Object.keys(impls).sort().join(",")

  useEffect(() => {
    const added = (ids ? ids.split(",") : []).map((key) => {
      const id = key as OperatorId
      const entry = { impl: () => ref.current[id] }
      const stack = live.get(id) ?? []
      stack.push(entry)
      live.set(id, stack)
      return { id, entry }
    })
    return () => {
      for (const { id, entry } of added) {
        const stack = live.get(id)
        const i = stack?.indexOf(entry) ?? -1
        if (stack && i >= 0) stack.splice(i, 1)
      }
    }
  }, [ids])
}

/** true when the operator can run now; otherwise the reason it cannot. */
export function pollOperator(id: OperatorId): true | string {
  const impl = current(id)
  if (!impl) return NOT_HERE
  try {
    return impl.poll ? impl.poll() : true
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/**
 * Run an operator, or say why it cannot run.
 *
 * The refusal is a toast rather than silence because a key that does nothing
 * reads as a key that is not bound. An operator with no owner on this screen
 * is the exception: nothing here offered it, so there is nothing to explain.
 */
export function runOperator(id: OperatorId): boolean {
  const impl = current(id)
  if (!impl) return false
  const poll = pollOperator(id)
  const label = OPERATORS[id].label.replace(/\u2026$/, "")
  if (poll !== true) {
    notifyInfo(label, poll)
    return false
  }
  // What ran, for the Reports editor: a key leaves no other trace of itself.
  report("operator", label)
  try {
    void Promise.resolve(impl.run()).catch((e) => notifyError(label, e))
  } catch (e) {
    notifyError(label, e)
    return false
  }
  return true
}

// ---- Keys ---------------------------------------------------------------------

/*
  From the user agent rather than from Wails' Environment(), which answers
  asynchronously: a keystroke has to be matched when it arrives. WKWebView
  reports "Macintosh" there and WebView2 does not.
*/
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent)

const MAC_SYMBOLS: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" }
const KEY_NAMES: Record<string, string> = {
  Period: ".",
  Comma: ",",
  NumpadDecimal: "Numpad .",
  Space: "Space",
  PageDown: "PgDn",
  PageUp: "PgUp",
}

/** A key combination as the platform writes it: ⇧⌘S on macOS, Shift+Ctrl+S elsewhere. */
export function formatKeys(spec: string, mac = IS_MAC): string {
  const parts = spec.split("+")
  const key = parts.pop() ?? ""
  const name = KEY_NAMES[key] ?? key
  if (mac) return parts.map((m) => MAC_SYMBOLS[m] ?? m).join("") + name
  return [...parts.map((m) => (m === "Mod" ? "Ctrl" : m)), name].join("+")
}

/** The first key of an operator, written for this platform, for a menu row's note. */
export function shortcut(id: OperatorId): string | undefined {
  const first = OPERATORS[id].keys?.[0]
  return first ? formatKeys(first) : undefined
}

/** What the keymap reads from a keyboard event; a subset, so tests can build one. */
export type KeyEventLike = Pick<
  KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>

function keyOf(e: KeyEventLike): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  if (["Period", "Comma", "Space", "NumpadDecimal"].includes(e.code)) return e.code
  return e.key
}

export function keyMatches(spec: string, e: KeyEventLike, mac = IS_MAC): boolean {
  const parts = spec.split("+")
  const key = parts.pop()
  const mods = new Set(parts)
  const wantMeta = mac && mods.has("Mod")
  const wantCtrl = mods.has("Ctrl") || (!mac && mods.has("Mod"))
  return (
    keyOf(e) === key &&
    e.metaKey === wantMeta &&
    e.ctrlKey === wantCtrl &&
    e.altKey === mods.has("Alt") &&
    e.shiftKey === mods.has("Shift")
  )
}

/**
 * The operator a keystroke runs.
 *
 * An editor's own binding wins over a window binding for the same keys, so a
 * key can mean one thing over the viewport and another elsewhere.
 */
export function operatorForKey(e: KeyEventLike, mac = IS_MAC): OperatorId | null {
  return OPERATOR_IDS.find((id) => OPERATORS[id].keys?.some((k) => keyMatches(k, e, mac))) ?? null
}

/**
 * The window's keymap. Installed once, by OperatorHost.
 *
 * Keys are left alone while a dialog is open -- the dialog is what the reader
 * is answering, and Cmd-S under a confirmation would act on what it is asking
 * about -- and while the focus is in a field, unless the operator says it
 * works there. A key whose operator has no owner on this screen is not taken,
 * so it still reaches whatever else might want it.
 */
export function installKeymap(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.repeat || e.isComposing) return
    if (document.querySelector('[aria-modal="true"]')) return
    const id = operatorForKey(e)
    if (!id || !current(id)) return
    const target = e.target as HTMLElement | null
    const typing = !!target?.closest?.(
      "input, textarea, select, [contenteditable='true']"
    )
    if (typing && !OPERATORS[id].inFields) return
    e.preventDefault()
    runOperator(id)
  }
  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}

// ---- Search -------------------------------------------------------------------

/** Operators matching a search by label, menu, description or id; label matches first. */
export function searchOperators(query: string): OperatorId[] {
  const q = query.trim().toLowerCase()
  if (!q) return OPERATOR_IDS
  const words = q.split(/\s+/)
  const text = (id: OperatorId) => {
    const o = OPERATORS[id]
    return `${o.label} ${o.menu} ${o.description} ${id.replace(/_/g, " ")}`.toLowerCase()
  }
  const rank = (id: OperatorId) => {
    const label = OPERATORS[id].label.toLowerCase()
    return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2
  }
  return OPERATOR_IDS.filter((id) => words.every((w) => text(id).includes(w))).sort(
    (a, b) => rank(a) - rank(b)
  )
}

