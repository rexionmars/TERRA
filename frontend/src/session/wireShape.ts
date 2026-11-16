/** How the wires between cards are drawn, kept with the reader's preferences. */
import { useCallback, useRef, useState } from "react"

import { useAuth } from "@/lib/auth"
import { notifyError } from "@/lib/notify"
import { mergePreferenceExtras, wireShapeFromPrefs } from "@/lib/preferenceExtras"
import type { WireShape } from "@/lib/wirePath"

/**
 * The shape the node fields draw their wires in, and the way to change it.
 *
 * One preference for Workflows and Compare, read from the stored preferences
 * by each, so a shape chosen on one field is the shape of the other. A choice
 * is shown at once and held until the stored preferences carry it, since they
 * change only once the write has come back.
 */
export function useWireShape(): [WireShape, (shape: WireShape) => void] {
  const { prefs, savePrefs } = useAuth()
  const [pending, setPending] = useState<WireShape | null>(null)
  /* Only the latest choice lets go of what is shown, or an earlier write coming
     back last would show its shape for a moment. */
  const latest = useRef(0)

  const choose = useCallback(
    (shape: WireShape) => {
      setPending(shape)
      if (!prefs) return
      const n = ++latest.current
      void savePrefs(
        {
          ...prefs,
          extras_json: mergePreferenceExtras(prefs.extras_json, { wire_shape: shape }),
        },
        { silent: true }
      )
        .catch((e: unknown) => notifyError("The wire shape could not be kept", e))
        .finally(() => {
          if (latest.current === n) setPending(null)
        })
    },
    [prefs, savePrefs]
  )

  return [pending ?? wireShapeFromPrefs(prefs), choose]
}
