/**
 * Accuracy drawn rather than tabulated.
 *
 * THE CONFUSION MATRIX IS THE WEAKEST FORMAT FOR THESE NUMBERS. It spends k²
 * cells on k classes -- 25 for five, of which five are the diagonal and most of
 * the remaining twenty are zero or near it -- and the question actually being
 * asked of it is not "how many cells went from class i to class j" but "which
 * way does this class fail". Answering that from a matrix means summing a row
 * against a column by eye.
 *
 * Producer's and user's accuracy ARE that row and that column, already summed,
 * and the run carries both. Drawn as a pair per class they take k rows instead
 * of k² cells, and the asymmetry between them -- the thing a matrix hides in
 * arithmetic -- becomes the shape of the figure. A class the model sweeps
 * everything into reads as a long producer's bar against a short user's one,
 * at a glance, which is the diagnosis.
 *
 * They also carry confidence intervals that nothing in the board was showing.
 * `producers_ci`/`users_ci` exist on every class and were used only by the
 * legacy page; a bar has somewhere to put them and a text row does not.
 *
 * No chart library. These are proportions on a shared 0-100 axis, which is two
 * divs and a width -- recharts would add a ResponsiveContainer measuring itself
 * inside a 15rem column to draw what a percentage already positions. The modal,
 * where there is width for axes and a histogram, is where the library earns its
 * place.
 */
import { PALETTE_STOPS } from "@/lib/palettes"
import { rampStop } from "@/components/analysisPrimitives"
import { cn } from "@/lib/utils"
import type { LULCAgreement, LULCAgreementBlocks, LULCClassAccuracy } from "@/lib/types"

/**
 * Producer's against user's, per class, as an estimate with its interval.
 *
 * DOT-AND-WHISKER, NOT BARS. A filled bar asserts a magnitude measured from
 * zero and known exactly; an accuracy is neither. It is a proportion estimated
 * from a finite sample, and the Wilson interval the run already computes is
 * part of the estimate rather than decoration on it. A bar with a shaded band
 * behind it draws the point as solid and the uncertainty as a shadow, which is
 * backwards -- so the point is a mark and the interval is the line it sits on,
 * which is how an estimate is reported.
 *
 * The 0-100 axis is drawn once for the whole figure rather than implied per
 * row. A reader comparing two classes is comparing positions against that axis;
 * without it every row is its own unlabelled scale.
 *
 * Ink is kept low deliberately (Tufte 1983): hairlines, no fills, no rounded
 * corners, no gridlines between ticks.
 */
/**
 * The marker's radius, in pixels, and the axis's own inset.
 *
 * One number rather than two: the track is inset by exactly what a marker
 * overhangs, so a class at 0 or at 100 is drawn whole, and the axis is inset
 * by the same amount so the marks sit on the scale they are measured against.
 */
const MARK_R = 4

/** The interval's end serifs. Tall enough to read as a bound, no taller. */
const SERIF_PX = 5

function AccuracyRow({ c }: { c: LULCClassAccuracy }) {
  // Null is not zero. A class the reference never sampled has no producer's
  // accuracy at all, and a mark at the origin would read as total failure
  // rather than as absence.
  const marks = (
    [
      { v: c.producers_pct, ci: c.producers_ci, kind: "producer's" },
      { v: c.users_pct, ci: c.users_ci, kind: "user's" },
    ] as const
  ).filter((m) => m.v != null)
  if (!marks.length) return null

  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-1.5">
        <span
          className="size-1.5 shrink-0 translate-y-px"
          style={{ backgroundColor: c.color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
          {c.name}
        </span>
        <span className="telemetry shrink-0 text-micro text-muted-foreground tabular-nums">
          n={c.n_reference.toLocaleString()}
        </span>
      </span>
      {/*
        POSITIONED IN CSS, not in a stretched SVG.

        This was an `svg viewBox="0 0 100 12"` with preserveAspectRatio="none",
        so that x could be the percentage itself and no arithmetic mapped value
        to position. The cost was not visible in the source and was the whole
        legibility fault on screen: the row renders about six hundred pixels
        wide and twelve tall, so x was scaled roughly six times and y not at
        all, and `circle r=2.2` came out an ellipse thirteen pixels across and
        two high. Every marker on this chart was a flat lozenge.

        non-scaling-stroke, which is here for the lines, does not help: it holds
        a stroke's WIDTH, not a shape's geometry.

        Percentages of an inset track do the same job with none of that. A
        marker is a div, so it is round because it is round.
      */}
      <div className="relative h-5 w-full">
        {/*
          Inset by the marker's own radius at both ends, so a class at 0 or at
          100 is drawn whole rather than half outside the column. The axis
          below is inset to match, or the marks would sit against a scale they
          are not measured on.
        */}
        <div
          className="absolute inset-y-0"
          style={{ left: MARK_R, right: MARK_R }}
          role="img"
          aria-label={marks
            .map(
              (m) =>
                `${m.kind} ${m.v!.toFixed(1)} percent${
                  m.ci ? `, 95% CI ${m.ci[0].toFixed(0)} to ${m.ci[1].toFixed(0)}` : ""
                }`
            )
            .join("; ")}
        >
          {marks.map((m, k) => {
            /*
              Two baselines, far enough apart that a pair with equal values is
              two marks rather than one thicker one. Soybean reads 78 and 79 on
              a real run, which is the case this spacing is for.
            */
            const top = marks.length === 1 ? "50%" : k === 0 ? "28%" : "72%"
            const lo = m.ci ? Math.max(0, m.ci[0]) : null
            const hi = m.ci ? Math.min(100, m.ci[1]) : null
            return (
              <div key={m.kind}>
                {lo != null && hi != null && (
                  <>
                    <div
                      className="absolute h-px -translate-y-1/2"
                      style={{
                        left: `${lo}%`,
                        width: `${Math.max(0, hi - lo)}%`,
                        top,
                        background: c.color,
                      }}
                    />
                    {/* Serifs, so the interval reads as bounded rather than as
                        a line that happens to stop. */}
                    {[lo, hi].map((x) => (
                      <div
                        key={x}
                        className="absolute w-px -translate-y-1/2"
                        style={{
                          left: `${x}%`,
                          top,
                          height: SERIF_PX,
                          background: c.color,
                        }}
                      />
                    ))}
                  </>
                )}
                {/*
                  Producer's filled, user's open. The pair is told apart by fill
                  rather than by colour, leaving the class colour to mean the
                  class.
                */}
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${m.v}%`,
                    top,
                    width: MARK_R * 2,
                    height: MARK_R * 2,
                    background: k === 0 ? c.color : "rgb(var(--p-surface))",
                    border: `1px solid ${c.color}`,
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </li>
  )
}

/** The shared axis, drawn once beneath the rows it governs. */
function AccuracyAxis() {
  return (
    <div
      className="relative mt-1 h-3"
      // Inset by the marker's radius, like the rows above: an axis running the
      // full width would put its 0 and its 100 at coordinates no mark can
      // reach, and every reading would look shifted inward.
      style={{ marginLeft: MARK_R, marginRight: MARK_R }}
    >
      <div
        className="absolute inset-x-0 top-0 border-t"
        style={{ borderColor: "rgb(var(--p-line-strong) / 0.45)" }}
        aria-hidden
      />
      {[0, 50, 100].map((t) => (
        <span
          key={t}
          className="telemetry absolute top-0.5 text-micro text-muted-foreground tabular-nums"
          style={{
            left: `${t}%`,
            // The end labels are pulled inside the axis rather than centred on
            // it: a centred "100" hangs half its width past the right edge and
            // is clipped by the column.
            transform:
              t === 0 ? "none" : t === 100 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

export function ClassAccuracyChart({ classes }: { classes: LULCClassAccuracy[] }) {
  // Classes the reference never sampled carry no accuracy in either direction.
  // Dropped rather than drawn as rows of dashes: a list of absences spends the
  // column's scarcest resource on nothing.
  const measured = classes.filter((c) => c.producers_pct != null || c.users_pct != null)
  if (!measured.length) return null

  return (
    <div className="flex w-full flex-col gap-1">
      {/*
        Title over key, not beside it. Sharing one line put an eyebrow and a
        legend in a 15rem column: the heading wrapped mid-word into "CURACY BY
        / ASS" while the key broke after "95%". Stacked, each gets the full
        width and neither wraps.
      */}
      <div className="flex w-full min-w-0 flex-col gap-0.5">
        <p className="eyebrow truncate !text-micro">Accuracy by class</p>
        <span className="telemetry flex items-center gap-1 text-micro whitespace-nowrap text-muted-foreground">
          <svg viewBox="0 0 18 6" className="h-1.5 w-4" aria-hidden>
            <circle cx="3" cy="3" r="2.2" className="fill-muted-foreground" />
            <circle
              cx="13"
              cy="3"
              r="2.2"
              className="fill-surface stroke-muted-foreground"
              strokeWidth="1"
            />
          </svg>
          prod. / user&apos;s · 95% CI
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {measured.map((c) => (
          <AccuracyRow key={c.class_id} c={c} />
        ))}
      </ul>
      <AccuracyAxis />
    </div>
  )
}

/**
 * Where the disagreement lives: in the amount, or in the placement.
 *
 * Pontius & Millones (2011) propose this decomposition AS A REPLACEMENT for
 * reporting a matrix with kappa -- their argument being that neither answers
 * whether the map got the quantity wrong or the location wrong, which is the
 * question that changes what to do next. Quantity disagreement says the
 * classifier found too much or too little of a class; allocation says it found
 * the right amount in the wrong place.
 *
 * One partitioned bar, because the three parts sum to 100 by construction --
 * verified, not assumed -- and a bar whose segments exhaust the whole is the
 * figure that says so. Segments are separated by hairline rules rather than by
 * gaps and rounding: a rounded segment with a gap beside it is a stylistic bar
 * chart, and this is a partition of a fixed total.
 */
/*
  THE RAMP THESE READINGS ARE PAINTED IN, and it is not the chassis accent.

  Every intensity here used to be `rgb(var(--p-accent) / alpha)`: the brand
  colour, faded. Two things were wrong with it and only one is a matter of
  taste. DESIGN.md holds that the scientific ramps answer to the data rather
  than to the chassis, and an accent that changes takes every confusion matrix
  in the application with it -- but the measurable fault is that FADING ONE HUE
  BY ALPHA IS NOT A PERCEPTUALLY UNIFORM SCALE. Equal steps in the number are
  not equal steps to the eye, which is the exact failure perceptually uniform
  colormaps exist to remove, and a confusion matrix is read by comparing cells.

  inferno, because it is the ramp the renderer's own palette table carries for
  a sequential magnitude with no reference value. It is generated from
  sidecar/composite.py and guarded byte for byte by test_palette_sync.py, so a
  swatch here is a colour the renderer defines rather than one transcribed.

  It also starts near-black, which a dark chassis needs: a ramp that starts
  light would put its low end above the panel and read the scale backwards.

  WHERE THE LABEL FLIPS is measured, not chosen. Against the dark theme's own
  text and ink, light type wins on inferno's stops up to t=0.50 and dark type
  from t=0.56 -- 4.08 against 2.90 at the first, 3.31 against 3.58 at the
  second. The 0.55 already in this file was calibrated for the accent and lands
  inside that crossing, which is why it did not have to move.

  A LIMIT WORTH STATING: at the crossing itself neither label clears WCAG's 4.5
  for text -- the best available is about 3.6. That is inherent to drawing a
  number on a continuous ramp, is the same on viridis (3.35 against 3.53), and
  is why every cell also carries its value in a title.
*/
const READING_RAMP = PALETTE_STOPS.inferno

/** Where a cell's own label stops being light and starts being dark. */
const LABEL_FLIP = 0.55

/*
  THE RAMP IS THE SAME IN BOTH THEMES, SO ITS LABELS ARE TOO. A cell's number
  was set in the theme's text or ground colour, which in the light theme put
  dark type on inferno's dark end and light type on its light end, unreadable
  at both. The two are fixed at the dark theme's text and ink, the pair the
  flip above was measured with. A cell with nothing on the ramp sits on the
  panel and takes the theme's muted text.
*/
function rampLabel(t: number): string {
  return t > LABEL_FLIP ? "rgb(20 20 20)" : "rgb(217 211 209)"
}

export function DisagreementBar({ a }: { a: LULCAgreement }) {
  const quantity = Math.max(0, a.quantity_disagreement_pct)
  const allocation = Math.max(0, a.allocation_disagreement_pct)
  // Taken from the reported total rather than as 100 minus the other two: the
  // three are computed independently and a rounding gap should show as a gap
  // rather than be silently absorbed into agreement.
  const agree = Math.max(0, Math.min(100, a.overall_pct))
  const total = agree + quantity + allocation || 100
  const parts = [
    {
      key: "agree",
      label: "agreement",
      v: agree,
      /*
        A PARTITION, so not a ramp: three parts of a fixed total, and the two
        disagreement terms are already told apart by hatching rather than by a
        colour that would have to mean something.

        The agreed share takes the ramp's top stop all the same, so this bar
        and the block grid beside it speak one language: what is agreement
        there is agreement here, in the same colour, rather than in the brand's.
      */
      fill: READING_RAMP[READING_RAMP.length - 1],
    },
    {
      key: "quantity",
      label: "quantity",
      v: quantity,
      // Hatched rather than a second solid tone: the two disagreement terms are
      // one kind of thing measured two ways, and hatching separates them
      // without introducing a colour that would have to mean something.
      fill: "url(#disagree-hatch)",
    },
    {
      key: "allocation",
      label: "allocation",
      v: allocation,
      fill: "rgb(var(--p-line-strong) / 0.55)",
    },
  ]

  let x = 0
  const placed = parts.map((p) => {
    const w = (p.v / total) * 100
    const seg = { ...p, x, w }
    x += w
    return seg
  })

  return (
    <div className="flex w-full flex-col gap-1">
      {/* Stacked for the same reason as the accuracy figure: a heading and a
          reading do not both fit across 15rem without one of them wrapping. */}
      <div className="flex w-full min-w-0 flex-col gap-0.5">
        <p className="eyebrow truncate !text-micro">Agreement with MapBiomas</p>
        <span className="telemetry text-micro whitespace-nowrap text-foreground tabular-nums">
          {a.overall_pct.toFixed(1)}
          <span className="text-muted-foreground">
            {" "}
            [{a.overall_ci[0].toFixed(0)}, {a.overall_ci[1].toFixed(0)}]
          </span>
        </span>
      </div>
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className="h-2.5 w-full"
        role="img"
        aria-label={`Agreement ${agree.toFixed(1)} percent, quantity disagreement ${quantity.toFixed(1)}, allocation disagreement ${allocation.toFixed(1)}`}
      >
        <defs>
          <pattern
            id="disagree-hatch"
            width="2"
            height="2"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            {/* The agreed share behind the hatch, so the two disagreement
                terms read as that share interrupted rather than as a third
                colour. Faint, because what carries here is the ruling. */}
            <rect
              width="2"
              height="2"
              fill={READING_RAMP[READING_RAMP.length - 1]}
              opacity={0.18}
            />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="2"
              stroke={READING_RAMP[READING_RAMP.length - 1]}
              strokeWidth="1"
            />
          </pattern>
        </defs>
        {placed.map((p) => (
          <rect
            key={p.key}
            x={p.x}
            y={0}
            width={Math.max(0, p.w)}
            height={6}
            fill={p.fill}
          >
            <title>{`${p.label}: ${p.v.toFixed(1)}%`}</title>
          </rect>
        ))}
        {/* The frame, so the bar is bounded by the total it partitions. */}
        <rect
          x={0}
          y={0}
          width={100}
          height={6}
          fill="none"
          stroke="rgb(var(--p-line-strong) / 0.5)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="telemetry flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
        {placed.slice(1).map((p) => (
          <span key={p.key} className="flex items-baseline gap-1">
            <svg viewBox="0 0 6 6" className="size-1.5 shrink-0" aria-hidden>
              <rect width="6" height="6" fill={p.fill} />
            </svg>
            {p.label} {p.v.toFixed(1)}
          </span>
        ))}
        <span>
          n = {a.n_reference_cells.toLocaleString()}
          {a.n_outside_legend > 0 && (
            /*
              Reference cells whose class the classifier has no label for. With
              a fixed crop legend this is shift measured in the label space
              itself, and it sat on the type without ever being drawn.
            */
            <>
              {" · "}
              <span className="text-foreground">
                {a.n_outside_legend.toLocaleString()} outside legend
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * The confusion matrix, at a width where a cell can be read.
 *
 * It is here rather than in the right column because k x k does not fit in
 * 15rem. Compressed to that width it became the tallest single thing in the
 * column -- the reason it scrolled -- while losing the one property that makes
 * a matrix worth its space: the ability to read a named row against a named
 * column and see which class is being taken for which. A grid whose axes are
 * numbered swatches is a heatmap of unlabelled cells.
 *
 * Kept, rather than replaced by the per-class bars, because the two answer
 * different questions. The bars say which way a class fails; only the matrix
 * says what it fails INTO. Losing that would be losing the pair -- pasture read
 * as soy -- that names the actual error.
 */
export function ConfusionMatrix({ a, title }: { a: LULCAgreement; title?: string }) {
  /*
    `matrix_classes` carries the class ids in the matrix's own axis order,
    which is not the order of `per_class` and need not contain the same set.
    Indexing per_class positionally -- what the compact grid could get away
    with, having no names to print -- would label rows with the wrong classes
    here, and a mislabelled matrix is worse than none.
  */
  const byId = new Map(a.per_class.map((c) => [c.class_id, c]))
  const axis = a.matrix_classes.map((id, i) => ({
    id,
    name: byId.get(id)?.name ?? `Class ${id}`,
    color: byId.get(id)?.color ?? "#888888",
    i,
  }))
  if (!axis.length || !a.matrix.length) return null
  const max = Math.max(1, ...a.matrix.flat())

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {title && <p className="eyebrow truncate !text-micro">{title}</p>}
      {/*
        ROWS ARE THE RUN, COLUMNS ARE THE REFERENCE, and this line said the
        reverse. `agreement_against_reference` in sidecar/lulc.py fills
        `matrix[index[pred_label], index[ref_label]]` and derives producer's
        accuracy from `matrix.sum(axis=0)` -- the COLUMN totals -- so the
        reference is the column axis.

        Both axes are drawn from `matrix_classes`, so the grid itself was
        right; only its caption was inverted. That is the worse of the two
        failures, because the cells are symmetric-looking and nothing on screen
        contradicted the caption: a reader following it read every off-diagonal
        cell as the opposite error, omission for commission.
      */}
      <p className="text-meta leading-snug text-muted-foreground">
        Rows = this run · columns = MapBiomas reference. Off-diagonal cells are the
        pairs actually confused.
      </p>
      <div className="min-w-0 overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-micro">
          <thead>
            <tr>
              <th className="p-0.5" />
              {axis.map((c) => (
                /*
                  Rotated, because a horizontal class name is several times the
                  width of the cell beneath it and would set the column width
                  for the whole grid. Vertical text costs height once.
                */
                <th key={c.id} className="p-0.5 align-bottom font-normal">
                  <span
                    className="telemetry block h-24 max-h-24 overflow-hidden text-left text-micro whitespace-nowrap text-muted-foreground"
                    style={{
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                    }}
                    title={c.name}
                  >
                    {c.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {axis.map((rowClass) => (
              <tr key={rowClass.id}>
                <th className="max-w-[9rem] p-0.5 text-left font-normal">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-xs"
                      style={{ backgroundColor: rowClass.color }}
                      aria-hidden
                    />
                    <span className="truncate text-meta text-muted-foreground">
                      {rowClass.name}
                    </span>
                  </span>
                </th>
                {axis.map((colClass) => {
                  const cell = a.matrix[rowClass.i]?.[colClass.i] ?? 0
                  const t = cell / max
                  const diag = rowClass.id === colClass.id
                  return (
                    <td key={colClass.id} className="p-0">
                      <div
                        className="telemetry flex min-h-[1.6rem] min-w-[1.6rem] items-center justify-center rounded-xs px-1"
                        style={{
                          background:
                            cell > 0
                              ? rampStop(READING_RAMP, t)
                              : "rgb(var(--p-line) / 0.08)",
                          boxShadow: diag
                            ? "inset 0 0 0 1px rgb(var(--p-line-strong) / 0.9)"
                            : undefined,
                        }}
                        title={`${rowClass.name} → ${colClass.name}: ${cell.toLocaleString()} cells`}
                      >
                        <span
                          className={cell > 0 ? undefined : "text-muted-foreground"}
                          style={cell > 0 ? { color: rampLabel(t) } : undefined}
                        >
                          {cell > 0 ? cell.toLocaleString() : "·"}
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Where each run's agreement sits, block by block, for both runs at once.
 *
 * A single overall figure cannot separate a classifier that is uniformly
 * mediocre from one that is accurate everywhere except a corner. On a synthetic
 * case with one bad quadrant the overall reads 92% while the worst block reads
 * 25%, and the second number is the one that says what to look at.
 *
 * It is also the second axis on which two AOIs compare. One figure per area
 * says which is higher; the spread says whether an area is evenly classified or
 * carries a failure in one place, and two areas can differ in that while
 * agreeing on the mean.
 *
 * ONE COLOUR DOMAIN over both grids, 0..100, for the reason the confusion pair
 * gives: two grids each stretched to their own range put two different
 * agreements in the same colour. Blocks below the cell floor are drawn empty
 * rather than dark -- no measurement is not a low score.
 */
export function BlockAgreementPair({
  a,
  b,
  labelA,
  labelB,
}: {
  a: LULCAgreement
  b: LULCAgreement
  labelA: string
  labelB: string
}) {
  const grids = [
    { letter: "A", label: labelA, blocks: a.blocks },
    { letter: "B", label: labelB, blocks: b.blocks },
  ].filter(
    (g): g is { letter: string; label: string; blocks: LULCAgreementBlocks } =>
      !!g.blocks
  )
  if (grids.length < 2) return null

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-label text-muted-foreground">
        {/*
          Broken at the boundaries between the three claims rather than left to
          wrap: on a wide board this ran as one line the full width of the
          panel, which is a measure no caption is read at. Each line is now one
          statement -- what a block is, what the spread answers, and what a
          blank one means.
        */}
        Each block is its own agreement against the reference.
        <br />
        Spread says whether the disagreement sits in one place or everywhere.
        <br />
        Blank blocks held fewer than {grids[0].blocks.min_cells} reference cells.
      </p>
      <div className="flex flex-row flex-wrap items-start gap-3">
        {grids.map((g) => {
          const at = new Map(g.blocks.cells.map((c) => [`${c.row}:${c.col}`, c]))
          return (
            <div key={g.letter} className="flex flex-col gap-1">
              <SideTag letter={g.letter} label={g.label} />
              <div
                className="grid gap-px"
                style={{
                  gridTemplateColumns: `repeat(${g.blocks.cols}, 0.85rem)`,
                }}
              >
                {Array.from({ length: g.blocks.rows }).flatMap((_, r) =>
                  Array.from({ length: g.blocks.cols }).map((__, c) => {
                    const cell = at.get(`${r}:${c}`)
                    const v = cell?.overall_pct ?? null
                    return (
                      <div
                        key={`${r}:${c}`}
                        className="h-[0.85rem] rounded-xs"
                        style={{
                          background:
                            v == null
                              ? "rgb(var(--p-line) / 0.12)"
                              : rampStop(READING_RAMP, v / 100),
                        }}
                        title={
                          cell == null
                            ? "No reference cells in this block"
                            : v == null
                              ? `${cell.n_reference_cells} reference cells, below the floor of ${g.blocks.min_cells}`
                              : `${v.toFixed(1)}% over ${cell.n_reference_cells} reference cells`
                        }
                      />
                    )
                  })
                )}
              </div>
              <p className="telemetry text-micro text-muted-foreground">
                med {g.blocks.median_pct.toFixed(0)} · IQR {g.blocks.iqr_pct.toFixed(0)}{" "}
                · {g.blocks.min_pct.toFixed(0)}–{g.blocks.max_pct.toFixed(0)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Both runs' confusion against the reference, on one axis and one colour scale.
 *
 * WHY THIS AND NOT THE TRANSITION MATRIX. The A-to-B matrix answers "where did
 * A's labels land in B", and it needs the two rasters to cover the same pixels.
 * Two areas never do, which is every comparison the Compare board exists for.
 * Each run separately carries a full confusion against the MapBiomas
 * reference, and two of those share the reference legend, so they can be read
 * against each other with no shared pixel anywhere.
 *
 * NORMALISED DOWN THE REFERENCE AXIS, WHICH IS NOT A PRESENTATION CHOICE. The
 * matrices carry counts of reference cells, and a larger area has larger counts
 * in every cell; set side by side as counts, the bigger area looks the more
 * confused. `agreement_against_reference` fills `matrix[predicted][reference]`,
 * so the reference is the COLUMN axis -- the axis `producers_pct` is derived
 * from -- and dividing each column by its total puts the producer's accuracy on
 * the diagonal. Drawn transposed, so rows are the reference and the grid reads
 * as an accuracy assessment is written.
 *
 * ONE TABLE, ONE AXIS, ONE SCALE. The two grids were two tables whose rows and
 * columns were named by class number -- 3, 21, 39 -- with the names nowhere in
 * the reading. They are now one table: each reference class named once at the
 * left, A's cells and then B's beside it, so a row is read across both runs.
 * Shares are bounded at 100 by construction, so both are shaded against 0..100
 * rather than against whatever each happens to reach. A reference class
 * neither side has cells of is no measurement, and its row is left out.
 */
export function ReferenceConfusionPair({
  a,
  b,
  labelA,
  labelB,
}: {
  a: LULCAgreement
  b: LULCAgreement
  labelA: string
  labelB: string
}) {
  const named = (agreement: LULCAgreement) =>
    new Map(agreement.per_class.map((c) => [c.class_id, c]))
  const namesA = named(a)
  const namesB = named(b)

  /* The union, in A's order then B's, so a class sits in the same column in both. */
  const ids: number[] = []
  for (const id of [...a.matrix_classes, ...b.matrix_classes]) {
    if (!ids.includes(id)) ids.push(id)
  }
  const axis = ids.map((id) => ({
    id,
    name: namesA.get(id)?.name ?? namesB.get(id)?.name ?? `Class ${id}`,
    color: namesA.get(id)?.color ?? namesB.get(id)?.color ?? "#888888",
  }))
  if (!axis.length || !a.matrix.length || !b.matrix.length) return null

  /** `[referenceClass][predictedClass]` shares on the union axis; null is not measured. */
  const sharesOf = (agreement: LULCAgreement) => {
    const at = new Map(agreement.matrix_classes.map((id, i) => [id, i]))
    return axis.map((refClass) => {
      const j = at.get(refClass.id)
      if (j == null) return axis.map(() => null)
      let total = 0
      for (const row of agreement.matrix) total += row[j] ?? 0
      if (!total) return axis.map(() => null)
      return axis.map((predClass) => {
        const i = at.get(predClass.id)
        return i == null ? null : ((agreement.matrix[i]?.[j] ?? 0) / total) * 100
      })
    })
  }
  const grids = [
    { letter: "A", label: labelA, shares: sharesOf(a) },
    { letter: "B", label: labelB, shares: sharesOf(b) },
  ]
  const rows = axis
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => grids.some((g) => g.shares[i]?.some((v) => v != null)))

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-meta">
        <thead>
          <tr>
            <th />
            {grids.map((g, k) => (
              <th
                key={g.letter}
                colSpan={axis.length}
                className={cn("pb-1 text-left font-normal", k > 0 && "pl-3")}
              >
                <SideTag letter={g.letter} label={g.label} />
              </th>
            ))}
          </tr>
          <tr>
            <th />
            {grids.map((g, k) =>
              axis.map((c, j) => (
                <th
                  key={`${g.letter}-${c.id}`}
                  className={cn("p-0 font-normal", k > 0 && j === 0 && "pl-3")}
                  title={`Called ${c.name}`}
                >
                  <span
                    className="mx-auto block size-3 rounded-xs"
                    style={{ backgroundColor: c.color }}
                  />
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c: rowClass, i }) => (
            <tr key={rowClass.id}>
              <th
                className="max-w-[9rem] pr-2 text-left font-normal"
                title={rowClass.name}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ backgroundColor: rowClass.color }}
                    aria-hidden
                  />
                  <span className="truncate text-label text-foreground">
                    {rowClass.name}
                  </span>
                </span>
              </th>
              {grids.map((g, k) =>
                axis.map((colClass, j) => {
                  const v = g.shares[i]?.[j] ?? null
                  const t = v == null ? 0 : v / 100
                  const diag = rowClass.id === colClass.id && v != null
                  return (
                    <td
                      key={`${g.letter}-${colClass.id}`}
                      className={cn("p-0", k > 0 && j === 0 && "pl-3")}
                    >
                      <div
                        className={cn(
                          "telemetry flex size-7 items-center justify-center rounded-xs",
                          diag && "ring-1 ring-[rgb(var(--p-text)/0.7)]"
                        )}
                        style={{
                          background:
                            v == null
                              ? "transparent"
                              : v > 0
                                ? rampStop(READING_RAMP, t)
                                : "rgb(var(--p-line) / 0.1)",
                        }}
                        title={
                          v == null
                            ? `${rowClass.name}: not measured in ${g.label}`
                            : `${rowClass.name} called ${colClass.name}: ${v.toFixed(1)}%, in ${g.label}`
                        }
                      >
                        <span
                          className={
                            v != null && v > 0 ? undefined : "text-muted-foreground"
                          }
                          style={
                            v != null && v > 0 ? { color: rampLabel(t) } : undefined
                          }
                        >
                          {v == null ? "" : v >= 0.5 ? v.toFixed(0) : "·"}
                        </span>
                      </div>
                    </td>
                  )
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A or B, and the run it stands for: the mark the whole reading uses. */
export function SideTag({ letter, label }: { letter: string; label?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[rgb(var(--p-surface-raised))] text-micro font-semibold text-foreground">
        {letter}
      </span>
      {label && <span className="truncate text-label text-foreground">{label}</span>}
    </span>
  )
}

/**
 * How two runs classify the same legend, against each other.
 *
 * Which of them gets a class right, and which class does the other lose: a run
 * measured against MapBiomas carries a producer's and a user's accuracy per
 * class and the quantity/allocation split over the whole map, so the two can
 * be read against each other without opening one, remembering, and opening the
 * other.
 *
 * EACH FIGURE GIVES BOTH VALUES AND WHAT THE CHANGE MEANS. The three whole-map
 * figures were a signed number each, red or green, with nothing to say that a
 * red +86.3 under Quantity was disagreement rising rather than accuracy: the
 * colour carried the meaning alone. Each now shows A's value, B's, the change
 * in percentage points, and the word -- better or worse -- in that colour.
 *
 * Classes only one side measured are listed and left blank rather than
 * dropped: a class B found and A did not is a finding, and a row that vanishes
 * hides it.
 */
export function AgreementDelta({
  a,
  b,
  labelB,
}: {
  a: LULCAgreement
  b: LULCAgreement
  labelA: string
  labelB: string
}) {
  /* Paired by class id, not by position: two areas do not list one legend in one order. */
  const byId = new Map(b.per_class.map((c) => [c.class_id, c]))
  const rows = a.per_class
    .map((ca) => ({ ca, cb: byId.get(ca.class_id) ?? null }))
    .filter((r) => r.ca.producers_pct != null || r.ca.users_pct != null || r.cb)
  const onlyB = b.per_class.filter(
    (cb) => !a.per_class.some((ca) => ca.class_id === cb.class_id)
  )
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {/*
        Overall says whether B agrees with the reference more often; quantity
        and allocation say whether a change came from a different AMOUNT of a
        class or the same amount in different PLACES, the split Pontius and
        Millones propose, which tells a model change from a registration one.
      */}
      <div className="grid grid-cols-3 gap-2">
        <DeltaFigure label="Agreement" a={a.overall_pct} b={b.overall_pct} />
        <DeltaFigure
          label="Quantity disagreement"
          a={a.quantity_disagreement_pct}
          b={b.quantity_disagreement_pct}
          betterWhenLower
        />
        <DeltaFigure
          label="Allocation disagreement"
          a={a.allocation_disagreement_pct}
          b={b.allocation_disagreement_pct}
          betterWhenLower
        />
      </div>

      <table className="w-full text-label">
        <thead>
          <tr className="text-meta text-muted-foreground">
            <th className="pb-1.5 text-left font-normal">Class</th>
            <th
              className="w-24 pb-1.5 text-right font-normal"
              title="Of the reference class, the share the run found"
            >
              Producer&apos;s
            </th>
            <th
              className="w-24 pb-1.5 text-right font-normal"
              title="Of what the run called the class, the share that was"
            >
              User&apos;s
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgb(var(--p-line)/0.25)]">
          {rows.map(({ ca, cb }) => (
            <tr key={ca.class_id}>
              <td className="py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ backgroundColor: ca.color }}
                    aria-hidden
                  />
                  <span className="truncate text-foreground">{ca.name}</span>
                </span>
              </td>
              <DeltaCell a={ca.producers_pct} b={cb?.producers_pct} />
              <DeltaCell a={ca.users_pct} b={cb?.users_pct} />
            </tr>
          ))}
          {onlyB.map((cb) => (
            <tr key={`b-${cb.class_id}`}>
              <td className="py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ backgroundColor: cb.color }}
                    aria-hidden
                  />
                  <span className="truncate text-foreground">{cb.name}</span>
                </span>
              </td>
              <td
                colSpan={2}
                className="py-1.5 text-right text-meta text-muted-foreground"
                title={`Only ${labelB} measured this class`}
              >
                only in B
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtPct(v?: number | null): string {
  return typeof v === "number" ? `${v.toFixed(1)}%` : "not measured"
}

/** A whole-map figure: A's value and B's, the change, and whether it is better. */
function DeltaFigure({
  label,
  a,
  b,
  betterWhenLower,
}: {
  label: string
  a?: number | null
  b?: number | null
  betterWhenLower?: boolean
}) {
  const value = typeof a === "number" && typeof b === "number" ? b - a : null
  const same = value == null || Math.abs(value) < 0.05
  const good = value != null && (betterWhenLower ? value < 0 : value > 0)
  return (
    <div className="min-w-0 rounded-md border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))] px-3 py-2.5">
      <p className="truncate text-meta text-muted-foreground" title={label}>
        {label}
      </p>
      <p className="telemetry mt-1 truncate text-heading text-foreground tabular-nums">
        {value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
        {value != null && <span className="text-meta text-muted-foreground"> pp</span>}
      </p>
      <p className="telemetry mt-0.5 truncate text-meta text-muted-foreground">
        {fmtPct(a)} → {fmtPct(b)}
      </p>
      {!same && (
        <p
          className={cn(
            "mt-1 text-meta font-medium",
            good ? "text-success" : "text-destructive-quiet"
          )}
        >
          {good ? "Better in B" : "Worse in B"}
        </p>
      )}
    </div>
  )
}

/**
 * One per-class change, B minus A, coloured by direction and carrying both
 * values in its title. A higher accuracy is better in either column.
 */
function DeltaCell({ a, b }: { a?: number | null; b?: number | null }) {
  const value = typeof a === "number" && typeof b === "number" ? b - a : null
  return (
    <td
      title={`${fmtPct(a)} → ${fmtPct(b)}`}
      className={cn(
        "telemetry py-1.5 text-right tabular-nums",
        value == null
          ? "text-muted-foreground"
          : Math.abs(value) < 0.05
            ? "text-muted-foreground"
            : value > 0
              ? "text-success"
              : "text-destructive-quiet"
      )}
    >
      {value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
    </td>
  )
}
