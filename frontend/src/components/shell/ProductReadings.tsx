/**
 * The figures of the products the classification panel does not hold.
 *
 * NOTHING IS RECOMPUTED OR REDRAWN HERE. Each reading is the compositor card of
 * the same subject, laid out in one column, so a figure read here and on a card
 * is one figure. What is added is what the card leaves to its graph: choosing
 * which part to open, and the actions a node would have supplied.
 */
import { useEffect, useMemo, useState } from "react"

import { DownloadSimple, Polygon } from "@/components/icons"
import { HealthReading } from "@/components/workspace/fieldNodes"
import * as Mineral from "@/components/workspace/mineralNodes"
import { Figure, Note } from "@/components/workspace/nodeParts"
import { OverlapReading } from "@/components/workspace/overlapNodes"
import { RadarReading } from "@/components/workspace/radarNodes"
import { ZonesReading } from "@/components/workspace/zonesNodes"
import { btnGhost } from "@/components/ui/buttons"
import type { Area } from "@/lib/areas"
import { filterFields, type FieldsValue } from "@/lib/compositorEval"
import { parseFields, sceneDate } from "@/lib/fields"
import type { MineralBand, MineralGroupId } from "@/lib/compositorGraph"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import { PRODUCT_NOTES } from "@/lib/productNotes"
import { formatHectares } from "@/lib/runSummary"
import type {
  FieldsAnalysis,
  HealthAnalysis,
  MineralAnalysis,
  OverlapAnalysis,
  RadarAnalysis,
  ZonesAnalysis,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { chosenPartition, zonesGeoJSON } from "@/lib/zones"
import { ExportOverlayFile, ListProjectRuns } from "../../../wailsjs/go/main/App"
import { PanelChoices, PanelLimit, PanelSection } from "@/components/shell/ShellPanel"

/** Base64 of the UTF-8 bytes: btoa alone refuses anything outside Latin-1. */
async function saveGeoJSON(text: string, filename: string) {
  let bin = ""
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  try {
    const dest = await ExportOverlayFile(
      `data:application/geo+json;base64,${btoa(bin)}`,
      filename
    )
    if (dest) notifyExportOk(dest)
  } catch (e) {
    notifyExportFail(e)
  }
}

export function MineralResult({ mineral: m }: { mineral: MineralAnalysis }) {
  const [group, setGroup] = useState<MineralGroupId>(1)
  const [band, setBand] = useState<MineralBand>("fe3")
  const pick = <Mineral.GroupPick value={group} onPick={setGroup} />
  return (
    <div className="flex flex-col gap-3">
      <div>
        <PanelSection title="Coverage" open>
          <Mineral.Coverage m={m} />
        </PanelSection>
        <PanelSection title="Classes" open>
          {pick}
          <Mineral.Classes m={m} group={group} />
        </PanelSection>
        <PanelSection title="References">
          {pick}
          <Mineral.References m={m} group={group} />
        </PanelSection>
        <PanelSection title="Passes">
          <Mineral.Passes m={m} />
        </PanelSection>
        <PanelSection title="Fractional cover">
          <Mineral.Cover m={m} />
        </PanelSection>
        <PanelSection title="Band positions">
          <PanelChoices
            label="Absorption band"
            value={band}
            options={[
              { id: "fe3", label: "Fe3+" },
              { id: "aloh", label: "Al-OH" },
            ]}
            onChange={setBand}
          />
          <Mineral.Positions m={m} band={band} />
        </PanelSection>
        <PanelSection title="Acid-sulfate minerals">
          <Mineral.Acid m={m} />
        </PanelSection>
        <PanelSection title="Confidence">
          <Mineral.Confidence m={m} />
        </PanelSection>
        <PanelSection title="Against EMIT L2B">
          {pick}
          <Mineral.Agreement m={m} group={group} />
        </PanelSection>
        <PanelSection title="Save">
          <Mineral.Save m={m} />
        </PanelSection>
      </div>
      <PanelLimit>{PRODUCT_NOTES.mineral.limit}</PanelLimit>
    </div>
  )
}

/** The saved area a delineation was run over, which is where its fields go. */
function useFieldsTarget(
  fields: FieldsAnalysis,
  areas: readonly Area[],
  projectId?: string | null
) {
  const [areaId, setAreaId] = useState<string | null>(null)
  useEffect(() => {
    if (!fields.run_id || !projectId) {
      setAreaId(null)
      return
    }
    let live = true
    ListProjectRuns(projectId, 1000)
      .then((runs) => {
        if (live) setAreaId(runs.find((r) => r.id === fields.run_id)?.area_id ?? null)
      })
      .catch(() => {
        if (live) setAreaId(null)
      })
    return () => {
      live = false
    }
  }, [fields.run_id, projectId])
  const area = areas.find((a) => a.id === areaId && !a.parent_id)
  if (!area) return null
  const adopted = areas.filter((a) => a.parent_id === area.id && a.source_run_id)
  return {
    name: area.name,
    adopted: adopted.length,
    adoptedWithRuns: adopted.filter((a) => a.run_count > 0).length,
  }
}

export function FieldsResult({
  fields: f,
  areas,
  projectId,
  onAdopt,
}: {
  fields: FieldsAnalysis
  areas: readonly Area[]
  projectId?: string | null
  onAdopt?: (
    runId: string,
    minHa: number,
    minCropland: number,
    replace: boolean
  ) => Promise<boolean>
}) {
  const [minHa, setMinHa] = useState(0)
  const [minCropland, setMinCropland] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const target = useFieldsTarget(f, areas, projectId)

  const all = useMemo(() => parseFields(f), [f])
  const value: FieldsValue = {
    type: "fields",
    key: f.run_id ?? "fields",
    runId: f.run_id ?? "",
    fields: all,
    total: all.length,
    minHa: 0,
    minCropland: 0,
  }
  const kept = filterFields(value, minHa, minCropland).fields

  const adopt = async (replace: boolean) => {
    if (!f.run_id || !onAdopt) return
    setBusy(true)
    const done = await onAdopt(f.run_id, minHa, minCropland, replace)
    setBusy(false)
    setConfirming(!done && replace)
  }
  const stats = f.field_area_ha
  const hasShares = all.some((x) => typeof x.properties.cropland_share === "number")

  return (
    <div className="flex flex-col gap-3">
      <div>
        <PanelSection title="Fields" open>
          <Figure label="Fields drawn" value={String(f.n_fields)} />
          <Figure label="Area of interest" value={formatHectares(f.area_ha)} />
          {stats && (
            <>
              <Figure label="In fields" value={formatHectares(stats.total)} />
              <Figure
                label="Median field"
                value={`${stats.median.toFixed(1)} ha (${stats.p10.toFixed(1)} to ${stats.p90.toFixed(1)})`}
              />
            </>
          )}
          <Figure
            label="Not seen clearly"
            value={`${(f.masked_fraction * 100).toFixed(1)} %`}
          />
        </PanelSection>
        <PanelSection title="Scenes read">
          <Figure
            label="Window A"
            value={`${sceneDate(f.window_a.date)} · ${Math.round(f.window_a.cloud_cover)} % cloud`}
          />
          <Figure
            label="Window B"
            value={`${sceneDate(f.window_b.date)} · ${Math.round(f.window_b.cloud_cover)} % cloud`}
          />
          <Figure label="Model" value={f.checkpoint.title} />
          <Note>Licence of the checkpoint: {f.checkpoint.license}.</Note>
        </PanelSection>
        <PanelSection title="Make them areas" open>
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label text-muted-foreground">At least (ha)</span>
              <input
                type="number"
                min={0}
                max={1000}
                step={0.5}
                className="field-input"
                value={minHa}
                onChange={(e) => setMinHa(Math.max(0, e.target.valueAsNumber || 0))}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-label text-muted-foreground">
                Cropland at least (%)
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                disabled={!hasShares}
                title={
                  hasShares
                    ? undefined
                    : "This delineation read no MapBiomas cropland share."
                }
                className="field-input"
                value={Math.round(minCropland * 100)}
                onChange={(e) =>
                  setMinCropland(
                    Math.min(1, Math.max(0, (e.target.valueAsNumber || 0) / 100))
                  )
                }
              />
            </label>
          </div>
          <Figure label="Kept" value={`${kept.length} of ${all.length}`} />
          {!target || !onAdopt ? (
            <Note>Only a saved delineation over a saved area can make its fields.</Note>
          ) : confirming ? (
            <>
              <Note>
                {`${target.name} holds ${target.adopted} fields from an earlier delineation`}
                {target.adoptedWithRuns
                  ? `, ${target.adoptedWithRuns} with runs of their own`
                  : ""}
                . Replacing removes them; fields drawn by hand stay.
              </Note>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adopt(true)}
                  className={btnGhost}
                >
                  Replace them
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={btnGhost}
                >
                  Keep them
                </button>
              </div>
            </>
          ) : (
            <>
              <Figure label="Into" value={target.name} />
              <button
                type="button"
                disabled={busy || !kept.length}
                onClick={() =>
                  target.adopted > 0 ? setConfirming(true) : void adopt(false)
                }
                className={cn(btnGhost, "self-start")}
              >
                <Polygon className="size-3.5" />
                Make {kept.length} fields
              </button>
            </>
          )}
          <button
            type="button"
            disabled={!kept.length}
            onClick={() =>
              void saveGeoJSON(
                JSON.stringify({
                  type: "FeatureCollection",
                  features: kept.map((x) => ({
                    type: "Feature",
                    properties: x.properties,
                    geometry: x.geometry,
                  })),
                }),
                "terra_fields.geojson"
              )
            }
            className={cn(btnGhost, "self-start")}
          >
            <DownloadSimple className="size-3.5" />
            GeoJSON, {kept.length} fields
          </button>
        </PanelSection>
      </div>
      <PanelLimit>{PRODUCT_NOTES.fields.limit}</PanelLimit>
    </div>
  )
}

export function HealthResult({ report }: { report: HealthAnalysis }) {
  return (
    <div className="flex flex-col gap-3">
      <HealthReading report={report} />
      <PanelLimit>{PRODUCT_NOTES.health.limit}</PanelLimit>
    </div>
  )
}

export function OverlapResult({ report }: { report: OverlapAnalysis }) {
  return (
    <div className="flex flex-col gap-3">
      <OverlapReading report={report} />
      <Note>A check holds for the moment it was read.</Note>
      <PanelLimit>{PRODUCT_NOTES.overlap.limit}</PanelLimit>
    </div>
  )
}

export function RadarResult({ report }: { report: RadarAnalysis }) {
  return (
    <div className="flex flex-col gap-3">
      <RadarReading report={report} />
      <PanelLimit>{PRODUCT_NOTES.radar.limit}</PanelLimit>
    </div>
  )
}

export function ZonesResult({
  report,
  name,
  onPick,
}: {
  report: ZonesAnalysis
  name: string
  /** Puts the partition chosen on the map; null asks for the suggested one. */
  onPick: (k: number) => void
}) {
  const [k, setK] = useState<number | null>(null)
  const partition = chosenPartition(report, k)
  return (
    <div className="flex flex-col gap-3">
      <PanelChoices
        label="Number of zones"
        value={partition?.k ?? report.suggested_k}
        options={report.partitions.map((p) => ({
          id: p.k,
          label: p.k === report.suggested_k ? `${p.k} (suggested)` : String(p.k),
        }))}
        onChange={(next) => {
          setK(next)
          onPick(next)
        }}
      />
      <ZonesReading report={report} k={k} />
      <button
        type="button"
        disabled={!partition}
        onClick={() =>
          void saveGeoJSON(zonesGeoJSON([{ name, partition }]), "terra_zones.geojson")
        }
        className={cn(btnGhost, "self-start")}
      >
        <DownloadSimple className="size-3.5" />
        GeoJSON, {partition?.k ?? "no"} zones
      </button>
      <PanelLimit>{PRODUCT_NOTES.zones.limit}</PanelLimit>
    </div>
  )
}
