/**
 * Asks fileFeature.worker.ts for one whole feature of an opened file's layer,
 * or for a page of the rows of a table without geometry.
 *
 * One worker for the session, made on the first ask, so a session that opens
 * no file starts none.
 */
import FeatureWorker from "./fileFeature.worker?worker"

let worker: Worker | null = null
let next = 0
type Reply = {
  req: number
  feature?: unknown
  rows?: unknown[]
  total?: number
  error?: string
}
const waiting = new Map<
  number,
  { resolve: (r: Reply) => void; reject: (e: Error) => void }
>()

function started(): Worker {
  if (worker) return worker
  worker = new FeatureWorker()
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const w = waiting.get(e.data.req)
    if (!w) return
    waiting.delete(e.data.req)
    if (e.data.error !== undefined) w.reject(new Error(e.data.error))
    else w.resolve(e.data)
  }
  return worker
}

function ask(message: Record<string, unknown>): Promise<Reply> {
  const w = started()
  const req = ++next
  return new Promise((resolve, reject) => {
    waiting.set(req, { resolve, reject })
    w.postMessage({ req, ...message })
  })
}

/** The feature `id` of the layer at `url`, whole, or null when the layer has none. */
export function fileFeature(url: string, id: number): Promise<GeoJSON.Feature | null> {
  return ask({ url, id }).then((r) => (r.feature ?? null) as GeoJSON.Feature | null)
}

/** Rows `from` to `from + count` of the table at `url`, as column to value, and how many it has. */
export function fileRows(
  url: string,
  from: number,
  count: number
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  return ask({ url, rows: { from, count } }).then((r) => ({
    rows: (r.rows ?? []) as Record<string, unknown>[],
    total: r.total ?? 0,
  }))
}

/** Lets go of every layer whose URL starts with `prefix`, when its file is closed. */
export function dropFileFeatures(prefix: string): void {
  worker?.postMessage({ drop: prefix })
}
