/**
 * The open project, and what is kept about it in the preferences.
 *
 * Under everything else, because every run, area and composition is filed against the
 * id held here.
 */
import { useCallback, useRef, useState } from "react"

import { useAuth } from "@/lib/auth"
import { parsePreferenceExtras } from "@/lib/preferenceExtras"

export function useProjectMemory() {
  const { prefs, savePrefs } = useAuth()
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId
  /** Set when activate runs before prefs have loaded; flushed on next prefs hydrate. */
  const pendingActiveProjectRef = useRef<string | null | undefined>(undefined)

  const persistAoiLabel = useCallback(
    async (label: string | null) => {
      const current = prefsRef.current
      if (!current) return
      const extras = parsePreferenceExtras(current.extras_json)
      // Keep React's active project — prefs may lag behind a just-activated id.
      const aid = activeProjectIdRef.current?.trim()
      if (aid) extras.active_project_id = aid
      else delete extras.active_project_id
      const next = label?.trim()
      if (next) extras.aoi_label = next
      else delete extras.aoi_label
      try {
        await savePrefs(
          {
            ...current,
            extras_json: JSON.stringify(extras),
          },
          { silent: true }
        )
      } catch {
        /* best-effort */
      }
    },
    [savePrefs]
  )

  const persistActiveProjectId = useCallback(
    async (id: string | null) => {
      setActiveProjectId(id)
      activeProjectIdRef.current = id
      const current = prefsRef.current
      if (!current) {
        pendingActiveProjectRef.current = id
        return
      }
      pendingActiveProjectRef.current = undefined
      const extras = parsePreferenceExtras(current.extras_json)
      if (id) extras.active_project_id = id
      else delete extras.active_project_id
      try {
        await savePrefs(
          {
            ...current,
            extras_json: JSON.stringify(extras),
          },
          { silent: true }
        )
      } catch {
        /* best-effort */
      }
    },
    [savePrefs]
  )

  return {
    activeProjectId,
    setActiveProjectId,
    activeProjectIdRef,
    pendingActiveProjectRef,
    persistAoiLabel,
    persistActiveProjectId,
  }
}
