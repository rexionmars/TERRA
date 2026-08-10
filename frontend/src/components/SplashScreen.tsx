import { useEffect, useState } from "react"
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
}

/**
 * Compact boot UI for the small splash window, before the main shell.
 *
 * A full-bleed aerial still with a slow pan, the brand centred, and the boot
 * log's last line along the bottom. The still rotates per launch rather than
 * during one: the window is up for about a second.
 */
export function SplashScreen({ exiting = false }: SplashScreenProps) {
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
  }, [])

  const statusLine = logs[logs.length - 1] ?? "booting…"
  const activeImage = SPLASH_STILLS[slide]?.path ?? SPLASH_IMAGES[0]

  return (
    <div
      className={`app-draggable splash-screen relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden px-5 text-foreground ${
        exiting ? "splash-screen--exit" : ""
      }`}
    >
      {/*
        One layer, for the still this launch claimed.

        All three used to render at once, each with its own background-image, so
        the browser fetched every one -- two of three downloads thrown away on a
        window that shows one, pulled at exactly the moment the bundle it is
        covering wants the network. The HTML preloads this one before any of
        this runs, so by here it is already in cache.
      */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          key={activeImage}
          className={`splash-kenburns splash-kenburns--${(slide % 3) + 1} is-active`}
          style={{ backgroundImage: `url(${activeImage})` }}
        />
        <div className="splash-kenburns-scrim absolute inset-0" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3.5">
        <img
          src="/terra-logo.png"
          alt=""
          className="h-14 w-14 object-contain drop-shadow-[0_2px_12px_rgb(0_0_0_/_0.55)]"
        />
        <div className="flex flex-col items-center gap-1.5">
          <p className="font-display text-lg font-semibold tracking-[0.18em] drop-shadow-[0_1px_8px_rgb(0_0_0_/_0.65)]">
            TERRA
          </p>
          <p className="eyebrow drop-shadow-[0_1px_6px_rgb(0_0_0_/_0.55)]">
            {BRAND_TAGLINE}
          </p>
          {/*
            The release, named. Fixed for the version.

            This briefly showed the name of the still on screen, which made it
            change every launch as the rotation advanced -- a name that moves
            is a caption, not a name. The photograph rotates; the release does
            not.
          */}
          <p className="telemetry text-meta text-foreground/70 drop-shadow-[0_1px_6px_rgb(0_0_0_/_0.55)]">
            {RELEASE_NAME}
            {version && ` · ${version}`}
          </p>
          <div className="mt-1 h-0.5 w-7 rounded-[1px] bg-accent/85" aria-hidden />
        </div>
        <span
          className="mt-1 h-1.5 w-1.5 animate-pulse rounded-[1px] bg-accent"
          aria-hidden
        />
      </div>

      <p
        className="app-no-drag absolute bottom-4 left-4 right-4 z-10 truncate text-center font-telemetry text-[10px] tracking-wide text-foreground/85 drop-shadow-[0_1px_6px_rgb(0_0_0_/_0.75)]"
        title={statusLine}
      >
        {statusLine}
      </p>
    </div>
  )
}
