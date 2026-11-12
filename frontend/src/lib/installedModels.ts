/**
 * The model packages installed on this machine, as the shell lists them.
 *
 * A small store rather than state in a component, because a model's name and
 * what it can do are read in many places that are plain functions -- a run's
 * label in Analyses and Compare, the method brief, which modes a model takes --
 * and they run long after the list was fetched. It is fetched once at start
 * and again after an install or a removal.
 *
 * NOTHING HERE KNOWS A MODEL BY NAME, except the three that ran before models
 * were packages: their ids are what older saved runs recorded, and those runs
 * still need a name when the package is not installed.
 */
import { useSyncExternalStore } from "react"

import { ListModels } from "../../wailsjs/go/main/App"
import type { ModelInfo } from "@/lib/types"

interface Snapshot {
  models: readonly ModelInfo[]
  /** Whether the list has been read at least once. */
  loaded: boolean
}

let snapshot: Snapshot = { models: [], loaded: false }
const listeners = new Set<() => void>()

function publish(next: Snapshot) {
  snapshot = next
  for (const l of listeners) l()
}

/**
 * Read the installed packages again, after an install or a removal.
 *
 * A failed read leaves the list as it was and NOT loaded: the store may not be
 * open yet, and an empty list marked as read would tell the form that nothing
 * is installed, which nobody has established.
 */
export async function refreshModels(): Promise<readonly ModelInfo[]> {
  try {
    const models = ((await ListModels()) ?? []) as unknown as readonly ModelInfo[]
    publish({ models, loaded: true })
    return models
  } catch {
    return snapshot.models
  }
}

/** For tests and previews: replace the list without asking the shell. */
export function setInstalledModels(models: readonly ModelInfo[]): void {
  publish({ models, loaded: true })
}

export function useInstalledModels(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot
  )
}

/** Whether the list has been read, so an empty one means none rather than not yet. */
export function modelsLoaded(): boolean {
  return snapshot.loaded
}

/** The newest installed version of a model, if any is installed. */
export function installedModel(id: string): ModelInfo | undefined {
  return snapshot.models.find((m) => m.manifest.id === id)
}

const EARLIER: Record<string, string> = {
  spectral: "Random Forest",
  temporal_transformer: "Temporal Transformer",
  prithvi: "Prithvi-EO 2.0",
}

/** A model's name: its package's, else the name an older run's id stood for, else the id. */
export function modelName(id: string): string {
  return installedModel(id)?.manifest.name ?? EARLIER[id] ?? id
}

/**
 * Whether the model runs in this classify mode. Cumulative retention reruns a
 * model over a growing stack, which only a package that lists "temporal" can;
 * a model that is not installed is taken to run the single mode alone.
 */
export function modelTakesMode(id: string, mode: string): boolean {
  const modes = installedModel(id)?.manifest.modes
  return modes?.length ? modes.includes(mode) : mode === "single"
}

/** A file's size in SI units, to one decimal past a thousand bytes. */
export function fileSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
