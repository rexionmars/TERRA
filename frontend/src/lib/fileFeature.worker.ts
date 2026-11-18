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
 */

type Ask = { req: number; url: string; id: number } | { drop: string }
type Answer = { req: number; feature: unknown } | { req: number; error: string }

const scope = self as unknown as {
  postMessage: (message: Answer) => void
  onmessage: ((e: MessageEvent<Ask>) => void) | null
}

const layers = new Map<string, Promise<Map<unknown, unknown>>>()

function layer(url: string): Promise<Map<unknown, unknown>> {
  let byId = layers.get(url)
  if (!byId) {
    byId = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`the layer answered ${res.status}`)
        return res.json() as Promise<{ features?: { id?: unknown }[] }>
      })
      .then((fc) => new Map((fc.features ?? []).map((f) => [f.id, f])))
    layers.set(url, byId)
  }
  return byId
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
    (byId) => scope.postMessage({ req: ask.req, feature: byId.get(ask.id) ?? null }),
    (err: unknown) => {
      layers.delete(ask.url)
      scope.postMessage({
        req: ask.req,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  )
}
