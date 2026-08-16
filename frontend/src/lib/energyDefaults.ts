/**
 * Request defaults for the photovoltaic energy model.
 *
 * Domain constants, so they live beside the other domain modules rather than
 * inside the component that happened to render them first: the application
 * state seeds itself from these, and importing them from a panel meant the
 * state depended on a view.
 */
/**
 * Defaults mirrored from the sidecar module constants.
 *
 * The Python constant and this initial state are duplicated with no link
 * between them, so each control states its default and where the default comes
 * from, and the response echoes back the value actually used under
 * `assumptions`. A field left at its default is still sent explicitly.
 */
export const ENERGY_DECLARED_LOSSES: {
  key: string
  label: string
  defaultPct: number
}[] = [
  { key: "soiling", label: "Soiling", defaultPct: 2.0 },
  { key: "mismatch", label: "DC mismatch", defaultPct: 2.0 },
  { key: "wiring", label: "DC wiring", defaultPct: 2.0 },
  { key: "connections", label: "Connections", defaultPct: 0.5 },
  { key: "nameplate_rating", label: "Nameplate", defaultPct: 1.0 },
  { key: "lid", label: "Light-induced deg.", defaultPct: 1.5 },
]

export const ENERGY_OPTIONAL_LOSSES: {
  key: string
  label: string
  defaultPct: number
  pvwattsSuggestedPct: number
}[] = [
  {
    key: "interrow_shading",
    label: "Inter-row shading",
    defaultPct: 0.0,
    pvwattsSuggestedPct: 3.0,
  },
  {
    key: "availability",
    label: "Availability",
    defaultPct: 0.0,
    pvwattsSuggestedPct: 3.0,
  },
]

/** Keys of the sidecar capacity-density table, with the source of each. */
export const ENERGY_CAPACITY_DENSITY_BASES: { id: string; label: string }[] = [
  {
    id: "bolinger_fixed_total_site",
    label: "Bolinger fixed tilt, total site",
  },
  { id: "bolinger_fixed_direct", label: "Bolinger fixed tilt, direct array" },
  { id: "bolinger_tracking_direct", label: "Bolinger tracking, direct array" },
  { id: "nrel_large_fixed_total", label: "Ong T3, above 20 MW, total site" },
  { id: "nrel_large_fixed_direct", label: "Ong T4, above 20 MW, direct array" },
  { id: "nrel_small_fixed_total", label: "Ong T3, below 20 MW, total site" },
  { id: "nrel_small_fixed_direct", label: "Ong T4, below 20 MW, direct array" },
]

export const ENERGY_DEFAULTS = {
  reportingBasis: "year_one" as "year_one" | "lifetime_mean",
  /** Jordan and Kurtz (2013), crystalline silicon median 0.5 percent per year. */
  degradationRatePctPerYear: 0.5,
  /** Project convention. */
  analysisPeriodYears: 25,
  /**
   * Bolinger and Bolinger (2022) fleet capacity densities of 0.35 and 0.24
   * MW_DC per acre are 0.86487 and 0.59305 MW_DC per hectare, which at 20
   * percent module efficiency imply ground coverage ratios of 0.43243 and
   * 0.29653. The tracker default was 0.35, which follows from no published
   * pair; at the reference site yields of 1507.70 fixed and 1782.41 tracking
   * kWh/kWp/yr that is the difference between a derived per-hectare change of
   * -4.88 and -19.83 percent. Both are editable request parameters.
   */
  gcrFixed: 0.435,
  gcrTracker: 0.295,
  trackerMaxAngleDeg: 60,
  capacityDensityBasis: "bolinger_fixed_total_site",
  /** Bolinger and Bolinger (2022) worked example, not a measured median. */
  buildableFraction: 0.75,
}
