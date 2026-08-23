/**
 * The parameters of a flood envelope run.
 *
 * THE PRODUCT SET IS FIRST BECAUSE IT IS THE MEASUREMENT. Every other control
 * here moves the extent; this one decides whether there is an envelope at all.
 * A reader who unchecks three of the four products is left with a single DEM's
 * mask, which is the shape the study found is not reproducible, so the panel
 * refuses it in the same words the sidecar does rather than letting the run
 * reach the network to be rejected.
 *
 * TWO PARAMETERS ARE NOT SENT UNLESS ASKED FOR. The buffer is sized from the
 * AOI and the inset margin from the cell size, both per window, so the panel
 * offers them as overrides rather than as fields with a number already in
 * them: a fixed default typed here would silently replace a value computed for
 * this window with one chosen for another. What the run actually used is
 * reported in the reading, which is where a reader takes a figure to override
 * from.
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
  /** A run is in flight; editing under it would describe the wrong result. */
  busy: boolean
}) {
  const toggleProduct = (id: string) => {
    const on = params.demIds.includes(id)
    onSet({
      demIds: on
        ? params.demIds.filter((x) => x !== id)
        : // Kept in the table's order rather than in click order, so the
          // request, the legend and the pair table list the products the same
          // way whatever order they were switched on in.
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
          At least two. A product coarser than the others is moved onto the
          shared grid before the terrain chain runs, and every pair it appears
          in carries that resampling alongside the terrain difference; the
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
          reports its widest product disagreement at 1 m, which is where the
          envelope is drawn rather than where it flatters. HAND is a terrain
          index, so a threshold in metres ranks susceptibility and is not a
          flood depth.
        </FieldNote>
        <FieldNote>
          The sweep of thresholds the pairs are compared over is the sidecar's,
          and the run reports which values it swept. The drainage area is held
          fixed across it: the extent moves with it and this analysis does not
          measure that movement.
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
          derivedNote="A 1 km ring by default, capped by the sidecar so enough of the AOI is left to measure."
          onChange={(v) => onSet({ insetMarginCells: v })}
        />
        <FieldNote>
          The DEM is read beyond the AOI so drainage entering it is real
          terrain, and the terrain chain runs on the AOI plus that buffer on
          every side. The figures come back over the AOI alone; the buffered
          window is reported with them as provenance. Water arriving from
          beyond the buffer is still missing, so the inset statistics repeat
          every comparison over the AOI shrunk by this ring, where the
          contributing area is truncated and HAND reads high.
        </FieldNote>
      </PanelSection>
    </>
  )
}

/**
 * A parameter the sidecar derives per window, offered as an override.
 *
 * The checkbox is the whole point: unchecked sends nothing, and the field is
 * not on screen holding a number that looks like what the run will use.
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
