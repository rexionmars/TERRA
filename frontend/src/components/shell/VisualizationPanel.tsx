import { CircleNotch, Eye, Trash } from "@/components/icons"
import { btnGhost, btnPrimaryCommit } from "@/components/ui/buttons"
import { INDICES, RGB_PRESETS, findRgbPreset } from "@/lib/compositeCatalog"
import { PRODUCT_NOTES } from "@/lib/productNotes"
import { exportPng, exportTif, type RunAsset } from "@/lib/runAssets"
import type {
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

/**
 * One scene as a band composite or a spectral index.
 *
 * A panel of its own rather than a product in the list. It answers a different
 * request from the others: a way of looking at an acquisition, which measures
 * nothing over the period and leaves no run behind.
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
  onListScenes,
  kind,
  onKindChange,
  bands,
  onBandsChange,
  index,
  onIndexChange,
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
  onListScenes: () => void
  kind: CompositeKind
  onKindChange: (k: CompositeKind) => void
  bands: [string, string, string]
  onBandsChange: (b: [string, string, string]) => void
  index: CompositeIndex
  onIndexChange: (i: CompositeIndex) => void
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
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onClearAll: () => void
  onClose: () => void
}) {
  const preset = findRgbPreset(bands)
  const canList = hasArea && !!start && !!end
  // Why the button is off, since a greyed button leaves that to be worked out.
  const blocked = !hasArea
    ? "Draw an area on the map, or choose one under Areas."
    : !selectedSceneId
      ? "List the scenes of the period and choose one."
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
          <PanelHeading>Scene</PanelHeading>
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
            {scenes.length > 0 && (
              <select
                aria-label="Scene"
                className="field-input min-w-0 flex-1"
                value={selectedSceneId}
                onChange={(e) => onSelectScene(e.target.value)}
              >
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.date} · {Math.round(s.cloud_cover)} % cloud
                  </option>
                ))}
              </select>
            )}
          </div>
          {start && end && (
            <p className="text-label text-muted-foreground">
              Period {start} to {end}
            </p>
          )}
          {scenesError && (
            <p className="text-label text-destructive-quiet">{scenesError}</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <PanelHeading>Composite</PanelHeading>
          <PanelChoices
            label="Composite kind"
            value={kind}
            options={[
              { id: "rgb", label: "RGB" },
              { id: "index", label: "Index" },
            ]}
            onChange={onKindChange}
          />
          {kind === "rgb" ? (
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
              {preset && (
                <p className="text-label text-muted-foreground">{preset.description}</p>
              )}
            </>
          ) : (
            <>
              <select
                aria-label="Spectral index"
                className="field-input"
                value={index}
                onChange={(e) => onIndexChange(e.target.value as CompositeIndex)}
              >
                {INDICES.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
              <p className="text-label text-muted-foreground">
                {INDICES.find((i) => i.id === index)?.description}
              </p>
            </>
          )}
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
        </section>

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
          </section>
        )}

        <PanelLimit>{PRODUCT_NOTES.compose.limit}</PanelLimit>
      </div>
    </ShellPanel>
  )
}
