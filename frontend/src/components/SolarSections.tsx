/**
 * The three solar result sections, as shown on screen.
 *
 * These are the blocks whose figures each carry the assumption that produced
 * them: the ramp drawn on the sidecar's scale rather than the layer's own
 * range, the beam share behind the shading figure, and the siting thresholds
 * being project conventions.
 *
 * Each takes only the payload it renders, so none of them can read page state.
 *
 * NONE OF THEM DRAWS ITS OWN HEADING. Each used to open with a `ReadingBlock`
 * naming the product, and the panel hosting it named the product again a few
 * hundred pixels below -- "Irradiation over terrain" twice on one screen, and
 * for the resource under two different names at once, "Solar resource" here
 * and "Resource at the AOI centroid" on the panel. The heading, the provenance
 * meta and the four headline figures are stated once by the host; see
 * components/energy/readingSections.tsx. A section renders its body.
 *
 * Every grid here measures the CONTAINER, not the window. These sections were
 * authored for a full-width page column and their breakpoints were `sm:`/`lg:`,
 * which read the viewport: hosted in a 40rem panel on a 1600px screen they
 * still took the four-column layout their content needs 45rem for, so the
 * reading came out cramped and sparse at the same time. A section that follows
 * the box it is in needs no tuning when that box is resized.
 */
import type {
  SolarAnalysis,
  SolarSitingAnalysis,
  SolarTerrainAnalysis,
} from "@/lib/types"
import {
  ContinuousRamp,
  PanelTile,
  PowerProvenanceNote,
  WaterFigure,
} from "@/components/analysisPrimitives"
import {
  CoverChipList,
  SkyViewFigures,
} from "@/components/solar/SolarDetailFigures"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Label,
} from "recharts"

/**
 * The point solar resource.
 *
 * Needs no scene, so it can be the only product a run carries. Every figure is
 * shown with the assumption behind it.
 */
export function SolarResourceSection({ solar }: { solar: SolarAnalysis }) {
  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={solar.resource.monthly.map((m) => ({
            month: String(m.month).padStart(2, "0"),
            ghi: m.ghi,
            dni: m.dni,
            dhi: m.dhi,
          }))}
          margin={{ top: 6, right: 14, left: 4, bottom: 22 }}
        >
          {/*
            The month axis stays categorical, and that is correct here: this is
            a twelve-value climatology on evenly spaced months, not an
            irregular acquisition calendar. The index charts had to move to a
            numeric time axis for exactly the opposite reason.
          */}
          <XAxis
            dataKey="month"
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickMargin={6}
          >
            <Label
              value="Month"
              position="insideBottom"
              offset={-14}
              style={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            />
          </XAxis>
          <YAxis
            stroke="var(--border)"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(v: number) => v.toFixed(1)}
            width={52}
          >
            {/* The unit was in a caption below the chart. Nature requires it on
                the axis, and a reader reading a value should not have to look
                somewhere else to know what it is. */}
            <Label
              value="Irradiation (kWh m⁻² d⁻¹)"
              angle={-90}
              position="insideLeft"
              style={{
                fontSize: 12,
                fill: "var(--muted-foreground)",
                textAnchor: "middle",
              }}
            />
          </YAxis>
          <Tooltip
            formatter={(v: number) => v.toFixed(2)}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontSize: 11,
            }}
          />
          {/* Above the plot: a bottom legend shares the band the axis title
              occupies, and "Month" was drawn through the series keys. */}
          <Legend
            verticalAlign="top"
            align="right"
            height={20}
            wrapperStyle={{ fontSize: 11, paddingBottom: 2 }}
            iconType="plainline"
          />
          {/* The verified triple, and a dash each: GHI, DNI and DHI are not
              independent -- GHI is the sum of DHI and the projected DNI -- so
              they are read together and have to stay separable in greyscale. */}
          {[
            { key: "ghi", label: "GHI", stroke: "var(--series-ndvi)", dash: undefined },
            { key: "dni", label: "DNI", stroke: "var(--series-evi)", dash: "6 3" },
            { key: "dhi", label: "DHI", stroke: "var(--series-savi)", dash: "2 3" },
          ].map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.stroke}
              strokeWidth={1.8}
              strokeDasharray={s.dash}
              dot={{ r: 1.8, strokeWidth: 0, fill: s.stroke }}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {/*
        The four headline figures were here AND in the panel strip above, at
        two roundings and two wordings of the same subs -- "+3.4% over flat"
        against "3.4% over horizontal" for one number. They are now stated once,
        by headlineFigures.ts, in the band this block scrolls under.
      */}

      {solar.geometry.tilt_tolerance.length > 0 && (
        <p className="mt-3 text-body leading-relaxed text-muted-foreground">
          Tilt tolerance:{" "}
          {solar.geometry.tilt_tolerance
            .map(
              (t) =>
                `${t.deviation_deg.toFixed(0)}° costs ${t.loss_pct.toFixed(2)}%`
            )
            .join(" · ")}
        </p>
      )}

      {/*
        The grid cell, kept where the paragraph about it was removed: two AOIs
        tens of kilometres apart resolve to one radiation cell and return the
        same series, so identical numbers would otherwise have no explanation.
      */}
      <div className="mt-2 text-meta text-muted-foreground">
        <p className="telemetry">1° radiation cell, not site-specific</p>
        <PowerProvenanceNote provenance={solar.power_provenance} />
      </div>
    </>
  )
}

/**
 * What the ramp's endpoints are the endpoints OF.
 *
 * Three answers and they are not interchangeable: a fixed domain is comparable
 * between runs, a shared one is wider than this layer and drawn so the pair can
 * be compared, and a layer's own range fills the ramp regardless of how narrow
 * the spread actually is. Saying the wrong one turns a 1.2% spread into an
 * image that looks like a strong gradient, or the reverse.
 */
function scaleBasisNote(scale: SolarTerrainAnalysis["scale"]): string {
  if (scale.basis === "fixed") {
    return "Fixed domain · comparable with other runs of this layer"
  }
  if (scale.basis === "shared" && scale.shared_with) {
    return `Domain shared with the ${scale.shared_with} layer · wider than this layer's own range`
  }
  return "Domain is this layer's own range · contrast is relative, not absolute"
}

/**
 * Terrain irradiation: the raster, its ramp and the figures over the area.
 *
 * ONE NAME FOR THIS PRODUCT. The heading read "Terrain irradiation · annual"
 * while the panel that framed it read "Irradiation over terrain" -- the same
 * two words in the other order, both uppercase, both on screen at once. The
 * selector, the run button and the status panel all take the name from
 * solarProducts, so this takes it too, and the season moves to the meta line
 * beside the rest of the provenance.
 */
export function SolarTerrainSection({
  terrain,
}: {
  terrain: SolarTerrainAnalysis
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 @min-[31rem]:grid-cols-2">
        <div>
          <PanelTile
            title={`Plane-of-array · ${terrain.unit}`}
            uri={terrain.overlay_uri}
            empty="No terrain raster"
          />
          {/* Endpoints come from the scale the sidecar drew on, not
              from this layer's own range: a seasonal layer shares its
              domain with the other season and is narrower than it. */}
          <ContinuousRamp
            palette={terrain.scale.palette}
            lowLabel={terrain.scale.min.toFixed(
              terrain.scale.decimals
            )}
            highLabel={terrain.scale.max.toFixed(
              terrain.scale.decimals
            )}
          />
          {/*
            WHICH domain, read from the payload rather than asserted.

            The status panel used to print "drawn on the scale reported with
            the raster, not on this layer's own range" under every terrain
            result. `render_scale` shares a domain only between winter and
            summer (sidecar/solar.py, SEASON_PAIR); for annual it returns
            basis "own", so the sentence denied exactly what the endpoints
            showed -- 1366 and 1607 beside figures reading Minimum 1366 and
            Maximum 1607. The payload has carried `basis` and `shared_with`
            for this the whole time and nothing read them.

            It also belongs here and not in the summary strip: it describes
            how the ramp two lines above was drawn, and the strip is on screen
            when no raster and no ramp are.
          */}
          <p className="mt-1 text-meta text-muted-foreground">
            {scaleBasisNote(terrain.scale)}
          </p>
        </div>
        {/*
          Minimum, Mean, Maximum and Spatial spread are NOT here. They are the
          product's headline and are stated once, in the band this block
          scrolls under -- they used to be printed in both places, about 400px
          apart, under character-identical labels and in two different orders.
          What remains is what the headline does not carry.
        */}
        <div className="grid grid-cols-2 gap-3 self-start">
          <WaterFigure
            label="Mean slope"
            value={`${terrain.slope_mean_deg.toFixed(1)}°`}
            sub={`max ${terrain.slope_max_deg.toFixed(1)}°`}
          />
          {terrain.shading_mean_pct !== null && (
            <WaterFigure
              label="Horizon shading"
              value={`${terrain.shading_mean_pct.toFixed(2)}%`}
              sub={
                terrain.shading_max_pct !== null
                  ? `max ${terrain.shading_max_pct.toFixed(1)}% of beam`
                  : "of beam irradiance"
              }
            />
          )}
        </div>
      </div>
      {/* The beam share as a figure. It was a paragraph explaining that the
          atmospheric resource has no structure at this scale and that what
          varies is the inclined surface -- method, and the same sentence for
          every AOI. The number it ended on is what changes. */}
      {terrain.beam_fraction > 0 && (
        <p className="mt-3 text-meta text-muted-foreground">
          <span className="telemetry">
            Beam share {(terrain.beam_fraction * 100).toFixed(0)}%
          </span>{" "}
          of horizontal irradiation · horizon shading applies to this component
        </p>
      )}
      {terrain.sky_view && (
        <div className="mt-3">
          <SkyViewFigures sky={terrain.sky_view} />
        </div>
      )}
      <PowerProvenanceNote
        provenance={terrain.power_provenance}
      />
    </>
  )
}

/** Photovoltaic siting: the class raster, the two areas and the class list. */
export function SolarSitingSection({
  siting,
}: {
  siting: SolarSitingAnalysis
}) {
  return (
    <>
      {/* Full-width, like the water occurrence tile: a 4:3 box across a whole
          panel runs off the bottom of the window on a wide screen. */}
      <PanelTile
        title="Suitability classes"
        uri={siting.overlay_uri}
        empty="No siting raster"
        fullWidth
      />
      {/* The two areas are the product's headline and are stated once, in the
          band above. The class list is what this block is for. */}
      <ul className="mt-3 flex flex-col gap-1.5">
        {siting.classes.map((c) => (
          <li key={c.code} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: c.color }}
            />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="telemetry w-20 shrink-0 text-right">
              {c.area_ha.toFixed(1)} ha
            </span>
            <span className="telemetry w-12 shrink-0 text-right text-muted-foreground">
              {c.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      {/* The thresholds as figures, and the one thing the classes do not
          account for -- without it "suitable" reads as permitted. */}
      <p className="mt-3 text-meta text-muted-foreground">
        <span className="telemetry">
          Slope limits {siting.thresholds.slope_acceptable_deg}° /{" "}
          {siting.thresholds.slope_restrictive_deg}°
        </span>{" "}
        · legal constraints not checked
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <CoverChipList
          label="Excluded cover"
          codes={siting.thresholds.excluded_cover}
        />
        <CoverChipList
          label="Cropland cover"
          codes={siting.thresholds.cropland_cover}
        />
      </div>
    </>
  )
}
