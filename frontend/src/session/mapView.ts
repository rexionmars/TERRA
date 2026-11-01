/** Where the map is, kept across surfaces and across sessions. */
import { useCallback, useEffect, useRef } from "react"

import { useAuth } from "@/lib/auth"
import { parsePreferenceExtras } from "@/lib/preferenceExtras"

export function useMapView() {
  const { prefs, savePrefs } = useAuth()
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  /**
   * Remember where the map was left, so the next session resumes there.
   *
   * The map emits on every pan and zoom frame, so this is debounced and only
   * writes once the view has settled. Failures are ignored: this is a
   * convenience, and losing it must never interrupt work.
   */
  const viewSaveTimer = useRef<number | undefined>(undefined)
  /**
   * Live map position, so returning to the map screen resumes exactly where it
   * was left rather than at whatever the debounced write last committed.
   */
  const liveViewRef = useRef<{ lat: number; lon: number; zoom: number } | null>(null)
  const persistMapView = useCallback(
    (v: { lat: number; lon: number; zoom: number }) => {
      if (viewSaveTimer.current) window.clearTimeout(viewSaveTimer.current)
      viewSaveTimer.current = window.setTimeout(() => {
        const current = prefsRef.current
        if (!current) return
        const extras = parsePreferenceExtras(current.extras_json)
        const last = extras.map_view
        // Skip a write when nothing meaningful moved.
        if (
          last &&
          Math.abs(last.lat - v.lat) < 1e-4 &&
          Math.abs(last.lon - v.lon) < 1e-4 &&
          last.zoom === v.zoom
        ) {
          return
        }
        extras.map_view = {
          lat: Number(v.lat.toFixed(5)),
          lon: Number(v.lon.toFixed(5)),
          zoom: v.zoom,
        }
        void savePrefs(
          { ...current, extras_json: JSON.stringify(extras) },
          { silent: true }
        ).catch(() => {
          /* best-effort */
        })
      }, 1200)
    },
    [savePrefs]
  )

  useEffect(
    () => () => {
      if (viewSaveTimer.current) window.clearTimeout(viewSaveTimer.current)
    },
    []
  )

  /**
   * Where the map is, for every surface that carries one.
   *
   * One live ref and one debounced write to the same map_view preference. Two
   * memories would let a pan made on one surface be lost on the way back to
   * another, or the reverse, depending on which one last committed.
   */
  const handleViewChange = useCallback(
    (v: { lat: number; lon: number; zoom: number }) => {
      liveViewRef.current = v
      persistMapView(v)
    },
    [persistMapView]
  )

  const initialView =
    liveViewRef.current ?? parsePreferenceExtras(prefs?.extras_json).map_view ?? null

  return { initialView, onViewChange: handleViewChange }
}
