import type { LULCAnalysis } from "@/lib/types"

const CALENDAR_NOTES: Record<string, string> = {
  A: "Wheat → Soybean → Fallow → Oat → Soybean",
  B: "Wheat → Corn+Soy → Cover crop → Wheat → Corn+Soy",
  C: "Corn → Soybean → Second-crop corn → Corn → Soybean",
}

interface LulcSectionProps {
  lulc: LULCAnalysis
  areaId?: string
}

export function LulcSection({ lulc, areaId }: LulcSectionProps) {
  const m = lulc.metrics
  const calendar = areaId ? CALENDAR_NOTES[areaId] : undefined
  const hasCompare = (lulc.pred_vs_ref?.length ?? 0) > 0

  return (
    <section className="ar-section p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Land cover / land use</p>
          <h2 className="mt-1 font-display text-base font-semibold tracking-wide">
            MapBiomas {lulc.year || 2023}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {lulc.source || "MapBiomas Collection 10"} · descriptive composition
            (no classifier)
          </p>
        </div>
        {calendar && (
          <p className="ar-raised max-w-xs px-2.5 py-1.5 text-[10px] text-muted-foreground">
            Documented use: {calendar}
          </p>
        )}
      </div>

      {/* Map + dense 2×4 metrics — never stretch to 8 sparse columns */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        {lulc.map_uri ? (
          <div className="ar-inset flex aspect-square items-center justify-center overflow-hidden p-3 lg:aspect-auto lg:min-h-[14rem]">
            <img
              src={lulc.map_uri}
              alt="MapBiomas land cover"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="ar-inset flex min-h-[12rem] items-center justify-center text-[11px] text-muted-foreground">
            Map unavailable
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:grid-rows-2">
          <Metric label="Area" value={`${m.area_ha.toFixed(1)} ha`} />
          <Metric label="Classes" value={String(m.n_classes)} />
          <Metric label="Shannon H" value={m.shannon_h.toFixed(3)} />
          <Metric label="Pielou J" value={m.pielou_j.toFixed(3)} />
          <Metric
            label="Dominant"
            value={`${m.dominant_pct.toFixed(1)}%`}
            sub={m.dominant_class}
          />
          <Metric label="Soybean 39" value={`${m.soja_pct.toFixed(1)}%`} />
          <Metric label="Other crops 41" value={`${m.outras_lav_pct.toFixed(1)}%`} />
          <Metric label="Agricultural*" value={`${m.agricola_pct.toFixed(1)}%`} />
        </div>
      </div>

      <div
        className={`mt-4 grid grid-cols-1 gap-3 border-t pt-4 md:grid-cols-2 ${
          hasCompare ? "xl:grid-cols-3" : ""
        }`}
        style={{ borderColor: "var(--ar-border)" }}
      >
        <div className="ar-raised p-3">
          <p className="eyebrow mb-2.5">Cover composition</p>
          <StatBars
            rows={lulc.composition.map((r) => ({
              key: String(r.class_id),
              label: `${r.class_id} ${r.name}`,
              color: r.color,
              pct: r.pct,
              right: `${r.area_ha.toFixed(1)} ha`,
            }))}
          />
        </div>
        <div className="ar-raised p-3">
          <p className="eyebrow mb-2.5">Land-use groups</p>
          <StatBars
            rows={lulc.groups.map((r) => ({
              key: r.group,
              label: r.group,
              color: r.color,
              pct: r.pct,
              right: `${r.area_ha.toFixed(1)} ha`,
            }))}
          />
        </div>
        {hasCompare && (
          <div className="ar-raised p-3 md:col-span-2 xl:col-span-1">
            <p className="eyebrow mb-1">MapBiomas vs predicted (shared pixels)</p>
            {/*
              The reference is native at 30 m and is resampled onto the 10 m
              classification grid, so roughly nine pixels carry one label
              observation. The sample size stated here is the distinct native
              cell count, not the pixel count.
            */}
            <p className="mb-2.5 text-[10px] text-muted-foreground">
              {typeof lulc.compare_reference_cells === "number" ? (
                <>
                  n = {lulc.compare_reference_cells.toLocaleString()} reference
                  cells at 30 m
                  {typeof lulc.compare_pixels === "number"
                    ? ` (${lulc.compare_pixels.toLocaleString()} pixels at 10 m)`
                    : ""}
                </>
              ) : typeof lulc.compare_pixels === "number" ? (
                <>
                  {lulc.compare_pixels.toLocaleString()} shared pixels at 10 m ·
                  reference cell count unavailable
                </>
              ) : null}
            </p>
            <div className="flex flex-col gap-1.5">
              {lulc.pred_vs_ref.map((r) => (
                <div
                  key={r.class_id}
                  className="grid grid-cols-[4.5rem_1fr_2.5rem_2.5rem] items-center gap-2 text-[11px] sm:grid-cols-[7rem_1fr_3rem_3rem]"
                >
                  <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: r.color }}
                    />
                    {r.class_id}
                  </span>
                  <div className="ar-track relative h-2 overflow-hidden rounded-sm">
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm opacity-40"
                      style={{
                        width: `${r.pct_ref}%`,
                        backgroundColor: r.color,
                      }}
                    />
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{
                        width: `${r.pct_pred}%`,
                        backgroundColor: r.color,
                      }}
                    />
                  </div>
                  <span className="telemetry text-right text-muted-foreground">
                    {r.pct_ref.toFixed(0)}%
                  </span>
                  <span className="telemetry text-right text-foreground">
                    {r.pct_pred.toFixed(0)}%
                  </span>
                </div>
              ))}
              <div className="mt-1 flex justify-end gap-4 text-[10px] text-muted-foreground">
                <span>dim = MapBiomas</span>
                <span>solid = predicted</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground">
        *Agricultural = annual cropland (39+41) + mosaic (21). Annual MapBiomas
        labels compress crop rotations into a single cover class.
      </p>
    </section>
  )
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="ar-raised flex min-h-[4.5rem] flex-col justify-center px-3 py-2.5">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="telemetry mt-1 text-[13px] font-medium text-foreground">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 truncate text-[9px] text-muted-foreground">{sub}</div>
      )}
    </div>
  )
}

function StatBars({
  rows,
}: {
  rows: { key: string; label: string; color: string; pct: number; right: string }[]
}) {
  if (!rows.length) {
    return <p className="text-[11px] text-muted-foreground">No classes in AOI.</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-xs">
          <span
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: r.color }}
          />
          <span className="w-36 shrink-0 truncate sm:w-44">{r.label}</span>
          <span className="ar-track relative h-1.5 flex-1 overflow-hidden rounded-sm">
            <span
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{ width: `${r.pct}%`, backgroundColor: r.color }}
            />
          </span>
          <span className="telemetry w-12 shrink-0 text-right">
            {r.pct.toFixed(1)}%
          </span>
          <span className="telemetry hidden w-14 shrink-0 text-right text-muted-foreground sm:inline">
            {r.right}
          </span>
        </li>
      ))}
    </ul>
  )
}
