/** What is done to areas: drawn, imported, chosen, renamed, deleted, selected for a queue. */
import { useCallback, useMemo, useRef, useState } from "react"

import { extendSelection, toArea, type Area } from "@/lib/areas"
import { importedPolygon } from "@/lib/importedPolygon"
import { notifyError, notifySuccess } from "@/lib/notify"
import { readBoardMemory } from "@/components/workspace/boardMemory"
import type { GeoJSONGeometry } from "@/lib/types"
import {
  CreateArea,
  DeleteArea,
  SetProjectLastArea,
  UpdateArea,
} from "../../wailsjs/go/main/App"
import type { GroundState } from "./ground"

export interface AreaProps {
  customPolygon: GeoJSONGeometry | null
  areaLabel?: string
  hasArea: boolean
  /** The AOI as GeoJSON text, for the research pack's manifest. */
  polygonGeoJSON?: string
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  /** Catalog of drawn/imported AOIs kept beside the active shape. */
  areas?: Area[]
  activeAreaId?: string
  onActivateArea?: (id: string) => void
  onRenameArea?: (id: string, name: string) => void
  onDeleteArea?: (id: string) => Promise<void>
  onClearArea: () => void
  onImportPolygon: () => void
  /** A published boundary chosen in the catalogue card, to become an area. */
  onPickBoundary?: (name: string, geometry: GeoJSONGeometry) => void
  /**
   * The areas the next jobs are queued over (selectAreas here), and the queueing
   * itself. While any is selected the band queues its product over them rather than
   * running it over the area in hand.
   */
  selectedAreaIds?: string[]
  onSelectAreas?: (ids: string[], mode: "toggle" | "add") => void
  onClearSelection?: () => void
}

export function useAreaActions({
  ground,
  activeProjectId,
  persistAoiLabel,
  takeCompositionOffMap,
  forgetCompositions,
}: {
  ground: GroundState
  activeProjectId: string | null
  persistAoiLabel: (label: string | null) => Promise<void>
  takeCompositionOffMap: () => void
  forgetCompositions: () => void
}) {
  const {
    customPolygon,
    setCustomPolygon,
    areas,
    activeAreaId,
    setActiveAreaId,
    setAnalysisLabel,
    refreshAreas,
    areaLabel,
    polygonGeoJSON,
  } = ground

  /*
    THE AREAS A JOB IS QUEUED OVER: shift-pressed on the globe or in the
    outliner, boxed with a shift-drag, or an area's fields all at once.

    Apart from the area in use, which stays the one the band runs over and the
    board shows: a selection is where the next jobs go, and making each
    shift-pressed field the area in use would move the board to it and drop
    whatever it was showing, once per press. A plain press activates an area
    and clears the selection, as a plain press does in a list.
  */
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([])
  const liveSelection = useMemo(
    () => selectedAreaIds.filter((id) => areas.some((a) => a.id === id)),
    [selectedAreaIds, areas]
  )
  const selectAreas = useCallback(
    (ids: string[], mode: "toggle" | "add") =>
      setSelectedAreaIds((prev) =>
        extendSelection(prev, ids, areas, activeAreaId, mode)
      ),
    [areas, activeAreaId]
  )
  const clearSelection = useCallback(() => setSelectedAreaIds([]), [])

  /*
    One drawn ground, written to the open project.

    THE REFUSAL IS THE POINT. An area used to be created wherever a shape
    arrived, belonging to nothing, and the run made over it inherited whichever
    project happened to be selected -- which is how 58 runs from several fields
    came to sit inside one project. There is nowhere to put an area without a
    project, so this says so instead of inventing somewhere.

    Returns the created area, or null when it refused or the write failed. The
    callers use that to decide whether to say anything.
  */
  const createArea = useCallback(
    async (geom: GeoJSONGeometry, nameHint?: string): Promise<Area | null> => {
      if (!activeProjectId) {
        notifyError("Open a project first: an area belongs to one.")
        return null
      }
      try {
        const row = await CreateArea(
          activeProjectId,
          nameHint?.trim() ?? "",
          JSON.stringify(geom)
        )
        const entry = toArea(row)
        if (!entry) {
          notifyError("The area was saved but its shape could not be read back.")
          return null
        }
        await refreshAreas(activeProjectId)
        setActiveAreaId(entry.id)
        setCustomPolygon(entry.geometry)
        setAnalysisLabel(entry.name)
        takeCompositionOffMap()
        // A ground just drawn is the ground being worked on, so the project
        // resumes here. Best effort, as in activateArea.
        void SetProjectLastArea(activeProjectId, entry.id).catch(() => {})
        return entry
      } catch (e) {
        notifyError("Could not save the area", e)
        return null
      }
    },
    [
      activeProjectId,
      refreshAreas,
      setActiveAreaId,
      setCustomPolygon,
      setAnalysisLabel,
      takeCompositionOffMap,
    ]
  )

  /*
    A boundary chosen in the catalogue card, kept as an area of the project.

    BELOW createArea AND NOT BESIDE THE OTHER HANDLERS, which is where it was
    first written: naming createArea in a dependency list above its own
    declaration is a reference before initialisation. It belongs next to the
    writer it calls anyway.

    THE SAME DOOR THE OTHER TWO USE. A polygon reaches this application by
    being drawn, by being read from a file, and now by being chosen from a
    published register -- and all three end here, at createArea, which is what
    decides the id, files it under the open project and puts it on the map. A
    third path with its own writer would be a third set of those decisions to
    keep in step.

    The name is the boundary's own, so an area taken from the register is
    called what the register calls it -- and the store numbers it if the
    project already holds a ground by that name, which is what makes two runs
    over Natal two areas rather than one overwritten.
  */
  const handlePickBoundary = useCallback(
    async (name: string, geometry: GeoJSONGeometry) => {
      const entry = await createArea(geometry, name)
      if (!entry) return
      notifySuccess(`\u201c${entry.name}\u201d is the area now.`)
    },
    [createArea]
  )

  /**
   * A polygon drawn on either map. Appended to the saved-AOI catalog so a
   * second draw does not throw the first away; the new entry becomes active.
   * Passing null clears the active shape only (catalog stays).
   */
  /**
   * The last shape this handler turned into a catalog entry.
   *
   * A REF, BECAUSE STATE CANNOT ANSWER THIS. The check below compares against
   * the active area, and when two reports of one drawing arrive in a single
   * React batch the second still sees the activeAreaId the first has not
   * committed yet -- so both create an entry, both name it from the same
   * `areas`, and the catalog gets two areas with one name between them.
   * That is exactly the pair reported. A ref is written synchronously and is
   * therefore the only thing that can see the first report from inside the
   * second.
   */
  const lastDrawnRef = useRef<string | null>(null)

  const handlePolygonDrawn = useCallback(
    (geom: GeoJSONGeometry | null) => {
      if (!geom) {
        lastDrawnRef.current = null
        setCustomPolygon(null)
        setActiveAreaId(undefined)
        setAnalysisLabel(undefined)
        return
      }
      /*
        THE SAME GROUND IS THE SAME AREA, so reporting it again does not make
        a second one.

        Belt to useAreaDrawing's braces. That hook now reports a finished
        polygon once, but it is not the only way in -- two map surfaces are
        mounted at a time and either can report -- and the cost of a stray
        second report is not a stray no-op: it is a catalog entry, named from
        whatever `areas` looked like when the batch started, so a pair of
        them arrive with one name between them.

        Compared by geometry rather than by identity: the value that comes back
        from the draw store is a fresh object every time and would never be the
        one already held.
      */
      const shape = JSON.stringify(geom)
      const active = areas.find((a) => a.id === activeAreaId)
      if (
        shape === lastDrawnRef.current ||
        (active && JSON.stringify(active.geometry) === shape)
      ) {
        setCustomPolygon(geom)
        if (active) setAnalysisLabel(active.name)
        return
      }
      lastDrawnRef.current = shape
      /*
        Retention is NOT done here. Setting `activeAreaId` inside createArea is
        what useRetainOnLeaving watches, and it keeps the
        outgoing ground's work for every way of leaving it rather than for this
        one.

        The shape goes on the map before the write returns. Waiting would leave
        a drawn outline invisible for the round trip, and the write is what
        decides the id and the name, not the geometry.

        IF THE WRITE IS REFUSED THE OUTLINE GOES WITH IT. An outline the map
        shows and the area card calls "none" is the disagreement this whole
        change exists to end; a reader told to open a project first should be
        looking at a map that is waiting for them, not at half a result.
      */
      setCustomPolygon(geom)
      /*
        THE STUDIO IS THE STEM, WHEN THERE IS ONE.

        Without it the store mints "drawn", "drawn 2", and that name becomes
        the label of the run made over the ground -- so a studio called "Serra
        do mel" ended up holding a run called run-drawn-2, named after nothing
        a reader chose. The name is available here because a studio is now
        named when it begins rather than when it is first saved; see
        handleNewStudio. The store numbers the stem, so two grounds drawn under
        one studio do not arrive with one name between them.

        Empty when the board is not bound to a studio -- an area drawn from the
        map with no studio open -- and then the sequence is the one it has
        always been.
      */
      void createArea(
        geom,
        readBoardMemory<string | null>("savedName", null) ?? undefined
      ).then((entry) => {
        if (entry) return
        lastDrawnRef.current = null
        setCustomPolygon(null)
        setAnalysisLabel(undefined)
      })
    },
    [
      areas,
      activeAreaId,
      setActiveAreaId,
      setCustomPolygon,
      setAnalysisLabel,
      createArea,
    ]
  )

  /*
    A polygon from a file, kept as an area of the open project.
  */
  const handleImportPolygon = () => {
    if (!activeProjectId) {
      notifyError("Open a project first: an area belongs to one.")
      return
    }
    try {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".kml,.geojson,.json"
      /*
        THE INPUT IS PUT IN THE DOCUMENT BEFORE IT IS CLICKED.

        It used to be a detached element, created and clicked without ever being
        attached, which is the form every snippet for this uses and which this
        webview ignores: WKWebView opens a file picker for an input that is in
        the document and silently does nothing for one that is not. The button
        looked dead and reported nothing. The avatar upload on the profile page
        never had the problem because its input is rendered into the page and
        clicked through a ref -- the same property, arrived at by writing it in
        JSX rather than by knowing the rule.

        Hidden rather than off-screen, and removed once the dialog has been
        answered, so nothing is left behind on a cancel either.

        THE PICKER IS ALSO OPENED BEFORE ANYTHING IS AWAITED.

        togeojson used to be imported first, and a dynamic import is a promise:
        after awaiting it the call below is no longer running inside the user
        gesture that started it, and a WKWebView refuses a programmatic click on
        a file input outside one. The dialog then never appeared and nothing
        said why -- the button looked dead. The parser is only needed once a
        file has been chosen, so it is loaded there instead.
      */
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const { kml } = await import("@tmcw/togeojson")
        const text = await file.text()
        let geom: GeoJSONGeometry | null = null
        try {
          /*
            Either format ends as GeoJSON, and `importedPolygon` reads both the
            same way: the first polygon wherever the file keeps it, at the
            coordinates the draw store accepts. See the module.
          */
          if (file.name.toLowerCase().endsWith(".kml")) {
            const dom = new DOMParser().parseFromString(text, "text/xml")
            if (dom.querySelector("parsererror")) {
              throw new Error("the file is not well-formed XML")
            }
            geom = importedPolygon(kml(dom))
          } else {
            geom = importedPolygon(JSON.parse(text))
          }
        } catch (e) {
          notifyError("Invalid file", e)
          return
        }
        if (!geom) {
          notifyError("No polygon found in the file.")
          return
        }
        input.remove()
        const entry = await createArea(geom, file.name.replace(/\.[^.]+$/, ""))
        if (!entry) return
        notifySuccess(`Polygon saved as \u201c${entry.name}\u201d.`)
      }
      input.style.display = "none"
      document.body.appendChild(input)
      const cleanup = () => input.remove()
      // Covers the cancel, where onchange never fires. Not perfectly: a webview
      // that reports no focus event would leave the node, which is why it is
      // display:none and carries no listeners of its own.
      window.addEventListener("focus", cleanup, { once: true })
      input.click()
    } catch (e) {
      notifyError("Import failed", e)
    }
  }

  const activateArea = useCallback(
    (id: string) => {
      const entry = areas.find((a) => a.id === id)
      if (!entry) return
      setActiveAreaId(entry.id)
      setCustomPolygon(entry.geometry)
      setAnalysisLabel(entry.name)
      setSelectedAreaIds([])
      takeCompositionOffMap()
      /*
        Recorded on the project so opening it again resumes on this ground.

        Best effort: failing to remember where a reader was is worth nothing in
        front of the action they actually took, which has already happened.
      */
      if (activeProjectId) {
        void SetProjectLastArea(activeProjectId, entry.id).catch(() => {})
      }
    },
    [
      areas,
      setActiveAreaId,
      setCustomPolygon,
      setAnalysisLabel,
      activeProjectId,
      takeCompositionOffMap,
    ]
  )

  const renameArea = useCallback(
    async (id: string, name: string) => {
      const next = name.trim()
      if (!next) return
      const current = areas.find((a) => a.id === id)
      if (!current) return
      /*
        THROUGH THE STORE, which is what makes the new name outlive the
        session. Renaming used to patch the local list and stop there, so the
        name a reader typed was gone at the next start and every run recorded
        under it still carried the old one.
      */
      try {
        await UpdateArea({
          id,
          name: next,
          notes: current.notes,
          polygon_geojson: JSON.stringify(current.geometry),
        } as never)
        await refreshAreas(activeProjectId)
        if (activeAreaId === id) setAnalysisLabel(next)
      } catch (e) {
        notifyError("Could not rename the area", e)
      }
    },
    [areas, activeAreaId, setAnalysisLabel, refreshAreas, activeProjectId]
  )

  const deleteArea = useCallback(
    async (id: string) => {
      /*
        ASKED FOR BY THE CALLER, NOT HERE. An area owns its runs, and
        DeleteArea removes their rows and their rasters, so the deletion is
        confirmed first -- in the studio's ConfirmDelete, which names the runs
        that go with it.

        This asked a second time with window.confirm, which in the WKWebView
        returns false without showing anything (ConfirmDelete.tsx says why). The
        studio's dialog had already been accepted and announced the area
        deleted; this then returned before DeleteArea, and the area stayed on
        the map and in the list.

        A failure is thrown rather than reported here, so the caller that
        announces the deletion announces it only when it happened.
      */
      if (!areas.some((a) => a.id === id)) return
      await DeleteArea(id)
      await refreshAreas(activeProjectId)
      if (activeAreaId === id) {
        setCustomPolygon(null)
        setActiveAreaId(undefined)
        setAnalysisLabel(undefined)
      }
    },
    [
      areas,
      activeAreaId,
      setCustomPolygon,
      setActiveAreaId,
      setAnalysisLabel,
      refreshAreas,
      activeProjectId,
    ]
  )

  const clearAreaAndComposition = useCallback(() => {
    forgetCompositions()
    void persistAoiLabel(null)
    setCustomPolygon(null)
    setAnalysisLabel(undefined)
    setActiveAreaId(undefined)
  }, [
    forgetCompositions,
    persistAoiLabel,
    setCustomPolygon,
    setAnalysisLabel,
    setActiveAreaId,
  ])

  const props: AreaProps = {
    customPolygon,
    areaLabel,
    hasArea: !!customPolygon,
    polygonGeoJSON,
    onPolygonDrawn: handlePolygonDrawn,
    areas,
    activeAreaId,
    onActivateArea: activateArea,
    onRenameArea: (id, name) => void renameArea(id, name),
    onDeleteArea: deleteArea,
    onClearArea: clearAreaAndComposition,
    onImportPolygon: handleImportPolygon,
    onPickBoundary: (name, geometry) => void handlePickBoundary(name, geometry),
    selectedAreaIds: liveSelection,
    onSelectAreas: selectAreas,
    onClearSelection: clearSelection,
  }

  return { props, liveSelection, clearAreaAndComposition }
}
