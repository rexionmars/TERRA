import { useEffect, useRef } from "react"

import { useAuth } from "@/lib/auth"
import { notifyError } from "@/lib/notify"
import { InspectEnvironment } from "../../wailsjs/go/main/App"

/**
 * Open settings at System when nothing can be computed.
 *
 * Checked here rather than during boot: it imports every dependency in the
 * target interpreter, which costs seconds, and the splash has a fast probe
 * for the interpreter itself. This runs once the shell is already up.
 *
 * Sending the user somewhere is the point. Without it the application opens
 * looking healthy, the user draws an area, chooses a period, waits, and the
 * run dies on an import -- this moves that failure earlier, to the page that
 * can fix it.
 *
 * It goes to a settings page rather than a screen of its own. Configuring the
 * interpreter is a setting; giving it a separate full-screen route meant the
 * same subject could be reached three ways and left the window with no way
 * back to anything else.
 *
 * Once per session, and never over an explicit navigation: this is a
 * first-run gate, not a guard that keeps pulling someone out of a screen
 * they chose to open.
 *
 * Waits for a signed-in user. goProfile sends anyone without one to the auth
 * screen instead, so firing before sign-in spent the one attempt this gate
 * gets on a redirect to a page it did not mean -- and an unusable interpreter
 * then went unreported for the rest of the session, which is precisely the
 * silence the gate exists to break.
 */
export function useEnvironmentGate() {
  const { user, goProfile } = useAuth()
  const envGateDone = useRef(false)
  useEffect(() => {
    if (!user || envGateDone.current) return
    envGateDone.current = true
    void (async () => {
      /*
        It says why before it moves anyone.

        This used to redirect in silence: the map appeared, then settings
        replaced it a moment later with nothing on screen accounting for the
        jump. That is indistinguishable from a navigation bug, and it was read
        as one -- the person it was trying to help concluded the application
        was broken, which is worse than the silence it replaced.

        The toast names what is missing rather than saying "something is
        wrong", because the specific package is what the user has to act on and
        the page it lands them on can only repeat it.
      */
      try {
        const state = await InspectEnvironment()
        if (state.active?.usable) return

        const missing = (state.active?.packages ?? []).filter(
          (p) => !p.optional && (!p.present || p.version_problem)
        )
        const detail = state.active?.unreachable
          ? state.active.unreachable
          : missing.length > 0
            ? `Missing: ${missing
                .slice(0, 3)
                .map((p) => p.distribution)
                .join(
                  ", "
                )}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`
            : "The selected interpreter cannot run the analysis sidecar."

        notifyError(
          "Analyses cannot run yet — opening Settings › System",
          `${detail} Choose a Python there, or let TERRA build one.`,
          { duration: 9000 }
        )
        goProfile("system")
      } catch (e) {
        // Failing to inspect is itself a reason to show the page: it is the
        // only place that can report what went wrong.
        notifyError("Could not check the Python environment", e, {
          duration: 9000,
        })
        goProfile("system")
      }
    })()
  }, [user, goProfile])
}
