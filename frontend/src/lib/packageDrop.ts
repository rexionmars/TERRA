/**
 * What a drop on the import dialog hands to the shell: one package, as its zip
 * or its folder.
 *
 * The shell's import takes either (internal/models Import) and says why it
 * refuses one, so a path is not judged here by its name: a folder has no
 * extension to judge. Only the count is, since an import installs one package
 * and several dropped at once would leave the reader not knowing which went in.
 */
export type PackageDrop = { path: string } | { refusal: string }

export function droppedPackage(paths: readonly string[]): PackageDrop | null {
  const given = paths.map((p) => p.trim()).filter(Boolean)
  if (!given.length) return null
  if (given.length > 1) {
    return {
      refusal: `${given.length} files were dropped. Drop one package at a time.`,
    }
  }
  return { path: given[0] }
}
