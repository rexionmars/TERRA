import { useEffect, useState } from "react"
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime"
import { GetAppVersion, GetBootLogs, GetBootState } from "../../wailsjs/go/main/App"
import { BRAND_PHOTO, BRAND_TAGLINE } from "@/lib/brand"

/** What the status reads; set by the Go side once the sidecar probe answers. */
type BootState = "booting" | "ready" | "failed"

const STATE_LABEL: Record<BootState, string> = {
  booting: "Booting",
  ready: "Ready",
  failed: "Sidecar failed",
}

function asBootState(s: string): BootState {
  return s === "ready" || s === "failed" ? s : "booting"
}

/**
 * How long the pre-bundle splash has been animating, in milliseconds.
 *
 * index.html stamps its copy with the time it painted, and this copy starts
 * every animation that far in, so the cross-fade between the two is between
 * two copies of one frame; see "One clock" in splash.css. Zero once that copy
 * has gone, which is how the menu's replay starts the entrance from the
 * beginning rather than an hour into it.
 */
function preBundleElapsed(): number {
  const stamp = document.getElementById("splash")?.dataset.t0
  const t0 = stamp ? Number.parseFloat(stamp) : Number.NaN
  return Number.isFinite(t0) ? Math.max(0, performance.now() - t0) : 0
}

type SplashScreenProps = {
  /** When true, fade/scale out before the main window opens. */
  exiting?: boolean
  /**
   * Whether this is the real boot.
   *
   * The application menu shows this screen again on request, and at that
   * moment nothing is booting: the boot events have long since stopped and the
   * last line would read "booting…" over a window that has been open for an
   * hour. A splash shown deliberately drops the status and the boot line rather
   * than claim either, and does not subscribe to a stream that will never
   * speak again.
   */
  live?: boolean
}

/**
 * Compact boot UI for the small splash window, before the main shell.
 *
 * A photograph of the ground across the window, with the lockup and the boot
 * state over its sky and a base at the foot: a bar with the boot log's last
 * line and the version, and a tab rising from it with the wordmark. The styles
 * are in splash.css, shared with the copy index.html paints first, and this
 * renders the same markup so the handoff between the two does not show.
 */
export function SplashScreen({ exiting = false, live = true }: SplashScreenProps) {
  const [logs, setLogs] = useState<string[]>(["booting…"])
  // Read once, at mount: the moment the two copies have to agree on.
  const [elapsed] = useState(preBundleElapsed)

  /*
    Null until the Go side answers, so the line renders without it and gains it
    a frame later rather than reserving blank space for it.
  */
  const [version, setVersion] = useState<string | null>(null)
  const [state, setState] = useState<BootState>("booting")

  useEffect(() => {
    let cancelled = false
    GetAppVersion()
      .then((version) => {
        if (!cancelled && version) setVersion(version)
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

    // Asked as well as listened for: the probe may have answered before this
    // mounted, and the event that said so has gone.
    GetBootState()
      .then((s) => {
        if (!cancelled) setState((prev) => (prev === "booting" ? asBootState(s) : prev))
      })
      .catch(() => {})
    const onState = (s: string) => setState(asBootState(s))
    EventsOn("boot:state", onState)

    return () => {
      cancelled = true
      EventsOff("boot:log")
      EventsOff("boot:state")
    }
  }, [live])

  const statusLine = logs[logs.length - 1] ?? "booting…"

  return (
    <div
      className={`splash app-draggable ${exiting ? "splash--exit" : ""}`}
      style={{ ["--sp-elapsed" as string]: `${Math.round(elapsed)}ms` }}
    >
      <div className="splash__scene" aria-hidden>
        <img
          className="splash__photo"
          srcSet="/terra-splash-water-tap-840.webp 840w, /terra-splash-water-tap.webp 2400w"
          sizes="100vw"
          src="/terra-splash-water-tap.webp"
          alt=""
        />
        <div className="splash__scrim" />
      </div>

      <div className="splash__bar">
        <span className="splash__spacer" />
        {live && (
          <span className="splash__state">
            <span className={`splash__dot splash__dot--${state}`} aria-hidden />
            {STATE_LABEL[state]}
          </span>
        )}
      </div>

      <div className="splash__lockup">
        <img className="splash__mark" src="/terra-logo.png" alt="" />
        <p className="splash__tagline">{BRAND_TAGLINE}</p>
      </div>

      <div className="splash__base">
        <div className="splash__tab" />
        <div className="splash__foot app-no-drag">
          {live && (
            <p className="splash__log" title={statusLine}>
              {statusLine}
            </p>
          )}
          <p className="splash__meta">
            <span className="splash__credit">
              Photo: {BRAND_PHOTO.author} · {BRAND_PHOTO.license}
            </span>
            {/*
              The version alone. The release's code name used to follow it;
              the splash carries no name over the picture but the wordmark.
            */}
            {version && <span>v{version}</span>}
          </p>
        </div>
        <img
          className="splash__word"
          src="/terra-wordmark-filled.svg"
          alt="TERRA"
          width={4669}
          height={728}
        />
      </div>
    </div>
  )
}
