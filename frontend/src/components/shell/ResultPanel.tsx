import { ClassAccuracyChart, DisagreementBar } from "@/components/studio/AgreementCharts"
import { btnGhost } from "@/components/ui/buttons"
import { PRODUCT_NOTES } from "@/lib/productNotes"
import { classifiedAreaHa, formatHectares } from "@/lib/runSummary"
import type {
  FieldsAnalysis,
  MineralAnalysis,
  PredictResult,
  WaterAnalysis,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelEmpty, PanelHeading, PanelLimit, ShellPanel } from "@/components/shell/ShellPanel"

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

/**
 * What a run produced, over the map it was measured on.
 *
 * The other products' readings are compositor cards today, and those move with
 * the compositor. Until they do, this says where they are rather than leaving a
 * finished run looking like it produced nothing.
 */
export function ResultPanel({
  result,
  water,
  mineral,
  fields,
  onOpenStudio,
  onClose,
}: {
  result: PredictResult | null
  water?: WaterAnalysis | null
  mineral?: MineralAnalysis | null
  fields?: FieldsAnalysis | null
  onOpenStudio: () => void
  onClose: () => void
}) {
  const hasClasses = !!result?.class_stats?.length
  const elsewhere = [mineral && "the mineral map", fields && "the field boundaries"].filter(
    (x): x is string => !!x
  )
  const label = hasClasses ? "Classification" : water ? "Surface water" : "No result"
  return (
    <ShellPanel crumbs={[{ label: "Result" }, { label }]} onClose={onClose}>
      {!hasClasses && !water && !elsewhere.length ? (
        <PanelEmpty title="No result yet">
          Run a product from Products, or open a saved analysis.
        </PanelEmpty>
      ) : (
        <div className="flex flex-col gap-6">
          {hasClasses && result && <ClassificationResult result={result} />}
          {water && <WaterResult water={water} />}
          {elsewhere.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-read text-muted-foreground">
                The figures of {elsewhere.join(" and ")} are still read in the classic studio.
              </p>
              <button type="button" onClick={onOpenStudio} className={cn(btnGhost, "self-start")}>
                Open the classic studio
              </button>
            </section>
          )}
        </div>
      )}
    </ShellPanel>
  )
}
