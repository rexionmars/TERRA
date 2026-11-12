/** What is drawn on the map: every raster of what is in hand, as rows of one list. */
import { useEffect, useMemo, useState } from "react"

import type { OverlayCaption } from "@/components/globe/OverlayCallout"
import type { CompositorGlobeOverlay } from "@/components/workspace/CompositorEditor"
import { linkInto, type CompositorGraph } from "@/lib/compositorGraph"
import { applyLayerPatch, mergeLayerPatch, type LayerPatch } from "@/lib/layerPatch"
import { legendFor } from "@/lib/layerLegend"
import {
  COMPOSITION_ORDER,
  compositionTitle,
  isZeroExtent,
  rasterLayers,
  type RasterLayer,
} from "@/lib/mapLayers"
import type { ClassLayer } from "@/lib/mapProbe"
import { runAssets } from "@/lib/runAssets"
import { withAssetLayers, type JobReading } from "@/lib/shellLayers"
import { majoritySmoothOverlay } from "@/lib/smoothOverlay"
import type { CompositionOverlay } from "@/lib/types"
import type { MapShellProps } from "@/pages/MapShell"

type Patches = Record<string, LayerPatch>

/** How each raster has been set by hand, and the assets of what is in hand. */
export function useRunAssets(props: MapShellProps, job: JobReading | null) {
  const [mineralLayerState, setMineralLayerState] = useState<Patches>({})
  const [fieldLayerState, setFieldLayerState] = useState<Patches>({})
  const [assetLayerState, setAssetLayerState] = useState<Patches>({})

  const assets = useMemo(
    () =>
      runAssets({
        result: props.result,
        composition: props.composition,
        compositionGallery: props.compositionGallery ?? [],
        areaId: props.activeAreaId,
        water: props.water,
        areaLabel: props.areaLabel,
        modelKind: props.modelKind,
        showCompositionOverlay: props.showCompositionOverlay,
        showWaterOverlay: props.showWaterOverlay,
        composeOpacity: props.composeOpacity,
        waterOpacity: props.waterOpacity,
        mineral: props.mineral,
        mineralLayers: mineralLayerState,
        fields: props.fields,
        fieldLayers: fieldLayerState,
        health: job?.health,
        overlap: job?.overlap,
        radar: job?.radar,
        zones: job?.zones,
      }),
    [
      props.result,
      props.composition,
      props.compositionGallery,
      props.activeAreaId,
      props.water,
      props.areaLabel,
      props.modelKind,
      props.showCompositionOverlay,
      props.showWaterOverlay,
      props.composeOpacity,
      props.waterOpacity,
      props.mineral,
      mineralLayerState,
      props.fields,
      fieldLayerState,
      job,
    ]
  )

  /** One partition of the zones on the map at a time; two would hide each other. */
  const showZones = (k: number) =>
    setAssetLayerState((held) => {
      let next = held
      for (const p of job?.zones?.partitions ?? []) {
        next = mergeLayerPatch(next, `zones-${p.k}`, { visible: p.k === k })
      }
      return next
    })

  const changeLayer = (id: string, patch: LayerPatch) =>
    applyLayerPatch(id, patch, {
      setCompositionVisible: props.onShowCompositionOverlayChange,
      setCompositionOpacity: props.onComposeOpacityChange,
      setWaterVisible: props.onShowWaterOverlayChange,
      setWaterOpacity: props.onWaterOpacityChange,
      setConfidenceVisible: props.onShowConfidenceChange,
      setPredictionVisible: props.onShowPredictionOverlayChange,
      setOverlayOpacity: props.onOpacityChange,
      patchFieldLayer: (l, p) =>
        setFieldLayerState((held) => mergeLayerPatch(held, l, p)),
      patchMineralLayer: (l, p) =>
        setMineralLayerState((held) => mergeLayerPatch(held, l, p)),
      patchAssetLayer: (l, p) =>
        setAssetLayerState((held) => mergeLayerPatch(held, l, p)),
    })

  return {
    assets,
    mineralLayerState,
    fieldLayerState,
    assetLayerState,
    setAssetLayerState,
    showZones,
    changeLayer,
  }
}

export function useMapLayers({
  props,
  assets,
  mineralLayerState,
  fieldLayerState,
  assetLayerState,
  compositor,
  compositorGlobe,
  sessionRunIds,
  areaId,
  areaName,
  beneath = null,
}: {
  props: MapShellProps
  assets: ReturnType<typeof runAssets>
  mineralLayerState: Patches
  fieldLayerState: Patches
  assetLayerState: Patches
  compositor: CompositorGraph | null
  compositorGlobe: CompositorGlobeOverlay[]
  sessionRunIds: string[]
  areaId: string
  areaName: string
  /** A composition of the gallery drawn just under the one on the map, to compare through the curtain. */
  beneath?: CompositionOverlay | null
}) {
  /* The prediction with the majority filter applied, which decides where a class boundary is. */
  const [smoothed, setSmoothed] = useState<{ from: string; uri: string } | null>(null)

  const stateLayers = useMemo(
    () =>
      rasterLayers({
        result: props.result,
        showPredictionOverlay: props.showPredictionOverlay,
        overlayOpacity: props.overlayOpacity,
        showConfidence: props.showConfidence,
        confidenceOnTop: props.confidenceOnTop,
        smoothOverlay: props.smoothOverlay,
        composition: props.composition,
        showCompositionOverlay: props.showCompositionOverlay,
        composeOpacity: props.composeOpacity,
        water: props.water,
        showWaterOverlay: props.showWaterOverlay,
        waterOpacity: props.waterOpacity,
        mineral: props.mineral,
        mineralLayers: mineralLayerState,
        fields: props.fields,
        fieldLayers: fieldLayerState,
      }),
    [
      props.result,
      props.showPredictionOverlay,
      props.overlayOpacity,
      props.showConfidence,
      props.confidenceOnTop,
      props.smoothOverlay,
      props.composition,
      props.showCompositionOverlay,
      props.composeOpacity,
      props.water,
      props.showWaterOverlay,
      props.waterOpacity,
      props.mineral,
      mineralLayerState,
      props.fields,
      fieldLayerState,
    ]
  )
  /*
    The composition under the one on the map, one step below it, so the curtain
    can set two scenes of one area side by side. Its id is its gallery id, which
    is the asset's own, so its row in Layers finds the files it is saved from and
    its switch and opacity are kept with the other assets'.
  */
  const beneathLayers = useMemo<RasterLayer[]>(() => {
    if (!beneath?.overlay_uri || isZeroExtent(beneath.extent)) return []
    return [
      {
        id: beneath.id,
        title: compositionTitle(beneath),
        uri: beneath.overlay_uri,
        extent: beneath.extent,
        opacity: assetLayerState[beneath.id]?.opacity ?? 1,
        order: COMPOSITION_ORDER - 1,
        pixelated: false,
        smooth: false,
        visible: assetLayerState[beneath.id]?.visible ?? true,
      },
    ]
  }, [beneath, assetLayerState])
  const layersBeforeGraph = useMemo(
    () => withAssetLayers([...stateLayers, ...beneathLayers], assets, assetLayerState),
    [stateLayers, beneathLayers, assets, assetLayerState]
  )

  /*
    What a graph's Globe nodes draw, as rows of the same list. The node may have been
    removed since it sent them and the run may have left the session, so each is
    checked here, where both are known.
  */
  const graphLayers = useMemo<RasterLayer[]>(() => {
    const inHand = new Set(sessionRunIds)
    return compositorGlobe
      .filter(
        (o) =>
          !!compositor &&
          !!linkInto(compositor, o.nodeId, o.socket) &&
          o.runIds.every((id) => inHand.has(id))
      )
      .map((o) => ({
        ...o.layer,
        id: o.key,
        title: `${o.layer.title}, from the workflow`,
        visible: assetLayerState[o.key]?.visible ?? true,
        opacity: assetLayerState[o.key]?.opacity ?? o.layer.opacity,
      }))
    // sessionRunIds is rebuilt each render; its joined text says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositorGlobe, compositor, assetLayerState, sessionRunIds.join("|")])
  const layers = useMemo(
    () => [...layersBeforeGraph, ...graphLayers],
    [layersBeforeGraph, graphLayers]
  )

  /* The class rasters drawn now. A hidden one is not what a reader is looking at. */
  const classLayers = useMemo<ClassLayer[]>(() => {
    const out: ClassLayer[] = []
    for (const l of layers) {
      const legend = assets.find((a) => a.sceneId === l.id)?.classes?.legend
      if (l.visible && legend?.length) {
        out.push({ id: l.id, title: l.title, uri: l.uri, extent: l.extent, legend })
      }
    }
    return out
  }, [layers, assets])

  const smoothFrom = layers.find((l) => l.smooth)?.uri
  useEffect(() => {
    if (!smoothFrom) return
    let live = true
    majoritySmoothOverlay(smoothFrom)
      .then((uri) => live && setSmoothed({ from: smoothFrom, uri }))
      .catch(() => live && setSmoothed(null))
    return () => {
      live = false
    }
  }, [smoothFrom])

  const overlays = useMemo(() => {
    const sources = {
      result: props.result,
      water: props.water,
      composition: props.composition,
      mineral: props.mineral,
    }
    return layers
      .filter((l) => l.visible && !!l.uri)
      .map((l) => {
        /*
          Every legend goes with its raster, and lib/legendChoice.ts decides
          which the map draws. A ramp is drawn by default, and so is a
          composition's legend, which the sidecar computed with it and which
          is short: at most seven clusters, or a ramp with four figures. A
          list of classes, figures or a note waits to be asked for.
        */
        const legend = legendFor(l.id, sources)
        const caption: OverlayCaption | undefined = legend
          ? { legend, area: areaName, detail: null }
          : undefined
        const captionByDefault =
          legend?.kind === "ramp" ||
          (l.id === "composition" && !!props.composition?.legend)
        const drawn =
          l.smooth && smoothed?.from === l.uri ? { ...l, uri: smoothed.uri } : l
        return { key: l.id, areaId, layer: drawn, caption, captionByDefault }
      })
  }, [
    layers,
    props.result,
    props.water,
    props.composition,
    props.mineral,
    areaId,
    areaName,
    smoothed,
  ])

  return { layers, classLayers, overlays }
}
