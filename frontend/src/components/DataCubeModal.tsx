import {
  CircleNotch,
  CubeTransparent,
  ImageBroken,
  X,
} from "@phosphor-icons/react"
import type { DataCubeResult } from "@/lib/types"
import { btnIcon } from "@/components/ui/buttons"

interface DataCubeModalProps {
  open: boolean
  loading: boolean
  error: string | null
  result: DataCubeResult | null
  onClose: () => void
}

export function DataCubeModal({
  open,
  loading,
  error,
  result,
  onClose,
}: DataCubeModalProps) {
  if (!open) return null

  const scenes = result?.scenes ?? []
  const range =
    result?.date_range?.length === 2
      ? `${result.date_range[0]} → ${result.date_range[1]}`
      : null

  return (
    <div
      className="app-no-drag absolute inset-0 z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Data cube"
        className="panel flex max-h-[min(42rem,88vh)] w-full max-w-3xl flex-col overflow-hidden rounded-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow !text-foreground flex items-center gap-1.5">
              <CubeTransparent className="size-3.5 text-primary" />
              Data cube
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sentinel-2 L2A scenes for this AOI (Planetary Computer)
              {result != null && (
                <>
                  {" "}
                  · {result.n_scenes} scene{result.n_scenes === 1 ? "" : "s"}
                  {range ? ` · ${range}` : ""}
                  {result.monthly_best ? " · best/month" : ""}
                  {` · cloud < ${result.max_cloud}%`}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={btnIcon}
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <CircleNotch className="size-5 animate-spin text-primary" />
              Querying STAC catalog…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-3 text-xs text-destructive-quiet">
              {error}
            </div>
          )}

          {!loading && !error && scenes.length === 0 && (
            <p className="py-12 text-center text-xs text-muted-foreground">
              No scenes match this AOI, period and cloud filter.
            </p>
          )}

          {!loading && !error && scenes.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {scenes.map((s) => (
                <li
                  key={s.id || s.date + s.tile}
                  className="overflow-hidden rounded-sm border border-border/60 bg-secondary/20"
                >
                  <div className="relative aspect-[4/3] bg-sunk">
                    {s.preview_uri ? (
                      <img
                        src={s.preview_uri}
                        alt={`Preview ${s.date}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                        <ImageBroken className="size-4 opacity-60" />
                        <span className="text-[9px]">No preview</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5 px-2 py-1.5">
                    <div className="telemetry text-[11px] text-foreground">{s.date}</div>
                    <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                      <span>{s.cloud_cover.toFixed(0)}% cloud</span>
                      {s.tile && <span>{s.tile}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
