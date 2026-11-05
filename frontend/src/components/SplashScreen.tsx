import { useEffect, useState } from "react"
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime"
import { GetAppVersion, GetBootLogs, GetBootState } from "../../wailsjs/go/main/App"
import { BRAND_TAGLINE } from "@/lib/brand"

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

/** The three orbits of the scene; splash.css gives each its size and rate. */
const ORBITS = [1, 2, 3] as const

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
 * The Earth at night under three turning orbits, after the constellation
 * section of pixxel.space: a status bar with the boot state and the version,
 * the website header's lockup over its wordmark, and the boot log's last line
 * in the foot. The styles are in splash.css, shared with the copy index.html
 * paints first, and this renders the same markup so the handoff between the
 * two does not show.
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
        <div className="splash__sky">
          <div className="splash__stars splash__stars--a" />
          <div className="splash__stars splash__stars--b" />
          <div className="splash__stars splash__stars--c" />
        </div>
        {ORBITS.map((n) => (
          <div key={n} className={`splash__orbit splash__orbit--${n}`}>
            <img className="splash__sat" src="/terra-splash-satellite.svg" alt="" />
          </div>
        ))}
        <img className="splash__earth" src="/terra-splash-earth.webp" alt="" />
      </div>

      <div className="splash__bar">
        {live && (
          <span className="splash__state">
            <span className={`splash__dot splash__dot--${state}`} aria-hidden />
            {STATE_LABEL[state]}
          </span>
        )}
        <span className="splash__spacer" />
        {/*
          The version alone. The release's code name used to follow it here;
          it was taken off the splash, which now carries nothing over the
          scene but the version, the lockup and the wordmark.
        */}
        {version && <span>v{version}</span>}
      </div>

      <div className="splash__body">
        <div className="splash__lockup">
          <img className="splash__mark" src="/terra-logo.png" alt="" />
          <p className="splash__tagline">{BRAND_TAGLINE}</p>
        </div>
        <img
          className="splash__word"
          src="/terra-wordmark-filled.svg"
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
