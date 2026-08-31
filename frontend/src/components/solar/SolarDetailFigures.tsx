/**
 * Figures shared by the Analysis solar sections and the studio's right
 * solar drawer. Kept in one place so sky view and the siting cover lists
 * cannot disagree about what a run reported.
 */
import {
  WaterFigure,
  Chip,
} from "@/components/analysisPrimitives"
import { mapbiomasCoverName } from "@/lib/mapbiomasCovers"
import type { SolarSkyView } from "@/lib/types"

/** Sky-view block for a terrain irradiation result. */
export function SkyViewFigures({ sky }: { sky: SolarSkyView }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow !text-micro">Sky view</p>
        <Chip tone={sky.applied ? "accent" : "muted"}>
          {sky.applied ? "Applied" : "Not applied"}
        </Chip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <WaterFigure
          label="Mean horizon"
          value={`${sky.mean_horizon_deg.toFixed(1)}°`}
          sub={`threshold ${sky.threshold_deg.toFixed(1)}°`}
        />
        <WaterFigure
          label="Max horizon"
          value={`${sky.max_horizon_deg.toFixed(1)}°`}
        />
        {sky.diffuse_loss_mean_pct != null && (
          <WaterFigure
            label="Diffuse loss"
            value={`${sky.diffuse_loss_mean_pct.toFixed(2)}%`}
            sub={
              sky.diffuse_loss_max_pct != null
                ? `max ${sky.diffuse_loss_max_pct.toFixed(1)}%`
                : undefined
            }
          />
        )}
      </div>
    </div>
  )
}

/** MapBiomas cover ids as readable chips. */
export function CoverChipList({
  label,
  codes,
}: {
  label: string
  codes: number[]
}) {
  if (!codes.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="eyebrow !text-micro">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {codes.map((id) => (
          <li key={id}>
            {/* The code is data, not decoration. At /70 over an already
                muted token it measured 3.85 at its very best and 1.89 over a
                bright map, so the number identifying the class was the least
                readable thing in the chip. An opacity modifier on a muted
                token has no valid range here. */}
            <span
              className="telemetry inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-micro text-muted-foreground"
              title={`MapBiomas ${id}`}
            >
              <span className="text-foreground">{mapbiomasCoverName(id)}</span>
              <span>{id}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
