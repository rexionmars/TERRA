/**
 * One feature of an opened file's layer, as the file has it, read off the main
 * thread.
 *
 * The map draws a layer cut into tiles, so the feature it reports under the
 * pointer is clipped to a tile and simplified to its zoom. Making an area of it,
 * or framing the map on it, needs the whole geometry; that is in the layer's
 * GeoJSON, which can run to a hundred megabytes, and parsing that on the main
 * thread stopped the screen for seconds. So it is fetched and indexed here, once
 * per layer, and only the feature asked for is sent back.
 *
 * A table without geometry is read the same way, and sent back a page of rows
 * at a time.
 */

type Ask =
  | { req: number; url: string; id: number }
  | { req: number; url: string; rows: { from: number; count: number } }
  | { drop: string }
type Answer =
  | { req: number; feature: unknown }
  | { req: number; rows: unknown[]; total: number }
  | { req: number; error: string }

const scope = self as unknown as {
  postMessage: (message: Answer) => void
  onmessage: ((e: MessageEvent<Ask>) => void) | null
}

/** A layer read: its features in the file's order, and by id. */
interface Read {
  list: { id?: unknown; properties?: unknown }[]
  byId: Map<unknown, unknown>
}

const layers = new Map<string, Promise<Read>>()

function layer(url: string): Promise<Read> {
  let read = layers.get(url)
  if (!read) {
    read = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`the layer answered ${res.status}`)
        return res.json() as Promise<{ features?: { id?: unknown }[] }>
      })
      .then((fc) => {
        const list = fc.features ?? []
        return { list, byId: new Map(list.map((f) => [f.id, f])) }
      })
    layers.set(url, read)
  }
  return read
}

scope.onmessage = (e) => {
  const ask = e.data
  if ("drop" in ask) {
    for (const url of [...layers.keys()]) {
      if (url.startsWith(ask.drop)) layers.delete(url)
    }
    return
  }
  layer(ask.url).then(
    (read) => {
      if ("rows" in ask) {
        /*
          A page of a table's rows, not the table: one of a quarter of a
          million rows would be copied to the page whole and laid out as as
          many lines.
        */
        const { from, count } = ask.rows
        scope.postMessage({
          req: ask.req,
          rows: read.list.slice(from, from + count).map((f) => f.properties ?? {}),
          total: read.list.length,
        })
        return
      }
      scope.postMessage({ req: ask.req, feature: read.byId.get(ask.id) ?? null })
    },
    (err: unknown) => {
      layers.delete(ask.url)
      scope.postMessage({
        req: ask.req,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  )
}
