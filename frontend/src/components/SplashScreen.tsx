import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime"
import { GetAppVersion, GetBootLogs } from "../../wailsjs/go/main/App"
import {
  SPLASH_CURRENT_KEY,
  SPLASH_IMAGES,
  SPLASH_SEEN_VERSION_KEY,
  SPLASH_STILLS,
  claimSplashSlideForLaunch,
} from "@/lib/splashBackground"
import { BRAND_TAGLINE, RELEASE_NAME } from "@/lib/brand"

type SplashScreenProps = {
  /** When true, fade/scale out before the main window opens. */
  exiting?: boolean
  /**
   * Whether this is the real boot.
   *
   * The application menu shows this screen again on request, and at that
   * moment nothing is booting: the boot events have long since stopped and the
   * last line would read "booting…" over a window that has been open for an
   * hour. A still shown deliberately drops the status and the boot line rather
   * than claim either, and does not subscribe to a stream that will never
   * speak again.
   */
  live?: boolean
}

/**
 * Compact boot UI for the small splash window, before the main shell.
 *
 * The website's hero at the size of this window: a full-bleed aerial still
 * with a slow pan, a status bar with the release, the website header's lockup
 * over its outlined wordmark, and the boot log's last line in the foot. The
 * styles are in splash.css, shared with the copy index.html paints first. One
 * still per launch and never a change during one: the window is up for about a
 * second. The manifest currently holds a single still, so every launch is that
 * one; the claim below is what walks the manifest whenever it holds more.
 */
export function SplashScreen({ exiting = false, live = true }: SplashScreenProps) {
  const [logs, setLogs] = useState<string[]>(["booting…"])
  /*
    Claimed once, and never advanced.

    There used to be a 7-second carousel here. The splash lives for about a
    second now, so the interval never fired and the Ken Burns pan -- 16 seconds
    with `forwards` -- never reached its second keyframe either. A rotation
    nobody can see is a still, so this is a still: one image per launch, the
    next one next time.
  */
  const [slide, setSlide] = useState(() =>
    claimSplashSlideForLaunch(SPLASH_IMAGES.length)
  )

  /*
    Null until the Go side answers, so the line renders without it and gains it
    a frame later rather than reserving blank space for it.
  */
  const [version, setVersion] = useState<string | null>(null)

  /*
    The featured still, on the first launch after an update.

    THE CLAIM IS NOT DISCARDED. This used to clear SPLASH_CURRENT_KEY before
    re-claiming, on the reasoning that re-claiming would be a no-op except
    after an update. It was the opposite: clearing the key is what removed the
    evidence of index.html's claim, so every single launch re-picked and the
    image visibly swapped a moment after the window opened. The HTML paints
    first and its choice is the one that stands.

    Only a genuinely new version overrides it, and that is decided by reading
    the stored version rather than by throwing the claim away and seeing what
    comes back.
  */
  useEffect(() => {
    let cancelled = false
    GetAppVersion()
      .then((version) => {
        if (cancelled || !version) return
        setVersion(version)

        let seen: string | null = null
        try {
          seen = localStorage.getItem(SPLASH_SEEN_VERSION_KEY)
        } catch {
          /* storage unavailable: keep what the HTML chose */
        }
        if (seen === version) return

        // First launch on this version: the release's own still takes over,
        // and claiming records the version so this does not repeat.
        try {
          sessionStorage.removeItem(SPLASH_CURRENT_KEY)
        } catch {
          /* storage unavailable: keep what the HTML chose */
        }
        setSlide(claimSplashSlideForLaunch(SPLASH_IMAGES.length, version))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Nothing is booting when the menu asks for this; see `live`.
    if (!live) return
    let cancelled = false

    GetBootLogs()
      .then((lines) => {
        if (cancelled) return
        const cleaned = (lines ?? []).filter(Boolean)
        if (cleaned.length) setLogs(cleaned)
      })
      .catch(() => {})

    const onLog = (msg: string) => {
      if (!msg) return
      setLogs((prev) => {
        if (prev[prev.length - 1] === msg) return prev
        return [...prev, msg]
      })
    }

    EventsOn("boot:log", onLog)
    return () => {
      cancelled = true
      EventsOff("boot:log")
    }
  }, [live])

  const statusLine = logs[logs.length - 1] ?? "booting…"
  const activeImage = SPLASH_STILLS[slide]?.path ?? SPLASH_IMAGES[0]

  return (
    <div className={`splash app-draggable ${exiting ? "splash--exit" : ""}`}>
      {/*
        One layer, for the still this launch claimed.

        All three used to render at once, each with its own background-image, so
        the browser fetched every one -- two of three downloads thrown away on a
        window that shows one, pulled at exactly the moment the bundle it is
        covering wants the network. The HTML preloads this one before any of
        this runs, so by here it is already in cache.
      */}
      <div
        key={activeImage}
        className={`splash__still splash__still--${(slide % 3) + 1}`}
        style={{ backgroundImage: `url(${activeImage})` }}
        aria-hidden
      />
      <div className="splash__scrim" aria-hidden />
      <div className="splash__grid" aria-hidden />
      <SplashOrbit />

      <div className="splash__bar">
        {live && (
          <span className="splash__state">
            <span className="splash__dot" aria-hidden />
            Booting
          </span>
        )}
        <span className="splash__spacer" />
        {/*
          The release, named. Fixed for the version.

          This briefly showed the name of the still on screen, which made it
          change every launch as the rotation advanced -- a name that moves
          is a caption, not a name. The photograph rotates; the release does
          not.
        */}
        <span>
          {version && `v${version} · `}
          {RELEASE_NAME}
        </span>
      </div>

      <div className="splash__body">
        <div className="splash__lockup">
          <img className="splash__mark" src="/terra-logo.png" alt="" />
          <p className="splash__tagline">{BRAND_TAGLINE}</p>
        </div>
        <img
          className="splash__word"
          src="/terra-wordmark.svg"
          alt="TERRA"
          width={4669}
          height={728}
        />
      </div>

      {live && (
        <div className="splash__foot app-no-drag">
          <p className="splash__label">Boot</p>
          <p className="splash__log" title={statusLine}>
            {statusLine}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The website hero's orbit, drawn for this window: a track and a satellite on
 * it, over the part of the photograph nothing is read on.
 *
 * SMIL rather than a CSS motion path, because the track is in the SVG's own
 * coordinates and follows the viewBox to the full-window replay; a CSS path is
 * in page pixels and would need recomputing per size. SMIL does not answer to
 * prefers-reduced-motion, so the clock is paused here instead. The negative
 * begin puts the first frame on the visible stretch of the track, which is
 * also where a paused satellite stays.
 *
 * Not in index.html's copy: a second one there would restart under this one at
 * the handoff, so the orbit arrives with the cross-fade instead.
 */
function SplashOrbit() {
  const ref = useRef<SVGSVGElement>(null)

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ref.current?.pauseAnimations()
    }
  }, [])

  return (
    <svg
      ref={ref}
      className="splash__orbit"
      viewBox="0 0 420 280"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <g transform="rotate(-14 300 92)">
        <ellipse
          className="splash__orbit-track"
          cx={300}
          cy={92}
          rx={160}
          ry={40}
          vectorEffect="non-scaling-stroke"
        />
        <g>
          <line
            className="splash__orbit-nadir"
            x1={0}
            y1={0}
            x2={0}
            y2={14}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            className="splash__orbit-ring"
            r={6.5}
            vectorEffect="non-scaling-stroke"
          />
          <circle className="splash__orbit-sat" r={2.2} />
          {/* The same ellipse as the track, as a path, from its left end. */}
          <animateMotion
            path="M140,92 a160,40 0 1,0 320,0 a160,40 0 1,0 -320,0"
            dur="36s"
            begin="-6s"
            repeatCount="indefinite"
          />
        </g>
      </g>
    </svg>
  )
}
