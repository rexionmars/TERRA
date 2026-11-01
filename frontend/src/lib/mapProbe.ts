/**
 * Reading a class map at a point on the ground.
 *
 * The board's rover read a plane by the texture coordinate under the pointer. On
 * a map the pointer has a longitude and latitude, and what it is over is the
 * raster as it is drawn: MapLibre stretches an image between its corners in Web
 * Mercator, so the northing is taken in that projection. Taken in plain degrees
 * the sample would disagree with the pixel under the pointer, by more the larger
 * the area is.
 */
import type { ClassLegendEntry } from "@/lib/classMask"
import {
  sampleClassAtUv,
  type BrushRadiusPx,
  type ClassProbeSample,
} from "@/lib/boardProbe"
import { cornersOf } from "@/lib/mapLayers"
import type { Bounds } from "@/lib/types"

export interface MapPoint {
  lon: number
  lat: number
}

const mercatorY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Where a point falls on a raster, 0 to 1 from the west and the south, or null outside it. */
export function lonLatToUv(p: MapPoint, e: Bounds): { u: number; v: number } | null {
  /*
    The raster's own axes, from its corners, so a turned one is read as it is
    drawn. The quad is a parallelogram to well under a pixel at any area this
    application reads, so three corners decide the two axes.
  */
  const [tl, tr, , bl] = cornersOf(e).map(([lon, lat]) => [lon, mercatorY(lat)])
  const ax = tr[0] - tl[0]
  const ay = tr[1] - tl[1]
  const bx = bl[0] - tl[0]
  const by = bl[1] - tl[1]
  const px = p.lon - tl[0]
  const py = mercatorY(p.lat) - tl[1]
  const det = ax * by - ay * bx
  const u = (px * by - py * bx) / det
  const down = (ax * py - ay * px) / det
  if (!Number.isFinite(u) || !Number.isFinite(down)) return null
  return u < 0 || u > 1 || down < 0 || down > 1 ? null : { u, v: 1 - down }
}

/** A class raster on the map, and how to invert its colours. */
export interface ClassLayer {
  id: string
  title: string
  uri: string
  extent: Bounds
  legend: readonly ClassLegendEntry[]
}

export interface PointReading {
  layerId: string
  title: string
  /** Null where the point is off the raster, or on a cell with no class. */
  sample: ClassProbeSample | null
}

export async function readPoint(
  point: MapPoint,
  layers: readonly ClassLayer[],
  radius: BrushRadiusPx
): Promise<PointReading[]> {
  return Promise.all(
    layers.map(async (l) => {
      const at = lonLatToUv(point, l.extent)
      const sample = at
        ? await sampleClassAtUv(l.uri, l.legend, at.u, at.v, radius)
        : null
      return { layerId: l.id, title: l.title, sample: sample?.entry ? sample : null }
    })
  )
}
