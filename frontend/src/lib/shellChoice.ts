/**
 * Which interface is up: the map shell, or the studio it is replacing.
 *
 * TEMPORARY, AND IT SHOULD BE DELETED WITH THE STUDIO. The map shell does not yet
 * hold everything the studio does -- comparison across areas and the compositor
 * are still reached there -- so the two stand side by side until it does, and a
 * switch nobody can reach would strand that work behind a release.
 *
 * Held outside React, as lib/panelSelection.ts is and for the reason it gives:
 * App's subtree is every screen the application has, and only the two components
 * that read this need to hear about it. Local storage rather than preferences,
 * because this is a setting of the migration and not of the reader.
 */
export type Shell = "map" | "studio"

const KEY = "terra.shell"

function stored(): Shell {
  try {
    return localStorage.getItem(KEY) === "studio" ? "studio" : "map"
  } catch {
    // A webview that refuses storage still has to open on something.
    return "map"
  }
}

let current: Shell = stored()
const listeners = new Set<() => void>()

export function shellChoice(): Shell {
  return current
}

export function chooseShell(next: Shell): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Held for this session only, which is what the reader asked for anyway.
  }
  for (const fn of listeners) fn()
}

export function subscribeShellChoice(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}
