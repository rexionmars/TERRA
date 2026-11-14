import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { CaretRight, CircleNotch, Play } from "@/components/icons"
import { MethodPanel } from "@/components/workspace/MethodPanel"
import { RunQueue } from "@/components/workspace/RunQueue"
import { btnGhost, btnPrimaryCommit } from "@/components/ui/buttons"
import { MODE_OPTIONS, modeBlockedBy } from "@/lib/classifyOptions"
import {
  classifiers,
  installedModel,
  modelName,
  useInstalledModels,
} from "@/lib/installedModels"
import { isJobKind } from "@/lib/jobs"
import {
  BOARD_TOOLS,
  isProductId,
  type BoardTool,
  type ProductId,
} from "@/lib/mapTools"
import { methodBrief } from "@/lib/methodBrief"
import { MAX_DRAWS, MAX_PASSES } from "@/lib/mineral"
import { PRODUCT_NOTES } from "@/lib/productNotes"
import { PRODUCT_PICTURES, pictureCredit } from "@/lib/productPictures"
import { productOffered, productRun, type ProductRunProps } from "@/lib/productRun"
import type { RunLogEntry } from "@/lib/runLog"
import type { ModelKind, WaterIndex } from "@/lib/types"
import { cn } from "@/lib/utils"
import { WATER_INDICES } from "@/lib/waterOptions"
import { PanelLimit, ShellPanel } from "@/components/shell/ShellPanel"
import type { MineralRunOptions } from "@/lib/mineral"

/**
 * The parameters each product reads, beside what starts it.
 *
 * Every value is the application's own state passed straight through, so a run
 * started here is made of the inputs the rest of the application shows.
 */
export interface ProductsPanelProps extends ProductRunProps {
  maxCloud: number
  monthlyBest: boolean
  mode: "single" | "temporal"
  modelKind: ModelKind
  prithviMode: "pixel" | "patch"
  waterIndex: WaterIndex
  mineralOptions?: MineralRunOptions
  /** What the run in progress has said, for the trace in the method panel. */
  runLog?: RunLogEntry[]
  onAnalyzeLULC?: () => void
  lulcRunning?: boolean
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  onMaxCloudChange: (v: number) => void
  onMonthlyBestChange: (v: boolean) => void
  onModeChange: (m: "single" | "temporal") => void
  onModelKindChange: (m: ModelKind) => void
  onPrithviModeChange: (m: "pixel" | "patch") => void
  onWaterIndexChange: (i: WaterIndex) => void
  /** Opens the Models screen, where a model is installed. */
  onOpenModels?: () => void
  onMineralOptionsChange?: (o: MineralRunOptions) => void
}

/*
  Compositions have a panel of their own: a way of looking at a
  scene rather than a run of a product.
*/
const LISTED = BOARD_TOOLS.filter((t): t is BoardTool & { id: ProductId } =>
  isProductId(t.id)
)

/*
  A crop of a published picture of the kind of result the product returns; see
  productPictures.ts. Without alt text, because the label beside it names the
  product. The edge keeps a dark picture from running into the panel.
*/
function Plate({ product }: { product: ProductId }) {
  const picture = PRODUCT_PICTURES[product]
  return (
    <img
      src={picture.path}
      alt=""
      title={pictureCredit(picture)}
      width={44}
      height={44}
      draggable={false}
      className="size-11 shrink-0 rounded-sm object-cover outline-1 -outline-offset-1 outline-[rgb(var(--p-line)/0.28)]"
    />
  )
}

/**
 * The model to classify with: the land-cover packages installed on this
 * machine. A package of another task is installed beside them and not listed.
 *
 * One entry per model, its newest version, which is what a run that pins no
 * version uses. With none installed there is nothing to pick, so the field says
 * where to get one. A model chosen earlier and since removed stays listed as
 * not installed, so the form does not silently switch to another model.
 */
function ModelField({
  value,
  onChange,
  onOpenModels,
}: {
  value: ModelKind
  onChange: (m: ModelKind) => void
  onOpenModels?: () => void
}) {
  const { models, loaded } = useInstalledModels()
  const newest = classifiers(models)
  if (loaded && newest.length === 0) {
    return (
      <Field label="Model">
        <p className="text-label text-muted-foreground">
          No land-cover model is installed.{" "}
          {onOpenModels && (
            <button
              type="button"
              onClick={onOpenModels}
              className="text-accent-quiet underline-offset-2 hover:underline"
            >
              Get one from Models
            </button>
          )}
        </p>
      </Field>
    )
  }
  const listed = newest.some((m) => m.manifest.id === value)
  return (
    <Field label="Model">
      <select
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {!listed && <option value={value}>{modelName(value)} · not installed</option>}
        {newest.map((m) => (
          <option key={m.manifest.id} value={m.manifest.id}>
            {m.manifest.name} · {m.manifest.version}
          </option>
        ))}
      </select>
    </Field>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** Clamped on the way out, because a number field holds whatever is typed. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
}

export function ProductsPanel({
  product,
  onProductChange,
  onClose,
  ...p
}: ProductsPanelProps & {
  product: ProductId | null
  onProductChange: (t: ProductId | null) => void
  onClose: () => void
}) {
  if (!product) {
    return (
      <ShellPanel crumbs={[{ label: "Products" }]} onClose={onClose}>
        <ul className="flex flex-col gap-1">
          {LISTED.filter((t) => productOffered(t.id, p)).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onProductChange(t.id)}
                className="flex w-full items-center gap-3 rounded-sm p-2 text-left transition-colors hover:bg-hover"
              >
                <Plate product={t.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-read font-medium text-foreground">
                    {t.label}
                  </span>
                  <span className="block text-label text-muted-foreground">
                    {PRODUCT_NOTES[t.id].hint}
                  </span>
                </span>
                <CaretRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </ShellPanel>
    )
  }

  const tool = BOARD_TOOLS.find((t) => t.id === product)
  const note = PRODUCT_NOTES[product]
  const picture = PRODUCT_PICTURES[product]
  const run = productRun(product, p)
  const usesPeriod = product !== "overlap"
  const usesCloud = product === "classify" || product === "water"
  const passes = p.mineralOptions

  return (
    <ShellPanel
      crumbs={[
        { label: "Products", onClick: () => onProductChange(null) },
        { label: tool?.label ?? product },
      ]}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {run.running && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(run.progress)}
              aria-label={run.label}
            >
              <div className="h-1 overflow-hidden rounded-sm bg-[rgb(var(--p-control))]">
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${clamp(run.progress, 0, 100)}%` }}
                />
              </div>
              <p className="mt-1 truncate text-label text-muted-foreground">
                {run.progressMsg}
              </p>
            </div>
          )}
          {run.blocked && !run.running && (
            <p className="text-label text-muted-foreground">{run.blocked}</p>
          )}
          <button
            type="button"
            disabled={!!run.blocked || run.running}
            onClick={run.onRun}
            className={cn(btnPrimaryCommit, "w-full")}
          >
            <Play className="size-3.5" />
            {run.label}
          </button>
          <div className="flex items-center gap-2">
            {/* Not disabled while running: that is when its trace is being written. */}
            <MethodPanel
              brief={methodBrief({
                tool: product,
                modelKind: p.modelKind,
                start: p.start,
                end: p.end,
                maxCloud: p.maxCloud,
                monthlyBest: p.monthlyBest,
              })}
              runLog={p.runLog ?? []}
              running={run.running}
            />
            {product === "classify" && p.onAnalyzeLULC && (
              <button
                type="button"
                onClick={p.onAnalyzeLULC}
                disabled={run.running || !p.hasArea || p.lulcRunning}
                title="MapBiomas over the area, without running a model"
                className={cn(btnGhost, "ml-auto")}
              >
                {p.lulcRunning && <CircleNotch className="size-3.5 animate-spin" />}
                Land cover
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Plate product={product} />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-read text-muted-foreground">{note.hint}</p>
            {/* The credit the picture's licence asks for, next to the picture. */}
            <button
              type="button"
              className="cursor-pointer self-start text-left text-meta text-muted-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              title="Cropped and resized from the original on Wikimedia Commons"
              onClick={() => BrowserOpenURL(picture.source)}
            >
              {pictureCredit(picture)}
            </button>
          </div>
        </div>

        {usesPeriod && (
          <div className="flex gap-2">
            <Field label="Start">
              <input
                type="date"
                className="field-input"
                value={p.start}
                onChange={(e) => p.onStartChange(e.target.value)}
              />
            </Field>
            <Field label="End">
              <input
                type="date"
                className="field-input"
                value={p.end}
                onChange={(e) => p.onEndChange(e.target.value)}
              />
            </Field>
          </div>
        )}

        {usesCloud && (
          <div className="flex items-end gap-3">
            <Field label="Cloud limit per scene (%)">
              <input
                type="number"
                min={0}
                max={100}
                className="field-input"
                value={p.maxCloud}
                onChange={(e) =>
                  p.onMaxCloudChange(clamp(e.target.valueAsNumber, 0, 100))
                }
              />
            </Field>
            <label className="flex h-8 flex-1 items-center gap-2 text-read text-foreground">
              <input
                type="checkbox"
                checked={p.monthlyBest}
                onChange={(e) => p.onMonthlyBestChange(e.target.checked)}
              />
              Clearest scene per month
            </label>
          </div>
        )}

        {product === "classify" && (
          <>
            <ModelField
              value={p.modelKind}
              onChange={(m) => {
                p.onModelKindChange(m)
                if (modeBlockedBy(p.mode, m)) p.onModeChange("single")
              }}
              onOpenModels={p.onOpenModels}
            />
            <Field label="Mode">
              <select
                className="field-input"
                value={p.mode}
                onChange={(e) =>
                  p.onModeChange(e.target.value as "single" | "temporal")
                }
              >
                {MODE_OPTIONS.map((o) => (
                  <option
                    key={o.id}
                    value={o.id}
                    disabled={!!modeBlockedBy(o.id, p.modelKind)}
                  >
                    {o.label} · {o.detail}
                  </option>
                ))}
              </select>
            </Field>
            {/* The heads an embedding package carries, from its manifest. */}
            {(installedModel(p.modelKind)?.manifest.variants?.length ?? 0) > 1 && (
              <Field label="Prediction">
                <select
                  className="field-input"
                  value={p.prithviMode}
                  onChange={(e) =>
                    p.onPrithviModeChange(e.target.value as "pixel" | "patch")
                  }
                >
                  {installedModel(p.modelKind)?.manifest.variants?.map((v) => (
                    <option key={v} value={v}>
                      Per {v}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}

        {product === "water" && (
          <Field label="Index">
            <select
              className="field-input"
              value={p.waterIndex}
              onChange={(e) => p.onWaterIndexChange(e.target.value as WaterIndex)}
            >
              {WATER_INDICES.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label} · {w.detail}
                </option>
              ))}
            </select>
          </Field>
        )}

        {product === "mineral" && passes && (
          <div className="flex gap-2">
            <Field label={`Passes compared per cell (1 to ${MAX_PASSES})`}>
              <input
                type="number"
                min={1}
                max={MAX_PASSES}
                className="field-input"
                value={passes.passes}
                onChange={(e) =>
                  p.onMineralOptionsChange?.({
                    ...passes,
                    passes: clamp(e.target.valueAsNumber, 1, MAX_PASSES),
                  })
                }
              />
            </Field>
            <Field label={`Uncertainty draws (0 to ${MAX_DRAWS})`}>
              <input
                type="number"
                min={0}
                max={MAX_DRAWS}
                className="field-input"
                value={passes.draws}
                onChange={(e) =>
                  p.onMineralOptionsChange?.({
                    ...passes,
                    draws: clamp(e.target.valueAsNumber, 0, MAX_DRAWS),
                  })
                }
              />
            </Field>
          </div>
        )}

        <PanelLimit>{note.limit}</PanelLimit>

        {isJobKind(product) && <RunQueue kind={product} />}
      </div>
    </ShellPanel>
  )
}
