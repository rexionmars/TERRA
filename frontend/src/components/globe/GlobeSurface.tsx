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
import {
  Globe2,
  Mountain,
  Pencil,
  Search,
  Spline,
  TriangleAlert,
  Trash2,
} from "lucide-react"
import {
  Map as MapLibreMap,
  type GeoJSONSource,
  type MapMouseEvent,
  type Subscription,
} from "maplibre-gl"
// Points MapLibre at its worker; see the module for why that is not automatic.
import "@/lib/maplibreWorker"

import type { GlobeArea } from "@/components/globe/globeArea"
import { MapBar, MapButton } from "@/components/map/MapChrome"
import { syncOverlays } from "@/components/map/mapOverlays"
import { isZeroExtent, type RasterLayer } from "@/lib/mapLayers"
import {
  ELEVATION_CREDIT,
  addTerrainSources,
  setTerrainEnabled,
} from "@/components/map/terrain"
import { Credit } from "@/components/TitleBar"
import { SearchBar } from "@/components/SearchBar"
import { useAreaDrawing } from "@/components/map/useAreaDrawing"
import type { GeoJSONGeometry } from "@/lib/types"
import {
  CameraControls,
  useCameraNavigation,
} from "@/components/map/cameraNavigation"
import { SpaceBackdrop } from "@/components/map/SpaceBackdrop"
import {
  MAPLIBRE_CREDIT,
  basemapByKind,
  type BasemapKind,
} from "@/lib/basemaps"
import { onPaletteChange } from "@/lib/paletteWatch"
import { cn } from "@/lib/utils"

/**
 * The imagery the globe draws, named once so the surface and the credit
 * beneath it cannot disagree about which one it is.
 *
 * ESRI, WHICH IS WHAT THE MAP ALREADY OPENS ON. This was s2cloudless, and the
 * choice cost twice over. Measured against the same six tiles, z8 through z13:
 * EOX answers in 801 ms on average, Esri in 142 ms. And s2cloudless is a 10 m
 * product, so its imagery stops at z14 -- past that a reader turns the wheel
 * and the picture does not sharpen, because there is nothing further to fetch.
 * Esri carries five more levels.
 *
 * s2cloudless is not worse; it is a different thing. It is one cloud-free
 * Sentinel-2 mosaic of a stated year, which is what makes it the right ground
 * for reading a classification against on the map screen, where it is offered.
 * This screen is for finding where the work is, and for that the faster and
 * deeper basemap is the one that answers.
 */
export const GLOBE_BASEMAP: BasemapKind = "esri"

/*
  THE SHAPE BEING DRAWN GETS ITS OWN SOURCE, not a feature in the catalog's.

  The catalog is what exists: areas and projects that have been saved, drawn in
  the accent, pressable to open. A shape under the pointer is none of those --
  it is not saved, pressing it must not activate anything, and it has to be
  told apart from the ring it may be about to replace. Sharing a source would
  also put it under the AREA_FILL click handler, so finishing a polygon would
  land on it as a press.

  White rather than the accent, which is what DrawMap already draws with: the
  colour says "in hand" against a field where saved is orange.
*/
const SHAPE_SOURCE = "draw-shape"
const SHAPE_FILL = "draw-shape-fill"
const SHAPE_LINE = "draw-shape-line"

/*
  Where the camera opens when nothing says otherwise: the whole planet, with
  Brazil facing the reader.

  A FALLBACK, NOT THE OPENING. It was the opening: the globe was built with
  these two hard-coded, so it came back to the same point over Brazil every
  time however far the reader had travelled on it, while the work map beside it
  restored where it was left. `initialView` is what the session remembers, and
  these are what a session with no memory gets.
*/
const START_ZOOM = 1.6
const START_CENTER: [number, number] = [-51.4, -23.4]

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

/**
 * The deepest level this imagery actually has. Past it MapLibre magnifies the
 * last real one, which looks identical to a slow network from the outside.
 */
const NATIVE_MAX = (() => {
  const b = basemapByKind(GLOBE_BASEMAP)
  return b.maxNativeZoom ?? b.maxZoom
})()

export function GlobeSurface({
  areas,
  onPickArea,
  polygon = null,
  onPolygonDrawn,
  initialView = null,
  onViewChange,
  overlays = [],
  className,
}: {
  areas: readonly GlobeArea[]
  /** An area was pressed. Its id, as given in `areas`. */
  onPickArea: (id: string) => void
  /**
   * The area in hand, which the drawing store is kept equal to.
   *
   * Read whether or not this surface can draw: a shape set from a search, an
   * import or the outliner is still the shape the reader is working on, and a
   * globe that showed the saved catalog but not the current area would be
   * missing the one outline they are here about.
   */
  polygon?: GeoJSONGeometry | null
  /**
   * A shape was drawn, edited or removed. ABSENT MEANS THIS GLOBE CANNOT DRAW,
   * and the tools are withheld rather than shown refusing.
   */
  onPolygonDrawn?: (geom: GeoJSONGeometry | null) => void
  /**
   * Where to open, when the session remembers.
   *
   * Read once, at mount, as the work map reads its own: a prop that moved the
   * camera on every change would fight the reader's hand.
   */
  initialView?: { lat: number; lon: number; zoom: number } | null
  /**
   * Where the reader moved it to.
   *
   * The SAME memory the work map writes, deliberately. Two would mean a pan
   * made here was lost on the way back to the map, or the reverse, depending
   * on which committed last -- which is the argument that put both map screens
   * on one already.
   */
  onViewChange?: (v: { lat: number; lon: number; zoom: number }) => void
  /**
   * Rasters from the viewport, drawn here over the ground each measures.
   *
   * The viewport lifts rasters off their coordinates so grounds far apart can
   * be read side by side; this is the way back. Under the area outlines, which
   * stay legible over them, and above the imagery they are measurements of.
   *
   * Each carries the key it is held by, because a layer id alone does not
   * identify one: two runs over two fields both call their raster
   * `solar:terrain`, and keying on that would let the second replace the
   * first while claiming to be a second overlay.
   */
  overlays?: readonly { key: string; layer: RasterLayer }[]
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const viewChangeRef = useRef(onViewChange)
  viewChangeRef.current = onViewChange
  const [failure, setFailure] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  /*
    RELIEF, OFF BY DEFAULT, for the reason terrain.ts states: a DEM tile per
    view and a mesh per tile, in an application with a written history of
    paying for graphics it did not ask for.

    It earns more here than on the work map. A sphere already shows the shape
    of a coastline and the curve of the limb; what it cannot show flat is why
    a valley is where it is, and lifting the ground at exaggeration 1 is what
    turns a picture of a place into the ground the areas are drawn on.
  */
  const [relief, setRelief] = useState(false)
  /*
    REVEALED, NOT ALWAYS UP. The work map carries its search bar permanently
    because it has the width for it and the bar is one of few things over the
    imagery. A studio area may be a quarter of that wide, and a bar standing
    across the top of a sphere would cover the pole to answer a question that
    is asked once and then not again for a while.

    It is also withheld from the work map for as long as the studio is up --
    see MapScreen -- so without this the studio has no way to reach a place by
    name at all, which is half of what the drawing modal was for.
  */
  const [searching, setSearching] = useState(false)
  /*
    THE TWO THINGS A READER CANNOT OTHERWISE TELL APART.

    Turning the wheel and seeing no change has two causes with one appearance:
    tiles still in flight, and imagery that has no finer level to give. Without
    a word from the surface they are the same event, and the reader's next move
    -- wait, or stop turning -- depends on which it is.

    The zoom figure alone answers a third of it: it moves while the picture
    does not, which says the gesture registered.
  */
  const { level } = useCameraNavigation(mapRef.current, ready)

  /*
    THE SAME HOOK THE WORK MAP USES, which is the whole reason this is a small
    change. `useAreaDrawing` carries the one-area rule, when a finished shape
    is reported and the sync with the copy held outside; a second answer to
    what drawing an area means is what it exists to prevent.

    The map is handed over only where there is somewhere to report to. The hook
    itself is called unconditionally -- it is a hook -- and does nothing with a
    null map, which is how a globe that only shows the catalog stays one.
  */
  const drawnRef = useRef(onPolygonDrawn)
  drawnRef.current = onPolygonDrawn
  const canDraw = !!onPolygonDrawn
  const { mode, setMode, clear, stop } = useAreaDrawing({
    map: canDraw ? mapRef.current : null,
    ready,
    polygon,
    onPolygonDrawn: (geom) => drawnRef.current?.(geom),
  })
  const stopRef = useRef(stop)
  stopRef.current = stop
  const [zoom, setZoom] = useState(initialView?.zoom ?? START_ZOOM)
  const [busy, setBusy] = useState(false)

  const pickAreaRef = useRef(onPickArea)
  pickAreaRef.current = onPickArea
  /** The most recent error event, which the watchdog reports if it matters. */
  const lastError = useRef<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const imagery = basemapByKind(GLOBE_BASEMAP)
    let map: MapLibreMap
    try {
      map = new MapLibreMap({
        container: host,
        /*
          No attribution control. It renders its links as anchors, and this is a
          WKWebView with no createWebViewWith delegate, so an anchor with
          target="_blank" is silently ignored -- the licence asks the credit to
          be REACHABLE and an anchor here is not. The application already
          discharges this the way it must, through BrowserOpenURL, and the
          readout at this surface's own foot renders the parts.

          Passing an options object here would also have dropped MapLibre's own
          link, since MapOptions.attributionControl is merged by shallow spread.
        */
        attributionControl: false,
        center: initialView
          ? [initialView.lon, initialView.lat]
          : START_CENTER,
        zoom: initialView?.zoom ?? START_ZOOM,
        /*
          85, not the 60 this defaults to. Sixty is a map's ceiling, set so a
          mercator plane never reaches its own horizon; on a sphere the horizon
          is the point -- laying the camera almost flat is what shows relief
          and the curve of the limb, and it is the view this screen was asked
          for. MapLibre permits up to 180, and the last degrees put the camera
          under the ground, so 85 is where it stops being a view of anything.
        */
        maxPitch: 85,
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
            [SHAPE_SOURCE]: {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
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
            /*
              ABOVE the catalog, because it is what is being worked on. And
              stroked rather than left as a fill: DrawMap records that a closed
              polygon with no line of its own vanishes the moment it is
              finished, which reads as the drawing having failed.
            */
            {
              id: SHAPE_FILL,
              type: "fill",
              source: SHAPE_SOURCE,
              paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 },
            },
            {
              id: SHAPE_LINE,
              type: "line",
              source: SHAPE_SOURCE,
              paint: { "line-color": "#ffffff", "line-width": 1.5 },
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
      map.on("zoom", () => {
        // Rounded before it is stored, so a pinch settles into about ten state
        // changes per level instead of one per frame.
        const z = Math.round(map.getZoom() * 10) / 10
        setZoom((prev) => (prev === z ? prev : z))
      })
    )
    /*
      Reported on moveend rather than on move: the session's memory of where it
      was left is a fact about where a gesture ENDED, and one write per frame of
      a drag would be several hundred writes for one of them.

      Through a ref, because the map is built once and this effect closes over
      the callback it was given at mount.
    */
    subs.push(
      map.on("moveend", () => {
        const c = map.getCenter()
        viewChangeRef.current?.({
          lat: c.lat,
          lon: c.lng,
          zoom: map.getZoom(),
        })
      })
    )
    /*
      `dataloading` fires per request and `idle` when nothing is outstanding
      and nothing is animating, which is exactly the pair this needs. Setting
      the same value again is free -- React bails out of a re-render when the
      state is unchanged -- so no throttling is warranted here.
    */
    subs.push(map.on("dataloading", () => setBusy(true)))
    subs.push(map.on("idle", () => setBusy(false)))
    /*
      THE ONE HAND THAT IS NOT A LINK.

      The convention elsewhere is that the arrow covers everything clickable and
      the hand is kept for what leaves the application -- a button reads as a
      button from its shape, its border and its hover, so the cursor is spent
      saying what those already say.

      A polygon on a canvas has none of those. AREA_FILL carries no hover paint,
      so with the arrow here a clickable area would announce itself in no way at
      all. The cursor is the whole affordance, which is the case the rule exists
      to leave room for rather than an exception to it.

      Giving the layer a hover feature-state would settle it the other way and
      let this go. That is a rendering change, not a cursor one.
    */
    subs.push(
      map.on("mouseenter", AREA_FILL, () => {
        map.getCanvas().style.cursor = "var(--cursor-pointer)"
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
      // Before the map goes. React runs effect cleanups in the order their
      // effects were declared, so terra-draw's adapter would otherwise write
      // into sources belonging to a map that has already been removed -- see
      // the note on `stop` in useAreaDrawing.
      stopRef.current()
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

  /*
    The raster sent here from the viewport.

    Through the same syncOverlays the work map uses, so one module decides how
    an image is placed and in what order -- two of them would disagree about
    where a class boundary sits, which mapLayers.ts already argues at length.

    Under AREA_LINE so the outlines stay readable over it. `once("styledata")`
    covers the window where the style is being replaced and addSource throws;
    the work map carries the same guard and the note explaining it.
  */
  const overlayIdsRef = useRef<string[]>([])
  const [styleNonce, setStyleNonce] = useState(0)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    /*
      Bottom to top, by the layer's own order.

      RasterLayer.order already encodes which raster reads over which -- a
      classification over surface water, confidence over the classification --
      and syncOverlays takes the array AS the ordering. Sorting here is what
      makes a stack of several read the way the same set reads on the work map,
      rather than in whatever sequence they happened to be pressed.
    */
    const specs = [...overlays]
      .filter((o) => !isZeroExtent(o.layer.extent))
      .sort((a, b) => a.layer.order - b.layer.order)
      .map((o) => ({
        id: `sent-${o.key}`,
        url: o.layer.uri,
        bounds: o.layer.extent,
        opacity: o.layer.opacity,
      }))
    try {
      overlayIdsRef.current = syncOverlays(
        map,
        specs,
        overlayIdsRef.current,
        map.getLayer(AREA_LINE) ? AREA_LINE : undefined
      )
    } catch {
      const retry = () => setStyleNonce((n) => n + 1)
      map.once("styledata", retry)
      return () => {
        map.off("styledata", retry)
      }
    }
  }, [overlays, ready, styleNonce])

  /*
    And the camera comes to what is drawn, when the SET changes.

    A globe is usually read at a zoom where a field is a fraction of a pixel,
    so drawing one without moving is drawing it where nobody is looking.

    To the union of the extents, not to the newest: sending a second raster
    over another field and being taken to it alone would hide the first, which
    is the comparison the reader is making. Two over the same ground give the
    same box, so nothing moves.

    Keyed on the set rather than the array, so a re-render or an opacity change
    does not pull the camera under the reader's hand.
  */
  const fitKey = overlays.map((o) => o.key).join("|")
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const boxes = overlays
      .map((o) => o.layer.extent)
      .filter((e) => !isZeroExtent(e))
    if (!boxes.length) return
    map.fitBounds(
      [
        [
          Math.min(...boxes.map((e) => e.lon_min)),
          Math.min(...boxes.map((e) => e.lat_min)),
        ],
        [
          Math.max(...boxes.map((e) => e.lon_max)),
          Math.max(...boxes.map((e) => e.lat_max)),
        ],
      ],
      { padding: 60 }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the set, not the array
  }, [fitKey, ready])

  /*
    The DEM and its shading, added once the style exists and inserted UNDER the
    catalog: an outline is about where work is and hillshade is the ground it
    is on, so shading over the ring would be the ground drawn on top of the
    thing it is under.
  */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    addTerrainSources(map, map.getLayer(AREA_FILL) ? AREA_FILL : undefined)
  }, [ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setTerrainEnabled(map, relief)
    return () => {
      // The lift is a property of the map, not of this effect's run: left on
      // through an unmount the next style load inherits a terrain whose source
      // is gone.
      if (mapRef.current) setTerrainEnabled(mapRef.current, false)
    }
  }, [relief, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource<GeoJSONSource>(SHAPE_SOURCE)
    void src?.setData(
      polygon
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: polygon as never },
            ],
          }
        : { type: "FeatureCollection", features: [] }
    )
  }, [polygon, ready])

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      {/*
        Space is drawn by the backdrop below, not by a colour on this element.
        It used to be `--p-ink`, the chassis colour, which made the globe read
        as an object on a panel rather than a view through one.

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
      <SpaceBackdrop />
      {/*
        Above the backdrop by document order, and transparent: MapLibre forces
        an alpha context and clears each frame, so what is behind this element
        is what shows around the planet.
      */}
      <div ref={hostRef} className="h-full w-full" />
      {/*
        Bottom left, in the studio status bar's idiom and at its weight: this
        answers a question a reader holds while looking at the imagery, and
        anything heavier would compete with the imagery for the answer.
      */}
      {ready && !failure && (
        <div className="telemetry pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className="tabular-nums text-foreground">z{zoom.toFixed(1)}</span>
          {busy ? (
            <span>loading imagery</span>
          ) : zoom > NATIVE_MAX ? (
            /* Not an error. The imagery ends and the picture is magnified from
               its last real level, which is what a map does; saying so is the
               difference between a limit and a fault. */
            <span>magnified past z{NATIVE_MAX}, the finest this imagery has</span>
          ) : null}
          {/*
            WHO THE GROUND BELONGS TO, in the title bar's own order and with its
            own separators, so the two surfaces credit one set of providers one
            way. It was missing here entirely: the surface switches MapLibre's
            attribution control off -- see the mount, where the reason is that
            an anchor in this WKWebView opens nothing -- on the understanding
            that the application renders the parts itself, and the screen that
            used to do so was removed with the globe destination.

            Not `telemetry`, so it is not in the mono face the readings above
            use: it is a sentence about ownership rather than a measurement.

            IT WRAPS RATHER THAN TRUNCATES. The title bar can hide its credit
            below xl and clip what is left, because the licence is discharged by
            the line being reachable on the surface that draws the imagery, and
            there the map is the whole window. A studio area can be a few inches
            wide, and a truncated credit in the only place it appears is a
            credit that is not given.

            `pointer-events-auto` on the credits alone, because the line around
            them is a readout that must not take the pointer off the planet.
          */}
          <span className="pointer-events-auto font-sans normal-case opacity-80">
            <Credit part={MAPLIBRE_CREDIT} />
            {basemapByKind(GLOBE_BASEMAP).credit.map((c, i) => (
              <span key={c.label}>
                {i === 0 ? " | " : " \u2014 "}
                <Credit part={c} />
              </span>
            ))}
            {/*
              Only while relief is drawn, because only then is a second provider
              on screen. terrain.ts states that rule and the reason behind it:
              naming the mosaic is also what keeps it distinct from the DEMs an
              analysis was computed on.
            */}
            {relief && (
              <span>
                {" \u2014 "}
                <Credit part={ELEVATION_CREDIT} />
              </span>
            )}
          </span>
        </div>
      )}

      {ready && !failure && (
        <CameraControls
          map={mapRef.current}
          level={level}
          className="absolute bottom-3 right-3"
        />
      )}

      {/*
        TOP RIGHT, NOT BOTTOM RIGHT WHERE DrawMap PUTS THEM. That corner is the
        camera's on this surface, and two bars stacked there would be one column
        of six glyphs with a seam somewhere in the middle -- which reads as one
        instrument rather than two. Opposite corners keep "where am I looking"
        and "what am I drawing" apart.
      */}
      {ready && !failure && (
        <MapBar className="app-no-drag absolute right-3 top-3 z-[400] flex flex-col">
          {/*
            THE COLUMN READS IN THE ORDER THE WORK HAPPENS: find the place,
            light the ground, draw on it. One column rather than a bar per
            subject, because this surface has one corner for chrome and a
            second bar beside it would be two instruments for one hand.
          */}
          <MapButton
            label="Search for a place"
            active={searching}
            onClick={() => setSearching((v) => !v)}
          >
            <Search className="size-4" strokeWidth={1.5} />
          </MapButton>
          <MapButton
            label="Relief"
            active={relief}
            onClick={() => setRelief((r) => !r)}
          >
            <Mountain className="size-4" strokeWidth={1.5} />
          </MapButton>
          {canDraw && (
            <>
              <MapButton
                label="Draw an area"
                active={mode === "draw"}
                onClick={() => setMode((m) => (m === "draw" ? "idle" : "draw"))}
              >
                <Pencil className="size-4" strokeWidth={1.5} />
              </MapButton>
              <MapButton
                label="Edit the area"
                active={mode === "edit"}
                onClick={() => setMode((m) => (m === "edit" ? "idle" : "edit"))}
              >
                <Spline className="size-4" strokeWidth={1.5} />
              </MapButton>
              <MapButton label="Delete the area" onClick={clear}>
                <Trash2 className="size-4" strokeWidth={1.5} />
              </MapButton>
            </>
          )}
        </MapBar>
      )}
      {/*
        OPENING TO THE LEFT of the column rather than under it: under is where
        the drawing tools are, and a panel that covered them would hide the
        controls a reader reaches for immediately after arriving somewhere.

        Bounded by the pane rather than given a width, so a narrow area gets a
        narrow bar instead of one that runs off the edge.
      */}
      {searching && ready && !failure && (
        <SearchBar
          className="app-no-drag absolute left-3 right-[3.5rem] top-3 z-[401] max-w-[22rem]"
          autoFocus
          onSelectLocation={(lat, lon) => {
            /*
              14, the zoom FlyToController arrives at everywhere else. Its
              export comment says the controller is shared precisely so there
              is one answer to how far the application zooms on arrival, and a
              second answer introduced here would be a globe that lands closer
              or further than the map for the same search.
            */
            mapRef.current?.flyTo({ center: [lon, lat], zoom: 14, duration: 1200 })
            setSearching(false)
          }}
        />
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
