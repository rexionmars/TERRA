import { useState } from "react"

import { CaretDown, FloppyDisk, Graph, Plus } from "@/components/icons"
import {
  CompositorEditor,
  type CompositorGlobeOverlay,
} from "@/components/workspace/CompositorEditor"
import { RunPicker } from "@/components/workspace/RunPicker"
import { AreaHeaderMenusHost } from "@/components/workspace/areaHeader"
import {
  OperatorMenuItem,
  MenuItem,
  MenuRule,
  MenuPopover,
} from "@/components/workspace/MenuPopover"
import { btnGhost } from "@/components/ui/buttons"
import { useAuth } from "@/lib/auth"
import type { CompositorGraph } from "@/lib/compositorGraph"
import type { FieldSet } from "@/lib/fieldSets"
import type { FieldsTarget } from "@/lib/fields"
import type { PdfReportRun } from "@/lib/pdfReport"
import { loadedRunAssets, type AssetRun, type RunAsset } from "@/lib/runAssets"
import type { SessionRun } from "@/lib/sessionRuns"
import type { Studio } from "@/lib/studios"
import type {
  FieldsAnalysis,
  InferenceRun,
  MineralAnalysis,
  PredictResult,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The compositor, with the whole window to work in.
 *
 * It was one editor among many and read everything through the board around it:
 * which runs exist, where its menus go, what its Globe nodes draw on. What stands
 * here is the rest of that, taken from the session's runs, with the board gone.
 * The work it holds is saved by name, and the name is how it comes back.
 */
export function WorkflowsScreen({
  hidden,
  runs,
  liveAssets,
  loading,
  onAddRun,
  graph,
  onChange,
  onGlobe,
  fieldSets,
  fieldsTargetOf,
  onAdoptFields,
  onNeedRuns,
  runRecordOf,
  saved,
  savedName,
  studios,
  dirty,
  naming,
  onNamingChange,
  onConfirmName,
  onOpenStudio,
}: {
  hidden: boolean
  runs: readonly SessionRun[]
  /** The run on the map's rasters, with what the session has switched on them. */
  liveAssets: readonly RunAsset[]
  loading: boolean
  onAddRun: (run: InferenceRun) => void
  graph: CompositorGraph | null
  onChange: (next: CompositorGraph) => void
  onGlobe: (overlays: CompositorGlobeOverlay[]) => void
  fieldSets: readonly FieldSet[]
  fieldsTargetOf: (runId: string) => FieldsTarget | null
  onAdoptFields?: (
    runId: string,
    minHa: number,
    minCropland: number,
    replace: boolean
  ) => Promise<boolean>
  onNeedRuns: (ids: string[]) => void
  runRecordOf: (runId: string) => PdfReportRun | null
  saved: boolean
  savedName: string | null
  studios: readonly Studio[]
  dirty: boolean
  /** The name being asked for, or null while none is. */
  naming: string | null
  onNamingChange: (name: string | null) => void
  onConfirmName: (name: string) => void
  onOpenStudio: (board: Studio) => void
}) {
  const { runs: savedRuns, projects } = useAuth()
  const [surface, setSurface] = useState<HTMLElement | null>(null)
  const [menusHost, setMenusHost] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState(false)

  const assetRuns: AssetRun[] = runs.map((r) => ({
    areaId: r.id,
    runId: r.id,
    title: r.label,
    period: r.period ?? "",
    model: r.model ?? undefined,
    deletable: false,
    assets: r.live ? [...liveAssets] : loadedRunAssets(r.result),
  }))
  const resultOf = (id: string): PredictResult | null =>
    runs.find((r) => r.id === id)?.result ?? null
  const mineralOf = (id: string): MineralAnalysis | null =>
    resultOf(id)?.mineral ?? null
  const fieldsOf = (id: string): FieldsAnalysis | null => resultOf(id)?.fields ?? null

  return (
    <div
      ref={setSurface}
      hidden={hidden}
      className={cn(
        "app-no-drag absolute inset-0 z-[480] flex-col bg-app",
        hidden ? "hidden" : "flex"
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Graph aria-hidden className="size-4 text-muted-foreground" />
        <MenuPopover
          open={menu}
          onOpenChange={setMenu}
          surface={surface}
          widthRem={18}
          trigger={(p) => (
            <button
              ref={p.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              aria-haspopup="menu"
              className="flex h-8 max-w-[20rem] items-center gap-1.5 rounded-sm px-2 text-title font-medium text-foreground transition-colors hover:bg-hover"
            >
              <span className="truncate">{savedName ?? "Unsaved workflow"}</span>
              {dirty && (
                <span
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                />
              )}
              <CaretDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          )}
        >
          <OperatorMenuItem id="WORKFLOW_NEW" onDone={() => setMenu(false)} />
          <OperatorMenuItem id="WORKFLOW_RENAME" onDone={() => setMenu(false)} />
          <OperatorMenuItem id="WORKFLOW_MANAGE" onDone={() => setMenu(false)} />
          {studios.length > 0 && <MenuRule />}
          {studios.map((b) => (
            <MenuItem
              key={b.id}
              label={b.name}
              checked={b.name === savedName}
              note={`${b.member_count ?? 0} ${b.member_count === 1 ? "run" : "runs"}`}
              onSelect={() => {
                setMenu(false)
                onOpenStudio(b)
              }}
            />
          ))}
        </MenuPopover>

        {/* View, Add and Node, which the compositor writes here from its own state. */}
        <div ref={setMenusHost} className="flex items-center gap-0.5" />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-label text-muted-foreground">
            {runs.length} {runs.length === 1 ? "run" : "runs"} in hand
          </span>
          <RunPicker
            runs={savedRuns}
            projects={projects}
            excludeRunIds={new Set(runs.map((r) => r.id))}
            busy={loading}
            surface={surface}
            onPick={onAddRun}
          />
          {naming !== null ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                onConfirmName(naming)
              }}
            >
              <input
                autoFocus
                aria-label="Name of the workflow"
                placeholder="Name of the workflow"
                className="field-input w-56"
                value={naming}
                onChange={(e) => onNamingChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onNamingChange(null)
                }}
              />
              <button type="submit" disabled={!naming.trim()} className={btnGhost}>
                <Plus className="size-3.5" />
                Save
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() =>
                saved && savedName ? onConfirmName(savedName) : onNamingChange("")
              }
              className={btnGhost}
            >
              <FloppyDisk className="size-3.5" />
              Save
            </button>
          )}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <AreaHeaderMenusHost.Provider value={menusHost}>
          <CompositorEditor
            runs={assetRuns}
            graph={graph}
            onChange={onChange}
            onGlobe={onGlobe}
            surface={surface}
            fieldsOf={fieldsOf}
            fieldsTargetOf={fieldsTargetOf}
            onAdoptFields={onAdoptFields}
            mineralOf={mineralOf}
            fieldSets={fieldSets}
            onNeedRuns={onNeedRuns}
            resultOf={resultOf}
            runRecordOf={runRecordOf}
          />
        </AreaHeaderMenusHost.Provider>
      </div>
    </div>
  )
}
