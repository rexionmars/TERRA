/**
 * Which file each project was last saved to or opened from, the files opened
 * recently, and the one function that opens one.
 *
 * KEPT IN THE PREFERENCES, which are per account and in the database, rather
 * than in localStorage as Solara keeps its list: two people signed in on one
 * machine have two lists, and a backup carries them.
 *
 * The opener is registered by ProjectFileHost, which is where the account and
 * the active project are; the Studio menu and the start screen live inside the
 * board and reach it through here, as the keymap reaches the board's editor.
 */

/** As many as a menu can list without becoming the menu. */
export const MAX_RECENT_PROJECT_FILES = 10

/** A path with this one first and no duplicate of it, bounded. */
export function withRecent(list: readonly string[] | undefined, path: string): string[] {
  return [path, ...(list ?? []).filter((p) => p !== path)].slice(0, MAX_RECENT_PROJECT_FILES)
}

/** A list without this path, for a file that is no longer there. */
export function withoutRecent(list: readonly string[] | undefined, path: string): string[] {
  return (list ?? []).filter((p) => p !== path)
}

/** The name a reader knows the file by: no folder, no extension. */
export function projectFileName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.terra$/i, "")
}

let opener: ((path?: string) => Promise<void>) | null = null

/** Set by ProjectFileHost while it is mounted; returns the function that withdraws it. */
export function setProjectFileOpener(fn: (path?: string) => Promise<void>): () => void {
  opener = fn
  return () => {
    if (opener === fn) opener = null
  }
}

/** Open a project file: the one named, or one asked for with a dialog. */
export function openProjectFile(path?: string): void {
  void opener?.(path)
}
