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

const ENERGY_TABS: { id: EnergyTab; label: string }[] = [
  { id: "solar", label: "Solar" },
  { id: "wind", label: "Wind" },
]

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

  const tabRefs = useRef<Partial<Record<EnergyTab, HTMLButtonElement | null>>>({})
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const current = ENERGY_TABS.findIndex((t) => t.id === tab)
      let next: number
      switch (e.key) {
        case "ArrowRight":
          next = (current + 1) % ENERGY_TABS.length
          break
        case "ArrowLeft":
          next = (current - 1 + ENERGY_TABS.length) % ENERGY_TABS.length
          break
        case "Home":
          next = 0
          break
        case "End":
          next = ENERGY_TABS.length - 1
          break
        default:
          return
      }
      e.preventDefault()
      const id = ENERGY_TABS[next].id
      setTab(id)
      tabRefs.current[id]?.focus()
    },
    [tab, setTab]
  )

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
    <div className="relative h-[26rem] min-h-[18rem] overflow-hidden rounded-md border border-border">
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
    </div>
  )

  const solarSection = () => {
    if (selected === "resource" && solar.results.resource) {
      return <SolarResourceSection solar={solar.results.resource} />
    }
    if (selected === "terrain" && solar.results.terrain) {
      return <SolarTerrainSection terrain={solar.results.terrain} />
    }
    if (selected === "siting" && solar.results.siting) {
      return <SolarSitingSection siting={solar.results.siting} />
    }
    if (selected === "energy" && solar.results.energy) {
      return <EnergyModelSection energy={solar.results.energy} />
    }
    return null
  }

  const section = solarSection()

  const solarOutput = drawsRaster(product) ? (
    <div className="flex flex-col gap-3">
      {/* Describes what the map is actually carrying, not what the selected
          product would put there. Both rasters are drawn whenever they are
          held, so telling a user with a terrain map already on screen that the
          map "shows the AOI" would be describing a different map. */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {section
          ? `${product.label}: the raster is drawn over the AOI below. Visibility and opacity are in the Layer section.`
          : solarOverlays.length
            ? `${product.label} draws a raster over the AOI. The map below is carrying ${solarOverlays.map((o) => (o.id === "terrain" ? "the terrain irradiation" : "the siting")).join(" and ")} raster from an earlier run; this product adds its own when it finishes.`
            : `${product.label} draws a raster over the AOI. The map below shows the AOI now and the raster when the run finishes.`}
      </p>
      {mapRegion}
      {section}
    </div>
  ) : section ? (
    section
  ) : (
    <OutputPlaceholder
      icon={<ChartLine className="size-5" aria-hidden />}
      title="Figures only, no map layer"
    >
      <p>
        {product.label} reads the radiation record at the AOI centroid, which
        resolves on a 1 degree grid, so it describes the cell the AOI sits in
        rather than structure within it. The payload carries no raster and no
        extent, so there is nothing to draw; the figures appear here when the
        run finishes.
      </p>
      {selected === "energy" && (
        <p>
          The plant figures do cover the AOI: the area behind them is classified
          on the slope limits set beside this card, reusing a siting result when
          one is held. That classification is not returned as a layer. Run
          Photovoltaic siting for a map of it.
        </p>
      )}
      {!props.hasArea && (
        <p>
          No AOI yet. Import a file or load a reference example from the Area
          section. Drawing one by hand needs a map, which the two raster
          products and the map screen provide.
        </p>
      )}
    </OutputPlaceholder>
  )

  const windOutput = wind.result ? (
    <WindScreening wind={wind.result} />
  ) : (
    <OutputPlaceholder
      icon={<WindIcon className="size-5" aria-hidden />}
      title="Figures only, no map layer"
    >
      <p>
        Wind screening resolves the AOI at its centroid on the MERRA-2
        reanalysis grid of 0.5 by 0.625 degrees. The payload carries no raster
        and no extent, so there is nothing to draw; the figures appear here when
        the run finishes.
      </p>
      <p>{WIND_QUALIFIER}</p>
    </OutputPlaceholder>
  )

  return (
    <div className="terra-workspace app-no-drag flex h-full min-h-0 flex-col overflow-hidden">
      <header className="ar-header sticky top-0 z-10 shrink-0 px-5 py-3.5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="telemetry text-[10px] text-primary">ENERGY</p>
            <h1 className="mt-0.5 font-display text-xl font-semibold tracking-wide xl:text-2xl">
              Solar and wind resource
            </h1>
          </div>
          <div
            className="ar-raised flex gap-1 p-1"
            role="tablist"
            aria-label="Energy resource"
          >
            {ENERGY_TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`energy-tab-${t.id}`}
                  aria-selected={active}
                  // Only the selected panel is mounted, so pointing at it from
                  // an inactive tab would be a dangling IDREF.
                  aria-controls={active ? `energy-panel-${t.id}` : undefined}
                  // Roving tabindex: the strip is one tab stop.
                  tabIndex={active ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[t.id] = el
                  }}
                  onClick={() => setTab(t.id)}
                  onKeyDown={handleTabKeyDown}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-sm px-5 text-[11px] font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
        <p className="mt-2 max-w-4xl text-[11px] leading-relaxed text-muted-foreground">
          One resource at a time. The photovoltaic figures are computed at a
          performance ratio bracketed by the Global Solar Atlas; the wind
          figures are gross of every plant loss and carry no external benchmark,
          so no figure on one tab is comparable with a figure on the other.
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="panel-scroll flex w-[21rem] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-4">
          {tab === "solar" ? (
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
                  onChange={(patch) =>
                    solarDispatch({ type: "layers/set", patch })
                  }
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
                  runningLabel={`${product.runningLabel}…`}
                  running={solar.run.active === selected}
                  disabled={!props.hasArea || solarBusy}
                  onClick={() => props.onRunSolar(selected)}
                />
                {!props.hasArea && (
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Define an area above to run.
                  </p>
                )}
                {solar.run.active !== null && solar.run.active !== selected && (
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {solarProduct(solar.run.active).label} is running. The
                    sidecar reports one run at a time.
                  </p>
                )}
                {!!solar.results[selected] && (
                  <button
                    type="button"
                    onClick={() =>
                      solarDispatch({ type: "result/clear", product: selected })
                    }
                    disabled={solarBusy}
                    className="ar-ghost flex h-8 items-center justify-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                    Clear this result
                  </button>
                )}
              </PanelSection>
            </>
          ) : (
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
                  runningLabel="Screening…"
                  running={windBusy}
                  disabled={!props.hasArea || windBusy}
                  onClick={props.onRunWind}
                />
                {!props.hasArea && (
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Define an area above to run.
                  </p>
                )}
                {!!wind.result && (
                  <button
                    type="button"
                    onClick={() => windDispatch({ type: "result/clear" })}
                    disabled={windBusy}
                    className="ar-ghost flex h-8 items-center justify-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                    Clear this result
                  </button>
                )}
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  {WIND_QUALIFIER}
                </p>
              </PanelSection>
            </>
          )}
        </div>

        <div
          role="tabpanel"
          id={`energy-panel-${tab}`}
          aria-labelledby={`energy-tab-${tab}`}
          className="min-w-0 flex-1 overflow-y-auto"
        >
          <div className="flex w-full flex-col gap-3 px-5 py-4 sm:px-6 lg:px-8">
            {tab === "solar" ? solarOutput : windOutput}
          </div>
        </div>
      </div>
    </div>
  )
}
