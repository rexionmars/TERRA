/**
 * Relief under the map: a DEM to lift the ground, and a shading layer over it.
 *
 * WHY A DIFFERENT DEM FROM THE ONE THE ANALYSIS USED, and why that has to be
 * said out loud. `sidecar/dem.py` draws COP30, NASADEM, ALOS and COP90 per area
 * and computes HAND and the flood envelope from them; those arrive here as a
 * rendered PNG and never as elevation. MapLibre lifts terrain from a `raster-dem`
 * SOURCE, which is tiles on the Web Mercator grid, and an area-shaped array is
 * not that.
 *
 * So the relief drawn here is a global mosaic and the analysis is not computed
 * from it. A reader must not take the shading under a flood envelope for the
 * surface that envelope was derived on. That is what `ELEVATION_CREDIT` is for:
 * it names the source in the title bar whenever relief is on, beside the
 * imagery credit, so the two DEMs are never silently conflated.
 *
 * OFF BY DEFAULT. Terrain adds a DEM tile per view and a mesh per tile, and
 * this application has a written history of paying for graphics it did not ask
 * for -- see docs/PERFORMANCE.md. A reader who wants relief asks for it.
 */
import type { Map as MapLibreMap } from "maplibre-gl"

import type { CreditPart } from "@/lib/basemaps"

export const DEM_SOURCE = "terrain-dem"
export const HILLSHADE_LAYER = "terrain-hillshade"

/**
 * AWS Terrain Tiles, in Terrarium encoding, which MapLibre decodes natively.
 *
 * Public and keyless, and it answers with `Access-Control-Allow-Origin: *`,
 * which a worker-fetched tile needs and an <img> would not have told us.
 */
const DEM_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"

/** The deepest level the mosaic carries; past it MapLibre magnifies the last. */
const DEM_MAX_ZOOM = 15

/**
 * Credited whenever relief is drawn. Not optional and not decorative: the
 * mosaic is assembled from national and mission datasets whose licences ask to
 * be named, and naming it is also what keeps it distinct from the DEMs the
 * analysis ran on.
 */
export const ELEVATION_CREDIT: CreditPart = {
  label: "Elevation: AWS Terrain Tiles",
  href: "https://registry.opendata.aws/terrain-tiles/",
}

/** The source and the shading layer, added once when the style is ready. */
export function addTerrainSources(map: MapLibreMap, beforeId?: string): void {
  if (!map.getSource(DEM_SOURCE)) {
    map.addSource(DEM_SOURCE, {
      type: "raster-dem",
      tiles: [DEM_TILES],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: DEM_MAX_ZOOM,
      attribution: ELEVATION_CREDIT.label,
    })
  }
  if (!map.getLayer(HILLSHADE_LAYER)) {
    map.addLayer(
      {
        id: HILLSHADE_LAYER,
        type: "hillshade",
        source: DEM_SOURCE,
        layout: { visibility: "none" },
        paint: {
          /*
            Shading the IMAGERY, not standing in for it. Satellite imagery
            already carries its own shadows, so a hillshade at full strength
            double-shades every slope and reads as a relief map printed over a
            photograph. Low exaggeration and a neutral highlight leave the
            picture and add the form.
          */
          "hillshade-exaggeration": 0.35,
          "hillshade-shadow-color": "#0b0b0c",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#5a5a5e",
          // From the north-west, which is where a reader's eye expects light on
          // a map and the convention every relief atlas uses. Anchored to the
          // viewport so turning the map does not turn the sun with it.
          "hillshade-illumination-direction": 315,
          "hillshade-illumination-anchor": "viewport",
        },
      },
      beforeId
    )
  }
}

/**
 * Turns the relief on or off.
 *
 * The lift and the shading move together on purpose: shading without a lift is
 * a picture of relief, and a lift without shading is a shape with no light on
 * it. Neither half alone is what was asked for.
 */
export function setTerrainEnabled(map: MapLibreMap, on: boolean): void {
  if (map.getLayer(HILLSHADE_LAYER)) {
    map.setLayoutProperty(HILLSHADE_LAYER, "visibility", on ? "visible" : "none")
  }
  /*
    Exaggeration 1: the ground at its own height. This is a measuring surface,
    and a vertical stretch would make a slope read steeper than it is -- which
    on a screen where flood extent is judged against terrain is not a matter of
    taste.
  */
  map.setTerrain(on ? { source: DEM_SOURCE, exaggeration: 1 } : null)
}
