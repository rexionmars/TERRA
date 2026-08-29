/**
 * The globe, on MapLibre.
 *
 * WHY NOT THE SPHERE THIS FILE USED TO BUILD. It built one by hand: a
 * three.js mesh, one stitched world image, Mercator texture coordinates and a
 * proximity test standing in for picking. That answered "how do I build a
 * globe" when the question was "what draws a globe from tiles", and the answer
 * to the second is a library. MapLibre projects the same XYZ tiles this
 * application already serves and zooms continuously into them, which is the
 * one thing the hand-built version could not do at any price short of a
 * quadtree.
 *
 * THE PROJECTION IS A STYLE PROPERTY, NOT A MAP OPTION. `MapOptions` carries no
 * `projection` field in 6.6.0 -- `new Map({ projection: "globe" })` does not
 * typecheck -- and setting it after construction needs a `style.load` handler,
 * because Style._load reassigns the stylesheet and discards anything set
 * before the style resolved. Declared inside the inline style it is in force on
 * the first frame, with no mercator flash to look at.
 *
 * `globe` is itself a transition: it expands to an interpolation that renders
 * a sphere below zoom 11 and mercator above 12. There is no handoff to write.
 */
import "maplibre-gl/dist/maplibre-gl.css"

import { useEffect, useRef, useState } from "react"
import { Globe2, TriangleAlert } from "lucide-react"
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type Subscription,
} from "maplibre-gl"
/*
  THE WORKER, POINTED AT EXPLICITLY. Without this the globe opens and never
  finishes -- and says nothing about why, which is how it cost an afternoon.

  MapLibre finds its worker as a sibling of its own module URL:

      new URL("./maplibre-gl-worker.mjs", import.meta.url)   web_worker.ts

  Under Vite that module is served from node_modules/.vite/deps, where the
  dependency optimiser put a rewritten copy of the library and nothing else --
  it never copies the worker, because no static import mentions it. The sibling
  URL therefore 404s, the Worker never starts, and NOTHING REPORTS IT: raster
  tiles are fetched on the main thread and load fine, so the map paints, while
  every GeoJSON source stays stuck in _isUpdatingWorker forever. Style.loaded()
  gates on every source, Map fires "load" only when Style.loaded() is true, and
  so "load" never arrives. Measured, not guessed: 33 imagery tiles all `loaded`
  beside one geojson source with `_sourceLoaded: undefined`.

  `?worker&url` makes Vite bundle the worker AND the ~490 kB sibling module it
  imports into one emitted file, and hand back its URL -- in dev and in the
  build. `?url` alone would emit the 18 kB worker without that sibling and fail
  the same way with a different 404.
*/
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"

setWorkerUrl(maplibreWorkerUrl)

import type { GlobeArea } from "@/components/globe/globeArea"
import { basemapByKind } from "@/lib/basemaps"
import { onPaletteChange } from "@/lib/paletteWatch"
import { cn } from "@/lib/utils"

const AREA_SOURCE = "terra-areas"
const AREA_FILL = "terra-areas-fill"
const AREA_LINE = "terra-areas-line"

/** A palette token's channels as a CSS colour MapLibre will parse. */
function token(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  const channels = raw.split(/\s+/).filter(Boolean)
  return channels.length === 3 ? `rgb(${channels.join(",")})` : fallback
}

/** The areas as one feature collection, which is what a GeoJSON source takes. */
function toFeatureCollection(areas: readonly GlobeArea[]) {
  return {
    type: "FeatureCollection" as const,
    features: areas.map((a) => ({
      type: "Feature" as const,
      // Carried in properties rather than as the feature id: a feature id has
      // to be a number or a string that MapLibre may reuse for state, and this
      // is only ever read back on a press.
      properties: { areaId: a.id, name: a.name },
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: a.parts.map((ring) => [ring]),
      },
    })),
  }
}

export function GlobeSurface({
  areas,
  onPickArea,
  onOpenMapHere,
  className,
}: {
  areas: readonly GlobeArea[]
  /** An area was pressed. Its id, as given in `areas`. */
  onPickArea: (id: string) => void
  /** The reader asked for the work map at the place they are looking at. */
  onOpenMapHere?: (at: { lon: number; lat: number }) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const pickAreaRef = useRef(onPickArea)
  pickAreaRef.current = onPickArea
  /** The most recent error event, which the watchdog reports if it matters. */
  const lastError = useRef<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const imagery = basemapByKind("eox")
    let map: MapLibreMap
    try {
      map = new MapLibreMap({
        container: host,
        /*
          No attribution control. It renders its links as anchors, and this is a
          WKWebView with no createWebViewWith delegate, so an anchor with
          target="_blank" is silently ignored -- the licence asks the credit to
          be REACHABLE and an anchor here is not. The application already
          discharges this the way it must, through BrowserOpenURL; the globe
          screen renders the same credit parts at its foot.

          Passing an options object here would also have dropped MapLibre's own
          link, since MapOptions.attributionControl is merged by shallow spread.
        */
        attributionControl: false,
        center: [-51.4, -23.4],
        zoom: 1.6,
        style: {
          version: 8,
          // The projection, in force on the first frame. See the file's note.
          projection: { type: "globe" },
          /*
            The atmosphere, which MapLibre draws only while it is rendering a
            globe and fades out on its own as the projection flattens. The hand
            written version needed a shader for this.
          */
          sky: {
            "sky-color": "#0b1021",
            "horizon-color": "#5b8fd6",
            "fog-color": "#9ec5f0",
            "atmosphere-blend": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              1,
              6,
              1,
              10,
              0,
            ],
          },
          sources: {
            imagery: {
              type: "raster",
              tiles: [imagery.url],
              /*
                256, not the 512 this defaults to. EOX serves 256px tiles, and
                the wrong figure does not fail -- it scales every tile by two
                and reports the world as half its resolution.
              */
              tileSize: 256,
              // The deepest level that exists. Past it MapLibre would ask for
              // tiles the server does not have; stopping here lets it magnify
              // the last real level instead, which is what a map does.
              maxzoom: imagery.maxNativeZoom ?? imagery.maxZoom,
            },
            [AREA_SOURCE]: {
              type: "geojson",
              data: toFeatureCollection(areas),
            },
          },
          layers: [
            /*
              A background layer is drawn per covering tile with the globe
              matrix applied, so this colours the PLANET where imagery has not
              arrived -- not the space around it. Space is CSS on the container,
              since the GL context clears to transparent.
            */
            {
              id: "planet",
              type: "background",
              paint: { "background-color": "#0b1d2e" },
            },
            { id: "imagery", type: "raster", source: "imagery" },
            /*
              A fill under the line, and it is what makes a press work. The hand
              written globe raycast the outline and had to fall back on nearest
              centre within a tolerance, because a line has no area to strike.
              A fill has area, so the press lands on the shape a reader aimed at.
            */
            {
              id: AREA_FILL,
              type: "fill",
              source: AREA_SOURCE,
              paint: { "fill-color": "#ED8744", "fill-opacity": 0.14 },
            },
            {
              id: AREA_LINE,
              type: "line",
              source: AREA_SOURCE,
              paint: { "line-color": "#ED8744", "line-width": 1.5 },
            },
          ],
        },
      })
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
      return
    }
    mapRef.current = map

    /*
      Every subscription is kept and unsubscribed. In 5 and later `map.on`
      returns a Subscription rather than the map, so the handlers are not
      removable by reference and letting them go would hold the map, its GL
      context and everything this closure reaches for the life of the page.
    */
    const subs: Subscription[] = []

    const paint = () => {
      if (!map.isStyleLoaded()) return
      const accent = token("--p-accent", "#ED8744")
      map.setPaintProperty(AREA_FILL, "fill-color", accent)
      map.setPaintProperty(AREA_LINE, "line-color", accent)
    }

    /*
      A DEADLINE ON OPENING, because the failure this file was written through
      had no other symptom: the map was constructed, painted, reported no
      error a reader could see, and simply never finished. An indefinite
      placeholder is indistinguishable from a slow link, so after this it says
      so and hands over whatever the last error was.

      Generous, because the alternative failure -- a real map over a real bad
      connection -- must not be called broken. The map is not torn down and
      keeps trying; if "load" does arrive afterwards it clears this.
    */
    const watchdog = window.setTimeout(() => {
      setFailure(
        lastError.current ??
          "The map was created but never finished loading its sources."
      )
    }, 20000)

    subs.push(
      map.on("load", () => {
        // Before anything else: the deadline has been met, and a globe that
        // opened must never be told twenty seconds later that it did not.
        window.clearTimeout(watchdog)
        paint()
        setFailure(null)
        setReady(true)
      })
    )

    /*
      KEPT, NOT DISCARDED. This handler used to be `void e`, on the reasoning
      that an error here could only be a tile failing over a poor link. That
      reasoning was wrong twice over: a failed WebGL context arrives here as
      an event rather than a throw (Map._setupPainter fires an ErrorEvent and
      returns, leaving no painter), and so does anything the style's sources
      report. Discarding them turned every one of those into the same blank
      wait.

      Still not fatal on arrival, because a tile that fails genuinely is not a
      failed map -- MapLibre reports each one and keeps drawing the rest. So
      the last one is held, and only the watchdog below decides it mattered.
    */
    subs.push(
      map.on("error", (e) => {
        const message = e.error?.message ?? String(e.error ?? "unknown error")
        lastError.current = message
        // Kept on the console too: a reader reports what the panel says, and
        // a developer needs the stack behind it.
        console.error("[globe]", e.error ?? message)
      })
    )
    subs.push(
      map.on("click", AREA_FILL, (e: MapMouseEvent & { features?: unknown[] }) => {
        const f = e.features?.[0] as
          | { properties?: Record<string, unknown> }
          | undefined
        const id = f?.properties?.areaId
        if (typeof id === "string") pickAreaRef.current(id)
      })
    )
    subs.push(
      map.on("mouseenter", AREA_FILL, () => {
        map.getCanvas().style.cursor = "pointer"
      })
    )
    subs.push(
      map.on("mouseleave", AREA_FILL, () => {
        map.getCanvas().style.cursor = ""
      })
    )

    const stopPaletteWatch = onPaletteChange(paint)

    return () => {
      window.clearTimeout(watchdog)
      stopPaletteWatch()
      for (const s of subs) s.unsubscribe()
      map.remove()
      mapRef.current = null
    }
    // Once per mount. Areas arrive through the effect below and the callback
    // through a ref, so nothing here should rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // Generic with no default parameter in this version: `getSource(id)` alone
    // does not carry setData and fails to compile.
    const src = map.getSource<GeoJSONSource>(AREA_SOURCE)
    void src?.setData(toFeatureCollection(areas))
  }, [areas, ready])

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      {/*
        Space is painted here. MapLibre forces an alpha context and clears each
        frame to transparent, and its own stylesheet sets no background, so the
        colour behind the planet is whatever CSS puts on this element.

        SIZED BY h-full, NOT BY `absolute inset-0`, AND THE DIFFERENCE IS NOT
        STYLISTIC. MapLibre puts `.maplibregl-map` on this element and its own
        stylesheet declares:

            .maplibregl-map { position: relative; overflow: hidden; }

        That is one class selector, exactly the specificity of Tailwind's
        `.absolute`, so the tie breaks on source order -- and the library's
        sheet is imported by this module, which lands after the app's. The
        element therefore computes to `position: relative`, `inset-0` stops
        stretching anything, and the div collapses to 1184x0 while the map
        loads, reports no error and paints a canvas nothing can see.

        Filling by height instead leaves the library's `position: relative`
        harmless, because nothing here depends on which one it is.
      */}
      <div
        ref={hostRef}
        className="h-full w-full"
        style={{ background: "rgb(var(--p-ink))" }}
      />
      {onOpenMapHere && ready && !failure && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
          {/*
            NOT ABOUT DETAIL ANY MORE. The old button said this was as close as
            the imagery went, which was true of a single stitched world image
            and is not true here: the globe zooms into the same tiles the map
            does. What the work map still has that this does not is the tools --
            drawing an area, the overlays, the comparison -- so that is what it
            offers now.
          */}
          <button
            type="button"
            onClick={() => {
              const c = mapRef.current?.getCenter()
              if (c) onOpenMapHere({ lon: c.lng, lat: c.lat })
            }}
            className="panel pointer-events-auto rounded-sm px-2.5 py-1.5 text-body text-foreground shadow-lg transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Open the work map here
          </button>
        </div>
      )}
      {(!ready || failure) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          {failure ? (
            <>
              <TriangleAlert
                className="size-5 text-destructive-quiet"
                strokeWidth={1.5}
              />
              <p className="max-w-[22rem] text-body text-muted-foreground">
                {ready
                  ? "The globe reported an error."
                  : "The globe did not finish opening."}
              </p>
              <p className="telemetry max-w-[22rem] break-words text-meta text-muted-foreground">
                {failure}
              </p>
            </>
          ) : (
            <>
              <Globe2
                className="size-5 animate-pulse text-muted-foreground"
                strokeWidth={1.5}
              />
              <p className="text-body text-muted-foreground">Opening the globe</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
