import { useEffect, useMemo, useState } from "react"

import { Crosshair, Trash } from "@/components/icons"
import { Swatch } from "@/components/workspace/nodeParts"
import { btnGhost } from "@/components/ui/buttons"
import {
  FALLBACK_PIXEL_SIZE_M,
  brushFootprint,
  type BrushRadiusPx,
} from "@/lib/boardProbe"
import {
  readPoint,
  type ClassLayer,
  type MapPoint,
  type PointReading,
} from "@/lib/mapProbe"
import type { PredictResult } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PointSpectra, type SpectraPoint } from "@/components/shell/PointSpectra"
import {
  PanelChoices,
  PanelEmpty,
  PanelHeading,
  ShellPanel,
} from "@/components/shell/ShellPanel"

export type PointSlot = "A" | "B"

const RADII: readonly BrushRadiusPx[] = [0, 1, 2, 4]

function PointCard({
  slot,
  point,
  placing,
  readings,
  onPlace,
  onClear,
}: {
  slot: PointSlot
  point: MapPoint | undefined
  placing: boolean
  readings: readonly PointReading[]
  onPlace: () => void
  onClear: () => void
}) {
  return (
    <section className="rounded-sm border border-border p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-label font-semibold text-primary-foreground"
        >
          {slot}
        </span>
        <span className="min-w-0 flex-1 truncate text-read text-foreground tabular-nums">
          {point
            ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
            : `Point ${slot} not placed`}
        </span>
        <button
          type="button"
          aria-pressed={placing}
          onClick={onPlace}
          className={cn(btnGhost, placing && "bg-selected")}
        >
          <Crosshair className="size-3.5" />
          {placing ? "Press the map" : point ? "Move" : "Place"}
        </button>
        {point && (
          <button
            type="button"
            aria-label={`Remove point ${slot}`}
            title="Remove"
            onClick={onClear}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Trash className="size-3.5" />
          </button>
        )}
      </div>
      {point && (
        <dl className="mt-2 flex flex-col gap-1">
          {readings.map((r) => (
            <div key={r.layerId} className="flex items-baseline justify-between gap-3">
              <dt className="truncate text-label text-muted-foreground">{r.title}</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-read text-foreground">
                {r.sample?.entry ? (
                  <>
                    <Swatch color={r.sample.entry.color} />
                    <span className="truncate">{r.sample.entry.name}</span>
                    {r.sample.examined > 1 && (
                      <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                        {r.sample.votes} of {r.sample.examined}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">No class here</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/**
 * Two points on the ground, and what the run says about each.
 *
 * WHAT THE CURVES ARE. A run keeps each class's spectrum, not each pixel's, so
 * these are the mean of the class under the point. Two points on one class draw
 * one curve, and it says nothing about how the two differ on the ground. The
 * figure is captioned so, because a chart beside a pin reads as the pin's own
 * spectrum unless it is told not to.
 */
export function PointsPanel({
  result,
  classLayers,
  points,
  placing,
  onPlacing,
  onClear,
  onClose,
}: {
  result: PredictResult | null
  classLayers: readonly ClassLayer[]
  points: Readonly<Partial<Record<PointSlot, MapPoint>>>
  placing: PointSlot | null
  onPlacing: (slot: PointSlot | null) => void
  onClear: (slot: PointSlot) => void
  onClose: () => void
}) {
  const [radius, setRadius] = useState<BrushRadiusPx>(0)
  const [readings, setReadings] = useState<Partial<Record<PointSlot, PointReading[]>>>(
    {}
  )

  useEffect(() => {
    let live = true
    void (async () => {
      const next: Partial<Record<PointSlot, PointReading[]>> = {}
      for (const slot of ["A", "B"] as const) {
        const p = points[slot]
        if (!p) continue
        try {
          next[slot] = await readPoint(p, classLayers, radius)
        } catch {
          // A raster whose legend does not explain it reads as no class.
          next[slot] = []
        }
      }
      if (live) setReadings(next)
    })()
    return () => {
      live = false
    }
  }, [points, classLayers, radius])

  const pixelSizeM = result?.pixel_size_m || FALLBACK_PIXEL_SIZE_M
  const spectra = result?.class_spectra ?? null

  /*
    A class is a curve once: two points on soybean are one line labelled by the
    first, and the sentence below says so.
  */
  const curves = useMemo<SpectraPoint[]>(() => {
    const out: SpectraPoint[] = []
    for (const slot of ["A", "B"] as const) {
      const id = readings[slot]?.find((r) => r.layerId === "prediction")?.sample?.entry
        ?.id
      if (typeof id === "number" && !out.some((c) => c.classId === id)) {
        out.push({ slot, classId: id })
      }
    }
    return out
  }, [readings])
  const sameClass =
    !!points.A &&
    !!points.B &&
    curves.length === 1 &&
    !!readings.A?.length &&
    !!readings.B?.length
  const nOf = (id: number) => spectra?.points.find((p) => p.class_id === id)?.n_pixels

  return (
    <ShellPanel crumbs={[{ label: "Points" }]} onClose={onClose}>
      {!classLayers.length ? (
        <PanelEmpty title="No class map on the map">
          Points read a class map. Run a classification, or show one under Layers.
        </PanelEmpty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-label text-muted-foreground">
              Read around each point
            </span>
            <PanelChoices
              label="Pixels read around each point"
              value={radius}
              options={RADII.map((r) => {
                const f = brushFootprint(r, pixelSizeM)
                return {
                  id: r,
                  label: r === 0 ? "1 pixel" : `${f.spanM} m`,
                  title: `${f.texels} pixels, ${f.areaHa.toFixed(2)} ha. The class named is their majority.`,
                }
              })}
              onChange={setRadius}
            />
          </div>
          {(["A", "B"] as const).map((slot) => (
            <PointCard
              key={slot}
              slot={slot}
              point={points[slot]}
              placing={placing === slot}
              readings={readings[slot] ?? []}
              onPlace={() => onPlacing(placing === slot ? null : slot)}
              onClear={() => onClear(slot)}
            />
          ))}
          {spectra && curves.length > 0 && (
            <figure className="flex flex-col gap-1.5">
              <PanelHeading>Mean spectrum of each point's class</PanelHeading>
              <PointSpectra spectra={spectra} points={curves} />
              <figcaption className="text-label text-muted-foreground">
                Marks are the mean of every pixel of the class on {spectra.scene_date};
                whiskers run from the 5th to the 95th percentile
                {curves
                  .map((c) => ` (${c.slot}: n = ${nOf(c.classId) ?? "unknown"})`)
                  .join("")}
                . A run keeps no spectrum per pixel, so this is not what the point
                itself reflects.
                {sameClass && " Both points are on one class, so they draw one curve."}
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </ShellPanel>
  )
}
