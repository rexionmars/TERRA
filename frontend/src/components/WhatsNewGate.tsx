import { useCallback, useEffect, useRef, useState } from "react"
import { GetAppVersion } from "../../wailsjs/go/main/App"
import { useAuth } from "@/lib/auth"
import {
  mergePreferenceExtras,
  parsePreferenceExtras,
} from "@/lib/preferenceExtras"
import {
  compareSemver,
  entriesSince,
  shouldSkipWhatsNew,
  type WhatsNewEntry,
} from "@/lib/whatsNew"
import { WhatsNewModal } from "@/components/WhatsNewModal"

/** Keep aligned with main.AppVersion in version.go when GetAppVersion is unavailable. */
const FALLBACK_APP_VERSION = "0.3.0"

/**
 * After splash + prefs load: show What’s New when the product version is newer
 * than last_seen (missing last_seen counts as never seen → show current notes once).
 */
export function WhatsNewGate() {
  const { prefs, loading, savePrefs } = useAuth()
  const [entries, setEntries] = useState<WhatsNewEntry[] | null>(null)
  const [currentVersion, setCurrentVersion] = useState("")
  const decidedRef = useRef(false)

  useEffect(() => {
    if (loading || !prefs || decidedRef.current) return
    decidedRef.current = true

    void (async () => {
      let current = FALLBACK_APP_VERSION
      try {
        const fromGo = (await GetAppVersion())?.trim()
        if (fromGo) current = fromGo
      } catch {
        /* use FALLBACK_APP_VERSION */
      }

      if (shouldSkipWhatsNew(current)) return

      const last =
        parsePreferenceExtras(prefs.extras_json).last_seen_version?.trim() || ""

      const persistSeen = async () => {
        try {
          await savePrefs(
            {
              ...prefs,
              extras_json: mergePreferenceExtras(prefs.extras_json, {
                last_seen_version: current,
              }),
            },
            { silent: true }
          )
        } catch {
          /* best-effort */
        }
      }

      // Never seen (or first launch with this feature): baseline below any release notes.
      const baseline = last || "0.0.0"
      if (compareSemver(current, baseline) <= 0) return

      const next = entriesSince(baseline, current)
      if (next.length === 0) {
        await persistSeen()
        return
      }

      setCurrentVersion(current)
      setEntries(next)
    })()
  }, [loading, prefs, savePrefs])

  const onContinue = useCallback(() => {
    const version = currentVersion
    const snapshot = prefs
    setEntries(null)
    if (!snapshot || !version) return
    void savePrefs(
      {
        ...snapshot,
        extras_json: mergePreferenceExtras(snapshot.extras_json, {
          last_seen_version: version,
        }),
      },
      { silent: true }
    ).catch(() => {
      /* best-effort */
    })
  }, [currentVersion, prefs, savePrefs])

  if (!entries?.length || !currentVersion) return null

  return (
    <WhatsNewModal
      currentVersion={currentVersion}
      entries={entries}
      onContinue={onContinue}
    />
  )
}
