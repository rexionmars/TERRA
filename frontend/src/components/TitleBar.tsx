import {
  LogIn,
  Minus,
  PanelBottom,
  PanelLeft,
  Square,
  UserRound,
  X,
} from "lucide-react"
import { AvatarCircle } from "@/components/AvatarCircle"
import type { ReactNode } from "react"
import {
  BrowserOpenURL,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../../wailsjs/runtime/runtime"
import type { LayoutMode, PredictResult } from "@/lib/types"
import {
  LEAFLET_CREDIT,
  basemapByKind,
  type BasemapKind,
  type CreditPart,
} from "@/lib/basemaps"
import { useAuth, type AppScreen } from "@/lib/auth"
import { cn } from "@/lib/utils"

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
  /**
   * The map layout, and the way to change it.
   *
   * This bar is the only chrome mounted in both layouts, which is why the
   * control lives here: in the workspace layout the navigation column is gone,
   * so a toggle placed there would be unreachable from the mode it exits.
   *
   * It is a view mode rather than a destination, so it does not contradict this
   * bar's rule against per-page navigation icons.
   */
  /**
   * Where the map screen hangs its whiteboard toggle.
   *
   * A host element handed BACK, rather than a ReactNode taken in like
   * `projectSwitcher`. What that button reads -- whether the board is up,
   * whether there is anything to put on it -- is the map screen's state, and
   * the map screen is not this component's parent. Filling a node slot would
   * mean lifting a deliberately screen-local flag into the shell, and that flag
   * is local on purpose: coming back to the map has to give the map, not a
   * board left open. MapView's BottomRightSlot bridges the same way for the
   * same reason -- a control with one owner that has to be drawn inside
   * another's DOM.
   */
  boardSlotRef?: (el: HTMLDivElement | null) => void
  layoutMode?: LayoutMode
  onLayoutModeChange?: (mode: LayoutMode) => void
  /**
   * Whether the studio covers the map.
   *
   * The telemetry in this bar describes the map: latitude, longitude, zoom and
   * whose imagery is being looked at. With the studio open the map is covered
   * -- that is the premise of the mode -- so those readings describe a surface
   * nobody can see, and the credit names imagery that is not on screen. They
   * are withheld rather than left to read as stale.
   */
  boardOpen?: boolean
  /**
   * Which basemap is showing, and the date of the imagery under the centre.
   *
   * Drawn here rather than over the map's bottom-right corner, where Leaflet
   * puts it by default. It is a licensing obligation and not chrome, so it
   * moved rather than went: the links each licence asks for are rendered as
   * real anchors from the table in lib/basemaps.
   */
  credit?: { kind: BasemapKind; date: string | null }
}

/**
 * One credited party, reachable where its licence asks it to be.
 *
 * A button calling BrowserOpenURL rather than an anchor with target="_blank".
 * This is a WKWebView, and Wails declares WKUIDelegate without implementing
 * createWebViewWith, so a blank-target link is silently ignored -- the click
 * does nothing at all. On a link the ODbL requires to be reachable, silently
 * nothing is the one outcome that cannot be shipped.
 *
 * Exported because the board's drawing map credits its basemap too, and an
 * anchor written there would be that silent failure a second time.
 */
export function Credit({ part }: { part: CreditPart }) {
  if (!part.href) return <span>{part.label}</span>
  return (
    <button
      type="button"
      onClick={() => BrowserOpenURL(part.href!)}
      className="hover:text-foreground hover:underline"
    >
      {part.label}
    </button>
  )
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
  boardSlotRef,
  layoutMode = "docked",
  onLayoutModeChange,
  credit,
  boardOpen = false,
}: TitleBarProps) {
  const { screen, user, loading, goProfile, goAuth } = useAuth()
  const onMap = screen === "map"
  const hasMap = onMap || screen === "energy"
  // The map's own readings, which need the map to be on screen to mean
  // anything. The board slot and the layout toggle stay on `hasMap`: they are
  // how the studio is left, so hiding them inside it would strand the user.
  const showMapTelemetry = hasMap && !boardOpen
  const run = runLabel?.trim()

  return (
    <header className={cn(
        "titlebar-terra app-draggable relative flex h-11 shrink-0 items-center justify-between bg-ink/40 pr-2 backdrop-blur-md",
        // The window's traffic lights own the first 4.5rem in both states.
        "pl-[4.5rem]"
      )}>
      <div className="flex items-center gap-3">
        {/*
          Hard against the corner, clear of the traffic lights and nothing else.

          It used to be a box the width of the studio's left column, centred on
          its own contents, so the wordmark read as that column's heading. The
          studio's Layout has no left column any more -- the viewport starts at
          the edge -- so the box was centring over a width that is not there.
        */}
        <div className="flex items-center gap-2">
          <img
            src="/terra-logo.png"
            alt=""
            className="h-7 w-7 object-contain"
          />
          <span className="font-display text-sm font-semibold tracking-[0.14em]">
            TERRA
          </span>
          {/* The mode, set close so "TERRA Studio" reads as one name. */}
          {boardOpen && (
            <span className="eyebrow hidden !text-foreground sm:inline">
              studio
            </span>
          )}
        </div>
        {!boardOpen && (
          <span className="hairline h-4 w-px self-center border-l" />
        )}
        {/*
          In the studio the eyebrow names the mode, not the product. "land
          cover · sentinel-2" is what the MAP screen works from, and the studio
          holds solar and wind beside land cover -- naming one of the three
          after the surface that carries all of them was the same mistake the
          energy screen already fixed here.

          Set closer to the wordmark than the screen labels are: it reads as
          part of the name rather than as a description of it.
        */}
        {!boardOpen && (
          <span className="eyebrow hidden sm:inline">
            {SCREEN_EYEBROW[screen]}
          </span>
        )}
        {/*
          Held where it was.

          The row is flex, so tightening the brand block ahead of it drags
          everything after it left by the same amount -- and the project is a
          landmark the user reaches for by position, not a consequence of how
          the title is spaced. The offset gives back exactly what the studio's
          tighter title took: the divider and its gap (0.75rem + 1px) plus the
          label's own pull (0.5rem).
        */}
        <span
          className={cn("flex items-center", boardOpen && "ml-[1.8125rem]")}
        >
        {/*
          Withheld in the studio, which carries its own data-block naming the
          board that is loaded. Two selectors on one row, each saying what is
          open and meaning something different by it, is the ambiguity this
          bar can least afford.
        */}
        {!boardOpen && projectSwitcher}
        </span>
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
        {showMapTelemetry && (
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
            {credit && (
              <>
                <span className="hairline h-4 w-px self-center border-l" />
                {/* Not telemetry, so it is not in the mono face the readings
                    use -- it is a sentence about who the imagery belongs to. */}
                <span className="hidden max-w-[26rem] truncate font-sans normal-case xl:inline">
                  <Credit part={LEAFLET_CREDIT} />
                  {credit.date ? ` \u00b7 imagery ${credit.date}` : ""}
                  {basemapByKind(credit.kind).credit.map((c, i) => (
                    <span key={c.label}>
                      {i === 0 ? " | " : " \u2014 "}
                      <Credit part={c} />
                    </span>
                  ))}
                </span>
              </>
            )}
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

        {/*
          The way into settings while the navigation column is withheld.
          Exactly when the column is gone: on the two screens that draw a map,
          in the layout that replaces the column with surfaces inside it. The
          column carries this item everywhere else, and two of them at once
          would be two answers to one question.

          Icon only. The column can afford the word beside it down 13.5rem;
          here it would sit between the coordinate readout and the window
          buttons, which is the narrowest part of the bar.
        */}
        {hasMap && layoutMode === "workspace" && !loading && (
          <button
            type="button"
            onClick={() => (user ? goProfile() : goAuth())}
            className="app-no-drag flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-raised/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={user ? "Settings" : "Sign in"}
          >
            {user?.avatar_uri ? (
              <AvatarCircle uri={user.avatar_uri} size="sm" />
            ) : user ? (
              <UserRound className="size-4" />
            ) : (
              <LogIn className="size-4" />
            )}
          </button>
        )}

        {/*
          The whiteboard toggle, between the account and the layout switch.

          Up here rather than on the surfaces that used to carry it, because
          those two mounts each had a layout they could not serve: the island's
          copy exists only in the workspace layout, and Leaflet's copy goes
          UNDER the board, an entry with no matching exit. This bar is above
          the board in both layouts -- it is the first child of a full-height
          flex column and the board is inset within the screen below it -- so
          one mount now does what two could not.

          Only where there is a map: an empty host still takes a gap-3 from
          this row, which would open a hole on every other screen.
        */}
        {hasMap && (
          <div ref={boardSlotRef} className="app-no-drag flex items-center" />
        )}

        {/* Wherever there is a map to lay out. */}
        {hasMap && onLayoutModeChange && (
          <button
            type="button"
            onClick={() =>
              onLayoutModeChange(layoutMode === "docked" ? "workspace" : "docked")
            }
            className="app-no-drag flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-raised/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={
              layoutMode === "docked"
                ? "Switch to workspace layout"
                : "Switch to docked layout"
            }
            aria-pressed={layoutMode === "workspace"}
          >
            {/* The icon names the layout it switches TO, not the one in use:
                the button is read as an action, and showing the current state
                made every user press it to find out what it did. */}
            {layoutMode === "docked" ? (
              <PanelBottom className="size-4" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </button>
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
