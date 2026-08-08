/**
 * The energy screen: the photovoltaic products and the wind screening.
 *
 * Peer to the map and analysis screens rather than a tab of the map's left
 * dock. The dock panel was a chassis built for the classification pipeline --
 * numbered stages ending in a single action -- and the five energy products are
 * not stages of one another: any of them can be run alone, two draw a raster
 * and three return only figures. On that chassis a user could run the energy
 * model expecting a layer, receive none, and read the map behind it, which was
 * showing a composition from another date, as the answer.
 *
 * TWO MUTUALLY EXCLUSIVE TABS, which is the point of the tabs rather than a
 * scroll. The photovoltaic capacity factor is computed at a performance ratio
 * bracketed by the Global Solar Atlas; the wind capacity factor is gross of
 * every plant loss and has no external benchmark. A layout that can show both
 * at once invites a comparison neither figure supports, so the structure makes
 * it unrepresentable.
 *
 * THE OUTPUT KIND IS STATED THREE TIMES BEFORE ANY RUN: the marker beside each
 * product in the selector, the shape the output region takes on selection, and
 * the run button. All three read components/energy/solarProducts.ts, so they
 * cannot drift from each other or from the payload in lib/types.ts.
 *
 * Parameters are not props. The store in lib/energyState.ts holds them and this
 * screen takes it whole; the panel it replaces declared 81 props for state its
 * host did not use.
 */
import { AnimatePresence, motion } from "motion/react"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
} from "react"
import { ChartLine, Trash2, Wind as WindIcon } from "lucide-react"
import { MapView } from "@/components/MapView"
import {
  SolarResourceSection,
  SolarSitingSection,
  SolarTerrainSection,
} from "@/components/SolarSections"
import { EnergyModelSection } from "@/components/EnergyModelSection"
import { WindScreening } from "@/components/WindScreening"
import { PanelSection } from "@/components/ui/PanelSection"
import { AoiSection } from "@/components/energy/AoiSection"
import { EnergyStatusPanel } from "@/components/energy/EnergyStatusPanel"
import { SolarProductSelector } from "@/components/energy/SolarProductSelector"
import { SolarParameterSections } from "@/components/energy/SolarParameterSections"
import { SolarLayerControls } from "@/components/energy/SolarLayerControls"
import { WindParameterSections } from "@/components/energy/WindParameterSections"
import {
  OutputPlaceholder,
  RunButton,
  RunProgress,
} from "@/components/energy/controls"
import {
  SOLAR_PRODUCTS,
  drawsRaster,
  productsUsingGroup,
  runButtonLabel,
  solarProduct,
  type SolarParamGroup,
} from "@/components/energy/solarProducts"
import type {
  SolarAction,
  SolarParams,
  SolarProductId,
  SolarState,
  WindAction,
  WindParams,
  WindState,
} from "@/lib/energyState"
import type { Area, GeoJSONGeometry } from "@/lib/types"
import type { AoiContourSchemeId } from "@/lib/aoiStyle"
import { cn } from "@/lib/utils"

export type EnergyTab = "solar" | "wind"

/**
 * The wind qualifier, printed on the tab whether or not a run has been made.
 *
 * After a run WindScreening prints the qualifier the response carries; before
 * one there is no response, and the figures a user is about to request are
 * exactly the ones that need the caveat in advance.
 */
const WIND_QUALIFIER =
  "Screening indication, gross of losses, unvalidated. The capacity factor " +
  "excludes wake, availability, electrical, icing and curtailment losses, and " +
  "it has no external benchmark of the kind the photovoltaic ratio has, which " +
  "is computed at a performance ratio bracketed by the Global Solar Atlas. It " +
  "is not comparable with the photovoltaic capacity factor: the two resources " +
  "are held on tabs that cannot be open at once, and no table, figure row or " +
  "export column holds both."

const AOI_NOTE_SOLAR =
  "Radiation resolves on a 1 degree grid, so a centroid result describes the " +
  "cell the AOI sits in, not structure within it. The terrain and siting " +
  "rasters resolve within the AOI from the Copernicus DEM at 30 m."

const AOI_NOTE_WIND =
  "Analysed at the AOI centroid on the MERRA-2 reanalysis grid of 0.5 by " +
  "0.625 degrees. That is a different cell from the 1 degree radiation grid, " +
  "so an AOI can leave one without leaving the other."

/** Stable no-op: the swipe compare belongs to the classification map. */
const NO_SWIPE_CHANGE = () => {}

/**
 * The raster list MapView accepts, read from MapView itself so a change to the
 * overlay contract is a compile error here rather than a layer that silently
 * stops drawing.
 */
type SolarOverlayList = NonNullable<
  ComponentProps<typeof MapView>["solarOverlays"]
>

export interface EnergyScreenProps {
  /** The photovoltaic store: parameters, results, layer state and run status. */
  solar: SolarState
  solarDispatch: Dispatch<SolarAction>
  /** The wind store, separate by design; see lib/energyState.ts. */
  wind: WindState
  windDispatch: Dispatch<WindAction>
  /** Starts a run for one product. The caller dispatches its result. */
  onRunSolar: (product: SolarProductId) => void
  onRunWind: () => void
  /**
   * Opens the analysis screen, where the long blocks live -- the loss
   * waterfall, the generation profile, the tracking comparison. They render
   * there from the same components, so this is a route to one rendering rather
   * than a second copy of it.
   */
  onOpenAnalysis: () => void

  // The AOI, defined from this screen. A run here consults no satellite scene,
  // so requiring a visit to the classification panel to draw one would make a
  // classification a precondition of an analysis that needs none.
  hasArea: boolean
  areas: Area[]
  activeExample: string
  onSelectExample: (id: string) => void
  customPolygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onImportPolygon: () => void
  onClearArea: () => void
  areaLabel?: string
  /**
   * Required, not optional: the embedded map offers a rename in its AOI context
   * menu, and a default no-op would leave that action silently doing nothing.
   */
  onAreaLabelChange: (label: string) => void
  aoiContourScheme: AoiContourSchemeId
  onAoiContourSchemeChange: (id: AoiContourSchemeId) => void

  // Map position, shared with the map screen so the two do not disagree about
  // where the user is looking.
  initialView?: { lat: number; lon: number; zoom: number } | null
  onViewChange: (v: { lat: number; lon: number; zoom: number }) => void
  flyTo: { lat: number; lon: number; key: number } | null

  /**
   * Open tab. Optional: held here when the caller does not hold it, in which
   * case it returns to Solar each time the screen is remounted.
   */
  tab?: EnergyTab
  onTabChange?: (tab: EnergyTab) => void
}

export function EnergyScreen(props: EnergyScreenProps) {
  const { solar, solarDispatch, wind, windDispatch } = props

  const [localTab, setLocalTab] = useState<EnergyTab>("solar")
  const tab = props.tab ?? localTab
  const setTab = useCallback(
    (next: EnergyTab) => {
      setLocalTab(next)
      props.onTabChange?.(next)
    },
    [props]
  )

  const [selected, setSelected] = useState<SolarProductId>(() => {
    // Opens on a product that already holds a result rather than always on the
    // first. The screen is unmounted on navigation, so a fixed initial value
    // would put the user in front of another product's parameters after a
    // return, with the raster they had just produced drawn beside it.
    const held = SOLAR_PRODUCTS.find((p) => solar.results[p.id])
    return held?.id ?? "resource"
  })
  const product = solarProduct(selected)

  /**
   * Results held at the moment a shared parameter was edited.
   *
   * The held object is recorded rather than a boolean, so a re-run retires the
   * note by itself: the store replaces the result with a new object, the
   * recorded one no longer matches, and nothing has to remember to clear a
   * flag. A missed clear would leave a permanent warning, which is read as
   * noise and then ignored on the run where it is true.
   */
  const [staleMarks, setStaleMarks] = useState<
    Partial<Record<SolarProductId, object>>
  >({})

  const setParams = useCallback(
    (patch: Partial<SolarParams>, group: SolarParamGroup) => {
      solarDispatch({ type: "params/set", patch })
      // Every product reading this group, the selected one included. Its own
      // held result is left on the previous value by this edit exactly as the
      // others are, and excluding it meant a product's own edit never marked
      // its own result.
      setStaleMarks((prev) => {
        const next = { ...prev }
        for (const p of productsUsingGroup(group)) {
          const held = solar.results[p.id]
          if (held) next[p.id] = held
        }
        return next
      })
    },
    [solarDispatch, solar.results]
  )

  const setLoss = useCallback(
    (group: "declared" | "optional", key: string, pct: number) => {
      solarDispatch({ type: "params/loss", group, key, pct })
    },
    [solarDispatch]
  )

  const sharedNote = useCallback(
    (group: SolarParamGroup): string | null => {
      // Including the selected product. Suppressed there, the note vanished at
      // the moment the user navigated to the very result it describes.
      const affected = productsUsingGroup(group).filter((p) => {
        const held = solar.results[p.id]
        return !!held && staleMarks[p.id] === held
      })
      if (!affected.length) return null
      const names = affected.map((p) => p.label).join(" and ")
      const plural = affected.length > 1
      return `${names} ${plural ? "hold results" : "holds a result"} computed before this edit. Re-run to report ${plural ? "them" : "it"} on the current setting.`
    },
    [solar.results, staleMarks]
  )

  const solarBusy = solar.run.active !== null
  const windBusy = wind.run.active

  const solarOverlays = useMemo(() => {
    // Terrain first so siting draws over it: the suitability classes are what a
    // siting decision reads, and the irradiation underneath is the continuous
    // field they were cut from. Both are drawn when both were run.
    const list: SolarOverlayList = []
    const terrain = solar.results.terrain
    if (terrain && solar.layers.showTerrain) {
      list.push({
        id: "terrain",
        uri: terrain.overlay_uri,
        extent: terrain.extent,
        opacity: solar.layers.terrainOpacity,
      })
    }
    const siting = solar.results.siting
    if (siting && solar.layers.showSiting) {
      list.push({
        id: "siting",
        uri: siting.overlay_uri,
        extent: siting.extent,
        opacity: solar.layers.sitingOpacity,
      })
    }
    return list
  }, [solar.results.terrain, solar.results.siting, solar.layers])

  const mapRegion = (
    <MapView
        initialView={props.initialView}
        areas={props.areas}
        activeExample={props.activeExample}
        customPolygon={props.customPolygon}
        onPolygonDrawn={props.onPolygonDrawn}
        onSelectExample={props.onSelectExample}
        flyTo={props.flyTo}
        solarOverlays={solarOverlays}
        // The classification chrome is pinned off rather than exposed: there is
        // no prediction on this screen to weigh against, so a confidence
        // toggle or a swipe compare would offer a comparison with nothing.
        result={null}
        overlayOpacity={1}
        showConfidence={false}
        confidenceOnTop={false}
        smoothOverlay={false}
        showPredictionOverlay={false}
        showCompositionOverlay={false}
        composition={null}
        swipeCompare={false}
        swipeRatio={0.5}
        onSwipeRatioChange={NO_SWIPE_CHANGE}
        areaLabel={props.areaLabel}
        onAreaLabelChange={props.onAreaLabelChange}
        aoiContourScheme={props.aoiContourScheme}
        onAoiContourSchemeChange={props.onAoiContourSchemeChange}
        onClearArea={props.onClearArea}
        onViewChange={props.onViewChange}
    />
  )

  const solarSetup = (
    <>
      <SolarProductSelector
        selected={selected}
        onSelect={setSelected}
        results={solar.results}
        running={solar.run.active}
      />
      <AoiSection
        note={AOI_NOTE_SOLAR}
        areas={props.areas}
        activeExample={props.activeExample}
        onSelectExample={props.onSelectExample}
        hasArea={props.hasArea}
        hasCustomPolygon={!!props.customPolygon}
        onImportPolygon={props.onImportPolygon}
        onClearArea={props.onClearArea}
        busy={solarBusy}
      />
      <SolarParameterSections
        product={product}
        params={solar.params}
        onSet={setParams}
        onLossSet={setLoss}
        sharedNote={sharedNote}
        shadingMeanPct={solar.results.terrain?.shading_mean_pct ?? null}
      />
      {drawsRaster(product) && (
        <SolarLayerControls
          results={solar.results}
          layers={solar.layers}
          onChange={(patch) => solarDispatch({ type: "layers/set", patch })}
        />
      )}
      <PanelSection title="Run">
        <RunProgress
          active={solar.run.active === selected}
          progress={solar.run.progress}
          message={solar.run.message}
        />
        <RunButton
          label={runButtonLabel(product)}
          runningLabel={`${product.runningLabel}\u2026`}
          running={solar.run.active === selected}
          disabled={!props.hasArea || solarBusy}
          onClick={() => props.onRunSolar(selected)}
        />
        {!props.hasArea && (
          <p className="text-meta leading-relaxed text-muted-foreground">
            Define an area above to run. Draw one on the map behind this panel,
            import a file, or load a reference example.
          </p>
        )}
        {solar.run.active !== null && solar.run.active !== selected && (
          <p className="text-meta leading-relaxed text-muted-foreground">
            {solarProduct(solar.run.active).label} is running. The sidecar
            reports one run at a time.
          </p>
        )}
      </PanelSection>
    </>
  )

  const windSetup = (
    <>
      <AoiSection
        note={AOI_NOTE_WIND}
        areas={props.areas}
        activeExample={props.activeExample}
        onSelectExample={props.onSelectExample}
        hasArea={props.hasArea}
        hasCustomPolygon={!!props.customPolygon}
        onImportPolygon={props.onImportPolygon}
        onClearArea={props.onClearArea}
        busy={windBusy}
      />
      <WindParameterSections
        params={wind.params}
        onSet={(patch: Partial<WindParams>) =>
          windDispatch({ type: "params/set", patch })
        }
      />
      <PanelSection title="Run">
        <RunProgress
          active={windBusy}
          progress={wind.run.progress}
          message={wind.run.message}
        />
        <RunButton
          label="Screen the wind resource, returns figures"
          runningLabel="Screening\u2026"
          running={windBusy}
          disabled={!props.hasArea || windBusy}
          onClick={props.onRunWind}
        />
        {!props.hasArea && (
          <p className="text-meta leading-relaxed text-muted-foreground">
            Define an area above to run.
          </p>
        )}
        {/* Carried here as well as on the result: the qualifier is the reason
            the wind figures are not comparable with the photovoltaic ones, and
            it has to be readable before a run as much as after one. */}
        <p className="text-meta leading-relaxed text-muted-foreground">
          {WIND_QUALIFIER}
        </p>
      </PanelSection>
    </>
  )

  /** Any result the current tab can report into the bottom panel. */
  const hasResult =
    tab === "wind"
      ? !!wind.result
      : !!solar.results[selected]

  /**
   * The setup column, floated over the map exactly as the map screen's tool
   * panels are. It was a structural column beside a boxed map, which gave the
   * same object two shapes and left the map letterboxed with dead space under
   * it -- the map is where the AOI is drawn, so it is not a thumbnail.
   */
  const setupColumn = (
    <motion.div
      key={tab}
      className="panel app-no-drag panel-scroll absolute bottom-3 left-3 top-3 z-[1000] flex w-[19rem] flex-col gap-4 overflow-y-auto rounded-md p-4"
      initial={{ opacity: 0, x: -28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -28 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-heading font-semibold">
          {tab === "solar" ? "Solar resource" : "Wind screening"}
        </h1>
      </div>
      {tab === "solar" ? solarSetup : windSetup}
    </motion.div>
  )

  return (
    <div className="relative h-full min-h-0 w-full">
      {/*
        Full bleed, as on the map screen. Two of the four solar products and the
        wind screening draw nothing, and the map still carries the AOI they are
        computed over, so it stays rather than being swapped for an empty state:
        what a product returns is declared in the selector and on its run
        button, before it runs, which is where that belongs.
      */}
      {mapRegion}

      <AnimatePresence mode="wait" initial={false}>
        {setupColumn}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {hasResult && (
          <EnergyStatusPanel
            key={`${tab}-${selected}`}
            tab={tab}
            selected={selected}
            results={solar.results}
            wind={wind.result}
            onClear={() =>
              tab === "wind"
                ? windDispatch({ type: "result/clear" })
                : solarDispatch({ type: "result/clear", product: selected })
            }
            onOpenAnalysis={props.onOpenAnalysis}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
