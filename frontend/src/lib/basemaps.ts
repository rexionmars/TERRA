/**
 * What each basemap requires to be shown, and where it comes from.
 *
 * The credit is a licensing obligation, not chrome: Esri's terms require the
 * source to be attributed, EOX's require the Copernicus notice, and OSM's ODbL
 * requires attribution with a link where the medium allows one. So the parts
 * are structured rather than an HTML string -- the title bar renders real
 * anchors from this, which keeps the links the obligation asks for without any
 * component having to inject markup it did not write.
 *
 * One table because the tile layers and the credit line are two readers of one
 * fact. They were two strings, and the URL a layer fetched from could have
 * drifted from the source the map claimed to be showing.
 */

import { MOSAIC_MIN_LEVEL, MOSAIC_TILES } from "@/lib/recentImagery"

export type BasemapKind = "esri" | "eox" | "s2recent" | "osm"

export interface CreditPart {
  label: string
  /** Present where the licence asks the attribution to be reachable. */
  href?: string
}

export interface Basemap {
  kind: BasemapKind
  /** The name the layers control shows, and the one an event reports back. */
  name: string
  url: string
  maxZoom: number
  maxNativeZoom?: number
  credit: readonly CreditPart[]
  /**
   * When this imagery was taken, where the product states it once for the
   * whole world.
   *
   * s2cloudless is a single mosaic of a named year, so its date is a property
   * of the basemap and belongs beside the URL that fetches it -- the year was
   * written out in four places, and a table whose layers and credit line are
   * two readers of one fact should hold it too. Esri's date is not this kind
   * of fact: it is per footprint and per level, and has to be asked of the
   * service point by point -- see components/map/imageryDate.ts. OSM is a
   * drawing rather than an acquisition. Absent means the date is not something
   * this table can answer.
   */
  imageryDate?: string
  /**
   * The shallowest LEVEL this basemap can be drawn at, where it has one.
   *
   * The recent Sentinel-2 mosaic is composed on demand and the service refuses
   * to compose one below level 9, so a surface offering it has to draw
   * something else under the zoom that asks for it -- which is not the same
   * number; see lib/mapScale.ts. Absent means the basemap covers the world at
   * every zoom, which is true of the other three.
   */
  minLevel?: number
}

export const BASEMAPS: readonly Basemap[] = [
  {
    kind: "esri",
    name: "Satellite (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    credit: [{ label: "Tiles © Esri" }],
  },
  {
    kind: "eox",
    name: "Sentinel-2 2025 (EOX)",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg",
    maxNativeZoom: 14,
    maxZoom: 19,
    imageryDate: "2025",
    credit: [
      { label: "© EOX", href: "https://cloudless.eox.at" },
      {
        label: "modified Copernicus Sentinel data 2025",
        href: "https://sentinel.esa.int/web/sentinel/user-guides/sentinel-2-msi",
      },
    ],
  },
  /*
    THE SECOND OPINION, for where the Esri footprint is old. Its own module
    carries the search, the pinned mosaic id and the measurements behind the
    choice; this row is only what the map and the credit need to know about it.
  */
  {
    kind: "s2recent",
    name: "Sentinel-2 recent (Planetary Computer)",
    url: MOSAIC_TILES,
    minLevel: MOSAIC_MIN_LEVEL,
    // 10 m is about z14 at these latitudes. The service answers past it by
    // magnifying its own pixels, which is the same picture at more bytes.
    maxNativeZoom: 14,
    maxZoom: 19,
    credit: [
      {
        label: "Microsoft Planetary Computer",
        href: "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a",
      },
      {
        label: "modified Copernicus Sentinel data",
        href: "https://sentinel.esa.int/web/sentinel/user-guides/sentinel-2-msi",
      },
    ],
  },
  {
    kind: "osm",
    name: "Map (OSM)",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    credit: [
      {
        label: "© OpenStreetMap",
        href: "https://www.openstreetmap.org/copyright",
      },
    ],
  },
]

/**
 * The library itself, credited on every basemap.
 *
 * One constant, again: there were two while the migration ran, because a credit
 * has to name the library that actually drew the map and for a while two of
 * them did. Every map in the application is MapLibre now.
 */
export const MAPLIBRE_CREDIT: CreditPart = {
  label: "MapLibre",
  href: "https://maplibre.org",
}

export function basemapByName(name: string): Basemap {
  return BASEMAPS.find((b) => b.name === name) ?? BASEMAPS[0]
}

export function basemapByKind(kind: BasemapKind): Basemap {
  return BASEMAPS.find((b) => b.kind === kind) ?? BASEMAPS[0]
}
