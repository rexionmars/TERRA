/**
 * Parameters of the wind screening.
 *
 * A separate store and a separate tab from the photovoltaic products: the
 * record resolves on the MERRA-2 grid of 0.5 by 0.625 degrees rather than the 1
 * degree radiation grid, it files under its own run kind, and its capacity
 * factor carries no external benchmark. Each default states whether it comes
 * from the record, from a reference turbine, or from a project convention with
 * no published basis.
 */
import type { WindParams } from "@/lib/energyState"
import { PanelSection } from "@/components/ui/PanelSection"
import { FieldNote, NumberField } from "./controls"

export function WindParameterSections({
  params,
  onSet,
}: {
  params: WindParams
  onSet: (patch: Partial<WindParams>) => void
}) {
  return (
    <>
      <PanelSection title="Record and hub">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Record years (10)"
            value={params.recordYears}
            onChange={(v) => onSet({ recordYears: v })}
            min={1}
            max={30}
          />
          <NumberField
            label="Hub height, m (110)"
            value={params.hubHeightM}
            onChange={(v) => onSet({ hubHeightM: v })}
            min={10}
            max={200}
          />
        </div>
        <FieldNote>
          The record carries 10 m and 50 m. A hub above 50 m is a power-law
          extrapolation, and the response states the ratio it sits at. The 110 m
          default is the reference turbine hub, a project convention; no turbine
          has been selected for any site.
        </FieldNote>
      </PanelSection>

      <PanelSection title="Surface roughness">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Roughness low, m (0.03)"
            value={params.roughnessLowM}
            onChange={(v) => onSet({ roughnessLowM: v })}
            min={0.001}
            max={2}
            step={0.01}
          />
          <NumberField
            label="Roughness high, m (0.10)"
            value={params.roughnessHighM}
            onChange={(v) => onSet({ roughnessHighM: v })}
            min={0.001}
            max={2}
            step={0.01}
          />
        </div>
        <FieldNote>
          An assumed land-cover property for open agricultural terrain, not a
          measurement at this AOI. The shear exponent derived from the record is
          inverted to a roughness and checked against this band; a disagreement
          is the strongest single reason not to read the hub figures as a
          measurement.
        </FieldNote>
      </PanelSection>

      <PanelSection title="Record checks">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Calm threshold, m/s (0.5)"
            value={params.calmThresholdMS}
            onChange={(v) => onSet({ calmThresholdMS: v })}
            min={0}
            max={5}
            step={0.1}
          />
          <NumberField
            label="Record max floor, m/s (10)"
            value={params.recordMaxFloorMS}
            onChange={(v) => onSet({ recordMaxFloorMS: v })}
            min={0}
            max={50}
          />
        </div>
        <FieldNote>
          Both are project conventions with no published basis. The floor exists
          to catch a near-surface field whose extremes are absent; read the
          record maximum and the record length rather than the flag alone.
        </FieldNote>
      </PanelSection>
    </>
  )
}
