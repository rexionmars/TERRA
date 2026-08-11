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

export type BasemapKind = "esri" | "eox" | "osm"

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
    credit: [
      { label: "© EOX", href: "https://cloudless.eox.at" },
      {
        label: "modified Copernicus Sentinel data 2025",
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

/** The library itself, credited on every basemap. */
export const LEAFLET_CREDIT: CreditPart = {
  label: "Leaflet",
  href: "https://leafletjs.com",
}

export function basemapByName(name: string): Basemap {
  return BASEMAPS.find((b) => b.name === name) ?? BASEMAPS[0]
}

export function basemapByKind(kind: BasemapKind): Basemap {
  return BASEMAPS.find((b) => b.kind === kind) ?? BASEMAPS[0]
}
