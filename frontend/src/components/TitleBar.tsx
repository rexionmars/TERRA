import {
  LogIn,
  Minus,
  PanelBottom,
  PanelLeft,
  Square,
  UserRound,
  X,
} from "lucide-react"
import { BRAND_TAGLINE } from "@/lib/brand"
import { AvatarCircle } from "@/components/AvatarCircle"
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  BrowserOpenURL,
  Environment,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../../wailsjs/runtime/runtime"
import { ELEVATION_CREDIT } from "@/components/map/terrain"
import { mapPose, subscribeMapPose } from "@/lib/mapPose"
import type { LayoutMode, PredictResult } from "@/lib/types"
import {
  MAPLIBRE_CREDIT,
  basemapByKind,
  type BasemapKind,
  type CreditPart,
} from "@/lib/basemaps"
import { useAuth } from "@/lib/auth"
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
   * Where the map screen hangs its studio toggle.
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
  credit?: { kind: BasemapKind; date: string | null; terrain?: boolean }
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
  /*
    The live pose, subscribed to rather than received.

    `view` is still the prop and still what App holds, but App only hears about
    the settled value now, once per gesture -- the reporter used to write every
    frame of a drag into the root component, and the root's subtree is every
    screen the application has. This readout is the only thing that wants those
    intermediate values, so it is the only thing that re-renders for them. The
    prop stands in until the map has reported: on a screen with no map, and on
    the first paint of one, the store is empty.
  */
  const live = useSyncExternalStore(subscribeMapPose, mapPose)
  const shown = live ?? view
  /*
    Whether the platform draws the window controls, asked once.

    Not a user-agent string: Wails reports the platform it was built for, which
    is the thing being asked about. Starts false, so the buttons are absent for
    the frame before the answer arrives -- appearing late reads as the bar
    settling, where disappearing late reads as a glitch.
  */
  const [onMac, setOnMac] = useState(false)
  useEffect(() => {
    let cancelled = false
    void Environment()
      .then((env) => {
        if (!cancelled) setOnMac(env.platform === "darwin")
      })
      .catch(() => {
        /* No runtime to ask: leave the buttons drawn, which is the safe way
           to be wrong -- a window with no controls cannot be closed. */
      })
    return () => {
      cancelled = true
    }
  }, [])
  const onMap = screen === "map"
  const hasMap = onMap || screen === "energy"
  // The map's own readings, which need the map to be on screen to mean
  // anything. The board slot and the layout toggle stay on `hasMap`: they are
  // how the studio is left, so hiding them inside it would strand the user.
  const showMapTelemetry = hasMap && !boardOpen
  const run = runLabel?.trim()

  return (
    <header className={cn(
        // border-border/60 matches the sidebar's right edge, which this line
        // meets at the top-left corner.
        "app-draggable relative flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-ink/40 pr-2 backdrop-blur-md",
        /*
          The window's traffic lights own the first 4.5rem in both states, and
          the wordmark keeps a centimetre clear of them.

          Written as `1cm` rather than as the rem it works out to, because the
          quantity being asked for is a physical distance between two things a
          reader sees side by side -- the last traffic light and the mark --
          and CSS defines the unit against the reference pixel, so it does not
          drift if the root size is ever changed. The 4.5rem stays a rem: it is
          the space the platform's own controls occupy, which is theirs.

          Unconditional, like the 4.5rem it adds to. `onMac` is resolved from
          the runtime after mount and starts false, so gating either value on
          it would slide the wordmark leftward on every launch.
        */
        "pl-[calc(4.5rem+1cm)]"
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
          {/*
            One signature, on every screen, from the module that owns it.

            There were three taglines: this file carried "for explorers", the
            splash and index.html carried "earth observation · energy" out of
            lib/brand.ts, and this line swapped itself for "studio" when the
            studio was up. So the application answered "what is this?" with a
            different sentence depending on where you looked.

            The swap went with them. It existed to tell a reader which of two
            surfaces they were on, and there are not two surfaces -- the studio
            opens OVER the map and is plainly on screen when it is. A signature
            that changes with state is not a signature.
          */}
          <span className="eyebrow hidden sm:inline">{BRAND_TAGLINE}</span>
        </div>
        {/*
          Inside the brand block, not after a divider. A rule between the
          wordmark and a signature would cut a name in half; it was there to
          separate the name from a claim about the screen, and there is no
          claim any more.
        */}
        <span
          className={cn("flex items-center", boardOpen && "ml-[1.8125rem]")}
        >
        {/*
          Withheld in the studio, which names the open project in its own block
          -- as the crumb before the board's name, so the relation is stated
          rather than left to two selectors on one row each saying what is open
          and meaning something different by it.

          The reason given here used to be that the studio's block named "the
          board that is loaded", which it did and still does. That was not a
          substitute: a board is not a project, so while the studio was up
          nothing on screen said which project the areas drawn and the runs
          made there were being filed under.
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
              LAT <span className="text-foreground">{fmtCoord(shown.lat, "N", "S")}</span>
            </span>
            <span>
              LON <span className="text-foreground">{fmtCoord(shown.lon, "E", "W")}</span>
            </span>
            <span>
              Z <span className="text-foreground">{shown.zoom.toFixed(0)}</span>
            </span>
            {credit && (
              <>
                <span className="hairline h-4 w-px self-center border-l" />
                {/* Not telemetry, so it is not in the mono face the readings
                    use -- it is a sentence about who the imagery belongs to. */}
                <span className="hidden max-w-[26rem] truncate font-sans normal-case xl:inline">
                  <Credit part={MAPLIBRE_CREDIT} />
                  {credit.date ? ` \u00b7 imagery ${credit.date}` : ""}
                  {basemapByKind(credit.kind).credit.map((c, i) => (
                    <span key={c.label}>
                      {i === 0 ? " | " : " \u2014 "}
                      <Credit part={c} />
                    </span>
                  ))}
                  {/*
                    Only while relief is drawn, because only then is a second
                    provider on screen. It is also what keeps the elevation
                    mosaic distinct from the DEMs an analysis was computed on --
                    see components/map/terrain.ts.
                  */}
                  {credit.terrain && (
                    <span>
                      {" \u2014 "}
                      <Credit part={ELEVATION_CREDIT} />
                    </span>
                  )}
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
          The studio toggle, between the account and the layout switch.

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

        {/*
          Wherever there is a map to lay out, and NOT while the studio covers
          it.

          The board draws its own 15rem column and the shell's navigation
          column would fight it for the left edge, so MapScreen pins the layout
          to workspace for as long as the board is up and restores the previous
          one on close. That makes this control inert in that mode rather than
          merely redundant: a press sets docked and the pinning effect sets it
          back on the same beat, so the icon flickers and the layout does not
          move. A control whose only outcome is to be undone is one to withhold.
        */}
        {hasMap && !boardOpen && onLayoutModeChange && (
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

        {/*
          NOT ON macOS, where the platform draws them itself.

          These were written for a frameless window, which has no controls of
          its own. The window is titled now -- frameless made macOS composite it
          off the path it uses for titled windows, and that slowed every other
          window sharing its space -- so the traffic lights sit at the other end
          of this same bar, and drawing a second minimise, maximise and close
          beside the avatar put two sets of window controls on one window.

          Kept everywhere else: on Windows and Linux this bar is still the only
          place they exist.
        */}
        {!onMac && (
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
        )}
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
