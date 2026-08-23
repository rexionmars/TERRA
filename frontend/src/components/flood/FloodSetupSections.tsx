/**
 * The parameters of a flood envelope run.
 *
 * The product set is first because it is the measurement. The other controls
 * move the extent; this one decides whether there is an envelope at all. One
 * product leaves a single DEM's mask, which the study found is not
 * reproducible, and the panel refuses that in the same words the sidecar does,
 * before the run reaches the network.
 *
 * Two parameters are not sent unless asked for. The sidecar sizes the buffer
 * from the AOI and the inset margin from the cell size, per window. The panel
 * offers both as overrides, with no number in the field until the reader takes
 * one over: a fixed default typed here would replace a value computed for this
 * window with one chosen for another. The reading reports the value the run
 * used.
 */
import { FieldNote, NumberField } from "@/components/energy/controls"
import { PanelSection } from "@/components/ui/PanelSection"
import {
  FLOOD_DEM_PRODUCTS,
  FLOOD_OVERRIDE_SEED,
  FLOOD_PRODUCT_SUBSTITUTION_NOTE,
  type FloodParams,
} from "@/components/flood/floodSetup"
import { cn } from "@/lib/utils"

export function FloodSetupSections({
  params,
  onSet,
  busy,
}: {
  params: FloodParams
  onSet: (patch: Partial<FloodParams>) => void
  /** A run is in flight, and the controls are disabled for its duration. */
  busy: boolean
}) {
  const toggleProduct = (id: string) => {
    const on = params.demIds.includes(id)
    onSet({
      demIds: on
        ? params.demIds.filter((x) => x !== id)
        : // Kept in the table's order, so the request, the legend and the
          // pair table list the products identically whatever order they were
          // switched on in.
          FLOOD_DEM_PRODUCTS.filter(
            (p) => p.id === id || params.demIds.includes(p.id)
          ).map((p) => p.id),
    })
  }

  return (
    <>
      <PanelSection title="DEM products">
        <ul className="flex flex-col gap-1">
          {FLOOD_DEM_PRODUCTS.map((p) => {
            const on = params.demIds.includes(p.id)
            return (
              <li key={p.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors",
                    on
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={() => toggleProduct(p.id)}
                    className="accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="telemetry shrink-0 text-micro text-muted-foreground">
                    {p.nativeResolutionM} m
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <FieldNote>{FLOOD_PRODUCT_SUBSTITUTION_NOTE}</FieldNote>
        <FieldNote>
          At least two products. A coarser product is resampled onto the shared
          grid before the terrain chain runs, so every pair it appears in
          carries a resampling component alongside the terrain difference. The
          reading marks those rows.
        </FieldNote>
      </PanelSection>

      <PanelSection title="Thresholds">
        <NumberField
          label="Reference threshold (m above drainage)"
          value={params.referenceThresholdM}
          min={0}
          max={50}
          step={0.5}
          onChange={(v) => onSet({ referenceThresholdM: v })}
        />
        <NumberField
          label="Drainage area (km2)"
          value={params.drainageKm2}
          min={0.01}
          max={100}
          step={0.1}
          onChange={(v) => onSet({ drainageKm2: v })}
        />
        <FieldNote>
          The agreement raster is built at the reference threshold. The study
          reports its widest disagreement between products at 1 m. A threshold
          in metres ranks relative susceptibility; it is not a flood depth.
        </FieldNote>
        <FieldNote>
          The sidecar sets the sweep of thresholds the pairs are compared over,
          and the run reports the values swept. The drainage area is held fixed
          across the sweep; its effect on the extent is not measured here.
        </FieldNote>
      </PanelSection>

      <PanelSection title="Window and inset">
        <OverrideField
          label="Buffer beyond the AOI (m)"
          value={params.bufferM}
          seed={FLOOD_OVERRIDE_SEED.bufferM}
          min={0}
          max={20000}
          step={100}
          busy={busy}
          derivedNote="Sized from the AOI extent by the sidecar."
          onChange={(v) => onSet({ bufferM: v })}
        />
        <OverrideField
          label="Inset margin (cells)"
          value={params.insetMarginCells}
          seed={FLOOD_OVERRIDE_SEED.insetMarginCells}
          min={0}
          max={500}
          step={1}
          busy={busy}
          derivedNote="A 1 km ring by default, capped by the sidecar to keep half the AOI's shorter side inside the inset."
          onChange={(v) => onSet({ insetMarginCells: v })}
        />
        <FieldNote>
          The terrain chain runs on the AOI plus the buffer on every side, so
          the drainage entering the AOI is measured terrain. The figures are
          over the AOI, with the buffered window reported beside them as
          provenance.
        </FieldNote>
        <FieldNote>
          Drainage arriving from beyond the buffer is absent. The inset
          statistics repeat every comparison over the AOI shrunk by this ring,
          where the contributing area is truncated and HAND reads high.
        </FieldNote>
      </PanelSection>
    </>
  )
}

/**
 * A parameter the sidecar derives per window, offered as an override.
 *
 * Unchecked sends nothing, and the number field appears only once the reader
 * takes the parameter over, so no number is on screen that the run will not
 * use.
 */
function OverrideField({
  label,
  value,
  seed,
  min,
  max,
  step,
  busy,
  derivedNote,
  onChange,
}: {
  label: string
  value: number | null
  seed: number
  min: number
  max: number
  step: number
  busy: boolean
  derivedNote: string
  onChange: (v: number | null) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={value !== null}
          disabled={busy}
          onChange={() => onChange(value === null ? seed : null)}
          className="accent-primary"
        />
        <span className="min-w-0 flex-1">{label}</span>
      </label>
      {value === null ? (
        <FieldNote>{derivedNote}</FieldNote>
      ) : (
        <NumberField
          label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
        />
      )}
    </div>
  )
}
