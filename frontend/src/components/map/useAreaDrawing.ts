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
 *   silently restarted. The finished shape on `finish`, an edited one only
 *   while the select mode owns it, a removal whenever one happens: the same set
 *   leaflet-draw's CREATED / EDITED / DELETED gave.
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
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw"
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter"

import type { GeoJSONGeometry } from "@/lib/types"

/** What the pointer is doing: nothing, laying vertices, or moving them. */
export type DrawMode = "idle" | "draw" | "edit"

export function useAreaDrawing({
  map,
  ready,
  polygon,
  onPolygonDrawn,
}: {
  /** Read through a ref by the caller; null until the map exists. */
  map: MapLibreMap | null
  ready: boolean
  /** The area as the application holds it, which the store is kept equal to. */
  polygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
}): {
  mode: DrawMode
  setMode: (m: DrawMode | ((prev: DrawMode) => DrawMode)) => void
  /** Removes the shape and reports the removal. */
  clear: () => void
  /** Releases the map's sources. Call before removing the map. */
  stop: () => void
} {
  const drawRef = useRef<TerraDraw | null>(null)
  const [mode, setMode] = useState<DrawMode>("idle")
  const onDrawnRef = useRef(onPolygonDrawn)
  onDrawnRef.current = onPolygonDrawn

  useEffect(() => {
    if (!map || !ready) return
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: {
            fillColor: "#ffffff",
            fillOpacity: 0.06,
            outlineColor: "#ffffff",
            outlineWidth: 2,
          },
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
      const polys = draw
        .getSnapshot()
        .filter((f) => f.geometry.type === "Polygon")
      const last = polys[polys.length - 1]
      onDrawnRef.current(last ? (last.geometry as GeoJSONGeometry) : null)
    }

    draw.on("finish", (id) => {
      // By id from the event, not by position in the snapshot: the store also
      // holds the closing point and the snapping point, and "everything but
      // the last" removed whichever of those happened to sort last.
      const others = draw
        .getSnapshot()
        .filter((f) => f.id !== id)
        .map((f) => f.id!)
      if (others.length) draw.removeFeatures(others)
      emit()
      setMode("idle")
      draw.setMode("select")
    })

    draw.on("change", (_ids, type) => {
      if (type === "delete") return emit()
      if (type === "update" && draw.getMode() === "select") emit()
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
    if (JSON.stringify(currentGeom) === JSON.stringify(polygon)) return
    draw.clear()
    if (polygon && polygon.type === "Polygon") {
      draw.addFeatures([
        {
          type: "Feature",
          properties: { mode: "polygon" },
          geometry: polygon as never,
        } as never,
      ])
    }
  }, [polygon])

  useEffect(() => {
    drawRef.current?.setMode(mode === "draw" ? "polygon" : "select")
  }, [mode])

  return {
    mode,
    setMode,
    clear: () => {
      drawRef.current?.clear()
      onDrawnRef.current(null)
      setMode("idle")
    },
    stop: () => {
      drawRef.current?.stop()
      drawRef.current = null
    },
  }
}
