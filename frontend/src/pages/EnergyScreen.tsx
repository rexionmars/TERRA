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
import { AnimatePresence } from "motion/react"
import type { LayoutMode } from "@/lib/types"
import { solarOverlayList } from "@/lib/solarLayers"
import type { BasemapKind } from "@/lib/basemaps"
import { WorkspaceBar } from "@/components/WorkspaceBar"
import { PanelShell, PanelTab, type PanelPlacement } from "@/components/ui/PanelShell"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
} from "react"
import { MapView } from "@/components/MapView"
import { SearchBar } from "@/components/SearchBar"
import { PanelSection } from "@/components/ui/PanelSection"
import { AoiSection } from "@/components/energy/AoiSection"
import { ChartColumn, SlidersHorizontal } from "lucide-react"
import { EnergyReadingColumn } from "@/components/energy/EnergyReadingColumn"
import {
  solarReadingGroups,
  windReadingGroups,
} from "@/components/energy/readingSections"
import {
  RecordWindowBar,
  lastCompleteYear,
  type RecordBand,
} from "@/components/energy/RecordWindowBar"
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
  /** Which layout draws this screen. See lib/types LayoutMode. */
  layoutMode?: LayoutMode
  /** Go to another destination, for the dock layout's bar. */
  onNavigate: (groupId: string, itemId?: string) => void
  /**
   * A request to show a restored result, counted rather than flagged.
   *
   * Bumped when a saved solar or wind run is opened from a list, so the reader
   * lands on the figures they asked for instead of on an empty screen with the
   * result folded into a panel they have to find.
   */
  openResultNonce?: number
  // The AOI, defined from this screen. A run here consults no satellite scene,
  // so requiring a visit to the classification panel to draw one would make a
  // classification a precondition of an analysis that needs none.
  hasArea: boolean
  areas: Area[]
  activeExample: string
  customPolygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onImportPolygon: () => void
  onClearArea: () => void
  /**
   * Flies the map to a searched place. The AOI is defined on this screen, and
   * without a search the only ways to reach a location were importing a file or
   * loading a reference example -- neither of which finds a place by name.
   */
  onLocationSelect: (lat: number, lon: number) => void
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
  /** Which basemap is showing, for the credit in the title bar. */
  onCreditChange?: (c: { kind: BasemapKind; date: string | null }) => void
  flyTo: { lat: number; lon: number; key: number } | null

  /**
   * Open tab. Optional: held here when the caller does not hold it, in which
   * case it returns to Solar each time the screen is remounted.
   */
  tab?: EnergyTab
  onTabChange?: (tab: EnergyTab) => void
}

/*
  The last open-the-reading request this session has acted on.

  Module scope, because the screen unmounts on navigation and a ref inside it
  cannot outlive the visit it was set in. See the effect that reads it.
*/
let lastHandledOpenNonce = 0

export function EnergyScreen(props: EnergyScreenProps) {
  const { solar, solarDispatch, wind, windDispatch } = props

  const [localTab, setLocalTab] = useState<EnergyTab>("solar")
  const tab = props.tab ?? localTab
  const setTab = useCallback(
    (next: EnergyTab) => {
      setLocalTab(next)
      // The reading is a different subject on the other tab, and solar and wind
      // must never be read as one comparison. Left open, the switch replaced a
      // reading under the reader with an unrelated one.
      setResultOpen(false)
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

  const workspace = props.layoutMode === "workspace"
  const [configOpen, setConfigOpen] = useState(false)
  /*
    Whether the full reading is on screen.

    Per screen and not per product: the reading holds every solar result the run
    has produced, so a reader who opens it and then switches product is still
    looking at the same reading with one more section in it.
  */
  const [resultOpen, setResultOpen] = useState(false)

  /*
    A restored run arrives with its result already in the reducers, and the
    reader asked to see it -- so it opens rather than waiting to be found.

    Compared against module scope, not a ref. This screen unmounts on
    navigation, so a ref inside it cannot tell a fresh request from one that
    outlived the last visit: the effect fired on every mount with a truthy
    nonce, and after any run restore every later return to this screen
    re-opened a full reading nobody had asked for.
  */
  useEffect(() => {
    const n = props.openResultNonce
    if (n && n !== lastHandledOpenNonce) {
      lastHandledOpenNonce = n
      setResultOpen(true)
    }
  }, [props.openResultNonce])
  /** The island's measured width, so the record bar can retract past it. */
  const [barWidthPx, setBarWidthPx] = useState(0)
  const solarBusy = solar.run.active !== null
  const windBusy = wind.run.active

  /**
   * The run action for whichever resource is in view.
   *
   * Gathered here for the dock layout's single button, the way the map screen
   * gathers its three. The two tabs differ in more than the handler: solar runs
   * whichever of its four products is selected, and names the run after that
   * product, while wind has one.
   *
   * The label is the verb alone. The panels can afford "Screen the wind
   * resource, returns figures" down a 19rem column; on a bar beside a track it
   * would push the island past the width the track has left.
   */
  const run =
    tab === "wind"
      ? {
          running: !!windBusy,
          progress: wind.run.progress,
          progressMsg: wind.run.message,
          label: windBusy ? "Screening\u2026" : "Screen",
          canRun: props.hasArea,
          onRun: props.onRunWind,
        }
      : {
          running: solar.run.active === selected,
          progress: solar.run.progress,
          progressMsg: solar.run.message,
          label:
            solar.run.active === selected
              ? `${product.runningLabel}\u2026`
              : "Run",
          // One run at a time in the sidecar, so any solar run blocks the rest.
          canRun: props.hasArea && !solarBusy,
          onRun: () => props.onRunSolar(selected),
        }

  // Read once per mount rather than per render: a value taken from the clock
  // inside the render body would make the axis a function of when React
  // re-rendered.
  const [endYear] = useState(() => lastCompleteYear(new Date()))

  // Seeded at the solar tab height so the first paint is close; the bar
  // corrects it on mount.
  const [footPx, setFootPx] = useState(62)

  /*
    The stage measured itself here, for two consumers that no longer exist.

    One was `--reading-h`, a pixel height for the full-width raster tile inside
    the reading, which reached for 45vh in a scroll window barely taller than
    that and pushed the siting class list off screen. The reading is a dialog
    now and declares that bound against its own body, which is the box the tile
    is actually in.

    The other was `drawerOverlapsReading`: the parameter drawer and the expanded
    reading were both right-anchored overlays at comparable z-indices, so below
    1488px of stage width opening one had to close the other. A dialog covers
    the surface it is opened from and does not compete with it for the right
    edge, so the collision and the ResizeObserver that predicted it are gone.
  */

  /**
   * The record windows of the tab in use, outermost first.
   *
   * Read from the same store the setup column's spinners write to, so the bar
   * and the spinners are two views of one value rather than two settings. The
   * bounds repeat the spinners' own, which is what keeps the bar from offering
   * a window the sidecar would reject.
   */
  const recordBands = useMemo<RecordBand[]>(
    () =>
      tab === "wind"
        ? [
            {
              id: "record",
              label: "record",
              years: wind.params.recordYears,
              min: 1,
              max: 30,
              note: "MERRA-2 hourly wind",
              onChange: (years) =>
                windDispatch({ type: "params/set", patch: { recordYears: years } }),
            },
          ]
        : [
            {
              id: "climatology",
              label: "climatology",
              years: solar.params.climatologyYears,
              min: 5,
              max: 40,
              note: "daily resource",
              onChange: (years) => setParams({ climatologyYears: years }, "radiation"),
            },
            {
              id: "hourly",
              label: "hourly",
              years: solar.params.hourlyYears,
              min: 3,
              max: 20,
              note: "tilt sweep, yield, terrain",
              onChange: (years) => setParams({ hourlyYears: years }, "hourly"),
            },
          ],
    [
      tab,
      wind.params.recordYears,
      solar.params.climatologyYears,
      solar.params.hourlyYears,
      windDispatch,
      setParams,
    ]
  )

  /*
    Derived in lib/solarLayers.ts rather than here. The board reads the same
    two rasters from the same store, and two derivations of one list disagree
    within a release -- the reason lib/mapLayers.ts exists.
  */
  const solarOverlays = useMemo(
    () =>
      solarOverlayList({
        terrain: solar.results.terrain,
        siting: solar.results.siting,
        showTerrain: solar.layers.showTerrain,
        showSiting: solar.layers.showSiting,
        terrainOpacity: solar.layers.terrainOpacity,
        sitingOpacity: solar.layers.sitingOpacity,
      }),
    [solar.results.terrain, solar.results.siting, solar.layers]
  )

  const mapRegion = (
    <MapView
        initialView={props.initialView}
        areas={props.areas}
        activeExample={props.activeExample}
        customPolygon={props.customPolygon}
        onPolygonDrawn={props.onPolygonDrawn}
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
        onCreditChange={props.onCreditChange}
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
        activeExample={props.activeExample}
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
        activeExample={props.activeExample}
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
          runningLabel="Screening…"
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

  /*
    Any result the current tab can report into the bottom panel.

    Any solar product, not the selected one. Gated on `selected`, choosing a
    product that had run nothing unmounted the panel and with it a reading of
    the three products that had -- results that were still in the store and
    still valid.
  */
  const hasResult =
    tab === "wind"
      ? !!wind.result
      : SOLAR_PRODUCTS.some((p) => !!solar.results[p.id])

  /*
    Clearing the last result closes the reading rather than leaving the column
    holding it. Nothing but unmounting the screen reset this before, so the next
    run of any product re-opened a full reading nobody had asked for.
  */
  useEffect(() => {
    if (!hasResult) setResultOpen(false)
  }, [hasResult])

  /*
    Which results the reading can show, as a key rather than a count.

    A run that finishes is the one moment the reader is certainly asking for
    the result, so the column opens on it. Compared as a key and not as a
    length so that clearing one product of four does not read as an arrival and
    re-open a column the reader had folded away.
  */
  const resultKeys = useMemo(
    () =>
      tab === "wind"
        ? wind.result
          ? "wind"
          : ""
        : SOLAR_PRODUCTS.filter((p) => solar.results[p.id]).map((p) => p.id).join(","),
    [tab, wind.result, solar.results]
  )
  const lastKeys = useRef(resultKeys)
  useEffect(() => {
    const arrived = resultKeys.length > lastKeys.current.length
    lastKeys.current = resultKeys
    if (arrived) setResultOpen(true)
  }, [resultKeys])

  const groups = useMemo(
    () =>
      tab === "wind"
        ? windReadingGroups(wind.result)
        : solarReadingGroups(solar.results),
    [tab, wind.result, solar.results]
  )

  /**
   * The setup column, floated over the map exactly as the map screen's tool
   * panels are. It was a structural column beside a boxed map, which gave the
   * same object two shapes and left the map letterboxed with dead space under
   * it -- the map is where the AOI is drawn, so it is not a thumbnail.
   */
  /*
    Whether the parameters are on screen.

    They were not foldable while this column was the screen's only surface --
    a control that empties the screen is not a control. The result is read in
    its own column now, and a reader comparing a run against the map it was
    computed over has a reason to want the map: 19rem of a 1400px stage is
    nearly a seventh of it, and the AOI is drawn on what it covers.
  */
  const [setupOpen, setSetupOpen] = useState(true)

  const setupColumn = (placement: PanelPlacement) => (
    <PanelShell
      key={tab}
      placement={placement}
      title={tab === "solar" ? "Solar resource" : "Wind screening"}
      onCollapse={
        placement === "drawer"
          ? () => setConfigOpen(false)
          : () => setSetupOpen(false)
      }
    >
      {tab === "solar" ? solarSetup : windSetup}
    </PanelShell>
  )

  return (
    <div
      className="relative h-full min-h-0 w-full"
      style={
        {
          // What the record bar occupies, reported by the bar itself, so the
          // status panel and the Leaflet attribution clear it exactly. Held by
          // hand this was wrong in both directions -- too small on the solar
          // tab, which overlapped, and too large on wind, which left a strip of
          // map between the attribution and the bar and made the attribution
          // read as floating.
          "--map-foot": `${footPx}px`,
        } as React.CSSProperties
      }
    >
      {/*
        Full bleed, as on the map screen. Two of the four solar products and the
        wind screening draw nothing, and the map still carries the AOI they are
        computed over, so it stays rather than being swapped for an empty state:
        what a product returns is declared in the selector and on its run
        button, before it runs, which is where that belongs.
      */}
      {mapRegion}

      <SearchBar onSelectLocation={props.onLocationSelect} />

      {/*
        The setup column, or the drawer the dock layout opens from its bar. The
        same block either way: only the container it is given changes.
      */}
      <AnimatePresence mode="wait" initial={false}>
        {workspace || !setupOpen ? null : setupColumn("docked")}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {!workspace && !setupOpen && (
          <PanelTab
            key="setup-tab"
            placement="docked"
            label="Setup"
            icon={SlidersHorizontal}
            title="Show the run parameters"
            onOpen={() => setSetupOpen(true)}
          />
        )}
      </AnimatePresence>
      {/*
        The presence stays mounted and its child is what comes and goes. Gating
        the AnimatePresence itself removed the exit animation: closing the
        drawer unmounted the thing that was supposed to be animating it out.
      */}
      <AnimatePresence mode="wait" initial={false}>
        {workspace && configOpen ? setupColumn("drawer") : null}
      </AnimatePresence>

      <AnimatePresence>
        {workspace && (
          <WorkspaceBar
            key="energy-bar"
            groupId="energy"
            activeId={tab}
            onNavigate={props.onNavigate}
            running={run.running}
            progress={run.progress}
            progressMsg={run.progressMsg}
            runLabel={run.label}
            canRun={run.canRun}
            onRun={run.onRun}
            onWidthChange={setBarWidthPx}
            configOpen={configOpen}
            onConfigToggle={() => setConfigOpen((o) => !o)}
          />
        )}
      </AnimatePresence>

      {/*
        Retracted past whatever holds the foot's left end: the setup column at
        its fixed 19rem plus its two gutters, or the dock layout's island at
        whatever width it measured, plus the gap between the two segments.
      */}
      <RecordWindowBar
        bands={recordBands}
        endYear={endYear}
        disabled={tab === "wind" ? windBusy : solarBusy}
        /* Folded, the column holds nothing at the foot's left end but a 32px
           tab three rems above it, so the reserved 20.5rem would be a strip of
           map kept clear for a panel that is not on screen. */
        flushLeft={workspace || !setupOpen}
        leftOffset={
          workspace
            ? barWidthPx
              ? `calc(${barWidthPx}px + 0.75rem)`
              : undefined
            : setupOpen
              ? "20.5rem"
              : undefined
        }
        onHeightChange={setFootPx}
      />

      {/*
        The reading, in the column that mirrors the setup one. Folded, it leaves
        the control that brings it back where its own head stands.

        Keyed on the tab alone: keyed on the product too, every product switch
        remounted a column that holds every product's result and would have
        thrown away the reader's scroll position for a change of selection.
        `mode="wait"`, because the default stacks the outgoing and incoming
        columns in one rectangle for the length of the exit spring.
      */}
      <AnimatePresence initial={false} mode="wait">
        {hasResult && resultOpen && (
          <EnergyReadingColumn
            key={tab}
            /* Not the tab's name: the setup column on the other edge already
               carries it, and two columns titled "Solar resource" flanking one
               map is the duplication this reshape exists to remove. */
            title={tab === "solar" ? "Solar result" : "Wind result"}
            groups={groups}
            onClear={(key) =>
              key === "wind"
                ? windDispatch({ type: "result/clear" })
                : solarDispatch({ type: "result/clear", product: key })
            }
            onCollapse={() => setResultOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {hasResult && !resultOpen && (
          <PanelTab
            key="result-tab"
            placement="reading"
            label="Result"
            icon={ChartColumn}
            title={`Read the ${tab} result`}
            onOpen={() => setResultOpen(true)}
          />
        )}
      </AnimatePresence>

    </div>
  )
}
