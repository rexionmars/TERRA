/**
 * The brush rover, with room to say what it read.
 *
 * The rover has existed for a while and has never had a surface of its own: it
 * lived as a 14rem block inside the prediction readout, where a size control, a
 * class name and a neighbour count competed for one column. What it could not
 * say there is everything a reader wants after pointing at a pixel -- where the
 * pixel is, how much ground it covers, how firm the label is, and what that
 * class reflects.
 *
 * The last of those is why this belongs beside the spectral editor rather than
 * under a map. A prediction is a label; the spectrum is the measurement the
 * label was inferred from. Pointing at a pixel and reading both at once is the
 * check that a class means what its name says.
 *
 * TARGETS THE SELECTION, like every other editor here. `detailFocus` in
 * BoardSurface already walks the selection for the last prediction layer, so
 * this needs no target of its own -- it is handed the same sample the board is
 * already taking.
 */
import type { Bounds, ClassSpectra, PredictResult } from "@/lib/types"
import type { BrushRadiusPx, ClassProbeSample } from "@/lib/boardProbe"
import { FALLBACK_PIXEL_SIZE_M, brushFootprint, uvToTexel } from "@/lib/boardProbe"
import type { ThemeName } from "@/lib/contrast"
import { chartGround, legibleOn } from "@/lib/seriesColor"
import { figureStyle, linearScale } from "@/lib/figure"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

/** The inline spectrum's own geometry, in the same units-are-pixels system. */
const SPARK = { w: 260, h: 62, pad: { top: 6, right: 4, bottom: 14, left: 30 } }

export interface BrushEditorProps {
  on: boolean
  onOnChange: (on: boolean) => void
  radius: BrushRadiusPx
  onRadiusChange: (r: BrushRadiusPx) => void
  /** The run behind the plane being probed, or null when none is selected. */
  result: PredictResult | null
  /** Null when the brush is off or the pointer is not over the plane. */
  sample: ClassProbeSample | null
  /** Where the pointer is on the plane, for the coordinate readout. */
  uv: { u: number; v: number } | null
  /**
   * Why the rover cannot run, when it cannot.
   *
   * The board refuses to arm a probe while two predictions are picked, because
   * the selection is then a comparison and there is no single plane to read.
   * Without this the editor waits for a sample that will never arrive, which
   * is indistinguishable from being broken.
   */
  blockedBy?: string | null
}

function coordinate(
  uv: { u: number; v: number },
  sample: ClassProbeSample,
  extent: Bounds
): { texel: { x: number; y: number }; lon: number; lat: number } {
  const texel = uvToTexel(uv.u, uv.v, sample.mapWidth, sample.mapHeight)
  // The pixel's centre, not its corner: a pixel is an area, and its coordinate
  // is the middle of the ground it covers.
  const lon =
    extent.lon_min +
    ((texel.x + 0.5) / sample.mapWidth) * (extent.lon_max - extent.lon_min)
  const lat =
    extent.lat_max -
    ((texel.y + 0.5) / sample.mapHeight) * (extent.lat_max - extent.lat_min)
  return { texel, lon, lat }
}

/** The sampled class's own spectrum, drawn small, from the run's own figures. */
function Spectrum({
  spectra,
  classId,
  stroke,
}: {
  spectra: ClassSpectra
  classId: number
  stroke: string
}) {
  const points = spectra.points
    .filter((p) => p.class_id === classId)
    .sort((a, b) => a.wavelength_nm - b.wavelength_nm)
  if (points.length < 2) return null

  const yMax = Math.max(...points.map((p) => p.mean))
  const yMin = Math.min(0, ...points.map((p) => p.mean))
  const x = linearScale([400, 2300], [SPARK.pad.left, SPARK.w - SPARK.pad.right])
  const y = linearScale([yMin, yMax], [SPARK.h - SPARK.pad.bottom, SPARK.pad.top])

  return (
    <svg
      viewBox={`0 0 ${SPARK.w} ${SPARK.h}`}
      style={figureStyle(SPARK.w)}
      role="img"
      aria-label="Mean reflectance of the sampled class, by band"
    >
      <path
        d={`M${SPARK.pad.left},${SPARK.pad.top} L${SPARK.pad.left},${SPARK.h - SPARK.pad.bottom} L${SPARK.w - SPARK.pad.right},${SPARK.h - SPARK.pad.bottom}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth={0.75}
      />
      {[yMin, yMax].map((v) => (
        <text
          key={v}
          x={SPARK.pad.left - 3}
          y={y(v)}
          fontSize={8}
          fill="var(--muted-foreground)"
          textAnchor="end"
          dominantBaseline="middle"
        >
          {v.toFixed(2)}
        </text>
      ))}
      <polyline
        points={points.map((p) => `${x(p.wavelength_nm)},${y(p.mean)}`).join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {points.map((p) => (
        <g key={p.band}>
          <circle cx={x(p.wavelength_nm)} cy={y(p.mean)} r={1.6} fill={stroke} />
          {/* Only the ends are labelled: seven labels at this width collide. */}
          {(p.band === points[0].band ||
            p.band === points[points.length - 1].band) && (
            <text
              x={x(p.wavelength_nm)}
              y={SPARK.h - 4}
              fontSize={8}
              fill="var(--muted-foreground)"
              textAnchor="middle"
            >
              {p.band}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

export function BrushEditor({
  on,
  onOnChange,
  radius,
  onRadiusChange,
  result,
  sample,
  uv,
  blockedBy,
}: BrushEditorProps) {
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"
  const pixelSizeM = result?.pixel_size_m || FALLBACK_PIXEL_SIZE_M
  const footprint = brushFootprint(radius, pixelSizeM)
  const spectra = result?.class_spectra ?? null
  const stat = sample?.entry
    ? result?.class_stats?.find((c) => c.class_id === sample.entry!.id)
    : undefined
  const where =
    sample && uv && result?.extent ? coordinate(uv, sample, result.extent) : null

  if (!result) {
    return (
      <p className="flex h-full items-center justify-center px-4 text-center text-meta text-muted-foreground">
        Select a prediction plane in the outliner. The rover reads the plane the
        selection points at, the same one the readouts describe.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: "rgb(var(--p-line) / 0.22)" }}
      >
        <button
          type="button"
          onClick={() => onOnChange(!on)}
          className={cn(
            "rounded-sm px-2 py-0.5 text-meta transition-colors",
            on
              ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
              : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
          )}
        >
          {on ? "Rover on" : "Rover off"}
        </button>
        {/*
          Sized in metres, off the run's own grid. What a reader asks of a
          prediction is whether it holds over a field, and a field is ground.
        */}
        <div className="flex gap-0.5">
          {([0, 1, 2, 4] as const).map((r) => {
            const fp = brushFootprint(r, pixelSizeM)
            return (
              <button
                key={r}
                type="button"
                onClick={() => onRadiusChange(r)}
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-meta transition-colors",
                  radius === r
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:bg-surface-raised/40"
                )}
                title={
                  r === 0
                    ? `One predicted pixel · ${fp.areaHa.toFixed(2)} ha`
                    : `Majority over ${fp.texels} pixels · ${fp.areaHa.toFixed(2)} ha`
                }
              >
                {fp.spanM} m
              </button>
            )
          })}
        </div>
        <span className="telemetry ml-auto text-meta text-muted-foreground">
          {footprint.texels} px · {footprint.areaHa.toFixed(2)} ha ·{" "}
          {pixelSizeM} m grid
        </span>
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-auto p-2">
        {blockedBy ? (
          <p className="text-meta text-muted-foreground">{blockedBy}</p>
        ) : !on ? (
          <p className="text-meta text-muted-foreground">
            Turn the rover on, then move over the prediction plane. Each sample
            is the majority class over the disc above, with the spectrum that
            class was measured at on the run&rsquo;s reference acquisition.
          </p>
        ) : !sample?.entry ? (
          <p className="text-meta text-muted-foreground">
            {sample
              ? "Outside the classified area."
              : "Move the rover over the prediction plane."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 size-3.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: sample.entry.color }}
              />
              <div className="min-w-0">
                <p className="text-body text-foreground">{sample.entry.name}</p>
                <p className="telemetry text-meta text-muted-foreground">
                  {sample.examined > 1
                    ? `${sample.votes} of ${sample.examined} pixels agree`
                    : "one pixel, no vote"}
                  {stat ? ` · class is ${stat.pct.toFixed(1)}% of the AOI` : ""}
                </p>
              </div>
            </div>

            {/*
              Where the sample is. A rover with no coordinate cannot be checked
              against anything outside the application, which is most of what a
              reader would want to do with a suspicious pixel.
            */}
            {where && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-meta">
                <dt className="text-muted-foreground">Pixel</dt>
                <dd className="telemetry">
                  col {where.texel.x}, row {where.texel.y} of {sample.mapWidth}×
                  {sample.mapHeight}
                </dd>
                <dt className="text-muted-foreground">Centre</dt>
                <dd className="telemetry">
                  {where.lat.toFixed(5)}, {where.lon.toFixed(5)}
                </dd>
                <dt className="text-muted-foreground">Covers</dt>
                <dd className="telemetry">
                  {footprint.spanM} m across · {footprint.areaHa.toFixed(2)} ha
                </dd>
              </dl>
            )}

            {/*
              The measurement behind the label. A prediction is a name; this is
              what the sensor read for every pixel the model gave that name to,
              so a class whose curve does not look like what it claims to be is
              visible here and nowhere else in the studio.
            */}
            {spectra ? (
              <div>
                <p className="eyebrow mb-1 !text-[9px]">
                  Class spectrum · {spectra.scene_date}
                </p>
                <Spectrum
                  spectra={spectra}
                  classId={sample.entry.id}
                  stroke={legibleOn(sample.entry.color, chartGround(theme))}
                />
                <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
                  The mean over every pixel of this class, not of the sample
                  under the rover. One acquisition of {spectra.n_scenes}.
                </p>
              </div>
            ) : (
              <p className="text-meta text-muted-foreground">
                This run carries no spectral response, so the class has no
                measured curve to show.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
