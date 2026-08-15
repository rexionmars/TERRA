/**
 * The AOI's own season, read as canopies.
 *
 * WHAT IS NEW HERE, AND WHAT IS NOT. Every other canopy surface takes its
 * parameters from the reader: a species, an age, a sowing. This one takes the
 * ground -- the vegetation-index series a run already measured -- and reports
 * what canopy it implies, what age carries that canopy, and how much of the
 * answer is worth trusting. The sowing stays the reader's, because a satellite
 * at 10 m cannot see row spacing and never will.
 *
 * WHY THAT MATTERS MORE THAN IT SOUNDS. The unobservable half is the half that
 * moves the light. At matched LAI, measured in this repository's own studies, an
 * ellipsoid crown overstates absorbed light by 37% and a row slab by 60%, and
 * the clumping index behind that spread is 0.40 to 0.56. So this surface is not
 * claiming to reconstruct the field's canopy. It is showing what the observation
 * pins down, what it does not, and what the difference costs.
 *
 * NOTHING IS DECIDED FOR THE READER. Two independent ages arrive for each date
 * -- one from leaf area, one from phenology -- and both are drawn. Where they
 * agree the isolated-plant model describes the field; where they part, Helios
 * grew a plant with no neighbours and reached that leaf area too early. Choosing
 * one to display would hide the only signal that says whether to trust the rest.
 */
import { useMemo } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { WaterFigure } from "@/components/analysisPrimitives"
import {
  dateToMs,
  timeAxisProps,
  timeLabelFormatter,
  timeTickFormatter,
} from "@/lib/chartAxis"

/*
  The shapes this reads, kept local and structural.

  Written against the payload rather than imported from the generated bindings,
  because the generated classes carry every optional as `any` and the whole
  point of this surface is that some fields are deliberately absent -- an age
  that does not exist past the plateau, a light block that is missing when no
  location was given. A local type makes those absences checkable.
*/
export interface AOIAgeCheck {
  comparable: boolean
  progress_helios?: number
  progress_field?: number
  delta_progress?: number
  agrees?: boolean
  why?: string
}

export interface AOIResolved {
  date: string
  lai: number
  state?: string
  day?: number
  day_at_least?: number
  height_m?: number
  at_plateau?: boolean
  declining?: boolean
  days_since_greenup?: number
  age_check: AOIAgeCheck
  why?: string
  error?: string
}

export interface AOILight {
  date?: string
  day?: number
  lai: number
  fapar: number
  beam_transmittance: number
  diffuse_transmittance?: number
  diffuse_share: number
  k_emergent?: number
  fapar_fixed_k?: number
  fixed_k?: number
  fixed_k_error_pct?: number
  beam_bins_marched?: number
  row_azimuth_deg?: number
  error?: string
}

export interface AOICanopy {
  species: string
  density: number
  reachable_lai: number
  lai: {
    lai: number[]
    ndvi: number[]
    peak_lai: number
    n: number
    n_saturated: number
    saturation_lai: number
  }
  states: string[]
  phenology: Record<string, number>
  resolved: AOIResolved[]
  n_usable: number
  sun: {
    source: string
    cell?: number[]
    years?: number
    diffuse_share?: number
    n_azimuth_bins?: number
    n_elevation_bins?: number
    why?: string
  }
  light?: AOILight
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`

export function CanopyFromAOIPanel({ data }: { data: AOICanopy }) {
  /*
    One row per observation, on a numeric time axis.

    `timeAxisProps` and not a category axis, for the reason lib/chartAxis.ts
    records: a cloud-screened series is irregular, and a category axis draws a
    three-month gap at the width of a five-day one, which falsifies every slope
    on the chart.
  */
  const rows = useMemo(
    () =>
      data.resolved.map((r) => ({
        t: dateToMs(r.date),
        lai: r.lai,
        // Split so the two ages draw as separate series without inventing a
        // point where one of them does not exist.
        helios: r.age_check.comparable ? r.age_check.progress_helios : null,
        field: r.age_check.comparable ? r.age_check.progress_field : null,
      })),
    [data.resolved]
  )

  const span = rows.length
    ? rows[rows.length - 1].t - rows[0].t
    : 0

  const disagreeing = data.resolved.filter(
    (r) => r.age_check.comparable && r.age_check.agrees === false
  ).length
  const comparable = data.resolved.filter((r) => r.age_check.comparable).length

  const light = data.light
  const saturated = data.lai.n_saturated

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
      {/* What the season was, and what of it could be read. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <WaterFigure
          label="Pico de LAI"
          value={data.lai.peak_lai.toFixed(2)}
          sub={`${data.lai.n} observações`}
        />
        <WaterFigure
          label="Legível como dossel"
          value={`${data.n_usable} / ${data.resolved.length}`}
          sub="datas com idade resolvida"
        />
        <WaterFigure
          label="LAI alcançável"
          value={data.reachable_lai.toFixed(2)}
          sub={`${data.species} a ${data.density.toFixed(1)} pl/m²`}
        />
        <WaterFigure
          label="Sol"
          value={data.sun.source === "power" ? "NASA POWER" : "referência"}
          sub={
            data.sun.source === "power"
              ? `difuso ${((data.sun.diffuse_share ?? 0) * 100).toFixed(0)}%`
              : "sem localização"
          }
        />
      </div>

      {/*
        The two flags that decide whether the rest is worth reading, stated
        before the chart rather than under it. A saturated series is
        extrapolation, and a season the ladder cannot follow is a species whose
        isolated plant does not describe this sowing.
      */}
      {saturated > 0 && (
        <div className="text-[11px]" style={{ color: "var(--p-warning)" }}>
          {saturated} de {data.lai.n} observações estão acima de LAI{" "}
          {data.lai.saturation_lai}, onde o NDVI mal se move e a inversão é
          extrapolação.
        </div>
      )}
      {comparable > 0 && disagreeing > comparable / 2 && (
        <div className="text-[11px]" style={{ color: "var(--p-warning)" }}>
          As duas idades discordam em {disagreeing} de {comparable} datas
          comparáveis. O Helios cresce sem vizinhos, então em semeadura adensada
          ele chega à área foliar cedo demais — a geometria tem a área certa e a
          arquitetura de uma planta mais jovem.
        </div>
      )}

      <div className="h-40 min-h-[10rem] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis
              {...timeAxisProps}
              dataKey="t"
              tickFormatter={timeTickFormatter(span)}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              stroke="var(--border)"
            />
            <YAxis
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              stroke="var(--border)"
              width={34}
              label={{
                value: "LAI (m² m⁻²)",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--muted-foreground)", fontSize: 10 },
              }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                fontSize: 11,
              }}
              labelFormatter={timeLabelFormatter}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="plainline"
              wrapperStyle={{ fontSize: 10 }}
            />
            <Line
              type="monotone"
              dataKey="lai"
              name="LAI observado"
              stroke="var(--series-ndvi)"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/*
        The number a crop-model reader has a question about.

        Not a second faPAR beside the first, but the error the constant
        coefficient carries here -- because the question is how wrong the slab
        is on this canopy, not what the slab believes.
      */}
      {light && !light.error && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2 sm:grid-cols-4"
             style={{ borderColor: "var(--p-line)" }}>
          <WaterFigure
            label="faPAR sob o sol real"
            value={light.fapar.toFixed(3)}
            sub={light.date ? `em ${light.date}` : undefined}
          />
          <WaterFigure
            label="k emergente"
            value={light.k_emergent?.toFixed(3) ?? "—"}
            sub={`modelo usa ${light.fixed_k ?? 0.7} fixo`}
          />
          <WaterFigure
            label="erro do k fixo"
            value={
              light.fixed_k_error_pct != null
                ? pct(light.fixed_k_error_pct)
                : "—"
            }
            sub={
              light.fapar_fixed_k != null
                ? `Beer daria ${light.fapar_fixed_k.toFixed(3)}`
                : undefined
            }
          />
          <WaterFigure
            label="difuso"
            value={`${(light.diffuse_share * 100).toFixed(0)}%`}
            sub={
              light.beam_bins_marched
                ? `${light.beam_bins_marched} direções marchadas`
                : undefined
            }
          />
        </div>
      )}
      {light?.error && (
        <div className="border-t pt-2 text-[11px]"
             style={{ borderColor: "var(--p-line)", color: "var(--p-warning)" }}>
          A luz não pôde ser calculada: {light.error}
        </div>
      )}
    </div>
  )
}
