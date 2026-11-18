/** Files opened on the map: their layers, how far each has loaded, and the feature pressed. */
import { useCallback, useEffect, useRef, useState } from "react"

import type { FilePick } from "@/components/globe/fileLayers"
import { dropFileFeatures, fileFeature } from "@/lib/fileFeature"
import {
  coloursTaken,
  drawsOnMap,
  isTable,
  toOpenedFile,
  type FileLayer,
  type OpenedFile,
} from "@/lib/fileLayers"
import { notifyError, notifyInfo, notifyLoading, notifySuccess } from "@/lib/notify"
import {
  ChooseGeoPackage,
  CloseGeoPackage,
  OpenGeoPackage,
} from "../../wailsjs/go/main/App"
import { EventsOn } from "../../wailsjs/runtime/runtime"

/** How a layer stands on the map: loading in the map's worker, drawn, or refused with a reason. */
export type LayerLoad =
  { state: "loading" } | { state: "loaded" } | { state: "failed"; message: string }

/** The pressed feature, and its whole geometry once read (null while it is, or if it could not be). */
export interface PickedFeature extends FilePick {
  feature: GeoJSON.Feature | null
  /** Why the whole feature could not be read, when it could not. */
  failed?: string
}

export interface FileLayerProps {
  files: readonly OpenedFile[]
  layerLoads: ReadonlyMap<string, LayerLoad>
  /**
   * The file being opened, while it is: its name, what is being done to it,
   * and since when, so a panel can say where a long open is.
   */
  opening: { name: string; step: string; since: number } | null
  /** The file opened last and when, which the shell frames the map on once. */
  lastOpened: { id: string; at: number } | null
  onChooseGeoPackage: () => void
  onOpenGeoPackage: (path: string) => void
  onCloseFile: (id: string) => void
  onToggleFileLayer: (key: string) => void
  onFileLayerState: (key: string, state: "loaded" | "failed", message?: string) => void
  pickedFeature: PickedFeature | null
  onPickFeature: (picked: FilePick | null) => void
}

/** A layer's URL made absolute: the map's worker and ours have no page to resolve it against. */
export function absoluteLayerUrl(url: string): string {
  return new URL(url, window.location.href).href
}

export function useFileLayers(): FileLayerProps {
  const [files, setFiles] = useState<OpenedFile[]>([])
  const [layerLoads, setLayerLoads] = useState<ReadonlyMap<string, LayerLoad>>(
    () => new Map()
  )
  const [opening, setOpening] = useState<FileLayerProps["opening"]>(null)
  const [lastOpened, setLastOpened] = useState<{ id: string; at: number } | null>(null)
  const [pickedFeature, setPickedFeature] = useState<PickedFeature | null>(null)
  /** The file whose layers are still being drawn, and the notification that says so. */
  const drawing = useRef<{ file: OpenedFile; toastId: string } | null>(null)

  const step = useCallback((toastId: string, name: string, text: string) => {
    setOpening((o) => (o ? { ...o, step: text } : o))
    notifyLoading(toastId, `Opening ${name}`, text)
  }, [])

  /*
    SAID AT ONCE AND UNTIL IT IS DONE. A file of a hundred megabytes of
    geometry takes seconds to read and seconds more to draw, and with nothing
    on screen in that time the reader concluded that choosing the file had done
    nothing. So the open is announced before anything is awaited, each layer
    the sidecar reads replaces the line, and the notification stays until the
    map reports every layer drawn or the reason one is not.
  */
  const openGeoPackage = useCallback(
    (path: string) => {
      const name = path.split(/[/\\]/).pop() ?? path
      const toastId = `geopackage:${path}:${Date.now()}`
      setOpening({ name, step: "Reading the file", since: Date.now() })
      notifyLoading(toastId, `Opening ${name}`, "Reading the file")
      const stop = EventsOn(
        "geopackage:progress",
        (ev: { path: string; msg: string }) => {
          if (ev.path === path && ev.msg) step(toastId, name, ev.msg)
        }
      )
      void (async () => {
        let file: OpenedFile
        try {
          const gp = await OpenGeoPackage(path)
          file = toOpenedFile(gp as never, coloursTaken(files))
        } catch (e) {
          notifyError(`Could not open ${name}`, e, { id: toastId })
          setOpening(null)
          return
        } finally {
          stop()
        }
        const drawn = file.layers.filter(drawsOnMap)
        if (!drawn.length) {
          setFiles((prev) => [...prev, file])
          setLastOpened({ id: file.id, at: Date.now() })
          setOpening(null)
          notifyInfo(
            `${name} has no layer TERRA can draw`,
            file.layers.some(isTable)
              ? "Its tables without geometry are listed in the Layers panel, which opens their rows."
              : "The Layers panel lists each layer with the reason.",
            { id: toastId }
          )
          return
        }
        setLayerLoads((prev) => {
          const next = new Map(prev)
          for (const l of drawn) next.set(l.key, { state: "loading" })
          return next
        })
        drawing.current = { file, toastId }
        setFiles((prev) => [...prev, file])
        setLastOpened({ id: file.id, at: Date.now() })
        step(
          toastId,
          name,
          `Drawing ${drawn.length} ${drawn.length === 1 ? "layer" : "layers"} on the map`
        )
      })()
    },
    [files, step]
  )

  const onFileLayerState = useCallback(
    (key: string, state: "loaded" | "failed", message?: string) => {
      setLayerLoads((prev) => {
        const was = prev.get(key)
        if (!was || was.state !== "loading") return prev
        const next = new Map(prev)
        next.set(
          key,
          state === "loaded"
            ? { state: "loaded" }
            : { state: "failed", message: message || "the map could not load it" }
        )
        return next
      })
    },
    []
  )

  /*
    The open ends when the map has answered for every layer of the file: the
    spinner stays through the drawing, which on a large layer is the longer
    half, and the notification says what was drawn and what was not.
  */
  useEffect(() => {
    const d = drawing.current
    if (!d) return
    const keys = d.file.layers.filter(drawsOnMap).map((l) => l.key)
    const loads = keys.map((k) => layerLoads.get(k))
    const done = loads.filter((l) => l && l.state !== "loading").length
    if (done < keys.length) {
      if (done > 0) {
        step(d.toastId, d.file.name, `Drawn ${done} of ${keys.length} layers`)
      }
      return
    }
    drawing.current = null
    setOpening(null)
    const failed = loads.filter((l) => l?.state === "failed").length
    // A table without geometry is not a layer that failed: it is listed, not drawn.
    const tables = d.file.layers.filter(isTable).length
    const notDrawn = d.file.layers.length - keys.length - tables + failed
    notifySuccess(
      `${d.file.name} is on the map`,
      `${keys.length - failed} ${keys.length - failed === 1 ? "layer" : "layers"} drawn` +
        (notDrawn ? `, ${notDrawn} not; the Layers panel says why.` : ".") +
        (tables
          ? ` ${tables} ${tables === 1 ? "table" : "tables"} without geometry in the Layers panel.`
          : "") +
        " Press a feature to read its attributes.",
      { id: d.toastId }
    )
  }, [layerLoads, step])

  const chooseGeoPackage = useCallback(() => {
    void (async () => {
      let path: string
      try {
        path = await ChooseGeoPackage()
      } catch (e) {
        notifyError("Could not open the file dialog", e)
        return
      }
      if (path) openGeoPackage(path)
    })()
  }, [openGeoPackage])

  const closeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    setLayerLoads((prev) => {
      const next = new Map(prev)
      for (const key of next.keys()) if (key.startsWith(`${id}:`)) next.delete(key)
      return next
    })
    setPickedFeature((p) => (p?.key.startsWith(`${id}:`) ? null : p))
    if (drawing.current?.file.id === id) {
      drawing.current = null
      setOpening(null)
    }
    dropFileFeatures(absoluteLayerUrl(`/geopackage-layer/${id}/`))
    // Best effort: the layers' files are temporary and swept in any case.
    void CloseGeoPackage(id).catch(() => {})
  }, [])

  const toggleFileLayer = useCallback((key: string) => {
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        layers: f.layers.map((l): FileLayer =>
          l.key === key ? { ...l, visible: !l.visible } : l
        ),
      }))
    )
  }, [])

  /*
    A press shows the attributes the map drew at once, and asks the worker for
    the whole feature, which "Zoom to it" and "Use as an area" need.
  */
  const pickFeature = useCallback(
    (picked: FilePick | null) => {
      if (!picked) {
        setPickedFeature(null)
        return
      }
      setPickedFeature({ ...picked, feature: null })
      const layer = files.flatMap((f) => f.layers).find((l) => l.key === picked.key)
      if (!layer?.url) return
      const same = (p: PickedFeature | null) =>
        p !== null && p.key === picked.key && p.id === picked.id
      fileFeature(absoluteLayerUrl(layer.url), picked.id).then(
        (feature) => setPickedFeature((p) => (same(p) && p ? { ...p, feature } : p)),
        (e: unknown) =>
          setPickedFeature((p) =>
            same(p) && p
              ? { ...p, failed: e instanceof Error ? e.message : String(e) }
              : p
          )
      )
    },
    [files]
  )

  return {
    files,
    layerLoads,
    opening,
    lastOpened,
    onChooseGeoPackage: chooseGeoPackage,
    onOpenGeoPackage: openGeoPackage,
    onCloseFile: closeFile,
    onToggleFileLayer: toggleFileLayer,
    onFileLayerState,
    pickedFeature,
    onPickFeature: pickFeature,
  }
}
