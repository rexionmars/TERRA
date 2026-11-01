import { DownloadSimple, Eye, EyeSlash } from "@/components/icons"
import type { LayerPatch } from "@/lib/layerPatch"
import type { RasterLayer } from "@/lib/mapLayers"
import { exportPng, exportTif, type RunAsset } from "@/lib/runAssets"
import { cn } from "@/lib/utils"
import { PanelEmpty, ShellPanel } from "@/components/shell/ShellPanel"

function SaveAs({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Save as ${label}`}
      aria-label={`Save as ${label}`}
      className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-label text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      <DownloadSimple className="size-3" />
      {label}
    </button>
  )
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="ml-9 flex items-center gap-2 text-label text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** What a finished run drew over the map, each with its switch and how solid it is. */
export function LayersPanel({
  layers,
  assets,
  smoothOverlay,
  onSmoothOverlayChange,
  confidenceOnTop,
  onConfidenceOnTopChange,
  onChange,
  onClose,
}: {
  layers: readonly RasterLayer[]
  /** The same rasters as files, which is what they are saved from. */
  assets: readonly RunAsset[]
  smoothOverlay: boolean
  onSmoothOverlayChange: (v: boolean) => void
  confidenceOnTop: boolean
  onConfidenceOnTopChange: (v: boolean) => void
  onChange: (id: string, patch: LayerPatch) => void
  onClose: () => void
}) {
  // Top of the stack first, which is how a list of what is over the map reads.
  const rows = [...layers].sort((a, b) => b.order - a.order)
  return (
    <ShellPanel crumbs={[{ label: "Layers" }]} onClose={onClose}>
      {rows.length === 0 ? (
        <PanelEmpty title="Nothing drawn yet">A finished run adds its rasters here.</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((l) => {
            const asset = assets.find((a) => a.sceneId === l.id)
            return (
              <li key={l.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={l.visible}
                    aria-label={`${l.visible ? "Hide" : "Show"} ${l.title}`}
                    title={l.visible ? "Hide" : "Show"}
                    onClick={() => onChange(l.id, { visible: !l.visible })}
                    className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                  >
                    {l.visible ? <Eye className="size-4" /> : <EyeSlash className="size-4" />}
                  </button>
                  <span
                    title={asset?.params || l.title}
                    className={cn(
                      "min-w-0 flex-1 truncate text-read",
                      l.visible ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {l.title}
                  </span>
                  <span className="w-10 shrink-0 text-right text-label tabular-nums text-muted-foreground">
                    {Math.round(l.opacity * 100)} %
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  aria-label={`Opacity of ${l.title}`}
                  value={l.opacity}
                  disabled={!l.visible}
                  onChange={(e) => onChange(l.id, { opacity: e.target.valueAsNumber })}
                  className="ml-9 accent-[rgb(var(--p-accent))] disabled:opacity-40"
                />
                {l.id === "prediction" && (
                  <Switch
                    label="Smooth class edges (majority filter)"
                    checked={smoothOverlay}
                    onChange={onSmoothOverlayChange}
                  />
                )}
                {l.id === "confidence" && (
                  <Switch
                    label="Keep the classification under it"
                    checked={confidenceOnTop}
                    onChange={onConfidenceOnTopChange}
                  />
                )}
                {asset && (
                  <div className="ml-8 flex items-center gap-1">
                    <SaveAs label="PNG" onClick={() => void exportPng(asset)} />
                    {asset.exportTif && <SaveAs label="GeoTIFF" onClick={() => void exportTif(asset)} />}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </ShellPanel>
  )
}
