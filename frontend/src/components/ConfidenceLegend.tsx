/**
 * Slim confidence legend — aligned with the bottom-right map tool column
 * (the width and radius the map's control bars use), clear gap above the draw button.
 */
export function ConfidenceLegend({ visible }: { visible: boolean }) {
  if (!visible) return null

  return (
    <div
      className="panel app-no-drag confidence-legend absolute z-[1100] flex flex-col items-center gap-1.5 rounded-[0.55rem] px-1.5 py-2"
      title="Prediction confidence"
    >
      <p className="eyebrow !tracking-wider">Conf</p>
      <div className="flex items-stretch gap-1">
        <div className="confidence-legend-bar w-2 shrink-0 rounded-[3px]" aria-hidden />
        <div className="telemetry flex flex-col justify-between py-px text-[9px] leading-none text-muted-foreground">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
      </div>
    </div>
  )
}
