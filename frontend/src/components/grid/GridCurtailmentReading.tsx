/**
 * What the operator withheld at the plants inside an area.
 *
 * FOUR BREAKDOWNS AND NONE OF THEM IS DECORATION. The record has structure that
 * a single fraction destroys, and each of these answers a question the total
 * cannot:
 *
 *   by reason  — whether the constraint would follow this project to another
 *                site. A systemic surplus would; a local network limit would
 *                not, and that is the only part a siting decision can act on.
 *   by hour    — where in the day the loss falls. Curtailment is taken from
 *                the hours the resource is worth most, because that is when
 *                the surplus exists; an annual fraction hides it entirely.
 *   by month   — the seasonal shape, which follows hydrology and load.
 *   by plant   — how much of the aggregate is one large neighbour.
 *
 * THE HEADLINE IS SPLIT BECAUSE IT DOES NOT ADD UP OTHERWISE. Withheld energy
 * spans every half hour in the window, so it carries both the energy taken
 * under restriction and the operator's estimate error while free -- and the
 * second is frequently negative. Reported as one number, the by-reason table
 * sums to more than the headline and looks like an arithmetic mistake.
 */
import {
  Chip,
  Stat,
  StatGrid,
  WaterFigure,
} from "@/components/analysisPrimitives"
import type { GridCurtailmentAnalysis } from "@/lib/types"

const mwh = (v: number): string =>
  `${Math.round(v).toLocaleString()} MWh`

const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`

/**
 * A row of bars, drawn as divs rather than as a chart.
 *
 * The shape is the message and the numbers are beside it; a charting library
 * here would bring an axis, a tooltip and a legend for twenty-four values that
 * each already carry their own label.
 */
function Bars({
  rows,
  label,
  value,
}: {
  rows: { key: string; v: number | null }[]
  label: (k: string) => string
  value: (v: number | null) => string
}) {
  const peak = Math.max(...rows.map((r) => r.v ?? 0), 0.0001)
  return (
    <div className="flex flex-col gap-px">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span className="telemetry w-8 shrink-0 text-right text-micro text-muted-foreground">
            {label(r.key)}
          </span>
          <div className="h-2.5 min-w-0 flex-1 bg-surface-raised/40">
            <div
              className="h-full bg-accent/70"
              style={{ width: `${Math.max(0, ((r.v ?? 0) / peak) * 100)}%` }}
            />
          </div>
          <span className="telemetry w-12 shrink-0 text-right text-micro text-foreground">
            {value(r.v)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function GridCurtailmentReading({
  result,
}: {
  result: GridCurtailmentAnalysis | null
}) {
  if (!result) {
    return (
      <div className="p-3 text-meta text-muted-foreground">
        No curtailment read yet. Draw an area, choose Curtailment in the run
        graph, and read the record.
      </div>
    )
  }

  const s = result.summary
  if (!s) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {/*
          The refusal, not an empty state. An area with no metered plant is a
          real answer about this ground, and it is different from a run that
          has not happened.
        */}
        <p className="text-body leading-relaxed text-foreground">
          {result.note ??
            "No plant of the operational record lies inside this area."}
        </p>
        <p className="text-meta text-muted-foreground">
          Window read: {result.window.used.join(" .. ")}.
        </p>
      </div>
    )
  }

  const reasons = result.by_reason

  /*
    THE DESCENT, COMPUTED ONCE AND LED WITH.

    The withheld fraction is the largest number this panel holds and the least
    usable, and it was shown first while the two subtractions that make it
    usable were below the fold. Over one area of Minas Gerais it reads 24.2
    percent, of which 11 percent is the operator's own model error and 89.3
    percent of the remainder is systemic -- so 2.3 percent is what a decision
    about THIS ground can act on, an order of magnitude below the headline.
    Over a second area the same three steps run 22.5, 42 and 13.2 percent, to
    1.2 percent. Neither descent is derivable from the other: the floor varies
    by place far more than by time -- a standard deviation of 15.3 points
    across sites against 7.6 across months -- so the panel has to show it per
    area rather than state a rule.

    Null-safe rather than defaulted, because share_local is absent when no
    restriction carried a reason, and treating that as zero would report a
    site as having no local exposure when what it has is no evidence.
  */
  const restrictedMwh = s.withheld_under_restriction_mwh
  const shareLocal = reasons?.share_local ?? null
  const localMwh = shareLocal === null ? null : restrictedMwh * shareLocal
  /*
    Against EXPECTED and never against WITHHELD.

    The free-hours gap is two-sided and is negative wherever plants out-produce
    the operator's estimate, which is not an edge case: over one area of Piaui
    it runs -264,818 MWh, so the energy taken under restriction is 731,759
    against a net withheld of 466,943 -- and a "share of withheld" would read
    156.7 percent and call itself a reduction. Expected output is the one
    denominator that is positive by construction and the same for all three
    quantities, so the descent holds its meaning at both signs.
  */
  const actionable =
    localMwh === null || !s.expected_mwh ? null : localMwh / s.expected_mwh
  const restrictedShare = s.expected_mwh ? restrictedMwh / s.expected_mwh : null
  const freeGapNegative = s.estimate_gap_when_free_mwh < 0

  return (
    <div className="panel-scroll flex flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">{s.kind}</Chip>
        <span className="text-meta text-muted-foreground">
          {s.plants_in_aoi} metered plant{s.plants_in_aoi === 1 ? "" : "s"} ·{" "}
          {result.window.used.join(" .. ")}
        </span>
      </div>

      {/* The number a siting decision can act on, given the size it deserves. */}
      <div className="flex flex-col gap-1">
        <div className="eyebrow">Local curtailment at this ground</div>
        <WaterFigure
          label="Of expected output"
          value={pct(actionable)}
          sub={localMwh === null ? "no reason recorded" : mwh(localMwh)}
        />
      </div>

      {/* The three quantities the lead is made of, each against expected
          output, so the reading holds whichever sign the free gap takes. */}
      <div className="flex flex-col gap-1">
        <div className="eyebrow">What the reading is made of</div>
        <div className="grid grid-cols-3 gap-x-4">
          <WaterFigure
            dense
            label="Withheld, net"
            value={pct(s.withheld_fraction)}
            sub={mwh(s.withheld_mwh)}
          />
          <WaterFigure
            dense
            label="Under restriction"
            value={pct(restrictedShare)}
            sub={mwh(restrictedMwh)}
          />
          <WaterFigure
            dense
            label="Of that, local"
            value={pct(shareLocal)}
            sub={localMwh === null ? "—" : mwh(localMwh)}
          />
        </div>
        <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
          Withheld is the operator&rsquo;s estimate minus its meter over every
          half hour, so it carries the estimate&rsquo;s own error as well as the
          energy actually taken. Over hours with no restriction in force that
          error is {mwh(s.estimate_gap_when_free_mwh)}
          {freeGapNegative
            ? " — negative, because these plants out-produced the estimate when free, which is why the restricted figure stands above the net one"
            : `, or ${pct(s.unrestricted_baseline_fraction)} of expected output`}
          . Only the local share is a number a decision about this ground can
          act on; the systemic part describes the subsystem and would follow
          this project to any site in it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <WaterFigure dense label="Expected" value={mwh(s.expected_mwh)} />
        <WaterFigure dense label="Delivered" value={mwh(s.delivered_mwh)} />
      </div>

      {/*
        The split, stated rather than left to be discovered. Without it the
        by-reason table below sums to more than the figure above and reads as
        an error.
      */}
      <div className="flex flex-col gap-1">
        <div className="eyebrow">How the total divides</div>
        <StatGrid at="pair">
          <Stat
            label="Under restriction"
            value={mwh(s.withheld_under_restriction_mwh)}
          />
          <Stat
            label="Estimate gap when free"
            value={mwh(s.estimate_gap_when_free_mwh)}
          />
        </StatGrid>
        <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
          {s.basis}
        </p>
      </div>

      {reasons && reasons.by_reason.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="eyebrow">Why</div>
            <span className="telemetry text-meta text-foreground">
              {pct(reasons.share_local)} local
            </span>
          </div>
          {reasons.by_reason.map((r) => (
            <Stat
              key={`${r.reason}/${r.origin}`}
              label={`${r.reason} / ${r.origin} · ${r.scope}`}
              value={`${mwh(r.withheld_mwh)} · ${pct(r.share, 0)}`}
            />
          ))}
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground">
            {reasons.note}
          </p>
        </div>
      )}

      {result.by_hour && result.by_hour.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">When, by hour</div>
          <Bars
            rows={result.by_hour
              .filter((h) => h.expected_mwh > 0)
              .map((h) => ({
                key: String(h.hour),
                v: h.withheld_fraction,
              }))}
            label={(k) => `${k.padStart(2, "0")}h`}
            value={(v) => pct(v, 0)}
          />
          <p className="mt-1 text-meta text-muted-foreground">
            Hours with no expected generation are omitted: a fraction of nothing
            is not a zero.
          </p>
        </div>
      )}

      {result.by_plant && result.by_plant.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="eyebrow">Per plant</div>
          {result.by_plant.map((p) => (
            <Stat
              key={p.id_ons}
              label={p.plant}
              value={`${pct(p.withheld_fraction)} · ${mwh(p.expected_mwh)}`}
            />
          ))}
          <p className="mt-1 text-meta text-muted-foreground">
            The aggregate above is dominated by the largest of these.
          </p>
        </div>
      )}
    </div>
  )
}
