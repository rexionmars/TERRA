import { Eye, EyeSlash } from "@/components/icons"
import type { LayerPatch } from "@/lib/layerPatch"
import type { RasterLayer } from "@/lib/mapLayers"
import { cn } from "@/lib/utils"
import { PanelEmpty, ShellPanel } from "@/components/shell/ShellPanel"

/** What the run drew over the map, each with its switch and how solid it is. */
export function LayersPanel({
  layers,
  onChange,
  onClose,
}: {
  layers: readonly RasterLayer[]
  onChange: (id: string, patch: LayerPatch) => void
  onClose: () => void
}) {
  return (
    <ShellPanel crumbs={[{ label: "Layers" }]} onClose={onClose}>
      {layers.length === 0 ? (
        <PanelEmpty title="Nothing drawn yet">A finished run adds its rasters here.</PanelEmpty>
      ) : (
        <ul className="flex flex-col gap-3">
          {layers.map((l) => (
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
            </li>
          ))}
        </ul>
      )}
    </ShellPanel>
  )
}
