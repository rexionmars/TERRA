import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"

import { Sparkle, ChartLine, Stack } from "@/components/icons"
import { MapButton } from "@/components/globe/MapChrome"
import { toGlobeArea, type GlobeArea } from "@/components/globe/globeArea"
import type { OverlayCaption } from "@/components/globe/OverlayCallout"
import { ActivityPanel } from "@/components/shell/ActivityPanel"
import { AreasPanel } from "@/components/shell/AreasPanel"
import { LayersPanel } from "@/components/shell/LayersPanel"
import { ProductsPanel } from "@/components/shell/ProductsPanel"
import { ShellRail, ShellTopBar, keepRailOpen, readRailOpen } from "@/components/shell/ShellChrome"
import { writeBoardMemory } from "@/components/studio/boardMemory"
import { StudioBrowser } from "@/components/studio/StudioBrowser"
import type { Area } from "@/lib/areas"
import { useAppSurfaces } from "@/lib/appSurfaces"
import { useAuth } from "@/lib/auth"
import { geometryBounds } from "@/lib/geometry"
import { applyLayerPatch, mergeLayerPatch, type LayerPatch } from "@/lib/layerPatch"
import { legendFor } from "@/lib/layerLegend"
import { rasterLayers } from "@/lib/mapLayers"
import { useReports } from "@/lib/reports"
import type { BoardToolId } from "@/lib/mapTools"
import { DEFAULT_MINERAL_RUN_OPTIONS } from "@/lib/mineral"
import { activeRuns } from "@/lib/productRun"
import { chooseShell } from "@/lib/shellChoice"
import type { Bounds } from "@/lib/types"
import type { StudioScreenProps } from "@/pages/StudioScreen"

/*
  Lazy, for the reasons the studio gives: MapLibre is 945 kB, and the result panel
  brings the agreement figures, which a reader who has run nothing has no use for.
*/
const GlobeSurface = lazy(() =>
  import("@/components/globe/GlobeSurface").then((m) => ({ default: m.GlobeSurface }))
)
const ResultPanel = lazy(() =>
  import("@/components/shell/ResultPanel").then((m) => ({ default: m.ResultPanel }))
)

/** Which panel is held up over the map. One value, so there is only ever one. */
type ShellPanelId = "areas" | "products" | "result" | "layers" | "activity"

/** The panel's width, and the tool column's, as the camera has to clear them. */
const PANEL_CLEARANCE_PX = 480

/**
 * The application as a map with panels held up in front of it.
 *
 * It takes the studio's props unchanged. App owns the parameters, the handlers and
 * the results, and those props are already the whole contract between it and a
 * surface, so what changes here is how they are drawn rather than what they are.
 *
 * THE STATE THAT IS HERE is the state of this surface: which panel is open, which
 * product it shows, how each mineral and field raster is set. The last two sit
 * here because nothing above draws them, as they do in the studio.
 */
export function MapShell(props: StudioScreenProps) {
  const { projects } = useAuth()
  const app = useAppSurfaces()
  const pageRef = useRef<HTMLDivElement>(null)

  const [destination, setDestination] = useState<"explore" | "analyses">("explore")
  const [railOpen, setRailOpen] = useState(readRailOpen)
  /*
    How many reports had been read when the activity panel was last open, so the
    rail can say there is something new. A count and not a flag: the log only
    grows while a session lasts, and clearing it leaves nothing to announce.
  */
  const reports = useReports()
  const [seenReports, setSeenReports] = useState(0)
  const [panel, setPanel] = useState<ShellPanelId | null>(null)
  const [product, setProduct] = useState<BoardToolId | null>(null)
  const [frame, setFrame] = useState<{ key: number; bounds: Bounds } | null>(null)
  const [coords, setCoords] = useState(props.initialView ?? null)
  const [mineralLayerState, setMineralLayerState] = useState<Record<string, LayerPatch>>({})
  const [fieldLayerState, setFieldLayerState] = useState<Record<string, LayerPatch>>({})
  const [spreadM, setSpreadM] = useState(0)

  const togglePanel = (id: ShellPanelId) => setPanel((p) => (p === id ? null : id))

  const areas = useMemo<readonly Area[]>(() => props.areas ?? [], [props.areas])
  const openStudio = () => chooseShell("studio")
  /** The studio on the workspace for this work, which it reads from memory at mount. */
  const openWorkspace = (id: "compare" | "compositing") => {
    writeBoardMemory("workspace", id)
    chooseShell("studio")
  }

  /** Choosing an area also goes to it, which a press on the map has no need to do. */
  const pickArea = (area: Area) => {
    props.onActivateArea?.(area.id)
    const b = geometryBounds(area.geometry)
    if (!b) return
    setFrame({
      key: Date.now(),
      bounds: { lon_min: b.lonMin, lat_min: b.latMin, lon_max: b.lonMax, lat_max: b.latMax },
    })
  }

  const layers = useMemo(
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

  const changeLayer = (id: string, patch: LayerPatch) =>
    applyLayerPatch(id, patch, {
      setCompositionVisible: props.onShowCompositionOverlayChange,
      setCompositionOpacity: props.onComposeOpacityChange,
      setWaterVisible: props.onShowWaterOverlayChange,
      setWaterOpacity: props.onWaterOpacityChange,
      setConfidenceVisible: props.onShowConfidenceChange,
      setPredictionVisible: props.onShowPredictionOverlayChange,
      setOverlayOpacity: props.onOpacityChange,
      patchFieldLayer: (l, p) => setFieldLayerState((held) => mergeLayerPatch(held, l, p)),
      patchMineralLayer: (l, p) => setMineralLayerState((held) => mergeLayerPatch(held, l, p)),
    })

  const areaId = props.activeAreaId ?? "current"
  const areaName =
    areas.find((a) => a.id === props.activeAreaId)?.name ??
    (props.customPolygon ? props.areaLabel || "Drawn area" : "No area")

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
        // A ramp is drawn beside its raster. Class legends run long, so they are
        // read in the result panel instead.
        const legend = legendFor(l.id, sources)
        const caption: OverlayCaption | undefined =
          legend?.kind === "ramp" ? { legend, area: areaName, detail: null } : undefined
        return { key: l.id, areaId, layer: l, caption }
      })
  }, [layers, props.result, props.water, props.composition, props.mineral, areaId, areaName])

  const globeAreas = useMemo<GlobeArea[]>(() => {
    const selected = new Set(props.selectedAreaIds ?? [])
    return areas
      .map((a) => {
        const g = toGlobeArea(`aoi:${a.id}`, a.name, a.geometry, !!a.parent_id)
        return g && selected.has(a.id) ? { ...g, selected: true } : g
      })
      .filter((a): a is GlobeArea => a !== null)
  }, [areas, props.selectedAreaIds])

  // A delineation's polygons while they are only proposed; see BoardSurface.
  const fieldDrafts = useMemo<GeoJSON.FeatureCollection | null>(() => {
    const f = props.fields
    if (!f?.fields_geojson) return null
    if (f.run_id && areas.some((a) => a.source_run_id === f.run_id)) return null
    try {
      return JSON.parse(f.fields_geojson) as GeoJSON.FeatureCollection
    } catch {
      return null
    }
  }, [props.fields, areas])

  const running = activeRuns(props)
  const busy = running.length > 0
  /*
    A run that finishes opens what it produced. Watched as an edge, so opening
    another panel while a result is on the map is not undone by the next render.
  */
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) setPanel("result")
    wasBusy.current = busy
  }, [busy])
  /*
    What the camera has to clear. The ref is read here on purpose: a finishing
    run's raster arrives in the render before the effect above opens its panel,
    and that raster is what the globe frames, so waiting for the panel would put
    it behind one.
  */
  const rightInsetPx = panel || busy || wasBusy.current ? PANEL_CLEARANCE_PX : 80

  useEffect(() => {
    if (panel === "activity") setSeenReports(reports.length)
  }, [panel, reports.length])

  return (
    <div className="absolute inset-0 flex bg-app">
      {app.surfaces}
      <ShellRail
        place={
          destination === "analyses"
            ? "analyses"
            : panel === "areas"
              ? "areas"
              : panel === "activity"
                ? "activity"
                : "explore"
        }
        open={railOpen}
        unseen={reports.length > seenReports}
        onExplore={() => {
          setDestination("explore")
          setPanel((p) => (p === "areas" || p === "activity" ? null : p))
        }}
        onAreas={() => {
          setDestination("explore")
          togglePanel("areas")
        }}
        onAnalyses={() => setDestination("analyses")}
        onCompare={() => openWorkspace("compare")}
        onWorkflows={() => openWorkspace("compositing")}
        onActivity={() => {
          setDestination("explore")
          togglePanel("activity")
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ShellTopBar
          projectName={props.activeProjectName ?? "No project"}
          projects={projects}
          activeProjectId={props.activeProjectId}
          onActivateProject={props.onActivateProject}
          areas={areas}
          areaName={areaName}
          activeAreaId={props.activeAreaId}
          onPickArea={pickArea}
          railOpen={railOpen}
          onToggleRail={() => {
            keepRailOpen(!railOpen)
            setRailOpen(!railOpen)
          }}
          app={app}
          onOpenStudio={openStudio}
        />
        <main className="relative min-h-0 min-w-0 flex-1">
          <Suspense fallback={null}>
            <GlobeSurface
              className="h-full w-full"
              areas={globeAreas}
              onPickArea={(id, extend) => {
                const picked = id.slice(id.indexOf(":") + 1)
                if (extend && props.onSelectAreas) props.onSelectAreas([picked], "toggle")
                else props.onActivateArea?.(picked)
              }}
              onBoxArea={
                props.onSelectAreas
                  ? (ids) =>
                      props.onSelectAreas?.(
                        ids.map((id) => id.slice(id.indexOf(":") + 1)),
                        "add"
                      )
                  : undefined
              }
              onClearSelection={props.selectedAreaIds?.length ? props.onClearSelection : undefined}
              polygon={props.customPolygon}
              onPolygonDrawn={props.onPolygonDrawn}
              onImportPolygon={props.onImportPolygon}
              overlays={overlays}
              fieldDrafts={fieldDrafts}
              spreadM={spreadM}
              onSpreadChange={setSpreadM}
              initialView={props.initialView}
              onViewChange={(v) => {
                setCoords(v)
                props.onViewChange(v)
              }}
              frame={frame}
              rightInsetPx={rightInsetPx}
              leadingTools={
                <>
                  <MapButton
                    label="Products"
                    active={panel === "products"}
                    onClick={() => togglePanel("products")}
                  >
                    <Sparkle className="size-4" />
                  </MapButton>
                  <MapButton
                    label="Result"
                    active={panel === "result"}
                    onClick={() => togglePanel("result")}
                  >
                    <ChartLine className="size-4" />
                  </MapButton>
                  <MapButton
                    label="Layers"
                    active={panel === "layers"}
                    onClick={() => togglePanel("layers")}
                  >
                    <Stack className="size-4" />
                  </MapButton>
                </>
              }
            />
          </Suspense>

          {panel === "areas" && (
            <AreasPanel
              areas={areas}
              hasProject={!!props.activeProjectId}
              activeAreaId={props.activeAreaId}
              onActivate={pickArea}
              onImport={props.onImportPolygon}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "products" && (
            <ProductsPanel
              {...props}
              mineralOptions={props.mineralOptions ?? DEFAULT_MINERAL_RUN_OPTIONS}
              product={product}
              onProductChange={setProduct}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === "result" && (
            <Suspense fallback={null}>
              <ResultPanel
                result={props.result}
                water={props.water}
                mineral={props.mineral}
                fields={props.fields}
                onOpenStudio={openStudio}
                onClose={() => setPanel(null)}
              />
            </Suspense>
          )}
          {panel === "layers" && (
            <LayersPanel layers={layers} onChange={changeLayer} onClose={() => setPanel(null)} />
          )}
          {panel === "activity" && <ActivityPanel onClose={() => setPanel(null)} />}

          {coords && (
            <span className="telemetry pointer-events-none absolute bottom-3 right-[3.5rem] z-[410] rounded-sm bg-[rgb(var(--p-ink)/0.82)] px-2 py-1 text-label tabular-nums text-foreground">
              {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
            </span>
          )}

          {/*
            What is running, wherever the reader has gone. A classification takes
            minutes, and the product panel it started from may be closed long
            before it ends.
          */}
          {busy && panel !== "products" && (
            <div
              role="status"
              className="panel app-no-drag absolute bottom-10 left-1/2 z-[440] w-[24rem] max-w-[60%] -translate-x-1/2 rounded-md px-3 py-2"
            >
              {running.map((r) => (
                <div key={r.label}>
                  <div className="flex items-baseline justify-between gap-3 text-label">
                    <span className="truncate text-foreground">{r.progressMsg || r.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(r.progress)} %
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-sm bg-[rgb(var(--p-control))]">
                    <div
                      className="h-full bg-primary transition-[width] duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, r.progress))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {destination === "analyses" && (
            <div ref={pageRef} className="app-no-drag absolute inset-0 z-[480] flex flex-col bg-app">
              <div className="min-h-0 flex-1">
                <StudioBrowser
                  surface={pageRef.current}
                  activeProjectId={props.activeProjectId ?? null}
                  onActivateProject={props.onActivateProject}
                  onOpenRun={(run) => {
                    props.onOpenReading?.(run)
                    setDestination("explore")
                    setPanel("result")
                  }}
                  onOpenReading={(run) => {
                    props.onOpenReading?.(run)
                    setDestination("explore")
                    setPanel("result")
                  }}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
