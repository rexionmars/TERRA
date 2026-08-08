/**
 * The area of interest, defined from the energy screen itself.
 *
 * The screen carries its own copy of the controls rather than deferring to the
 * classification panel: the products here need an AOI and nothing else, so
 * sending the user to another screen to draw one would make a classification
 * panel a precondition of a run that consults no satellite scene.
 *
 * The note is passed in because the grid the AOI is resolved on differs between
 * the tabs: 1 degree for radiation, 0.5 by 0.625 degrees for the reanalysis the
 * wind screening reads.
 */
import { useState } from "react"
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react"
import type { Area } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelSection } from "@/components/ui/PanelSection"

export function AoiSection({
  note,
  areas,
  activeExample,
  onSelectExample,
  hasArea,
  hasCustomPolygon,
  onImportPolygon,
  onClearArea,
  busy,
}: {
  note: string
  areas: Area[]
  activeExample: string
  onSelectExample: (id: string) => void
  hasArea: boolean
  hasCustomPolygon: boolean
  onImportPolygon: () => void
  onClearArea: () => void
  /** A run is in flight; editing the AOI under it would discard the result. */
  busy: boolean
}) {
  const [showExamples, setShowExamples] = useState(false)

  return (
    <PanelSection title="Area">
      <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onImportPolygon}
          disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
        >
          <Upload className="size-3.5" />
          Import
        </button>
        <button
          type="button"
          onClick={onClearArea}
          disabled={busy || !hasArea}
          className="flex items-center justify-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          Clear
        </button>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs",
          hasArea
            ? "border-primary/40 text-foreground"
            : "border-dashed border-border text-muted-foreground"
        )}
      >
        {hasArea ? (
          <CheckCircle2 className="size-3.5 text-primary" />
        ) : (
          <Pencil className="size-3.5" />
        )}
        {hasArea
          ? hasCustomPolygon
            ? "Area defined"
            : activeExample
              ? `Example ${activeExample} loaded`
              : "Area defined"
          : "No area defined. Draw one on the map, import a file, or load an example."}
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setShowExamples((s) => !s)}
          className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Layers className="size-3" />
          Reference examples
          {showExamples ? (
            <ChevronLeft className="size-3 rotate-90" />
          ) : (
            <ChevronRight className="size-3 rotate-90" />
          )}
        </button>
        {showExamples && (
          <div className="grid grid-cols-3 gap-1.5">
            {areas.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => onSelectExample(a.id)}
                title={a.label}
                className={cn(
                  "rounded-sm border px-2 py-1 text-xs disabled:opacity-50",
                  activeExample === a.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-secondary"
                )}
              >
                {a.id}
              </button>
            ))}
          </div>
        )}
      </div>
    </PanelSection>
  )
}
