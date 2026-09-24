/**
 * The Mineral nodes' cards: one part of a mineral map's figures each.
 *
 * WHY CARDS AND NOT A PANEL. The reading column held all of this at once --
 * coverage, both groups' classes and references, the passes, the fractional
 * cover, the band positions, the acid-sulfate minerals, the confidence, the
 * agreement with L2B -- and a column of eleven tables is read by scrolling
 * past ten of them. As nodes, each part is a card the reader adds, moves
 * beside the raster it describes, or removes; a run's set is placed for it
 * when it finishes (withMineralNodes).
 *
 * Every figure is the payload's own (lib/types MineralAnalysis): nothing is
 * recomputed here, only laid out. What each figure means is said in the card
 * where the column said it in a paragraph, and the longer account is in the
 * method brief.
 */
import { DownloadSimple } from "@phosphor-icons/react"
import type { GraphNode, MineralBand, MineralGroupId } from "@/lib/compositorGraph"
import type { MineralValue } from "@/lib/compositorEval"
import {
  MINERAL_MASKED_COLOR,
  MINERAL_NO_ANSWER_COLOR,
  mineralCellAreaHa,
  mineralClassColor,
  mineralNoAnswerHa,
  mineralRampGradient,
} from "@/lib/mineral"
import { notifyExportFail, notifyExportOk } from "@/lib/notify"
import type { MineralAnalysis, MineralSpread } from "@/lib/types"
import { ExportOverlayFile } from "../../../wailsjs/go/main/App"
import { Choice } from "./nodeCard"
import { ActionButton, Figure, Note, Swatch } from "./nodeParts"

const INT = new Intl.NumberFormat("en-US")
const ha = (v: number) => (Math.abs(v) >= 100 ? `${v.toFixed(0)} ha` : `${v.toFixed(1)} ha`)
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`
const nm = (v: number) => `${v.toFixed(0)} nm`

/** The two groups by the region they read, as the class maps' titles name them. */
const GROUP_SHORT: Record<MineralGroupId, string> = { 1: "0.4-1.3 um", 2: "2.0-2.5 um" }
const BAND_SHORT: Record<MineralBand, string> = { fe3: "Fe3+", aloh: "Al-OH" }

/** A card's title, where its setting belongs in it. */
export function mineralNodeTitle(node: GraphNode): string | null {
  switch (node.kind) {
    case "mineralClasses":
      return `Classes, ${GROUP_SHORT[node.group]}`
    case "mineralReferences":
      return `References, ${GROUP_SHORT[node.group]}`
    case "mineralAgreement":
      return `Against L2B, ${GROUP_SHORT[node.group]}`
    case "mineralPositions":
      return `${BAND_SHORT[node.band]} band position`
    default:
      return null
  }
}

/** A few rows as a grid: first column the name, the rest figures on the right. */
function Rows({
  head,
  rows,
  cols,
}: {
  head: string[]
  rows: { key: string; cells: React.ReactNode[]; muted?: boolean; title?: string }[]
  cols: string
}) {
  return (
    <div className="grid items-center gap-x-2 gap-y-1 text-meta" style={{ gridTemplateColumns: cols }}>
      {head.map((h, i) => (
        <span key={i} className={`text-micro text-muted-foreground${i ? " text-right" : ""}`}>
          {h}
        </span>
      ))}
      {rows.map((r) => (
        <div key={r.key} className="contents" title={r.title}>
          {r.cells.map((c, i) => (
            <span
              key={i}
              className={
                i === 0
                  ? `flex min-w-0 items-center gap-1.5 ${r.muted ? "text-muted-foreground" : "text-foreground"}`
                  : `telemetry whitespace-nowrap text-right ${r.muted ? "text-muted-foreground" : "text-foreground"}`
              }
            >
              {c}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function Named({ color, label }: { color?: string; label: string }) {
  return (
    <>
      {color && <Swatch color={color} />}
      <span className="truncate" title={label}>
        {label}
      </span>
    </>
  )
}

function GroupPick({ value, onPick }: { value: MineralGroupId; onPick: (g: MineralGroupId) => void }) {
  return (
    <div className="flex items-center gap-1">
      {([1, 2] as const).map((g) => (
        <Choice key={g} label={GROUP_SHORT[g]} chosen={value === g} onPick={() => onPick(g)} />
      ))}
    </div>
  )
}

const spreadText = (s: MineralSpread | null | undefined, fmt: (v: number) => string) =>
  s ? `${fmt(s.p50)} (${fmt(s.p10)} to ${fmt(s.p90)})` : "–"

function Coverage({ m }: { m: MineralAnalysis }) {
  const cellHa = mineralCellAreaHa(m)
  const used = m.selection ? `${m.selection.contributing_passes} of ${m.selection.compared_passes}` : String(m.scenes.length)
  return (
    <>
      <Figure
        label="Observed"
        value={`${ha(m.observed_area_ha)} · ${m.aoi_area_ha > 0 ? pct(m.observed_area_ha / m.aoi_area_ha) : "–"} of the area`}
      />
      {m.selection && (
        <Figure
          label="Exposed"
          value={`${ha(m.selection.exposed_area_ha)} · ${m.observed_area_ha > 0 ? pct(m.selection.exposed_area_ha / m.observed_area_ha) : "–"} of observed`}
        />
      )}
      <Figure label="Masked" value={cellHa !== null ? ha(m.masked_cells * cellHa) : `${INT.format(m.masked_cells)} cells`} />
      {m.groups.map((g) => (
        <Figure key={g.group} label={`Identified, ${GROUP_SHORT[g.group as MineralGroupId] ?? g.group}`} value={ha(g.detected_area_ha)} />
      ))}
      <Figure label="Passes used" value={used} />
      <Note>
        Band depth is not abundance. Vegetation, water and cloud suppress the answer, so shares are
        of the observed ground. Exposed: free of green vegetation and residue in the pass used.
      </Note>
      {m.notes.map((n, i) => (
        <Note key={i}>{n}</Note>
      ))}
    </>
  )
}

function Classes({ m, group }: { m: MineralAnalysis; group: MineralGroupId }) {
  const g = m.groups.find((x) => x.group === group)
  if (!g) return <Note>This run has no {GROUP_SHORT[group]} group.</Note>
  const cellHa = mineralCellAreaHa(m)
  const obs = m.observed_area_ha
  const noAnswer = mineralNoAnswerHa(m, g)
  return (
    <Rows
      cols="minmax(0,1fr) auto auto"
      head={["Class", "Area", "Of observed"]}
      rows={[
        ...g.classes.map((c) => ({
          key: c.class,
          title: `mean band depth ${c.mean_depth.toFixed(3)}`,
          cells: [<Named key="n" color={mineralClassColor(m, c.class, c.color)} label={c.label || c.class} />, ha(c.area_ha), pct(c.fraction_of_observed)],
        })),
        {
          key: "no-answer",
          muted: true,
          cells: [<Named key="n" color={MINERAL_NO_ANSWER_COLOR} label="No answer" />, ha(noAnswer), obs > 0 ? pct(noAnswer / obs) : "–"],
        },
        {
          key: "masked",
          muted: true,
          cells: [<Named key="n" color={MINERAL_MASKED_COLOR} label="Masked" />, cellHa !== null ? ha(m.masked_cells * cellHa) : "–", "–"],
        },
      ]}
    />
  )
}

function References({ m, group }: { m: MineralAnalysis; group: MineralGroupId }) {
  const g = m.groups.find((x) => x.group === group)
  if (!g?.entries.length) return <Note>No reference won a cell in this group.</Note>
  return (
    <Rows
      cols="minmax(0,1fr) auto auto"
      head={["Reference", "Cells", "Fit"]}
      rows={g.entries.slice(0, 10).map((e) => ({
        key: e.id,
        title: `${e.title} · ${e.class} · mean depth ${e.mean_depth.toFixed(3)}`,
        cells: [<Named key="n" color={mineralClassColor(m, e.class)} label={e.title} />, INT.format(e.cells), e.mean_fit.toFixed(2)],
      }))}
    />
  )
}

function Passes({ m }: { m: MineralAnalysis }) {
  if (!m.scenes.length) return <Note>No pass contributed cells.</Note>
  return (
    <>
      <Rows
        cols="minmax(0,1fr) auto auto"
        head={["Pass", "Used", "Exposed"]}
        rows={m.scenes.map((s) => ({
          key: s.granule,
          muted: s.cells === 0,
          title: `${s.granule} · scene cloud ${typeof s.cloud_cover === "number" ? `${s.cloud_cover.toFixed(0)}%` : "–"} · ${INT.format(s.masked_cells)} cells masked`,
          cells: [
            <Named key="n" label={s.acquired || s.date} />,
            INT.format(s.cells),
            typeof s.exposed_cells === "number" && typeof s.candidate_cells === "number"
              ? `${INT.format(s.exposed_cells)} / ${INT.format(s.candidate_cells)}`
              : "–",
          ],
        }))}
      />
      <Note>
        Each cell from the pass it is least covered in: exposed ground first (NDVI and CAI), then
        lower NDVI. Exposed: of the cells the pass observed.
      </Note>
    </>
  )
}

function Cover({ m }: { m: MineralAnalysis }) {
  const c = m.cover
  if (!c) return <Note>No EMIT L2B fractional cover exists for the passes used.</Note>
  return (
    <>
      <Figure label="Bare soil" value={pct(c.mean_bare)} />
      <Figure label="Green vegetation" value={pct(c.mean_pv)} />
      <Figure label="Dry vegetation" value={pct(c.mean_npv)} />
      <Figure label={`Bare above ${c.bare_threshold}`} value={`${ha(c.bare_area_ha)} of ${ha(c.area_ha)}`} />
      {c.groups.map((g) => (
        <Figure key={g.group} label={`Identified there, ${GROUP_SHORT[g.group as MineralGroupId] ?? g.group}`} value={ha(g.identified_area_ha)} />
      ))}
      <Note>Means over the cells with a fraction; the endmembers are EMIT's, built for arid ground.</Note>
    </>
  )
}

function Positions({ m, band }: { m: MineralAnalysis; band: MineralBand }) {
  const p = m.positions?.find((x) => x.key === band)
  if (!p) {
    return (
      <Note>
        {band === "fe3"
          ? "No cell of this map was identified as hematite or goethite."
          : "No cell of this map was identified as white mica or smectite."}
      </Note>
    )
  }
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="h-2 rounded-[2px]" style={{ background: mineralRampGradient(p.ramp.colors) }} />
        <div className="flex justify-between text-micro text-muted-foreground">
          <span>{nm(p.ramp.min)}</span>
          <span>{nm(p.ramp.max)}</span>
        </div>
      </div>
      <Rows
        cols="minmax(0,1fr) auto auto"
        head={["Cells of", "n", "Median (10-90%)"]}
        rows={[
          ...p.classes.map((c) => ({
            key: c.class,
            cells: [<Named key="n" color={mineralClassColor(m, c.class)} label={c.label} />, INT.format(c.cells), spreadText(c, nm)],
          })),
          ...p.references.map((r) => ({
            key: `ref-${r.class}`,
            muted: true,
            cells: [<Named key="n" label={`${r.class} references`} />, String(r.references), `${nm(r.median_nm)} (${nm(r.min_nm)} to ${nm(r.max_nm)})`],
          })),
        ]}
      />
      <Note>
        {band === "fe3"
          ? "Shorter in hematite than in goethite. Read against the reference rows, fitted the same way."
          : "White mica moves from about 2190 to 2225 nm as Al is replaced. Read against the reference rows."}
      </Note>
    </>
  )
}

function Acid({ m }: { m: MineralAnalysis }) {
  const rows = m.acid_sulfate ?? []
  if (!rows.length) return <Note>No acid-sulfate mineral was identified.</Note>
  return (
    <>
      <Rows
        cols="minmax(0,1fr) auto auto"
        head={["Mineral", "Area", "Group 1 / 2"]}
        rows={rows.map((r) => ({
          key: r.key,
          title: r.setting,
          cells: [<Named key="n" color={r.color} label={r.label} />, ha(r.area_ha), r.groups ? `${r.groups["1"] ?? 0} / ${r.groups["2"] ?? 0}` : "–"],
        }))}
      />
      <Note>
        An identification, not a pH. Group 1 matches rest on Fe3+ bands shared with goethite in
        iron-rich soil; group 2 on a band of the mineral itself.
      </Note>
    </>
  )
}

function Confidence({ m }: { m: MineralAnalysis }) {
  const rows = m.confidence ?? []
  if (!rows.length) return <Note>This run carries no fit margins.</Note>
  const draws = rows.find((r) => r.draws > 0)?.draws ?? 0
  return (
    <>
      {rows.map((r) => {
        const identified = m.groups.find((g) => g.group === r.group)?.detected_cells ?? 0
        return (
          <div key={r.group} className="flex flex-col gap-0.5">
            <span className="text-micro text-muted-foreground">{GROUP_SHORT[r.group as MineralGroupId] ?? r.group}</span>
            <Figure label="Fit margin" value={spreadText(r.margin, (v) => v.toFixed(2))} />
            {draws > 0 && (
              <Figure
                label={`Held in all ${r.draws} draws`}
                value={identified > 0 ? pct(r.stable_cells / identified) : "–"}
              />
            )}
          </div>
        )
      })}
      <Note>
        Margin: the fit less the best fit of another class; near zero, another mineral explains the
        spectrum as well.
        {draws > 0 ? "" : " Set draws on the Passes card of the run to measure stability."}
      </Note>
    </>
  )
}

function Agreement({ m, group }: { m: MineralAnalysis; group: MineralGroupId }) {
  const a = m.agreement?.find((x) => x.group === group)
  if (!a) return <Note>No EMIT L2B granule exists for the passes used in this group.</Note>
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="telemetry text-[18px] leading-none text-foreground">
          {a.agree_fraction_of_both !== null ? pct(a.agree_fraction_of_both) : "–"}
        </span>
        <span className="text-meta text-muted-foreground">
          same class, of {INT.format(a.agree + a.differ)} cells both identified
        </span>
      </div>
      <Figure label="Here only / L2B only" value={`${INT.format(a.port_only)} / ${INT.format(a.l2b_only)}`} />
      {a.pairs.length > 0 && (
        <Rows
          cols="minmax(0,1fr) minmax(0,1fr) auto"
          head={["Here", "L2B", "Cells"]}
          rows={a.pairs.slice(0, 5).map((p) => ({
            key: `${p.here}>${p.l2b}`,
            cells: [
              <Named key="h" color={mineralClassColor(m, p.here)} label={m.legend.find((l) => l.class === p.here)?.label ?? p.here} />,
              <Named key="l" color={mineralClassColor(m, p.l2b)} label={m.legend.find((l) => l.class === p.l2b)?.label ?? p.l2b} />,
              INT.format(p.cells),
            ],
          }))}
        />
      )}
      <Note>L2B runs t5.27d1 with libraries that are not public. Vegetation and water count as no mineral.</Note>
    </>
  )
}

function Save({ m }: { m: MineralAnalysis }) {
  const go = async () => {
    try {
      const dest = await ExportOverlayFile(m.geotiff, "terra_mineral_map.tif")
      if (dest) notifyExportOk(dest)
    } catch (e) {
      notifyExportFail(e)
    }
  }
  return (
    <>
      <ActionButton
        label="GeoTIFF"
        icon={<DownloadSimple className="size-3.5" />}
        disabled={!m.geotiff}
        onClick={() => void go()}
      />
      {!m.geotiff && <Note>This run has no GeoTIFF on disk.</Note>}
    </>
  )
}

/** A Mineral node's card body, from the figures that reach it. */
export function MineralNodeBody({
  node,
  value,
  onChange,
}: {
  node: GraphNode
  value: MineralValue
  onChange: (next: GraphNode) => void
}) {
  const m = value.analysis
  switch (node.kind) {
    case "mineralCoverage":
      return <Coverage m={m} />
    case "mineralClasses":
      return (
        <>
          <GroupPick value={node.group} onPick={(group) => onChange({ ...node, group })} />
          <Classes m={m} group={node.group} />
        </>
      )
    case "mineralReferences":
      return (
        <>
          <GroupPick value={node.group} onPick={(group) => onChange({ ...node, group })} />
          <References m={m} group={node.group} />
        </>
      )
    case "mineralPasses":
      return <Passes m={m} />
    case "mineralCover":
      return <Cover m={m} />
    case "mineralPositions":
      return (
        <>
          <div className="flex items-center gap-1">
            {(["fe3", "aloh"] as const).map((b) => (
              <Choice key={b} label={BAND_SHORT[b]} chosen={node.band === b} onPick={() => onChange({ ...node, band: b })} />
            ))}
          </div>
          <Positions m={m} band={node.band} />
        </>
      )
    case "mineralAcid":
      return <Acid m={m} />
    case "mineralConfidence":
      return <Confidence m={m} />
    case "mineralAgreement":
      return (
        <>
          <GroupPick value={node.group} onPick={(group) => onChange({ ...node, group })} />
          <Agreement m={m} group={node.group} />
        </>
      )
    case "mineralSave":
      return <Save m={m} />
    default:
      return null
  }
}
