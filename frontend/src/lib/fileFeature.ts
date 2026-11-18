/**
 * Asks fileFeature.worker.ts for one whole feature of an opened file's layer.
 *
 * One worker for the session, made on the first ask, so a session that opens
 * no file starts none.
 */
import FeatureWorker from "./fileFeature.worker?worker"

let worker: Worker | null = null
let next = 0
const waiting = new Map<
  number,
  { resolve: (f: GeoJSON.Feature | null) => void; reject: (e: Error) => void }
>()

function started(): Worker {
  if (worker) return worker
  worker = new FeatureWorker()
  worker.onmessage = (
    e: MessageEvent<{ req: number; feature?: GeoJSON.Feature | null; error?: string }>
  ) => {
    const w = waiting.get(e.data.req)
    if (!w) return
    waiting.delete(e.data.req)
    if (e.data.error !== undefined) w.reject(new Error(e.data.error))
    else w.resolve(e.data.feature ?? null)
  }
  return worker
}

/** The feature `id` of the layer at `url`, whole, or null when the layer has none. */
export function fileFeature(url: string, id: number): Promise<GeoJSON.Feature | null> {
  const w = started()
  const req = ++next
  return new Promise((resolve, reject) => {
    waiting.set(req, { resolve, reject })
    w.postMessage({ req, url, id })
  })
}

/** Lets go of every layer whose URL starts with `prefix`, when its file is closed. */
export function dropFileFeatures(prefix: string): void {
  worker?.postMessage({ drop: prefix })
}
