import { useEffect, useState } from "react"

import {
  CircleNotch,
  CornersOut,
  DownloadSimple,
  Eye,
  EyeSlash,
  Folder,
  X,
} from "@/components/icons"
import { btnGhost } from "@/components/ui/buttons"
import {
  countLabel,
  layersBounds,
  type FileLayer,
  type OpenedFile,
} from "@/lib/fileLayers"
import type { LayerPatch } from "@/lib/layerPatch"
import type { RasterLayer } from "@/lib/mapLayers"
import { exportPng, exportTif, type RunAsset } from "@/lib/runAssets"
import { cn } from "@/lib/utils"
import type { LayerLoad } from "@/session/fileLayers"
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
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

/** A layer's mark as the map draws it: a dot, a stroke or a filled square. */
function Swatch({ layer }: { layer: FileLayer }) {
  if (!layer.url) return <span aria-hidden className="size-3 shrink-0" />
  const edge = "border border-[#141414]/70"
  if (layer.kind === "point") {
    return (
      <span
        aria-hidden
        className={cn("size-2.5 shrink-0 rounded-full", edge)}
        style={{ background: layer.color }}
      />
    )
  }
  if (layer.kind === "line") {
    return (
      <span
        aria-hidden
        className="h-1 w-3.5 shrink-0 rounded-full"
        style={{ background: layer.color, boxShadow: "0 0 0 1px rgb(20 20 20 / 0.6)" }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-xs border-2"
      style={{ borderColor: layer.color, background: `${layer.color}55` }}
    />
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {children}
    </button>
  )
}

type Opening = { name: string; step: string; since: number }

/**
 * A file being opened: its name, what is being done to it, and for how long,
 * counted in whole seconds so a long open is seen to be moving.
 */
function Opening({ opening }: { opening: Opening }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const seconds = Math.max(0, Math.floor((now - opening.since) / 1000))
  return (
    <div role="status" className="flex items-start gap-2 rounded-sm bg-hover px-2 py-2">
      <CircleNotch className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-read text-foreground">
          Opening {opening.name}
        </span>
        <span className="block text-label text-muted-foreground">
          {opening.step} · {seconds} s
        </span>
      </span>
    </div>
  )
}

/**
 * The files opened on the map, each with its layers: a switch per layer, the
 * mark it is drawn with, what it holds and in which coordinate system, and why
 * a layer that is not drawn is not.
 */
function OpenedFiles({
  files,
  opening,
  layerLoads,
  onToggle,
  onCloseFile,
  onZoomTo,
}: {
  files: readonly OpenedFile[]
  layerLoads: ReadonlyMap<string, LayerLoad>
  opening: Opening | null
  onToggle: (key: string) => void
  onCloseFile: (id: string) => void
  onZoomTo: (bounds: [number, number, number, number]) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {files.map((f) => {
        const box = layersBounds(f.layers)
        return (
          <section key={f.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span
                className="min-w-0 flex-1 truncate text-read font-medium text-foreground"
                title={f.path}
              >
                {f.name}
              </span>
              {box && (
                <IconAction label={`Zoom to ${f.name}`} onClick={() => onZoomTo(box)}>
                  <CornersOut className="size-4" />
                </IconAction>
              )}
              <IconAction label={`Close ${f.name}`} onClick={() => onCloseFile(f.id)}>
                <X className="size-4" />
              </IconAction>
            </div>
            <ul className="flex flex-col">
              {f.layers.map((l) => (
                <li
                  key={l.key}
                  className="flex items-center gap-2 rounded-sm pr-1 hover:bg-hover"
                >
                  {l.url ? (
                    <IconAction
                      label={`${l.visible ? "Hide" : "Show"} ${l.title || l.name}`}
                      onClick={() => onToggle(l.key)}
                    >
                      {l.visible ? (
                        <Eye className="size-4" />
                      ) : (
                        <EyeSlash className="size-4" />
                      )}
                    </IconAction>
                  ) : (
                    <span aria-hidden className="size-7 shrink-0" />
                  )}
                  <Swatch layer={l} />
                  <button
                    type="button"
                    disabled={!l.bounds}
                    onClick={() => l.bounds && onZoomTo(l.bounds)}
                    title={l.bounds ? `Zoom to ${l.title || l.name}` : undefined}
                    className="min-w-0 flex-1 py-1.5 text-left disabled:cursor-default"
                  >
                    <span
                      className={cn(
                        "block truncate text-read",
                        l.url && l.visible ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {l.title || l.name}
                    </span>
                    <span className="block text-label text-muted-foreground">
                      {l.url
                        ? `${countLabel(l)}${l.drawn < l.count ? ` of ${l.count.toLocaleString("en")} rows` : ""} · ${l.crs}`
                        : `Not drawn: ${l.reason}.`}
                    </span>
                    {layerLoads.get(l.key)?.state === "loading" && (
                      <span className="flex items-center gap-1 text-label text-muted-foreground">
                        <CircleNotch className="size-3 animate-spin" />
                        Drawing
                      </span>
                    )}
                    {(() => {
                      const load = layerLoads.get(l.key)
                      return load?.state === "failed" ? (
                        <span className="block text-label text-destructive-quiet">
                          Not drawn: {load.message}
                        </span>
                      ) : null
                    })()}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {opening && <Opening opening={opening} />}
    </div>
  )
}

/** What is drawn over the map: opened files' layers, and a finished run's rasters with how solid each is. */
export function LayersPanel({
  layers,
  assets,
  smoothOverlay,
  onSmoothOverlayChange,
  confidenceOnTop,
  onConfidenceOnTopChange,
  onChange,
  files,
  layerLoads,
  opening,
  onOpenGeoPackage,
  onCloseFile,
  onToggleFileLayer,
  onZoomTo,
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
  files: readonly OpenedFile[]
  layerLoads: ReadonlyMap<string, LayerLoad>
  opening: Opening | null
  onOpenGeoPackage: () => void
  onCloseFile: (id: string) => void
  onToggleFileLayer: (key: string) => void
  onZoomTo: (bounds: [number, number, number, number]) => void
  onClose: () => void
}) {
  // Top of the stack first, which is how a list of what is over the map reads.
  const rows = [...layers].sort((a, b) => b.order - a.order)
  return (
    <ShellPanel
      crumbs={[{ label: "Layers" }]}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onOpenGeoPackage}
          disabled={opening !== null}
          className={cn(btnGhost, "w-full")}
        >
          <Folder className="size-4" />
          Open a GeoPackage…
        </button>
      }
    >
      {(files.length > 0 || opening) && (
        <OpenedFiles
          files={files}
          opening={opening}
          layerLoads={layerLoads}
          onToggle={onToggleFileLayer}
          onCloseFile={onCloseFile}
          onZoomTo={onZoomTo}
        />
      )}
      {rows.length === 0 && files.length === 0 && !opening ? (
        <PanelEmpty title="Nothing drawn yet">
          A finished run adds its rasters here, and a GeoPackage opened below adds its
          layers.
        </PanelEmpty>
      ) : rows.length === 0 ? null : (
        <ul
          className={cn(
            "flex flex-col gap-3",
            files.length > 0 && "mt-5 border-t border-border pt-4"
          )}
        >
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
                    {l.visible ? (
                      <Eye className="size-4" />
                    ) : (
                      <EyeSlash className="size-4" />
                    )}
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
                  <span className="w-10 shrink-0 text-right text-label text-muted-foreground tabular-nums">
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
                    {asset.exportTif && (
                      <SaveAs label="GeoTIFF" onClick={() => void exportTif(asset)} />
                    )}
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
