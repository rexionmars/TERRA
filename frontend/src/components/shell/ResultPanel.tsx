import { useEffect, useState } from "react"

import { Package } from "@/components/icons"
import { ResearchPackModal } from "@/components/ResearchPackModal"
import { ClassAccuracyChart, DisagreementBar } from "@/components/workspace/AgreementCharts"
import { LibraryLimitEditor, type LibraryLimitMode } from "@/components/workspace/LibraryLimitEditor"
import { SeparabilityEditor } from "@/components/workspace/SeparabilityEditor"
import { SpectraEditor } from "@/components/workspace/SpectraEditor"
import { RunTables } from "@/components/workspace/RunTables"
import { btnGhost } from "@/components/ui/buttons"
import type { Area } from "@/lib/areas"
import { PRODUCT_NOTES } from "@/lib/productNotes"
import type { JobReading } from "@/lib/shellLayers"
import { classifiedAreaHa, formatHectares } from "@/lib/runSummary"
import type {
  FieldsAnalysis,
  MineralAnalysis,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  FieldsResult,
  HealthResult,
  MineralResult,
  OverlapResult,
  RadarResult,
  ZonesResult,
} from "@/components/shell/ProductReadings"
import {
  PanelChoices,
  PanelEmpty,
  PanelHeading,
  PanelLimit,
  ShellPanel,
} from "@/components/shell/ShellPanel"

function Figure({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="text-read tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function Figures({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-sm border border-border bg-[rgb(var(--p-control))] p-3">
      {children}
    </dl>
  )
}

/** The first and last date of a run, which is what its window says it read. */
function period(dates: readonly string[] | null | undefined): string {
  if (!dates?.length) return "n/a"
  const first = dates[0]
  const last = dates[dates.length - 1]
  return first === last ? first : `${first} to ${last}`
}

function ClassificationResult({ result }: { result: PredictResult }) {
  const stats = result.class_stats ?? []
  const agreement = result.lulc?.agreement
  return (
    <div className="flex flex-col gap-5">
      <Figures>
        <Figure label="Period read" value={period(result.date_range)} wide />
        <Figure label="Scenes" value={String(result.n_dates)} />
        <Figure label="Classified area" value={formatHectares(classifiedAreaHa(stats))} />
        <Figure
          label="Mean vote share"
          value={
            result.confidence_floor != null
              ? `${(result.mean_confidence * 100).toFixed(0)} % (floor ${(result.confidence_floor * 100).toFixed(0)} %)`
              : `${(result.mean_confidence * 100).toFixed(0)} %`
          }
        />
      </Figures>

      {stats.length > 0 && (
        <section>
          <PanelHeading>Predicted classes</PanelHeading>
          <table className="w-full text-read">
            <thead>
              <tr className="border-b border-border text-left text-label text-muted-foreground">
                <th scope="col" className="py-1.5 font-normal">Class</th>
                <th scope="col" className="py-1.5 text-right font-normal">Area (ha)</th>
                <th scope="col" className="py-1.5 text-right font-normal">Share (%)</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.class_id} className="border-b border-border/60">
                  <td className="py-1.5">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-3 shrink-0 rounded-[2px]"
                        style={{ background: s.color }}
                      />
                      <span className="truncate text-foreground">{s.name}</span>
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-foreground">
                    {s.area_ha.toFixed(1)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-foreground">
                    {s.pct.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {agreement && (
        <section className="flex flex-col gap-2.5">
          <PanelHeading>Against MapBiomas</PanelHeading>
          <DisagreementBar a={agreement} />
          <ClassAccuracyChart classes={agreement.per_class} />
          <p className="text-label text-muted-foreground">
            Concordance with an annual reference map, not field validation.
          </p>
        </section>
      )}

      <PanelLimit>{PRODUCT_NOTES.classify.limit}</PanelLimit>
    </div>
  )
}

function WaterResult({ water }: { water: WaterAnalysis }) {
  return (
    <div className="flex flex-col gap-5">
      <Figures>
        <Figure label="Index" value={water.index} />
        <Figure label="Dates read" value={String(water.n_dates)} />
        <Figure label="Period read" value={period(water.date_range)} wide />
        <Figure label="Area of interest" value={formatHectares(water.aoi_area_ha)} />
        <Figure label="Persistent water" value={formatHectares(water.persistent_area_ha)} />
        <Figure label="Ephemeral water" value={formatHectares(water.ephemeral_area_ha)} />
        <Figure label="Peak date" value={water.peak_date || "n/a"} />
        <Figure label="Peak water share" value={`${water.peak_water_fraction_pct.toFixed(1)} %`} />
      </Figures>
      <PanelLimit>{PRODUCT_NOTES.water.limit}</PanelLimit>
    </div>
  )
}

/** A product a reading can be of. */
export type ResultProduct =
  | "classify"
  | "water"
  | "mineral"
  | "fields"
  | "health"
  | "overlap"
  | "radar"
  | "zones"

const PRODUCT_LABEL: Record<ResultProduct, string> = {
  classify: "Classification",
  water: "Surface water",
  mineral: "Mineral map",
  fields: "Field boundaries",
  health: "Vegetation health",
  overlap: "Registers",
  radar: "Radar",
  zones: "Zones",
}

/**
 * What the classification is read through. The figures fit the column; the rest
 * are figures with a width of their own, so the panel widens for them.
 */
export type ClassificationView = "summary" | "spectra" | "separability" | "library" | "tables"

const VIEWS: readonly { id: ClassificationView; label: string; title: string }[] = [
  { id: "summary", label: "Summary", title: "Figures, classes and agreement" },
  { id: "spectra", label: "Spectra", title: "What each predicted class reflects, band by band" },
  { id: "separability", label: "Separability", title: "How far apart two classes are, band by band" },
  { id: "library", label: "Library", title: "Each class against a spectral library" },
  { id: "tables", label: "Tables", title: "The run's own tables, as the research pack exports them" },
]

export interface ResultPanelProps {
  result: PredictResult | null
  water?: WaterAnalysis | null
  mineral?: MineralAnalysis | null
  fields?: FieldsAnalysis | null
  job?: JobReading | null
  /** What to show first: the run that just finished, or the one just opened. */
  focus?: ResultProduct | null
  view: ClassificationView
  onViewChange: (v: ClassificationView) => void
  areas: readonly Area[]
  projectId?: string | null
  /** The name the run is listed under. */
  runLabel: string
  /** For the research pack's manifest. */
  modelKind?: string
  polygonGeoJSON?: string
  onAdoptFields?: (runId: string, minHa: number, minCropland: number, replace: boolean) => Promise<boolean>
  onPickZones: (k: number) => void
  onRemove: (product: ResultProduct) => void
  onClose: () => void
}

/** What a run produced, over the map it was measured on. */
export function ResultPanel({
  result,
  water,
  mineral,
  fields,
  job,
  focus,
  view,
  onViewChange,
  areas,
  projectId,
  runLabel,
  modelKind,
  polygonGeoJSON,
  onAdoptFields,
  onPickZones,
  onRemove,
  onClose,
}: ResultPanelProps) {
  // Go marshals a nil slice as null, and a run with nothing to read leaves these nil.
  const hasClassification = !!(result?.class_stats?.length || result?.lulc || result?.overlay_uri)
  const present: ResultProduct[] = [
    ...(job?.health ? (["health"] as const) : []),
    ...(job?.overlap ? (["overlap"] as const) : []),
    ...(job?.radar ? (["radar"] as const) : []),
    ...(job?.zones ? (["zones"] as const) : []),
    ...(fields ? (["fields"] as const) : []),
    ...(mineral ? (["mineral"] as const) : []),
    ...(water ? (["water"] as const) : []),
    ...(hasClassification ? (["classify"] as const) : []),
  ]
  const [chosen, setChosen] = useState<ResultProduct | null>(null)
  // A new run says what to look at, over whatever was being read before it.
  useEffect(() => setChosen(null), [focus, job?.runId])
  const pick = (want: ResultProduct | null | undefined) =>
    want && present.includes(want) ? want : null
  const product = pick(chosen) ?? pick(focus) ?? present[0] ?? null

  const [surface, setSurface] = useState<HTMLElement | null>(null)
  const [libraryMode, setLibraryMode] = useState<LibraryLimitMode>("distance")
  const [packOpen, setPackOpen] = useState(false)
  const label = product ? PRODUCT_LABEL[product] : "No result"
  const figure = product === "classify" && view !== "summary"
  const runs = result ? [{ id: result.run_id ?? "current", label: runLabel, result }] : []

  const choices = present.length > 1 && (
    <PanelChoices
      label="Result"
      value={product ?? present[0]}
      options={present.map((p) => ({ id: p, label: PRODUCT_LABEL[p] }))}
      onChange={setChosen}
    />
  )
  const views = product === "classify" && result && (
    <PanelChoices label="Reading" value={view} options={VIEWS} onChange={onViewChange} />
  )
  const remove = product && (
    <button
      type="button"
      onClick={() => onRemove(product)}
      className={cn(btnGhost, "self-start")}
      title="Takes this result off the map. A saved run stays saved."
    >
      Take off the map
    </button>
  )

  return (
    <ShellPanel
      crumbs={[{ label: "Result" }, { label }]}
      onClose={onClose}
      wide={figure}
      bare={figure}
      panelRef={setSurface}
    >
      {!product ? (
        <PanelEmpty title="No result yet">
          Run a product from Products, or open a saved analysis.
        </PanelEmpty>
      ) : figure ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 py-2">
            {choices}
            {views}
            {view === "library" && (
              <PanelChoices
                label="Library reading"
                value={libraryMode}
                options={[
                  { id: "distance", label: "Distance" },
                  { id: "mechanism", label: "Mechanism" },
                ]}
                onChange={setLibraryMode}
              />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {view === "spectra" && <SpectraEditor runs={runs} />}
            {view === "separability" && <SeparabilityEditor runs={runs} />}
            {view === "library" && (
              <LibraryLimitEditor runs={runs} mode={libraryMode} surface={surface} />
            )}
            {view === "tables" && <RunTables runs={runs} />}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {choices}
          {views}
          {product === "classify" && result && <ClassificationResult result={result} />}
          {product === "classify" && result && (
            <button
              type="button"
              onClick={() => setPackOpen(true)}
              className={cn(btnGhost, "self-start")}
              title="The run's tables and figures with their provenance, for a paper or a review"
            >
              <Package className="size-3.5" />
              Research pack
            </button>
          )}
          {product === "water" && water && <WaterResult water={water} />}
          {product === "mineral" && mineral && <MineralResult mineral={mineral} />}
          {product === "fields" && fields && (
            <FieldsResult fields={fields} areas={areas} projectId={projectId} onAdopt={onAdoptFields} />
          )}
          {product === "health" && job?.health && <HealthResult report={job.health} />}
          {product === "overlap" && job?.overlap && <OverlapResult report={job.overlap} />}
          {product === "radar" && job?.radar && <RadarResult report={job.radar} />}
          {product === "zones" && job?.zones && (
            <ZonesResult report={job.zones} name={job.label} onPick={onPickZones} />
          )}
          {remove}
        </div>
      )}
      {packOpen && result && (
        <ResearchPackModal
          result={result}
          modelKind={modelKind ?? ""}
          areaLabel={runLabel}
          polygonGeoJSON={polygonGeoJSON}
          onClose={() => setPackOpen(false)}
        />
      )}
    </ShellPanel>
  )
}
