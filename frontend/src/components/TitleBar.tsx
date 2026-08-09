import { Minus, Square, X } from "lucide-react"
import type { ReactNode } from "react"
import {
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../../wailsjs/runtime/runtime"
import type { PredictResult } from "@/lib/types"
import { useAuth, type AppScreen } from "@/lib/auth"

interface TitleBarProps {
  view: { lat: number; lon: number; zoom: number }
  result: PredictResult | null
  projectSwitcher?: ReactNode
  /**
   * Title of the run on screen. Absent until one is made or opened, which is
   * not the same as an untitled run, so nothing is shown rather than a
   * placeholder standing in for a run that does not exist.
   */
  runLabel?: string | null
}

/**
 * What each screen works from, named once per screen.
 *
 * The eyebrow used to be the pinned literal "land cover · sentinel-2", which a
 * user in the energy screen read for a whole session while neither the solar
 * nor the wind products touch Sentinel-2. The energy label names NASA POWER
 * because both tabs read their series from it (SolarAnalysis,
 * SolarTerrainAnalysis, EnergyModelAnalysis and WindAnalysis all carry
 * power_provenance), and it names no single resource because the tab in use is
 * state inside that screen which the title bar does not see.
 *
 * Typed against AppScreen so a screen added later cannot ship without a label.
 */
const SCREEN_EYEBROW: Record<AppScreen, string> = {
  map: "land cover · sentinel-2",
  energy: "solar and wind · nasa power",
  // The destination is the project hub -- the list of projects, their saved
  // runs and their overlays. A single analysis is one thing opened from inside
  // it, so naming the whole screen after that one thing sent users looking for
  // a chart and gave them a folder list.
  analysis: "project hub",
  auth: "sign in",
  profile: "settings",
  environment: "python environment",
}

function fmtCoord(v: number, pos: string, neg: string): string {
  const dir = v >= 0 ? pos : neg
  return `${Math.abs(v).toFixed(4)}°${dir}`
}

// Frameless title bar: brand + context + map telemetry. Navigation lives in
// the left navigation column so the header stays free of per-page icons.
export function TitleBar({
  view,
  result,
  projectSwitcher,
  runLabel,
}: TitleBarProps) {
  const { screen } = useAuth()
  const onMap = screen === "map"
  const hasMap = onMap || screen === "energy"
  const run = runLabel?.trim()

  return (
    <header className="titlebar-terra app-draggable relative flex h-11 shrink-0 items-center justify-between bg-ink/40 pl-20 pr-2 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <img
            src="/terra-logo.png"
            alt=""
            className="h-7 w-7 object-contain"
          />
          <span className="font-display text-sm font-semibold tracking-[0.14em]">
            TERRA
          </span>
        </div>
        <span className="hairline h-4 w-px self-center border-l" />
        <span className="eyebrow hidden sm:inline">{SCREEN_EYEBROW[screen]}</span>
        {projectSwitcher}
        {run && (
          <>
            <span className="hairline hidden h-4 w-px self-center border-l sm:inline-block" />
            {/* The full title, truncated by width rather than shortened here:
                the stamp at its end is what tells two runs of one AOI apart,
                so a middle ellipsis would remove the discriminating part. The
                title attribute carries the whole string. */}
            <span
              className="telemetry hidden max-w-[16rem] truncate text-[11px] text-muted-foreground sm:inline-block"
              title={run}
            >
              {run}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/*
          Wherever there is a map. The energy screen draws one full bleed and
          the AOI is defined on it, so the position was being withheld from
          half the places it describes. The two screens share one view, so the
          readout is the same value in both.
        */}
        {hasMap && (
          <div className="telemetry hidden items-center gap-4 text-[11px] text-muted-foreground lg:flex">
            <span>
              LAT <span className="text-foreground">{fmtCoord(view.lat, "N", "S")}</span>
            </span>
            <span>
              LON <span className="text-foreground">{fmtCoord(view.lon, "E", "W")}</span>
            </span>
            <span>
              Z <span className="text-foreground">{view.zoom.toFixed(0)}</span>
            </span>
            {/* The pill counts the scenes behind a classification, which the
                energy products never read, so it stays on the map screen. */}
            {onMap && result && (
              <>
                <span className="hairline h-4 w-px self-center border-l" />
                <span className="status-pill text-place/80">
                  {result.n_dates > 0
                    ? `${result.n_dates} scenes · active`
                    : result.lulc
                      ? "MapBiomas · active"
                      : "overlay · active"}
                </span>
              </>
            )}
          </div>
        )}

        <div className="app-no-drag flex items-center gap-1">
          <WindowButton onClick={WindowMinimise} title="Minimize">
            <Minus className="h-3.5 w-3.5" />
          </WindowButton>
          <WindowButton onClick={WindowToggleMaximise} title="Maximize">
            <Square className="h-3 w-3" />
          </WindowButton>
          <WindowButton onClick={Quit} danger title="Close">
            <X className="h-3.5 w-3.5" />
          </WindowButton>
        </div>
      </div>
    </header>
  )
}

function WindowButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground ${
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  )
}
