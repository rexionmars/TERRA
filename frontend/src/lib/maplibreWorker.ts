/**
 * Points MapLibre at its own web worker. Import once, before any map is built.
 *
 * WITHOUT THIS A MAP OPENS AND NEVER FINISHES, AND SAYS NOTHING ABOUT WHY.
 * MapLibre locates its worker as a sibling of its own module URL:
 *
 *     new URL("./maplibre-gl-worker.mjs", import.meta.url)   web_worker.ts
 *
 * Under Vite that module is served from node_modules/.vite/deps, where the
 * dependency optimiser put a rewritten copy of the library and nothing else --
 * it never copies the worker, because no static import names it -- so the
 * sibling URL 404s. In a packaged build the document is served over wails://,
 * which fails that function's `^https?:` test and yields the empty string, so
 * `new Worker("")` loads the document itself. Neither path throws.
 *
 * Neither reports, either. Raster tiles are fetched on the main thread and load
 * fine, so the map paints; every GeoJSON source stays in _isUpdatingWorker
 * forever; Style.loaded() gates on all sources and Map fires "load" only when
 * it is true. The observed shape of it: 33 imagery tiles all `loaded` beside
 * one geojson source with `_sourceLoaded: undefined`, indefinitely.
 *
 * `?worker&url` makes Vite bundle the worker together with the ~490 kB sibling
 * module it imports and hand back a URL that resolves in dev and in the build.
 * `?url` alone would emit the 18 kB worker without that sibling and fail the
 * same way with a different 404.
 *
 * HERE RATHER THAN IN EACH SURFACE. Two of them build maps now, and a global
 * set twice is a global that can be set two ways.
 */
import { setWorkerUrl } from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"

setWorkerUrl(maplibreWorkerUrl)
