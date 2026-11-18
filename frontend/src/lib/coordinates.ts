/**
 * A place on the map written as text to paste elsewhere.
 *
 * LATITUDE FIRST, then longitude, in decimal degrees on WGS 84, separated by a
 * comma and a space: the order of ISO 6709 and the form a search box in Google
 * Maps, Google Earth or QGIS's coordinate locator reads as it is. Six decimal
 * places, about 0.1 m on the ground, finer than anything the map can be
 * pressed at.
 */
export function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
}
