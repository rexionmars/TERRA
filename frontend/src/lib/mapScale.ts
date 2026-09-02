/**
 * The two numbers a zoom is, and the conversion between them.
 *
 * THE READOUT'S z IS NOT THE LEVEL BEING FETCHED. MapLibre defines zoom
 * against a 512 px tile, every raster source in this application serves 256,
 * and the library resolves that in `coveringZoomLevel`:
 *
 *   z = round(map.zoom + log2(transform.tileSize / source.tileSize))
 *
 * which with 512 over 256 is the map's zoom plus one. Measured in the running
 * application: at map zoom 13.49 the tiles on the wire were level 14.
 *
 * It matters because the services state their own limits in LEVELS. Esri's
 * identify gives MinMapLevel 12 and a MaxMapLevel per footprint; the mosaic
 * and s2cloudless publish level ceilings too. Comparing those against the
 * map's zoom reads every limit one level too high -- it says high-resolution
 * imagery has not started when it has, and that a picture is magnified when it
 * is not.
 *
 * So the rule is: a service's number is a LEVEL, the readout's number is a
 * ZOOM, and nothing compares one to the other without passing through here.
 */

/**
 * How much wider MapLibre's own tile is than the ones these sources serve.
 *
 * One level, written as the log rather than as the literal 1 so the reason
 * survives: it is the same expression the library evaluates.
 */
const LEVEL_OFFSET = Math.log2(512 / 256)

/** The tile level MapLibre asks for at this zoom. */
export function tileLevel(zoom: number): number {
  return Math.max(0, Math.round(zoom + LEVEL_OFFSET))
}

/**
 * The zoom at which a level is the one being fetched.
 *
 * For putting a service's limit back into the reader's units: a footprint that
 * ends at level 17 stops sharpening at zoom 16, and 16 is the number on
 * screen.
 */
export function zoomOfLevel(level: number): number {
  return level - LEVEL_OFFSET
}

/**
 * The ground one CSS pixel covers at this zoom and latitude, in metres.
 *
 * THE FIGURE THAT DOES NOT DEPEND ON A CONVENTION. Web Mercator's scale is
 * 40075016.686 m around the equator over a world that is 512 * 2^zoom pixels
 * wide in MapLibre's units, narrowed by the cosine of the latitude. Where a z
 * has to be explained, this can be compared against the imagery itself: 10 m
 * Sentinel-2 is at its own scale while this reads 10 or more, and is being
 * magnified below that.
 */
export function metresPerPixel(zoom: number, lat: number): number {
  const EQUATOR_M = 40075016.686
  return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}
