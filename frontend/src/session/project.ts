/** Opening a project, and coming back to the one the last session was on. */
import { useCallback, useEffect, useRef, type RefObject } from "react"

import { useAuth } from "@/lib/auth"
import { geometryBounds } from "@/lib/geometry"
import { notifyError } from "@/lib/notify"
import { parsePreferenceExtras } from "@/lib/preferenceExtras"
import {
  projectOverlayToComposition,
  scopeCompositionsToView,
} from "@/lib/projectOverlays"
import { toAreas } from "@/lib/areas"
import type { CompositionOverlay, GeoJSONGeometry } from "@/lib/types"
import { GetProject, ListAreas, ListProjectOverlays } from "../../wailsjs/go/main/App"

export function useProjectActions({
  analysisLabel,
  setAnalysisLabel,
  setActiveProjectId,
  setActiveAreaId,
  setCustomPolygon,
  activeProjectIdRef,
  pendingActiveProjectRef,
  persistActiveProjectId,
  persistAoiLabel,
  clearAnalysisResults,
  clearRetainedRuns,
  clearGallery,
  loadGallery,
  setShowCompositionOverlay,
}: {
  analysisLabel?: string
  setAnalysisLabel: (v: string | undefined) => void
  setActiveProjectId: (id: string | null) => void
  setActiveAreaId: (id: string | undefined) => void
  setCustomPolygon: (g: GeoJSONGeometry | null) => void
  activeProjectIdRef: RefObject<string | null>
  pendingActiveProjectRef: RefObject<string | null | undefined>
  persistActiveProjectId: (id: string | null) => Promise<void>
  persistAoiLabel: (label: string | null) => Promise<void>
  clearAnalysisResults: () => void
  clearRetainedRuns: () => void
  clearGallery: () => void
  loadGallery: (gallery: CompositionOverlay[], shown: CompositionOverlay | null) => void
  setShowCompositionOverlay: (v: boolean) => void
}) {
  const { prefs, projects } = useAuth()
  const didRestoreProjectRef = useRef(false)

  // Hydrate active project from prefs only when extras change — never on AOI rename.
  useEffect(() => {
    if (!prefs) return
    if (pendingActiveProjectRef.current !== undefined) {
      const pending = pendingActiveProjectRef.current
      pendingActiveProjectRef.current = undefined
      void persistActiveProjectId(pending)
      return
    }
    const extras = parsePreferenceExtras(prefs.extras_json)
    const id = extras.active_project_id?.trim() || null
    if (id) {
      setActiveProjectId(id)
      return
    }
    setActiveProjectId(null)
    const orphanLabel = extras.aoi_label?.trim()
    if (orphanLabel && !analysisLabel) {
      setAnalysisLabel(orphanLabel)
    }
    // Intentionally omit analysisLabel: renaming AOI must not re-run this sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only follow prefs extras
  }, [prefs, prefs?.extras_json, persistActiveProjectId])

  const activateProject = useCallback(
    async (id: string | null, opts?: { userInitiated?: boolean }) => {
      // Opening a project is an explicit action and draws its AOI and most
      // recent composition on the map. Restoring one at startup is not, and
      // must not: a session that begins with an AOI outline and an overlay the
      // user did not ask for in that session leaves them clearing both by hand.
      const userInitiated = opts?.userInitiated ?? true
      /*
        WHAT THE PREVIOUS PROJECT LEFT BEHIND, dropped before this one arrives.

        Opening a project set the AOI, the label and the composition and cleared
        nothing, so the run on the map, the standalone products beside it and
        the catalogued AOI id all stayed -- every one of them belonging to the
        project just left. The visible half is a raster from another field
        sitting over the new one.

        The half that is not visible is worse, because it reaches the studio.
        The board receives `runId` as `result?.run_id || "current"` and resolves
        the live area from it and from `activeAreaId`; carrying both across meant
        the new project's ground opened under the OLD project's identity, and
        that identity is the key to everything the board keeps per area -- the
        name a reader typed, the layer order, what they removed, where they
        dragged it. boardMemory.ts describes this failure and the work done to
        end it; this path was still reaching it.

        Read before persisting, since persisting is what moves the ref.

        NOT ON RESTORE. A session resuming at its last project is not leaving
        anything, and clearing there would drop the AOI that the same startup
        restored from preferences a moment earlier.

        NOT RETAINED, either, unlike the other two callers of the clear. They
        keep the run they are leaving so the board can still show it; this is
        leaving the project that run belongs to, and putting it on the next
        project's board is the contamination being removed.
      */
      const leaving = activeProjectIdRef.current
      if (userInitiated && leaving !== id) {
        clearAnalysisResults()
        // The retained ones too. Clearing the shown result while leaving the
        // runs it moved on from in hand carries the previous project onto this
        // one's boards by the other door.
        clearRetainedRuns()
        setActiveAreaId(undefined)
      }
      await persistActiveProjectId(id)
      if (!id) {
        clearGallery()
        return
      }
      try {
        const p = await GetProject(id)
        /*
          THE GROUND THE READER WAS LAST ON, not the project's own shape.

          A project used to carry one polygon and one label, written from
          whatever was on the map, and opening it put that back. A project
          working several fields therefore always reopened on one of them, and
          which one depended on the order things had been done in. It carries a
          cursor now -- last_area_id -- into the areas it owns.

          An id that resolves to nothing is treated as no cursor: an area
          deleted since has DeleteArea clear this column, so the only way to
          reach that is a row that never existed, and reopening on nothing is
          the honest answer to it.
        */
        const rows = await ListAreas(id)
        const opened = toAreas(rows)
        const resume = opened.find((a) => a.id === p.last_area_id) ?? opened[0] ?? null
        if (userInitiated && resume) {
          setActiveAreaId(resume.id)
          setCustomPolygon(resume.geometry)
          setAnalysisLabel(resume.name)
          void persistAoiLabel(resume.name)
        } else if (userInitiated) {
          /*
            A PROJECT WITH NO GROUND YET OPENS ON NO GROUND.

            The branch above replaces the drawing when the project being opened
            has one to resume on, so the case that was never handled is the
            project that has none: the previous project's outline stayed on the
            map, over a field the opened project does not own, and a run made
            there was filed against it. The clear above this only dropped the
            catalogued id -- the shape itself was left drawn, which is the half
            a reader can see.
          */
          setCustomPolygon(null)
          setAnalysisLabel(undefined)
          void persistAoiLabel(null)
        }
        const overlays = (await ListProjectOverlays(
          id
        )) as unknown as import("@/lib/types").ProjectOverlay[]
        const gallery = overlays
          .map(projectOverlayToComposition)
          .filter((x): x is CompositionOverlay => !!x)
        // The gallery is always loaded so the compositions stay one click away
        // in Overlay Tools; only the display is conditional.
        /*
          Only a composition that covers the area being opened is put on the
          map. This took gallery[0] -- the project's most recent -- and turned
          the overlay on, so opening a project whose latest composition was
          made over a different field drew a raster off the edge of the view
          the same action had just flown to.
        */
        // From the ground being resumed on, not from the branch above, which
        // only runs when the user asked for this.
        const openedAoi = resume ? geometryBounds(resume.geometry) : null
        const inView = openedAoi
          ? scopeCompositionsToView(gallery, null, {
              lon_min: openedAoi.lonMin,
              lat_min: openedAoi.latMin,
              lon_max: openedAoi.lonMax,
              lat_max: openedAoi.latMax,
            })
          : gallery
        loadGallery(gallery, userInitiated ? (inView[0] ?? null) : null)
        setShowCompositionOverlay(userInitiated && !!inView[0])
      } catch (e) {
        notifyError("Could not open project", e)
      }
    },
    [
      clearAnalysisResults,
      persistActiveProjectId,
      clearRetainedRuns,
      persistAoiLabel,
      setActiveAreaId,
      setCustomPolygon,
      setAnalysisLabel,
      activeProjectIdRef,
      clearGallery,
      loadGallery,
      setShowCompositionOverlay,
    ]
  )

  // On boot, restore AOI + label from the last active project (prefs only stored the id).
  useEffect(() => {
    if (didRestoreProjectRef.current) return
    const id = parsePreferenceExtras(prefs?.extras_json).active_project_id?.trim()
    if (!id) return
    if (!projects.some((p) => p.id === id)) return
    didRestoreProjectRef.current = true
    void activateProject(id, { userInitiated: false })
  }, [prefs?.extras_json, projects, activateProject])

  return activateProject
}
