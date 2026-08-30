/**
 * What to grow and what to read, along the foot of the simulation workspace.
 *
 * The canopy's half of what the run editor is for the classification products:
 * one band, set once, that every panel in the workspace answers from. The run
 * band holds an area, a period and a model and the viewport, the outliner, the
 * properties column and the tables show what came of it; this holds a species,
 * an age, a sowing and which analysed area is read, and the Stand, Season,
 * Light and Ages panels show what came of THAT.
 *
 * WHY THE PANELS DO NOT HOLD THESE. They did, each of them, and two canopy
 * areas therefore carried two copies of the species and the sowing over one
 * stand -- with nothing saying it was one stand, since each area answered from
 * its own state. A parameter set twice to ask two questions about one field is
 * a parameter that can disagree with itself, which is the failure this
 * codebase has already had with a palette and with a set of table columns.
 *
 * TWO ACTIONS, because there are two subjects and they cost differently. Grow
 * builds the geometry, which is seconds and a few hundred thousand triangles.
 * Read area inverts an observed index series and, when the area has a location,
 * fetches the solar record for its cell and lights the canopy under it. Neither
 * runs on a scrub, for the reason the run band does not classify on one.
 */
import { useEffect } from "react"
import {
  Loader2,
  Package,
  Pentagon,
  Ruler,
  Sprout,
  Sun,
  Timer,
} from "lucide-react"

import { NumberField } from "@/components/ui/NumberField"
import { cn } from "@/lib/utils"

import { SPECIES } from "./canopySpecies"
import { useCanopyWorkflow } from "./canopyWorkflow"
import { BandDivider as Divider, BandGroup as Group } from "./runBand"

const metres = (v: number) => `${v.toFixed(2)} m`
const readMetres = (t: string) => {
  const v = parseFloat(t.replace("m", "").trim())
  return Number.isFinite(v) ? v : null
}
const degrees = (v: number) => `${Math.round(v)}°`
const readDegrees = (t: string) => {
  const v = parseFloat(t.replace("°", "").trim())
  return Number.isFinite(v) ? v : null
}
const whole = (v: number) => `${Math.round(v)}`
const readWhole = (t: string) => {
  const v = parseInt(t, 10)
  return Number.isFinite(v) ? v : null
}

export function CanopyRunBar() {
  const w = useCanopyWorkflow()

  // Announced to the workflow, so a panel in an arrangement that has no band
  // can say where the controls it is missing would be.
  const register = w?.registerBand
  useEffect(() => register?.(), [register])

  if (!w) return null

  const busy = w.growing || w.reading

  return (
    <div className="app-no-drag relative flex h-full w-full items-center overflow-x-auto">
      {/*
        The parameters scroll sideways; the actions do not. On a narrow window
        the groups run out of room before the buttons do, and a commit that had
        scrolled away would be the one control that has to be reachable from
        anywhere in the band.
      */}
      <div className="panel-scroll flex min-w-0 flex-1 items-center overflow-x-auto py-1">
        {/*
          The area first, as the run band puts it first, and for the same
          reason: it is the only input here that was observed rather than
          chosen, and everything the three read panels show is derived from it.
        */}
        <Group icon={Pentagon} label="Area">
          <select
            value={w.sourceId ?? ""}
            disabled={busy}
            onChange={(e) => w.setSourceId(e.target.value || undefined)}
            title={
              w.readable.length
                ? "The analysed area whose index series is read as a canopy"
                : "No analysed area carries a long enough index series yet"
            }
            className="field-input h-[1.375rem] w-auto max-w-[12rem] px-1 text-meta"
          >
            <option value="">none</option>
            {w.readable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          {/*
            The count, quiet, because it is what decides whether the season the
            panels draw is a curve or three points with a line through them.
          */}
          <span
            className={cn(
              "telemetry shrink-0 text-meta",
              w.source ? "text-muted-foreground" : "text-muted-foreground/50"
            )}
          >
            {w.source
              ? `${w.source.result.vi_series?.length ?? 0} dates`
              : "no season"}
          </span>
        </Group>

        <Divider />

        <Group icon={Sprout} label="Species">
          <select
            value={w.stand.species}
            disabled={busy}
            onChange={(e) => w.setStand({ species: e.target.value })}
            className="field-input h-[1.375rem] w-auto px-1 text-meta"
          >
            {SPECIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Group>

        <Divider />

        <Group icon={Timer} label="Age">
          {/*
            Rounded on the way in, for the fields the sidecar types as whole
            numbers. Scrubbing calls onChange with the continuous value under
            the pointer, so dragging Day produced 89.319… and Go refused the
            request with `cannot unmarshal number 89.3192471590909 into Go
            struct field CanopyMeshRequest.days of type int`.
          */}
          <NumberField
            label="Day"
            value={w.stand.days}
            min={5}
            max={200}
            step={5}
            format={whole}
            parse={readWhole}
            disabled={busy}
            onChange={(v) => w.setStand({ days: Math.round(v) })}
          />
        </Group>

        <Divider />

        {/*
          The sowing, which is the half a satellite cannot see and the half that
          moves the light: at matched LAI an ellipsoid crown overstates absorbed
          light by 37% and a row slab by 60%. It is one group because the four
          numbers are one decision -- how the plants are placed on the ground.
        */}
        <Group icon={Ruler} label="Sowing">
          <NumberField
            label="Rows"
            value={w.stand.rows}
            min={1}
            max={8}
            step={1}
            format={whole}
            parse={readWhole}
            disabled={busy}
            onChange={(v) => w.setStand({ rows: Math.round(v) })}
          />
          <NumberField
            label="Per row"
            value={w.stand.perRow}
            min={1}
            max={10}
            step={1}
            format={whole}
            parse={readWhole}
            disabled={busy}
            onChange={(v) => w.setStand({ perRow: Math.round(v) })}
          />
          <NumberField
            label="Row spacing"
            value={w.stand.interRow}
            min={0.1}
            max={6}
            step={0.05}
            format={metres}
            parse={readMetres}
            disabled={busy}
            onChange={(v) => w.setStand({ interRow: v })}
          />
          <NumberField
            label="In row"
            value={w.stand.interPlant}
            min={0.05}
            max={4}
            step={0.05}
            format={metres}
            parse={readMetres}
            disabled={busy}
            onChange={(v) => w.setStand({ interPlant: v })}
          />
          {/*
            The density the two spacings come to, which is the number the
            ladder actually consumes -- a reader setting 0.80 by 0.25 is
            setting 5.0 plants per square metre and cannot see it otherwise.
          */}
          <span className="telemetry shrink-0 text-meta text-muted-foreground">
            {(1 / (w.stand.interRow * w.stand.interPlant)).toFixed(1)} pl/m²
          </span>
        </Group>

        <Divider />

        {/*
          The drawn stand's own light, not the sun the read panels use. Those
          take the record for the area's cell; this is where the lamp is put to
          see the geometry, and it moves no number.
        */}
        <Group icon={Sun} label="Light">
          <NumberField
            label="Sun"
            value={w.sun.elevation}
            min={2}
            max={90}
            step={1}
            format={degrees}
            parse={readDegrees}
            onChange={(v) => w.setSun({ elevation: v })}
          />
          <NumberField
            label="Azimuth"
            value={w.sun.azimuth}
            min={0}
            max={359}
            step={5}
            format={degrees}
            parse={readDegrees}
            onChange={(v) => w.setSun({ azimuth: v })}
          />
        </Group>

        <Divider />

        {/*
          What was last built, at the right end of the parameters rather than
          in a band of its own. It describes the stand every Stand panel is
          drawing, and a panel that is showing a season should still be able to
          see what the geometry it is being compared against weighs.
        */}
        <Group icon={Package} label="Grown">
          {w.mesh ? (
            <span className="telemetry shrink-0 text-meta text-muted-foreground">
              {w.mesh.plants} {w.mesh.species} · day {w.mesh.days} ·{" "}
              {w.mesh.leafArea.toFixed(2)} m² leaf ·{" "}
              {Object.values(w.mesh.organs)
                .reduce((a, b) => a + b, 0)
                .toLocaleString()}{" "}
              triangles · {(w.mesh.bytes / 1e6).toFixed(1)} MB
            </span>
          ) : (
            <span className="telemetry shrink-0 text-meta text-muted-foreground/50">
              nothing grown yet
            </span>
          )}
        </Group>
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2.5">
        {/*
          The second action, in the place and the weight the run band gives
          Land cover: a commit that acts on the same parameters and produces a
          different kind of answer.
        */}
        <button
          type="button"
          onClick={() => void w.readArea()}
          disabled={!w.source || busy}
          title={
            w.source
              ? `Read ${w.source.label}'s index series as a ${w.stand.species} canopy at this sowing`
              : "Choose an analysed area first; its season is what is read"
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-meta transition-colors",
            "bg-surface-raised/40 hover:bg-surface-raised hover:text-foreground disabled:opacity-40",
            w.aoiStale ? "text-accent" : "text-muted-foreground"
          )}
        >
          {w.reading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Pentagon className="size-3" />
          )}
          {w.reading ? "Reading" : w.aoiStale ? "Reread area" : "Read area"}
        </button>

        {/*
          A button rather than a debounce, because growing is seconds rather
          than milliseconds: rebuilding while a number is being scrubbed would
          queue jobs the reader has already moved past and make the surface feel
          stuck. It says so when the staged parameters no longer describe what
          is drawn.
        */}
        <button
          type="button"
          onClick={() => void w.grow()}
          disabled={busy}
          title={
            w.standStale
              ? "The parameters have changed since this stand was grown"
              : "Grow the stand and draw it in every Stand panel"
          }
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors",
            "focus-visible:outline-none focus-visible:inset-ring-1 focus-visible:inset-ring-ring",
            busy
              ? "cursor-not-allowed bg-surface-raised/40 text-muted-foreground"
              : "bg-accent text-accent-foreground hover:opacity-90"
          )}
        >
          {w.growing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sprout className="size-3.5" />
          )}
          {w.growing ? "Growing" : w.standStale ? "Regrow" : "Grow"}
        </button>
      </div>
    </div>
  )
}
