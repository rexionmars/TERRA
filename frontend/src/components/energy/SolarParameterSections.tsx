/**
 * The parameters of the selected photovoltaic product, and only those.
 *
 * Which groups appear is read from the product table, so the panel cannot show
 * a control the selected product does not send. The groups are named after what
 * they configure rather than after a product, because two of them are consumed
 * by more than one: SolarParams holds one climatology period and one pair of
 * slope limits for the whole axis, so the resource card and the energy model
 * cannot report a yield at ratios that differ, and the siting map and the
 * energy model cannot classify the AOI on different slopes.
 *
 * The consequence is that editing a shared group can invalidate a result held
 * by a product that is not selected. Every write therefore goes through one
 * callback, and the note that names the affected product is rendered from the
 * same table that says who consumes the group.
 */
import type { SolarParams } from "@/lib/energyState"
import type { SolarSeason } from "@/lib/types"
import {
  ENERGY_CAPACITY_DENSITY_BASES,
  ENERGY_DECLARED_LOSSES,
  ENERGY_OPTIONAL_LOSSES,
} from "@/lib/energyDefaults"
import { PanelSection } from "@/components/ui/PanelSection"
import {
  FieldNote,
  NumberField,
  SharedParameterNote,
  TextField,
} from "./controls"
import type { SolarParamGroup, SolarProductEntry } from "./solarProducts"

const SEASONS: { id: SolarSeason; label: string }[] = [
  { id: "annual", label: "Annual" },
  { id: "winter", label: "Winter" },
  { id: "summer", label: "Summer" },
  { id: "winter_crop", label: "Winter crop" },
  { id: "anisotropy", label: "Winter / summer" },
  { id: "shading", label: "Horizon shading" },
]

export interface SolarParameterSectionsProps {
  product: SolarProductEntry
  params: SolarParams
  /**
   * Every parameter write, tagged with the group it belongs to. One entry point
   * so the shared-parameter note is raised in one place instead of at each
   * field, which is where a missed call would go unnoticed.
   */
  onSet: (patch: Partial<SolarParams>, group: SolarParamGroup) => void
  onLossSet: (group: "declared" | "optional", key: string, pct: number) => void
  /** Text naming products holding a result computed before the current edit. */
  sharedNote: (group: SolarParamGroup) => string | null
  /** AOI-mean share of beam blocked, from a terrain result; null without one. */
  shadingMeanPct: number | null
}

export function SolarParameterSections({
  product,
  params,
  onSet,
  onLossSet,
  sharedNote,
  shadingMeanPct,
}: SolarParameterSectionsProps) {
  return (
    <>
      {product.params.map((group) => (
        <ParamGroup
          key={group}
          group={group}
          params={params}
          onSet={onSet}
          onLossSet={onLossSet}
          note={sharedNote(group)}
          shadingMeanPct={shadingMeanPct}
        />
      ))}
    </>
  )
}

function ParamGroup({
  group,
  params,
  onSet,
  onLossSet,
  note,
  shadingMeanPct,
}: {
  group: SolarParamGroup
  params: SolarParams
  onSet: (patch: Partial<SolarParams>, group: SolarParamGroup) => void
  onLossSet: (group: "declared" | "optional", key: string, pct: number) => void
  note: string | null
  shadingMeanPct: number | null
}) {
  const set = (patch: Partial<SolarParams>) => onSet(patch, group)

  if (group === "hourly") {
    return (
      <PanelSection title="Hourly window">
        <NumberField
          label="Hourly years"
          value={params.hourlyYears}
          onChange={(v) => set({ hourlyYears: v })}
          min={3}
          max={20}
        />
        <FieldNote>
          The window the tilt sweep, the yield and the terrain lookup are
          computed over. The hourly fetch dominates the run time, and shortening
          it costs accuracy for little gain.
        </FieldNote>
        {note && <SharedParameterNote>{note}</SharedParameterNote>}
      </PanelSection>
    )
  }

  if (group === "radiation") {
    return (
      <PanelSection title="Radiation and array">
        <NumberField
          label="Climatology years"
          value={params.climatologyYears}
          onChange={(v) => set({ climatologyYears: v })}
          min={5}
          max={40}
        />
        <NumberField
          label="Surface azimuth (0 = north)"
          value={params.surfaceAzimuth}
          onChange={(v) => set({ surfaceAzimuth: v })}
          min={-180}
          max={180}
        />
        <TextField
          label="Performance ratio (blank = reference 0.80)"
          value={params.performanceRatio}
          onChange={(v) => set({ performanceRatio: v })}
          placeholder="0.80"
        />
        <FieldNote>
          The modelled ratio omits soiling, inter-row shading, degradation,
          availability and cabling, so the yield is reported at a reference
          ratio. Both are shown in the result.
        </FieldNote>
        {note && <SharedParameterNote>{note}</SharedParameterNote>}
      </PanelSection>
    )
  }

  if (group === "season") {
    return (
      <PanelSection title="Season">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Season
          <select
            value={params.season}
            onChange={(e) => set({ season: e.target.value as SolarSeason })}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
          >
            {SEASONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <FieldNote>
          The annual map averages a geometry that reverses within the year.
          Winter over summer carries that contrast in one layer. Winter and
          summer are drawn on one colour domain, so the two are comparable.
          Horizon shading is the share of beam irradiation the surrounding
          terrain blocks, which is small in the mean and large in valleys.
        </FieldNote>
        <FieldNote>
          The terrain map resolves what the point analysis cannot: irradiation
          on an inclined surface varies with slope and aspect, from the
          Copernicus DEM at 30 m.
        </FieldNote>
        {note && <SharedParameterNote>{note}</SharedParameterNote>}
      </PanelSection>
    )
  }

  if (group === "slope") {
    return (
      <PanelSection title="Slope limits">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Slope limit"
            value={params.slopeRestrictiveDeg}
            onChange={(v) => set({ slopeRestrictiveDeg: v })}
            min={1}
            max={45}
          />
          <NumberField
            label="Restrictive from"
            value={params.slopeAcceptableDeg}
            onChange={(v) => set({ slopeAcceptableDeg: v })}
            min={1}
            max={45}
          />
        </div>
        <FieldNote>
          Slope limits and the excluded-cover list are project conventions, not
          verified legal restrictions. Legal reserve, permanent preservation
          areas and municipal zoning require the CAR and local legislation,
          which this analysis does not consult.
        </FieldNote>
        {note && <SharedParameterNote>{note}</SharedParameterNote>}
      </PanelSection>
    )
  }

  return (
    <PanelSection title="Plant and losses">
      <FieldNote>
        The energy model runs on the same radiation chain and the same optimum
        as the terrain map, at the performance ratio set above, so the two
        products cannot report different yields for one AOI. It adds the loss
        stack behind that ratio, the single-axis tracking comparison, the
        diurnal profile and the plant energy over the suitable area.
      </FieldNote>

      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Reporting basis
        <select
          value={params.reportingBasis}
          onChange={(e) =>
            set({
              reportingBasis: e.target.value as "year_one" | "lifetime_mean",
            })
          }
          className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
        >
          <option value="year_one">Year one (default)</option>
          <option value="lifetime_mean">Lifetime mean</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Degradation %/yr"
          value={params.degradationPct}
          onChange={(v) => set({ degradationPct: v })}
          min={0}
          max={5}
          step={0.1}
        />
        <NumberField
          label="Analysis period (yr)"
          value={params.analysisPeriodYears}
          onChange={(v) => set({ analysisPeriodYears: v })}
          min={1}
          max={50}
        />
      </div>
      <FieldNote>
        Degradation is a basis for the whole chain, not a loss row, so every
        figure carries the basis it was computed on. Year one applies none.
        Defaults: 0.5 %/yr, the crystalline silicon median of Jordan and Kurtz
        (2013); 25 years, a project convention.
      </FieldNote>

      <span className="text-[11px] text-muted-foreground">
        Declared losses (%)
      </span>
      <div className="grid grid-cols-2 gap-2">
        {ENERGY_DECLARED_LOSSES.map((term) => (
          <NumberField
            key={term.key}
            label={`${term.label} (${term.defaultPct})`}
            value={params.declaredLoss[term.key] ?? term.defaultPct}
            onChange={(v) => onLossSet("declared", term.key, v)}
            min={0}
            max={50}
            step={0.1}
          />
        ))}
      </div>
      <FieldNote>
        Terms this chain does not model, entered as declared assumptions. The
        value in brackets is the PVWatts v5 default from Dobos (2014),
        NREL/TP-6A20-62641. They multiply the modelled ratio into the derived
        one; the applied ratio is unaffected.
      </FieldNote>

      <span className="text-[11px] text-muted-foreground">
        Optional losses (%)
      </span>
      <div className="grid grid-cols-2 gap-2">
        {ENERGY_OPTIONAL_LOSSES.map((term) => (
          <NumberField
            key={term.key}
            label={`${term.label} (${term.defaultPct})`}
            value={params.optionalLoss[term.key] ?? term.defaultPct}
            onChange={(v) => onLossSet("optional", term.key, v)}
            min={0}
            max={50}
            step={0.1}
          />
        ))}
      </div>
      <FieldNote>
        Both default to zero. PVWatts v5 suggests 3 percent for each. Applying
        both multiplies the derived ratio by 0.9409; at the reference site that
        takes it from 0.7825 to 0.7363, which is 7.5 to 8.1 percent below the
        Global Solar Atlas implied band of 0.796 to 0.801, the external
        reference the applied ratio is calibrated against. No row geometry is
        modelled here, so there is nothing from which an inter-row shading loss
        could be computed.
      </FieldNote>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="GCR fixed (0.435)"
          value={params.gcrFixed}
          onChange={(v) => set({ gcrFixed: v })}
          min={0.05}
          max={0.95}
          step={0.005}
        />
        <NumberField
          label="GCR tracker (0.295)"
          value={params.gcrTracker}
          onChange={(v) => set({ gcrTracker: v })}
          min={0.05}
          max={0.95}
          step={0.005}
        />
      </div>
      <NumberField
        label="Tracker rotation limit, degrees (60)"
        value={params.trackerMaxAngleDeg}
        onChange={(v) => set({ trackerMaxAngleDeg: v })}
        min={10}
        max={90}
      />
      <FieldNote>
        Both defaults follow from the fleet capacity densities of Bolinger and
        Bolinger (2022), 0.35 MW_DC per acre fixed tilt and 0.24 MW_DC per acre
        single-axis tracking, which are 0.865 and 0.593 MW_DC per hectare. At 20
        percent module efficiency those imply ground coverage ratios of 0.432
        and 0.297; the defaults 0.435 and 0.295 sit within 0.6 percent of them.
        Their ratio sets the sign of the per-hectare comparison and the
        published ranges straddle the parity point, so the response reports the
        parity ratio beside the answer. The rotation limit is a project
        convention. Backtracking is always on and is not exposed: without it
        pvlib ignores the coverage ratio and returns a gain no plant would
        deliver.
      </FieldNote>

      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Capacity density basis
        <select
          value={params.densityBasis}
          onChange={(e) => set({ densityBasis: e.target.value })}
          className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
        >
          {ENERGY_CAPACITY_DENSITY_BASES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="Buildable fraction (0.75)"
        value={params.buildableFraction}
        onChange={(v) => set({ buildableFraction: v })}
        min={0.05}
        max={1}
        step={0.05}
      />
      <FieldNote>
        Default: Bolinger and Bolinger (2022) fixed tilt, derated to a
        total-site basis by the buildable fraction the paper gives as a worked
        example. The area basis moves the capacity further than the exceedance
        band does, so it is reported with every figure. The direct-array entries
        apply to array area only; using one against a whole site overstates
        capacity by 1/0.75.
      </FieldNote>

      <TextField
        label="UTC offset for the diurnal profile (blank = UTC)"
        value={params.utcOffset}
        onChange={(v) => set({ utcOffset: v })}
        placeholder="-3"
      />

      <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={params.applyShading}
          disabled={shadingMeanPct == null}
          onChange={(e) => set({ applyShading: e.target.checked })}
          className="mt-0.5 size-3.5 shrink-0 accent-primary disabled:opacity-40"
        />
        <span>
          Apply horizon shading from the terrain map
          {shadingMeanPct == null
            ? " (run the terrain product first)"
            : ` (${shadingMeanPct.toFixed(2)}% of beam, AOI mean)`}
        </span>
      </label>
      <FieldNote>
        Off by default. The terrain map measures shading over the whole AOI,
        while the derate applies to the suitable pixels only, so carrying it
        across is a decision the response records rather than an automatic step.
        Left off, the plant figures are reported unshaded.
      </FieldNote>
      <FieldNote>
        A siting map is reused as the classification behind the capacity;
        without one the AOI is classified afresh on the slope limits above. The
        plant figures are a resource and land ceiling, not an interconnectable
        or permitted capacity.
      </FieldNote>
      {note && <SharedParameterNote>{note}</SharedParameterNote>}
    </PanelSection>
  )
}
