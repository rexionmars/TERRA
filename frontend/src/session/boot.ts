/** The splash, and the moment it gives way to the application. */
import { useEffect, useState } from "react"

import { notifyError } from "@/lib/notify"
import { RevealMainWindow } from "../../wailsjs/go/main/App"
import { EventsOff, EventsOn } from "../../wailsjs/runtime/runtime"

export function useBootReveal() {
  const [booting, setBooting] = useState(true)
  const [splashExiting, setSplashExiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    let started = false
    let exitTimer: number | undefined
    let revealTimer: number | undefined

    /*
      boot:ready carries whether the probe succeeded, and nothing read it.

      A sidecar that failed its probe wrote the reason into the boot log, the
      splash showed it for a moment, and then the splash was replaced by an
      application that looked healthy -- the one report of the failure went
      away with the screen that carried it.

      The environment gate covers an unusable interpreter specifically. This
      covers the rest: a missing sidecar script, a probe that timed out, a
      runner that never built. Reported once, as a notification the user can
      read after the window opens.
    */
    const reveal = async () => {
      if (cancelled) return
      try {
        await RevealMainWindow()
      } catch {
        /* ignore */
      }
      // Let the OS settle the maximised frame before mounting the shell.
      revealTimer = window.setTimeout(() => {
        if (!cancelled) setBooting(false)
      }, 120)
    }

    const finish = (ok?: boolean) => {
      if (cancelled || started) return
      started = true
      if (ok === false) {
        notifyError(
          "TERRA started, but the analysis sidecar did not respond. " +
            "Settings › System reports what is wrong."
        )
      }
      setSplashExiting(true)
      // Match the .splash--exit transition in splash.css (~480ms).
      exitTimer = window.setTimeout(() => void reveal(), 480)
    }

    EventsOn("boot:ready", finish)
    /*
      The backstop, for a boot:ready that never arrives.

      Twelve seconds rather than twenty: the probe caps itself at eight and the
      floor below it is under a second, so anything past that is something
      genuinely stuck -- and the old timeout meant staring at a frozen splash
      for twenty seconds before the window would open at all.

      Called with no argument, so it is not reported as a failed probe. Nothing
      is known here; the probe may still answer after this fires.
    */
    const safety = window.setTimeout(() => finish(), 12_000)
    return () => {
      cancelled = true
      EventsOff("boot:ready")
      window.clearTimeout(safety)
      if (exitTimer) window.clearTimeout(exitTimer)
      if (revealTimer) window.clearTimeout(revealTimer)
    }
  }, [])

  return { booting, splashExiting }
}
