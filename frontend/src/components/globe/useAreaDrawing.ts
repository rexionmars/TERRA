/**
 * Drawing one area on a MapLibre map, with terra-draw.
 *
 * A HOOK BECAUSE THERE ARE TWO SURFACES. The work map draws an area, and so
 * does the studio's globe, which is how an area is drawn without leaving the
 * board. The second used to be a dialog holding a map of its own; it is a
 * planet in the arrangement now, and the reason for the hook did not change
 * with it -- the control is a store, a mode and four handlers, and a second
 * copy would be a second answer to what "one area" means.
 *
 * WHAT IT CARRIES that terra-draw does not:
 *
 * - ONE AREA AT A TIME. A second polygon replaces the first rather than joining
 *   it, so what a run reads is never ambiguous.
 * - WHEN THE SHAPE LEAVES. Not on every vertex: terra-draw fires `change` with
 *   "update" as a polygon is being drawn, and emitting those put a half-drawn
 *   shape into the application's state, which the sync below then treated as
 *   a disagreement and cleared -- the drawing was wiped on its third click and
 *   silently restarted. The finished shape on `finish`, an edited one on the
 *   `finish` that ends each select-mode gesture, a removal whenever one
 *   happens: the same set leaflet-draw's CREATED / EDITED / DELETED gave.
 * - A LINE, in the "cut" mode: the cut a field is split along, handed over
 *   and taken off the store again, since the store holds one area.
 * - THE SHAPE HELD ELSEWHERE. Search, import, an example and clearing all set
 *   the area from outside, and the store has to agree with them or the next
 *   edit starts from a shape that is no longer on screen.
 *
 * `stop` is returned rather than only run on unmount, and the caller must call
 * it before removing the map. React runs effect cleanups in the order their
 * effects were declared, so a map created in an earlier effect is gone by the
 * time this one's cleanup runs, and terra-draw's adapter then writes into
 * sources that no longer exist.
 */
import { useEffect, useRef, useState } from "react"
import type { Map as MapLibreMap } from "maplibre-gl"
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw"
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter"

import { drawableOutline } from "@/lib/geometry"
import type { GeoJSONGeometry } from "@/lib/types"

/**
 * The adapter, with terra-draw's cursor keywords pointed at the pointer set.
 *
 * terra-draw writes a cursor straight onto the canvas -- `canvas.style.cursor =
 * "crosshair"` -- which outranks every rule, so drawing an area kept the
 * platform cursor while the map under it had changed. Its own `cursors` option
 * cannot help: that type is a closed union of CSS keywords and will not take a
 * variable.
 *
 * So the translation happens here, at the one place the value is written. The
 * keyword becomes `var(--cursor-<keyword>, <keyword>)`, and var()'s own
 * fallback does the rest -- a keyword the set does not draw, `wait` or
 * `n-resize`, resolves to itself rather than to nothing. That fallback is why
 * there is no list of covered keywords to keep in step with cursors.css.
 */
class PointerSetAdapter extends TerraDrawMapLibreGLAdapter<MapLibreMap> {
  private readonly canvasOf: () => HTMLElement

  constructor(options: { map: MapLibreMap }) {
    super(options)
    this.canvasOf = () => options.map.getCanvas()
  }

  setCursor(
    cursor: Parameters<TerraDrawMapLibreGLAdapter<MapLibreMap>["setCursor"]>[0]
  ) {
    const style = this.canvasOf().style
    if (cursor === "unset") style.removeProperty("cursor")
    else style.cursor = `var(--cursor-${cursor}, ${cursor})`
  }
}

/** How long after a gesture ends a press on the map still belongs to it. */
const FINISH_CLICK_MS = 400

/**
 * What the pointer is doing: nothing, laying vertices, moving them, or laying
 * the line a field is cut along.
 */
export type DrawMode = "idle" | "draw" | "edit" | "cut"

/** A GeoJSON LineString: the line a field is cut along. */
export interface DrawnLine {
  type: "LineString"
  coordinates: [number, number][]
}

export function useAreaDrawing({
  map,
  ready,
  polygon,
  onPolygonDrawn,
  onPolygonEdited,
  onLineDrawn,
}: {
  /** Read through a ref by the caller; null until the map exists. */
  map: MapLibreMap | null
  ready: boolean
  /** The area as the application holds it, which the store is kept equal to. */
  polygon: GeoJSONGeometry | null
  /** A new shape, or the shape removed. */
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  /**
   * The shape in hand, moved: once per gesture, when a vertex or the whole
   * outline is let go, a vertex is removed or one is inserted. Absent, an edit
   * is reported as a new shape.
   */
  onPolygonEdited?: (geom: GeoJSONGeometry) => void
  /** A line laid in the "cut" mode, finished with a press on its last point or Enter. */
  onLineDrawn?: (line: DrawnLine) => void
}): {
  mode: DrawMode
  setMode: (m: DrawMode | ((prev: DrawMode) => DrawMode)) => void
  /** Removes the shape and reports the removal. */
  clear: () => void
  /** Releases the map's sources. Call before removing the map. */
  stop: () => void
  /**
   * Whether a press now is part of a gesture that just ended. The press that
   * finishes a line or an outline reaches the map's own click after the mode
   * has gone back to idle, and is then read as choosing what lies under it.
   */
  justFinished: () => boolean
} {
  const drawRef = useRef<TerraDraw | null>(null)
  /**
   * True while THIS hook is writing the store to match the shape held outside.
   *
   * `draw.clear()` and `draw.addFeatures()` raise the same `change` events a
   * hand does, and the listener below cannot tell them apart -- so a sync would
   * report itself back out as an edit. Emitting during one is how a shape
   * arriving from elsewhere came to erase itself.
   */
  const syncing = useRef(false)
  const [mode, setMode] = useState<DrawMode>("idle")
  const finishedAt = useRef(0)
  const onDrawnRef = useRef(onPolygonDrawn)
  onDrawnRef.current = onPolygonDrawn
  const onEditedRef = useRef(onPolygonEdited)
  onEditedRef.current = onPolygonEdited
  const onLineRef = useRef(onLineDrawn)
  onLineRef.current = onLineDrawn

  useEffect(() => {
    if (!map || !ready) return
    const draw = new TerraDraw({
      adapter: new PointerSetAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: {
            fillColor: "#ffffff",
            fillOpacity: 0.06,
            outlineColor: "#ffffff",
            outlineWidth: 2,
          },
        }),
        new TerraDrawLineStringMode({
          styles: { lineStringColor: "#ffffff", lineStringWidth: 2 },
        }),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
          },
        }),
      ],
    })
    draw.start()
    drawRef.current = draw
    /*
      DEV ONLY. The draw store is not reachable from the DOM, and its snapshot
      is what told one click from another when a rectangle came out as a
      two-point sliver.
    */
    if (import.meta.env.DEV) {
      ;(window as unknown as { __draw?: TerraDraw }).__draw = draw
    }

    const emit = () => {
      /*
        THE SYNC IS NOT AN EDIT, and this guard is what says so.

        Two surfaces run this hook at once -- the work map and the studio's
        globe, both mounted, both bound to the one area the application holds.
        Finishing a shape on either one sets that area, which arrives at the
        OTHER as a polygon its store does not have; the effect below then
        clears the store to replace it, `clear()` raises `change` with
        "delete", and this listener answered a synchronisation with
        `onPolygonDrawn(null)`. The shape that had just been drawn was erased
        by the surface that was only being told about it.

        It was reachable before the globe drew, through search, import and
        adopt -- any path that sets the area from outside a mounted map -- and
        it is constant now. The rule is narrow: while this hook is writing the
        store to match what it was given, the store has nothing to report.
      */
      if (syncing.current) return
      const polys = draw.getSnapshot().filter((f) => f.geometry.type === "Polygon")
      /*
        ONE AREA IS THIS HOOK'S INVARIANT, so two polygons is a state it is
        PASSING THROUGH and never a state to report from.

        Two surfaces run this hook at once -- the work map and the studio's
        globe -- and the sync effect below puts the area the application holds
        into each store. Drawing on one of them therefore starts from a store
        that already has a polygon in it: the synced copy, plus the new one.

        `finish` prunes the extra before it reports, and is the one caller
        left. The `change` listener was another, and reported from inside the
        pair: terra-draw raised "update" in select mode while both were
        present, this emitted, and the line below took the LAST polygon in the
        snapshot -- which in that transient pair is not reliably the one being
        drawn. The application received a geometry it had not asked about and
        filed it as a new area.

        The trace that found it read `emit len=179 polys=2` immediately before
        a catalog entry appeared, and `polys=1` on the report that followed.

        Guarding on the geometry was the wrong fix and is why two attempts at
        it changed nothing: the two reports carry DIFFERENT shapes, so no
        comparison between them could ever have matched.
      */
      if (polys.length > 1) return
      const last = polys[polys.length - 1]
      onDrawnRef.current(last ? (last.geometry as GeoJSONGeometry) : null)
    }

    draw.on("finish", (id, context) => {
      finishedAt.current = performance.now()
      /*
        A LINE IS NOT AN AREA. It is the cut the reader laid across the field
        in hand: handed over, and taken off the store, which goes on holding
        the field's outline and nothing else.
      */
      if (context.mode === "linestring") {
        const line = draw.getSnapshot().find((f) => f.id === id)
        syncing.current = true
        try {
          draw.removeFeatures([id])
          setMode("idle")
          draw.setMode("select")
        } finally {
          syncing.current = false
        }
        if (line?.geometry.type === "LineString") {
          onLineRef.current?.(line.geometry as unknown as DrawnLine)
        }
        return
      }
      /*
        AN EDIT IS REPORTED WHEN THE GESTURE ENDS, as an edit. It was reported
        on every `change` the select mode raised while a vertex was dragged,
        through the path a new shape takes, so each pointer move over the map
        became an area of its own.
      */
      if (context.mode === "select") {
        if (syncing.current) return
        const polys = draw.getSnapshot().filter((f) => f.geometry.type === "Polygon")
        if (polys.length !== 1) return
        const geom = polys[0].geometry as GeoJSONGeometry
        if (onEditedRef.current) onEditedRef.current(geom)
        else onDrawnRef.current(geom)
        return
      }
      /*
        ONE FINISH, ONE REPORT, and the guard is what makes that true.

        Everything this handler does to the store is housekeeping: dropping the
        closing and snapping points the polygon mode leaves behind, and handing
        the feature to the select mode. Each of those raises the same `change`
        events a hand raises -- `removeFeatures` raises "delete" -- so the
        listener below answered them, and one finished polygon was reported
        two and three times.

        Downstream that is not a repeated no-op. `handlePolygonDrawn` writes an
        area per report, and the store names each one against what the project
        held when the write arrived: three areas called "drawn 2", identical
        geometry, three ids. The board then listed each of them.

        The report is made after the guard is released, deliberately: it is the
        one thing here that IS news.
      */
      syncing.current = true
      try {
        // By id from the event, not by position in the snapshot: the store also
        // holds the closing point and the snapping point, and "everything but
        // the last" removed whichever of those happened to sort last.
        const others = draw
          .getSnapshot()
          .filter((f) => f.id !== id)
          .map((f) => f.id!)
        if (others.length) draw.removeFeatures(others)
        setMode("idle")
        draw.setMode("select")
      } finally {
        syncing.current = false
      }
      emit()
    })

    /*
      A DELETE IS A REMOVAL ONLY WHEN NO POLYGON IS LEFT. The modes delete
      their own guide points as they go -- the cut mode one per vertex laid --
      and reporting the polygon still in the store on each of them was harmless
      only while it was the very shape the application held. It is not when the
      store holds that shape's drawable outline (drawableOutline), which the
      application would read as a new area.
    */
    draw.on("change", (_ids, type) => {
      if (type !== "delete" || syncing.current) return
      if (!draw.getSnapshot().some((f) => f.geometry.type === "Polygon")) {
        onDrawnRef.current(null)
      }
    })

    return () => {
      if (drawRef.current === draw) {
        draw.stop()
        drawRef.current = null
      }
    }
  }, [map, ready])

  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return
    // Never mid-gesture: there the store is being edited and the application's
    // copy is older than it by definition.
    if (draw.getModeState() === "drawing") return
    const current = draw.getSnapshot()
    const currentGeom = current.length
      ? (current[current.length - 1].geometry as GeoJSONGeometry)
      : null
    // The store holds what it can: see drawableOutline.
    const wanted = polygon ? drawableOutline(polygon) : null
    if (JSON.stringify(currentGeom) === JSON.stringify(wanted)) return
    /*
      Set for the whole replacement rather than per call, because it is the
      pair that has to be silent: cleared and not yet refilled is a state this
      hook passes THROUGH, and reporting from inside it would report an empty
      store as an area that was removed. Restored in a finally so a throw in
      addFeatures cannot leave the surface permanently unable to report.
    */
    syncing.current = true
    try {
      draw.clear()
      if (wanted) {
        draw.addFeatures([
          {
            type: "Feature",
            properties: { mode: "polygon" },
            geometry: wanted as never,
          } as never,
        ])
      }
    } finally {
      syncing.current = false
    }
  }, [polygon])

  useEffect(() => {
    drawRef.current?.setMode(
      mode === "draw" ? "polygon" : mode === "cut" ? "linestring" : "select"
    )
  }, [mode])

  return {
    mode,
    setMode,
    clear: () => {
      /*
        The caller's clear IS an edit -- the reader pressed the bin -- so it
        reports, and it reports EXPLICITLY rather than through the change
        listener: the guard above silences that path, and a removal nobody
        hears is a shape that stays in the application after it has left the
        screen.
      */
      syncing.current = true
      try {
        drawRef.current?.clear()
      } finally {
        syncing.current = false
      }
      onDrawnRef.current(null)
      setMode("idle")
    },
    stop: () => {
      drawRef.current?.stop()
      drawRef.current = null
    },
    justFinished: () => performance.now() - finishedAt.current < FINISH_CLICK_MS,
  }
}
