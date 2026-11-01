import { useEffect, useMemo, useState } from "react"

import { Copy, X } from "@/components/icons"
import { ConfusionMatrix } from "@/components/workspace/AgreementCharts"
import {
  PredictionComparison,
  type PredictionCompareSide,
} from "@/components/workspace/PredictionComparison"
import { DomainShiftEditor } from "@/components/workspace/DomainShiftEditor"
import {
  LibraryLimitEditor,
  type LibraryLimitMode,
} from "@/components/workspace/LibraryLimitEditor"
import { RunPicker } from "@/components/workspace/RunPicker"
import { SeparabilityEditor } from "@/components/workspace/SeparabilityEditor"
import { SpectraEditor } from "@/components/workspace/SpectraEditor"
import { RunTables } from "@/components/workspace/RunTables"
import { btnGhost } from "@/components/ui/buttons"
import { tableToCSV } from "@/lib/analysisTables"
import { useAuth } from "@/lib/auth"
import type { SessionRun } from "@/lib/sessionRuns"
import { compareClassMaps, type ClassMapCompare } from "@/lib/boardProbe"
import {
  comparePair,
  comparePairTables,
  formatGroundWidth,
  gridColumns,
  groundWidthM,
  pinSlot,
  type ComparePins,
} from "@/lib/compareGrid"
import { predictionSource } from "@/lib/mapLayers"
import { notifyError, notifySuccess } from "@/lib/notify"
import { loadedRunAssets, type RunAsset } from "@/lib/runAssets"
import type { InferenceRun } from "@/lib/types"
import { cn } from "@/lib/utils"
import { PanelChoices } from "@/components/shell/ShellPanel"

type CompareTab =
  "differences" | "shift" | "cohort" | "spectra" | "separability" | "library" | "tables"

const TABS: readonly { id: CompareTab; label: string; title: string }[] = [
  {
    id: "differences",
    label: "Differences",
    title: "Agreement, transitions and class shares between A and B",
  },
  {
    id: "shift",
    label: "Domain shift",
    title: "How far apart the two runs sit, as the model saw them",
  },
  { id: "cohort", label: "Cohort", title: "Every run measured from one source" },
  { id: "spectra", label: "Spectra", title: "What each class reflects, in both runs" },
  {
    id: "separability",
    label: "Separability",
    title: "How far apart classes are, and where that changes",
  },
  { id: "library", label: "Library", title: "Each class against a spectral library" },
  { id: "tables", label: "Tables", title: "The runs' own tables" },
]

/** Every raster the run can show, of whichever product it is. */
const assetsOf = (run: SessionRun): RunAsset[] =>
  loadedRunAssets(run.result).filter((a) => a.extent && a.previewUri)

function Tile({
  run,
  slot,
  canCompare,
  onSlot,
  onRemove,
}: {
  run: SessionRun
  slot: "A" | "B" | null
  canCompare: boolean
  onSlot: (slot: "a" | "b") => void
  onRemove?: () => void
}) {
  const assets = useMemo(() => assetsOf(run), [run])
  const [assetId, setAssetId] = useState<string | null>(null)
  const asset = assets.find((a) => a.id === assetId) ?? assets[0]
  return (
    <figure
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-[rgb(var(--p-surface))]",
        slot ? "border-[rgb(var(--p-line-strong))]" : "border-border"
      )}
    >
      <figcaption className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-read text-foreground"
          title={run.label}
        >
          {run.label}
        </span>
        {canCompare &&
          (["a", "b"] as const).map((s) => {
            const on = slot === s.toUpperCase()
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                aria-label={`Compare ${run.label} as ${s.toUpperCase()}`}
                onClick={() => onSlot(s)}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-sm text-label font-semibold transition-colors",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground"
                )}
              >
                {s.toUpperCase()}
              </button>
            )
          })}
        {onRemove && (
          <button
            type="button"
            aria-label={`Take ${run.label} off the grid`}
            title="Take off the grid. A saved run stays saved."
            onClick={onRemove}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </figcaption>
      <div className="relative min-h-0 flex-1 bg-[rgb(var(--p-sunk))]">
        {asset ? (
          <img
            src={asset.previewUri}
            alt={`${asset.title} of ${run.label}`}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ imageRendering: asset.pixelated ? "pixelated" : undefined }}
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center px-3 text-center text-label text-muted-foreground">
            This run keeps no raster to show.
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1 border-t border-border px-2 py-1.5">
        {assets.length > 1 && (
          <select
            aria-label={`Raster of ${run.label}`}
            className="field-input"
            value={asset?.id ?? ""}
            onChange={(e) => setAssetId(e.target.value)}
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        )}
        <p
          className="truncate text-label text-muted-foreground tabular-nums"
          title={[run.period, run.model].filter(Boolean).join(" · ")}
        >
          {asset?.extent && `${formatGroundWidth(groundWidthM(asset.extent))} across`}
          {run.period && ` · ${run.period}`}
          {run.model && ` · ${run.model}`}
        </p>
      </div>
    </figure>
  )
}

/**
 * Runs set beside each other, wherever they are on the ground.
 *
 * A FIXED GRID, NOT THE BOARD IT REPLACES. What the board's viewport did for this
 * was lift rasters off their coordinates, and what it cost was a 3D scene, a camera
 * and a splittable tree to read two pictures. A grid keeps the only part of that
 * the comparison uses, and each tile says how much ground it spans, since it is
 * drawn to its own scale.
 */
export function CompareScreen({
  runs: gridRuns,
  loading,
  onAddRun,
  onDropRun,
  hidden,
}: {
  /** The runs in hand; see lib/sessionRuns. */
  runs: readonly SessionRun[]
  loading: boolean
  onAddRun: (run: InferenceRun) => void
  onDropRun: (run: SessionRun) => void
  hidden: boolean
}) {
  const { runs: savedRuns, projects } = useAuth()
  const [surface, setSurface] = useState<HTMLElement | null>(null)
  const [pins, setPins] = useState<ComparePins>({})
  const [tab, setTab] = useState<CompareTab>("differences")
  const [libraryMode, setLibraryMode] = useState<LibraryLimitMode>("distance")
  const [source, setSource] = useState<string | undefined>()

  /* What can stand in a slot: a class map with a legend to compare it by. */
  const sides = useMemo<PredictionCompareSide[]>(
    () =>
      gridRuns.flatMap((r) => {
        const src = predictionSource(r.result)
        return src && r.result.class_stats?.length
          ? [
              {
                areaId: r.id,
                label: r.label,
                model: r.model,
                period: r.period,
                result: r.result,
                uri: src.uri,
                pixelated: true,
              },
            ]
          : []
      }),
    [gridRuns]
  )
  const pair = comparePair(
    sides.map((s) => s.areaId),
    pins
  )
  const sideA = sides.find((s) => s.areaId === pair?.[0])
  const sideB = sides.find((s) => s.areaId === pair?.[1])
  const compared: [PredictionCompareSide, PredictionCompareSide] | null =
    sideA && sideB ? [sideA, sideB] : null

  const [mapCompare, setMapCompare] = useState<{
    key: string
    compare: ClassMapCompare | null
    error: string | null
  } | null>(null)
  const pairKey = compared
    ? `${compared[0].uri.length}:${compared[0].areaId}|${compared[1].uri.length}:${compared[1].areaId}`
    : ""
  useEffect(() => {
    if (!compared) return
    let live = true
    const legend = (s: PredictionCompareSide) =>
      (s.result.class_stats ?? []).map((c) => ({
        id: c.class_id,
        name: c.name,
        color: c.color,
      }))
    compareClassMaps(
      compared[0].uri,
      legend(compared[0]),
      compared[1].uri,
      legend(compared[1])
    )
      .then((compare) => live && setMapCompare({ key: pairKey, compare, error: null }))
      .catch(
        (e: unknown) =>
          live &&
          setMapCompare({
            key: pairKey,
            compare: null,
            error: e instanceof Error ? e.message : "Could not compare these rasters.",
          })
      )
    return () => {
      live = false
    }
    // The key stands for the pair; the array is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey])
  const pairCompare = mapCompare?.key === pairKey ? mapCompare : null

  const readRuns = compared
    ? compared.map((s) => ({ id: s.areaId, label: s.label, result: s.result }))
    : sides.map((s) => ({ id: s.areaId, label: s.label, result: s.result }))
  const sole = !compared && sides.length === 1 ? sides[0] : null

  const copyDeltas = async () => {
    if (!compared) return
    const tables = comparePairTables(compared[0], compared[1])
    const text = tables.map((t) => `# ${t.csvName}\n${tableToCSV(t)}`).join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      notifySuccess(
        `${tables.length} tables copied`,
        tables.map((t) => t.csvName).join(", ")
      )
    } catch (e) {
      notifyError("Could not copy the deltas", e)
    }
  }

  const n = gridRuns.length
  const empty = (msg: string) => (
    <p className="flex h-full items-center justify-center px-6 text-center text-read text-muted-foreground">
      {msg}
    </p>
  )

  return (
    <div
      ref={setSurface}
      hidden={hidden}
      className={cn(
        "app-no-drag absolute inset-0 z-[480] flex-col bg-app",
        hidden ? "hidden" : "flex"
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="text-title font-medium text-foreground">Compare</h1>
        <span className="text-label text-muted-foreground">
          {n === 0
            ? "No runs on the grid"
            : `${n} ${n === 1 ? "run" : "runs"}, each to its own scale`}
        </span>
        <div className="ml-auto">
          <RunPicker
            runs={savedRuns}
            projects={projects}
            excludeRunIds={new Set(gridRuns.map((r) => r.id))}
            busy={loading}
            surface={surface}
            onPick={onAddRun}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {n === 0 ? (
            empty(
              "Add a saved run to set it beside another. Runs of any area and any product can stand here."
            )
          ) : (
            <div
              className="grid h-full min-h-[24rem] gap-3"
              style={{
                gridTemplateColumns: `repeat(${gridColumns(n)}, minmax(0, 1fr))`,
                gridAutoRows: "minmax(16rem, 1fr)",
              }}
            >
              {gridRuns.map((r) => (
                <Tile
                  key={r.id}
                  run={r}
                  canCompare={sides.some((x) => x.areaId === r.id)}
                  slot={pair?.[0] === r.id ? "A" : pair?.[1] === r.id ? "B" : null}
                  onSlot={(slot) => setPins(pinSlot(pair, slot, r.id))}
                  // The run on the map is on the grid for as long as it is on the map.
                  onRemove={r.live ? undefined : () => onDropRun(r)}
                />
              ))}
            </div>
          )}
        </div>

        <aside
          aria-label="Reading of the runs compared"
          className="flex w-[34rem] shrink-0 flex-col border-l border-border bg-[rgb(var(--p-surface))]"
        >
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
            <PanelChoices
              label="Reading"
              value={tab}
              options={TABS}
              onChange={setTab}
            />
            {compared && (
              <div className="flex items-center gap-2 text-label text-muted-foreground">
                <span className="min-w-0 truncate">
                  <strong className="font-semibold text-foreground">A</strong>{" "}
                  {compared[0].label}{" "}
                  <strong className="font-semibold text-foreground">B</strong>{" "}
                  {compared[1].label}
                </span>
                {tab === "differences" && (
                  <button
                    type="button"
                    onClick={() => void copyDeltas()}
                    className={cn(btnGhost, "ml-auto shrink-0")}
                  >
                    <Copy className="size-3.5" />
                    Copy deltas
                  </button>
                )}
              </div>
            )}
            {tab === "library" && (
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
            {tab === "cohort" && (
              <label className="flex items-center gap-2 text-label text-muted-foreground">
                Measured from
                <select
                  className="field-input min-w-0 flex-1"
                  value={source ?? ""}
                  onChange={(e) => setSource(e.target.value || undefined)}
                >
                  <option value="">Choose the source run</option>
                  {sides.map((s) => (
                    <option key={s.areaId} value={s.areaId}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "differences" &&
              (compared ? (
                <PredictionComparison
                  sides={compared}
                  compare={pairCompare?.compare ?? null}
                  compareError={pairCompare?.error ?? null}
                />
              ) : sole?.result.lulc?.agreement ? (
                <div className="panel-scroll h-full overflow-auto p-3">
                  <ConfusionMatrix a={sole.result.lulc.agreement} title={sole.label} />
                  <p className="mt-3 text-label text-muted-foreground">
                    Add a second classification to read this against another run.
                  </p>
                </div>
              ) : (
                empty(
                  "Two classifications on the grid are compared here. Mark which with A and B on their tiles."
                )
              ))}
            {tab === "shift" &&
              (compared ? (
                <DomainShiftEditor mode="pair" sides={compared} available={sides} />
              ) : (
                empty("Needs two classifications on the grid.")
              ))}
            {tab === "cohort" &&
              (sides.length >= 2 ? (
                <DomainShiftEditor
                  mode="cohort"
                  sides={compared}
                  available={sides}
                  sourceId={source}
                  onPickTarget={(id) => setPins(pinSlot(pair, "b", id))}
                />
              ) : (
                empty(
                  "Needs a source and at least one other classification on the grid."
                )
              ))}
            {tab === "spectra" &&
              (readRuns.length ? (
                <SpectraEditor runs={readRuns} />
              ) : (
                empty("Needs a classification on the grid.")
              ))}
            {tab === "separability" &&
              (readRuns.length ? (
                <SeparabilityEditor runs={readRuns} />
              ) : (
                empty("Needs a classification on the grid.")
              ))}
            {tab === "library" &&
              (readRuns.length ? (
                <LibraryLimitEditor
                  runs={readRuns}
                  mode={libraryMode}
                  surface={surface}
                />
              ) : (
                empty("Needs a classification on the grid.")
              ))}
            {tab === "tables" &&
              (readRuns.length ? (
                <RunTables runs={readRuns} />
              ) : (
                empty("Needs a classification on the grid.")
              ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
