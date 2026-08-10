import { useEffect, useState } from "react"
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime"
import { GetBootLogs } from "../../wailsjs/go/main/App"
import {
  SPLASH_IMAGES,
  claimSplashSlideForLaunch,
} from "@/lib/splashBackground"
import { BRAND_TAGLINE } from "@/lib/brand"

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
  const [slide] = useState(() => claimSplashSlideForLaunch(SPLASH_IMAGES.length))

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
  const activeImage = SPLASH_IMAGES[slide] ?? SPLASH_IMAGES[0]

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
