import { CircleNotch, Eye, Trash } from "@/components/icons"
import { LegendBody } from "@/components/globe/OverlayCallout"
import { btnGhost, btnPrimaryCommit } from "@/components/ui/buttons"
import {
  BIOMASS_YEARS,
  BIOPHYSICAL_VARIABLES,
  INDEX_GROUPS,
  INDICES,
  KINDS,
  RGB_PRESETS,
  S2_BANDS,
  bandName,
  findRgbPreset,
  kindDef,
} from "@/lib/compositeCatalog"
import { layerLegendOfComposition } from "@/lib/compositionLegend"
import { compositionTitle } from "@/lib/mapLayers"
import { PRODUCT_NOTES } from "@/lib/productNotes"
import { exportPng, exportTif, type RunAsset } from "@/lib/runAssets"
import type {
  BiophysicalVariable,
  CompositeIndex,
  CompositeKind,
  CompositionOverlay,
  DataCubeScene,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  PanelChoices,
  PanelHeading,
  PanelLimit,
  ShellPanel,
} from "@/components/shell/ShellPanel"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

/** The most groups a clustering forms: the categorical colours there are. */
const MAX_CLUSTERS = 7

function SceneSelect({
  label,
  scenes,
  value,
  onChange,
}: {
  label: string
  scenes: readonly DataCubeScene[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <select
      aria-label={label}
      className="field-input min-w-0 flex-1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!value && <option value="">Choose a scene</option>}
      {scenes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.date} · {Math.round(s.cloud_cover)} % cloud
        </option>
      ))}
    </select>
  )
}

/**
 * What a reader must hold when two compositions are set side by side.
 *
 * A colour means one value on both sides only where both are drawn on one fixed
 * scale: a canopy variable of one kind. Everything else sets its scale per
 * raster, and clusters number their groups per scene.
 */
function compareNote(a: CompositionOverlay, b: CompositionOverlay): string {
  if (
    a.kind === "biophysical" &&
    b.kind === "biophysical" &&
    a.variable === b.variable
  ) {
    return "Both are drawn on one fixed scale, so one colour on the two sides is one value."
  }
  if (a.kind === "clusters" || b.kind === "clusters") {
    return "Cluster numbers are not shared between two scenes: read the groups, not their colours."
  }
  return "Each is scaled on its own, so one colour on the two sides is not one value. Read each against its own legend."
}

/**
 * Ways of looking at the area: one scene, two, the period's cloud-free median,
 * or a published biomass map.
 *
 * A panel of its own rather than a product in the list. It answers a different
 * request from the others: a way of looking, which leaves no run behind, and
 * each kind states its limit under it.
 */
export function VisualizationPanel({
  hasArea,
  start,
  end,
  scenes,
  scenesLoading,
  scenesError,
  selectedSceneId,
  onSelectScene,
  sceneBefore,
  onSelectSceneBefore,
  onListScenes,
  kind,
  onKindChange,
  median,
  onMedianChange,
  bands,
  onBandsChange,
  index,
  onIndexChange,
  clusters,
  onClustersChange,
  variable,
  onVariableChange,
  year,
  onYearChange,
  stretchLow,
  stretchHigh,
  onStretchChange,
  running,
  progress,
  progressMsg,
  onApply,
  composition,
  gallery,
  assets,
  beneathId,
  onBeneath,
  onSelect,
  onRemove,
  onClearAll,
  onClose,
}: {
  hasArea: boolean
  start: string
  end: string
  scenes: readonly DataCubeScene[]
  scenesLoading: boolean
  scenesError: string | null
  selectedSceneId: string
  onSelectScene: (id: string) => void
  /** The earlier scene of a change; selectedSceneId is the later. */
  sceneBefore: string
  onSelectSceneBefore: (id: string) => void
  onListScenes: () => void
  kind: CompositeKind
  onKindChange: (k: CompositeKind) => void
  /** Drawn from the period's cloud-free median, where the kind allows it. */
  median: boolean
  onMedianChange: (v: boolean) => void
  bands: [string, string, string]
  onBandsChange: (b: [string, string, string]) => void
  index: CompositeIndex
  onIndexChange: (i: CompositeIndex) => void
  clusters: number
  onClustersChange: (k: number) => void
  variable: BiophysicalVariable
  onVariableChange: (v: BiophysicalVariable) => void
  year: number
  onYearChange: (y: number) => void
  stretchLow: number
  stretchHigh: number
  onStretchChange: (low: number, high: number) => void
  running: boolean
  progress: number
  progressMsg: string
  onApply: () => void
  composition: CompositionOverlay | null
  gallery: readonly CompositionOverlay[]
  assets: readonly RunAsset[]
  /** The composition drawn under the one on the map, to compare through the curtain. */
  beneathId: string | null
  onBeneath: (id: string | null) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onClearAll: () => void
  onClose: () => void
}) {
  const def = kindDef(kind)
  const fromMedian = def.median && median
  const needsScene = kind !== "biomass" && !fromMedian
  const preset = findRgbPreset(bands)
  const indexDef = INDICES.find((i) => i.id === index)
  const variableDef = BIOPHYSICAL_VARIABLES.find((v) => v.id === variable)
  const beneath = gallery.find((c) => c.id === beneathId) ?? null
  const canList = hasArea && !!start && !!end
  // Why the button is off, since a greyed button leaves that to be worked out.
  const blocked = !hasArea
    ? "Draw an area on the map, or choose one under Areas."
    : kind === "biomass"
      ? null
      : !start || !end
        ? "Set both dates of the period, under Products."
        : !needsScene
          ? null
          : !selectedSceneId
            ? "List the scenes of the period and choose one."
            : kind === "change" && !sceneBefore
              ? "Choose the earlier scene of the change."
              : kind === "change" && sceneBefore === selectedSceneId
                ? "Choose two different scenes."
                : null
  const reading = composition?.legend
    ? layerLegendOfComposition(composition.legend)
    : null
  return (
    <ShellPanel
      crumbs={[{ label: "Visualization" }]}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {running && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label="Applying the composition"
            >
              <div className="h-1 overflow-hidden rounded-sm bg-[rgb(var(--p-control))]">
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${clamp(progress, 0, 100)}%` }}
                />
              </div>
              <p className="mt-1 truncate text-label text-muted-foreground">
                {progressMsg}
              </p>
            </div>
          )}
          {blocked && !running && (
            <p className="text-label text-muted-foreground">{blocked}</p>
          )}
          <button
            type="button"
            disabled={!!blocked || running}
            onClick={onApply}
            className={cn(btnPrimaryCommit, "w-full")}
          >
            {running ? "Applying" : "Apply"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-read text-muted-foreground">{PRODUCT_NOTES.compose.hint}</p>

        <section className="flex flex-col gap-2">
          <PanelHeading>View</PanelHeading>
          <PanelChoices
            label="Kind of view"
            value={kind}
            options={KINDS.map((k) => ({ id: k.id, label: k.label }))}
            onChange={onKindChange}
          />
          <p className="text-label text-muted-foreground">{def.description}</p>
        </section>

        {kind !== "biomass" && (
          <section className="flex flex-col gap-2">
            <PanelHeading>{kind === "change" ? "Scenes" : "Scene"}</PanelHeading>
            {/*
              THE MEDIAN IS A SOURCE, NOT A KIND. Any view that reads one scene's
              bands as a picture can read the period's cloud-free median instead;
              a change is two scenes and a canopy model needs one scene's angles,
              so those two do not offer it.
            */}
            {def.median && (
              <PanelChoices
                label="Drawn from"
                value={median ? "median" : "scene"}
                options={[
                  { id: "scene", label: "One scene" },
                  { id: "median", label: "Period median" },
                ]}
                onChange={(v) => onMedianChange(v === "median")}
              />
            )}
            {fromMedian ? (
              <p className="text-label text-muted-foreground">
                Each cell is the median of its clear observations over the period, from
                up to 12 of the least cloudy acquisitions. Cells differ in how many
                observations they rest on, and in which dates. Over a period with a
                rainy season the clearest dates fall in the dry one, so the median is of
                the dry season: the dates it used are given with it.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!canList || scenesLoading}
                    onClick={onListScenes}
                    title={
                      !canList
                        ? "Needs an area and both dates of the period, under Products."
                        : undefined
                    }
                    className={cn(btnGhost, "shrink-0")}
                  >
                    {scenesLoading && <CircleNotch className="size-3.5 animate-spin" />}
                    {scenes.length ? "Refresh scenes" : "List scenes"}
                  </button>
                  {scenes.length > 0 && kind !== "change" && (
                    <SceneSelect
                      label="Scene"
                      scenes={scenes}
                      value={selectedSceneId}
                      onChange={onSelectScene}
                    />
                  )}
                </div>
                {scenes.length > 0 && kind === "change" && (
                  <div className="flex gap-2">
                    <Field label="Before">
                      <SceneSelect
                        label="Earlier scene"
                        scenes={scenes}
                        value={sceneBefore}
                        onChange={onSelectSceneBefore}
                      />
                    </Field>
                    <Field label="After">
                      <SceneSelect
                        label="Later scene"
                        scenes={scenes}
                        value={selectedSceneId}
                        onChange={onSelectScene}
                      />
                    </Field>
                  </div>
                )}
              </>
            )}
            {start && end && (
              <p className="text-label text-muted-foreground">
                Period {start} to {end}
              </p>
            )}
            {scenesError && (
              <p className="text-label text-destructive-quiet">{scenesError}</p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <PanelHeading>{def.label}</PanelHeading>
          {kind === "rgb" && (
            <>
              <select
                aria-label="Band combination"
                className="field-input"
                value={preset?.id ?? ""}
                onChange={(e) => {
                  const hit = RGB_PRESETS.find((r) => r.id === e.target.value)
                  if (hit) onBandsChange([...hit.bands] as [string, string, string])
                }}
              >
                {!preset && <option value="">Custom</option>}
                {RGB_PRESETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} · {r.bands.join(", ")}
                  </option>
                ))}
              </select>
              {/*
                ONE PICKER PER CHANNEL, under the presets rather than instead of
                them: a preset is the usual answer, and a band moved by hand
                turns the list above to Custom, which is what it then is.
              */}
              <div className="flex gap-2">
                {(["R", "G", "B"] as const).map((channel, at) => (
                  <Field key={channel} label={channel}>
                    <select
                      aria-label={`Band in the ${channel} channel`}
                      title={bandName(bands[at])}
                      className="field-input"
                      value={bands[at]}
                      onChange={(e) => {
                        const next: [string, string, string] = [...bands]
                        next[at] = e.target.value
                        onBandsChange(next)
                      }}
                    >
                      {S2_BANDS.map((b) => (
                        <option key={b.id} value={b.id} title={bandName(b.id)}>
                          {b.id}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              <p className="text-label text-muted-foreground">
                {preset
                  ? preset.description
                  : bands.map((b, at) => `${"RGB"[at]} ${bandName(b)}`).join(" · ")}
              </p>
            </>
          )}
          {(kind === "index" || kind === "change") && (
            <>
              <select
                aria-label="Spectral index"
                className="field-input"
                value={index}
                onChange={(e) => onIndexChange(e.target.value as CompositeIndex)}
              >
                {INDEX_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {INDICES.filter((i) => i.group === group).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {indexDef && (
                <>
                  <p className="text-label text-muted-foreground">
                    {indexDef.description}
                  </p>
                  <p className="telemetry text-label text-muted-foreground">
                    {kind === "change"
                      ? `after - before, of ${indexDef.formula}`
                      : indexDef.formula}
                  </p>
                </>
              )}
            </>
          )}
          {kind === "clusters" && (
            <Field label="Groups">
              <input
                type="number"
                min={2}
                max={MAX_CLUSTERS}
                className="field-input"
                value={clusters}
                onChange={(e) =>
                  onClustersChange(
                    Math.round(clamp(e.target.valueAsNumber, 2, MAX_CLUSTERS))
                  )
                }
              />
            </Field>
          )}
          {kind === "biophysical" && (
            <>
              <select
                aria-label="Canopy variable"
                className="field-input"
                value={variable}
                onChange={(e) =>
                  onVariableChange(e.target.value as BiophysicalVariable)
                }
              >
                {BIOPHYSICAL_VARIABLES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              {variableDef && (
                <p className="text-label text-muted-foreground">
                  {variableDef.description}
                </p>
              )}
            </>
          )}
          {kind === "biomass" && (
            <Field label="Year">
              <select
                aria-label="Year of the biomass map"
                className="field-input"
                value={year}
                onChange={(e) => onYearChange(Number(e.target.value))}
              >
                {BIOMASS_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {def.stretch && (
            <div className="flex gap-2">
              <Field label="Stretch low (%)">
                <input
                  type="number"
                  min={0}
                  max={49}
                  className="field-input"
                  value={stretchLow}
                  onChange={(e) =>
                    onStretchChange(clamp(e.target.valueAsNumber, 0, 49), stretchHigh)
                  }
                />
              </Field>
              <Field label="Stretch high (%)">
                <input
                  type="number"
                  min={51}
                  max={100}
                  className="field-input"
                  value={stretchHigh}
                  onChange={(e) =>
                    onStretchChange(stretchLow, clamp(e.target.valueAsNumber, 51, 100))
                  }
                />
              </Field>
            </div>
          )}
        </section>

        {/*
          THE FIGURES OF WHAT IS ON THE MAP, where the sidecar computed them: the
          mean, the share a model could not answer, the clusters' areas. The map
          ties the same legend to the raster; here it is read in full.
        */}
        {composition && reading && (
          <section className="flex flex-col gap-2">
            <PanelHeading>On the map</PanelHeading>
            <p className="text-read text-foreground">{reading.subject}</p>
            <LegendBody legend={reading} />
            {/* The caveat the map's card has no room for. */}
            {composition.legend?.note && (
              <p className="text-label text-muted-foreground">
                {composition.legend.note}
              </p>
            )}
          </section>
        )}

        {gallery.length > 0 && (
          <section className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <PanelHeading>Compositions of this area</PanelHeading>
              <button
                type="button"
                onClick={onClearAll}
                className="text-label text-muted-foreground hover:text-foreground"
              >
                Take all off
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {gallery.map((c) => {
                const asset = assets.find((a) => a.selectId === c.id)
                const on = composition?.id === c.id
                return (
                  <li
                    key={c.id}
                    className={cn("rounded-sm px-2 py-1.5", on && "bg-selected")}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        aria-current={on ? "true" : undefined}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-1.5">
                          {on && (
                            <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate text-read text-foreground">
                            {c.title || c.label || "Composition"}
                          </span>
                        </span>
                        {c.sceneDate && (
                          <span className="block text-label text-muted-foreground">
                            {c.sceneDate}
                          </span>
                        )}
                      </button>
                      {/*
                        Offered only with a composition on the map, since that is
                        what this one would be compared with.
                      */}
                      {!on && composition && (
                        <button
                          type="button"
                          aria-pressed={c.id === beneathId}
                          onClick={() => onBeneath(c.id === beneathId ? null : c.id)}
                          title={
                            c.id === beneathId
                              ? "Stop comparing"
                              : "Draw under the composition on the map, and compare the two with the curtain"
                          }
                          className={cn(
                            "text-label hover:text-foreground",
                            c.id === beneathId
                              ? "text-primary"
                              : "text-muted-foreground"
                          )}
                        >
                          Compare
                        </button>
                      )}
                      {asset && (
                        <>
                          <button
                            type="button"
                            onClick={() => void exportPng(asset)}
                            className="text-label text-muted-foreground hover:text-foreground"
                          >
                            PNG
                          </button>
                          {asset.exportTif && (
                            <button
                              type="button"
                              onClick={() => void exportTif(asset)}
                              className="text-label text-muted-foreground hover:text-foreground"
                            >
                              GeoTIFF
                            </button>
                          )}
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemove(c.id)}
                        aria-label={`Take ${c.title || "this composition"} off the list`}
                        title="Take off the list"
                        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
                      >
                        <Trash className="size-3.5" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {composition && beneath && (
              <p className="mt-1 text-label text-muted-foreground">
                {compositionTitle(beneath)} is under {compositionTitle(composition)}.
                Move the curtain on the map to compare them.{" "}
                {compareNote(composition, beneath)}
              </p>
            )}
          </section>
        )}

        <PanelLimit>{def.limit}</PanelLimit>
      </div>
    </ShellPanel>
  )
}
