/**
 * The published catalogue of models, and the downloads started from it.
 *
 * Read when the Models screen first opens, and again when the reader asks: it
 * is a request to GitHub, and only that screen needs it. The shell keeps the
 * catalogue it last read, and an install names an entry of it by id and
 * version, never by address (internal/models/catalog.go).
 *
 * A store rather than state in the screen, so a download keeps running, and
 * keeps its progress, while the reader goes back to the map.
 */
import { useSyncExternalStore } from "react"

import {
  CancelModelDownload,
  InstallCatalogModel,
  ModelCatalog as ReadModelCatalog,
} from "../../wailsjs/go/main/App"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import { refreshModels } from "@/lib/installedModels"
import type { CatalogEntry, ModelCatalog, ModelDownload, ModelInfo } from "@/lib/types"

interface Snapshot {
  catalog: ModelCatalog | null
  reading: boolean
  /** Why no catalogue could be read, not even the copy this build carries. */
  error: string | null
  /** The downloads under way, by model id. */
  downloads: Readonly<Record<string, ModelDownload>>
}

let snapshot: Snapshot = { catalog: null, reading: false, error: null, downloads: {} }
const listeners = new Set<() => void>()

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  for (const l of listeners) l()
}

export function useModelCatalog(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot
  )
}

/** Read the catalogue again; a read already under way is not doubled. */
export async function readModelCatalog(): Promise<void> {
  if (snapshot.reading) return
  publish({ reading: true })
  try {
    const catalog = (await ReadModelCatalog()) as unknown as ModelCatalog
    publish({ catalog, reading: false, error: null })
  } catch (e) {
    publish({ reading: false, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Read the catalogue unless it has been read already. */
export function ensureModelCatalog(): void {
  if (!snapshot.catalog && !snapshot.reading) void readModelCatalog()
}

/** For tests and previews: replace the catalogue without asking the shell. */
export function setModelCatalog(catalog: ModelCatalog | null): void {
  publish({ catalog, reading: false, error: null })
}

/** For tests and previews: show a download as under way. */
export function setDownloads(downloads: Record<string, ModelDownload>): void {
  publish({ downloads })
}

let listening = false

// The shell reports a download's progress as an event. Listened to from the
// first download on, for the whole session: a download outlives the screen.
function listen() {
  if (listening) return
  listening = true
  EventsOn("models:download", (d: ModelDownload) => {
    if (!snapshot.downloads[d.id]) return
    publish({ downloads: { ...snapshot.downloads, [d.id]: d } })
  })
}

function settle(id: string) {
  const { [id]: _done, ...rest } = snapshot.downloads
  publish({ downloads: rest })
}

/**
 * Download one entry and install it. Resolves with the installed package, and
 * rejects with the shell's reason when it could not be installed or was
 * cancelled; nothing is installed then.
 */
export async function downloadModel(entry: CatalogEntry): Promise<ModelInfo> {
  const { id, version } = entry.manifest
  listen()
  publish({
    downloads: {
      ...snapshot.downloads,
      [id]: {
        id,
        version,
        source: entry.sources[0]?.name ?? "",
        received: 0,
        total: entry.package.size,
      },
    },
  })
  try {
    const info = (await InstallCatalogModel(id, version)) as unknown as ModelInfo
    await refreshModels()
    return info
  } finally {
    settle(id)
  }
}

export function cancelDownload(id: string): void {
  void CancelModelDownload(id)
}

/** The newest version of a model the catalogue lists, if it lists one. */
export function catalogEntry(
  catalog: ModelCatalog | null,
  id: string
): CatalogEntry | undefined {
  return (catalog?.models ?? [])
    .filter((e) => e.manifest.id === id)
    .sort((a, b) => compareVersions(b.manifest.version, a.manifest.version))[0]
}

/**
 * Order dotted versions part by part, numerically where both parts are
 * numbers and as text otherwise, so 1.10 is newer than 1.9. The same order
 * internal/models gives installed versions.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".")
  const pb = b.split(".")
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ""
    const y = pb[i] ?? ""
    const nx = /^\d+$/.test(x) ? Number(x) : NaN
    const ny = /^\d+$/.test(y) ? Number(y) : NaN
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}
