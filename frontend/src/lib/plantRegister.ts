/**
 * The plant register, fetched once and held, so the map is not bare.
 *
 * WHY IT IS NOT A RUN. Every other question this slice asks is about a polygon
 * over a window, and produces a result worth saving beside the area it was
 * asked of. This one answers "where are the plants", which is what a reader
 * needs BEFORE drawing the polygon -- and an area drawn without it is a guess:
 * the imagery shows a solar farm plainly and the record may hold nothing under
 * the shape that was drawn over it.
 *
 * ONE FETCH PER SESSION, held in a module promise. The located register is
 * 24,698 points and about 7 MB, which takes the store a little over two
 * seconds and MapLibre no effort at all. Fetching it per panel would pay that
 * for each board; fetching it per view would pay a round trip for every pan,
 * for a payload that fits in memory once and never changes while the
 * application is open.
 *
 * A FAILURE IS NOT AN EMPTY REGISTER, and the two must not arrive as the same
 * value. `null` while loading or after a failure means "the map cannot say";
 * a collection with no features means "asked, and there are none". A layer
 * that drew the first as the second would tell a reader there are no plants
 * where in fact there is no connection.
 */
import { useEffect, useState } from "react"

import { GridPlants } from "../../wailsjs/go/main/App"

export interface PlantRegister {
  geojson: GeoJSON.FeatureCollection
  /** Counted over what was returned, which a bbox or kind filter changes. */
  counts: {
    returned: number
    metered: number
    registered: number
    located: number
    truncated: boolean
  }
  note: string
}

let pending: Promise<PlantRegister | null> | null = null

/**
 * The register, fetched at most once.
 *
 * The promise is cached and not its result, so two callers mounting in the
 * same tick share one request rather than racing two. A rejection clears the
 * cache: a store that was unreachable at startup is often reachable a moment
 * later, and holding the failure forever would make that unrecoverable without
 * a restart.
 */
export function loadPlantRegister(): Promise<PlantRegister | null> {
  if (pending) return pending
  pending = GridPlants([], [])
    .then((layer) => {
      /*
        THE GENERATED TYPE IS WRONG HERE AND THE CAST IS DELIBERATE.

        The field is json.RawMessage in Go, which is []byte, so the Wails
        generator writes `geojson: number[]` in models.ts. At runtime it is
        nothing of the sort: RawMessage carries MarshalJSON, so the wire value
        is the GeoJSON object itself and never a byte array.

        RawMessage rather than map[string]any -- which would generate an honest
        type -- because it forwards seven megabytes without Go parsing and
        re-serialising a document neither end of this reads. The string branch
        is kept because a future transport that hands it over as text would
        otherwise fail at the layer instead of here.
      */
      const raw = layer.geojson as unknown
      const geojson = (
        typeof raw === "string" ? JSON.parse(raw) : raw
      ) as GeoJSON.FeatureCollection
      return {
        geojson,
        counts: layer.counts,
        note: layer.note,
      } as PlantRegister
    })
    .catch((e) => {
      pending = null
      console.warn("[plants] the register could not be read:", e)
      return null
    })
  return pending
}

/** The register for a component, or null while it is loading or unavailable. */
export function usePlantRegister(): PlantRegister | null {
  const [register, setRegister] = useState<PlantRegister | null>(null)
  useEffect(() => {
    let live = true
    void loadPlantRegister().then((r) => {
      if (live) setRegister(r)
    })
    return () => {
      live = false
    }
  }, [])
  return register
}

/*
  WHICH OF THE REGISTER'S LAYERS ARE DRAWN.

  Held in a module rather than threaded as props, and the reason is the shape of
  the tree rather than convenience: the card that toggles a layer is in the run
  band, which StudioScreen renders, and the layer itself is on the globe, which
  BoardSurface renders. Neither is an ancestor of the other. Lifting the state
  to their common parent would put a map concern in a screen that has no map in
  it, and pass it through two components that only forward it.

  The register itself is already held this way and for the same reason. This is
  the second value with the same lifetime -- one per session, read by two
  unrelated subtrees -- so it lives beside it.
*/
export type PlantLayerId = "metered" | "registered"

export interface PlantLayerState {
  metered: boolean
  registered: boolean
}

/*
  The metered layer on and the rest off, which is not a neutral default.

  558 of the 18,639 located photovoltaic enterprises are in the operational
  record, so drawing all of them alike opens the map on 24,140 marks that
  nothing here can be asked about and 558 that can. The layer that answers is
  the one that is up; the other is available and is a deliberate choice.
*/
let layerState: PlantLayerState = { metered: true, registered: false }
const layerListeners = new Set<(s: PlantLayerState) => void>()

export function setPlantLayer(id: PlantLayerId, on: boolean): void {
  layerState = { ...layerState, [id]: on }
  for (const fn of layerListeners) fn(layerState)
}

/** The layer switches, kept in step across every subtree that reads them. */
export function usePlantLayers(): PlantLayerState {
  const [state, setState] = useState(layerState)
  useEffect(() => {
    // Re-read on subscribe: a component mounting after a toggle would
    // otherwise render the value this module held when it was first imported.
    setState(layerState)
    layerListeners.add(setState)
    return () => {
      layerListeners.delete(setState)
    }
  }, [])
  return state
}
