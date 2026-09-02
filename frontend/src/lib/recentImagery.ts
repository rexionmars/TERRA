/**
 * The most recent Sentinel-2 the Planetary Computer can draw, as tiles.
 *
 * WHY A SECOND SATELLITE BASEMAP EXISTS. Esri's World Imagery is a mosaic
 * whose resolution and date vary together, footprint by footprint: over Sao
 * Paulo it reads to z20 on a 2025 acquisition, over Teresina to z18 on a 2024
 * one, over Jose de Freitas it stops at z17 on a 2026 one. Where the local
 * footprint is old there is nothing to turn to, because a mosaic has no second
 * opinion. This is the second opinion: 10 m, everywhere, from whatever the
 * satellite last saw through a gap in the clouds.
 *
 * It does not replace the Esri layer and is not meant to. Measured against it
 * over Curitiba, 12 tiles at z14 through six connections: Esri 418 ms, this
 * 7563 ms on a first visit and 497 ms once the CDN holds them. At z16 the
 * difference stops being speed and becomes subject -- Esri resolves roofs,
 * this resolves blocks. What it buys is time: the newest cloud-free scene over
 * Curitiba is a month old, against an Esri footprint there from April 2024.
 *
 * THE SAME CATALOGUE THE ANALYSES READ. sidecar/terra/stac.py opens this API
 * for every Sentinel-2 path in the application, so the ground a run was
 * computed over and the ground the map draws come from one archive.
 */

/**
 * The search the mosaic renders: every Sentinel-2 L2A scene under 10% cloud,
 * newest first per pixel, with no date bound. A window would have to be moved
 * as it aged; "the most recent that is clear" does not.
 */
const MOSAIC_SEARCH = {
  collections: ["sentinel-2-l2a"],
  "filter-lang": "cql2-json",
  filter: { op: "<=", args: [{ property: "eo:cloud_cover" }, 10] },
}

/**
 * The registered id of that search.
 *
 * A HASH OF THE SEARCH, NOT A HANDLE. Registering the body above returns the
 * same id every time, so it can be written down here rather than fetched
 * before the first tile can be drawn. What registering does is make sure the
 * server still holds the entry, which is why `ensureMosaic` runs anyway -- once
 * per session, after the tiles are already loading, so a slow or failed call
 * costs the map nothing.
 */
const MOSAIC_ID = "832da05b42678505676241b4bc269dda"

const DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1"
const STAC_API = "https://planetarycomputer.microsoft.com/api/stac/v1"

/**
 * Natural colour, in the service's own words.
 *
 * Copied from the collection's published render options rather than invented:
 * the same three bands and the same curve the Planetary Computer's own viewer
 * uses, so what the map draws is what its documentation shows.
 */
const RENDER = [
  "collection=sentinel-2-l2a",
  "assets=B04",
  "assets=B03",
  "assets=B02",
  "nodata=0",
  "color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35",
].join("&")

export const MOSAIC_TILES = `${DATA_API}/mosaic/tiles/${MOSAIC_ID}/{z}/{x}/{y}@1x?${RENDER}`

/**
 * The shallowest level the service will mosaic.
 *
 * A LEVEL, NOT A ZOOM -- the service's own figure, published beside the render
 * options and confirmed against it: level 9 answers 200, level 8 answers 204.
 * A 204 is a blank tile rather than an error, which looks like a network fault
 * from the outside, so the surfaces draw the wide basemap below the zoom that
 * fetches this. See lib/mapScale.ts for the conversion.
 */
export const MOSAIC_MIN_LEVEL = 9

let registered: Promise<void> | null = null

/** Ask the service to hold the search, once per session. */
export function ensureMosaic(): Promise<void> {
  if (!registered) {
    registered = fetch(`${DATA_API}/mosaic/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(MOSAIC_SEARCH),
    }).then(
      () => undefined,
      // Nothing to report and nothing to do: the id is pinned, so a failed
      // registration means either the entry was already there or the network
      // is down, and both are visible in the tiles themselves.
      () => undefined
    )
  }
  return registered
}

/**
 * When the newest clear scene over this point was acquired.
 *
 * A GET, WHERE THE CATALOGUE'S SEARCH IS USUALLY WRITTEN AS A POST. Both work
 * from the webview -- a POST carrying JSON was measured answering 200 through
 * its preflight, so this is not a workaround for anything. It is one round
 * trip instead of two for a question asked on every moveend, and it takes a
 * small box around the point rather than a geometry, which is the same
 * question at a scale where the box is a kilometre across.
 *
 * An approximation, and knowingly: the mosaic composes per pixel and may take
 * an older scene where the newest has no data at that exact spot. It is the
 * same approximation the Esri readout makes by asking about the centre, and it
 * answers the question a reader is actually asking -- how old is this.
 */
export async function fetchLatestSceneDate(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<string | null> {
  // A hundredth of a degree, about a kilometre: wide enough that a point on a
  // scene edge still finds the scene, narrow enough that the answer is about
  // where the reader is looking.
  const pad = 0.01
  const params = new URLSearchParams({
    collections: "sentinel-2-l2a",
    bbox: `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`,
    query: JSON.stringify({ "eo:cloud_cover": { lt: 10 } }),
    sortby: "-properties.datetime",
    limit: "1",
  })
  const res = await fetch(`${STAC_API}/search?${params}`, { signal })
  if (!res.ok) return null
  const data = (await res.json()) as {
    features?: Array<{ properties?: { datetime?: string } }>
  }
  const iso = data.features?.[0]?.properties?.datetime
  return iso ? iso.slice(0, 10) : null
}
