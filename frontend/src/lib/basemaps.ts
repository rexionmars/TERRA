/**
 * What each basemap requires to be shown, and where it comes from.
 *
 * The credit is a licensing obligation, not chrome: Esri's terms require the
 * source to be attributed and EOX's require the Copernicus notice, with a link
 * where the medium allows one. So the parts are structured rather than an HTML
 * string -- the title bar renders real
 * anchors from this, which keeps the links the obligation asks for without any
 * component having to inject markup it did not write.
 *
 * One table because the tile layers and the credit line are two readers of one
 * fact. They were two strings, and the URL a layer fetched from could have
 * drifted from the source the map claimed to be showing.
 */

import { MOSAIC_MIN_LEVEL, MOSAIC_TILES } from "@/lib/recentImagery"

export type BasemapKind = "esri" | "eox" | "s2recent" | "street" | "topo"

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
   * service point by point -- see components/globe/imageryDate.ts. OSM is a
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
  /*
    THE TWO THAT ARE NOT PHOTOGRAPHS, and the reason they are Esri's.

    Every basemap above is imagery: the reader could choose between two
    pictures of the ground and not between a picture and a drawing. A drawing
    answers a question the photographs cannot -- what a place is CALLED, where
    the road goes, which side of the river a town is on -- and on this
    application's own products it is the one base a classification can be
    checked against by name.

    From the same provider as the imagery, deliberately. It is already
    credited, its licence is already satisfied by that credit, and its tiles
    are the same 256 px scheme, so nothing about the layer stack changes when
    the base does.

    THIS REPLACED A ROW FOR OSM WHICH NOTHING READ. It had been carried since
    the Leaflet map, unreferenced outside this file, and its URL still held the
    `{s}` subdomain placeholder that Leaflet expands and MapLibre does not --
    so the one non-imagery base the table declared could not have drawn a tile
    if it had been wired. Wiring it was the other option and is the one the
    operator's own tile policy argues against: it asks applications not to use
    those servers and to identify themselves when they do.

    NEITHER HAS A HANDOVER. The imagery pair splits at level 12 because Esri's
    World Imagery is a Landsat-derived composite below it; these two are one
    product drawn at every level, so a reader on either sees the same map from
    the planet down to a street.
  */
  {
    kind: "street",
    name: "Streets (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    credit: [{ label: "Tiles © Esri" }],
  },
  {
    kind: "topo",
    name: "Topographic (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    credit: [{ label: "Tiles © Esri" }],
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
