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
import type { LULCAgreement, LULCClassAccuracy } from "@/lib/types"

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
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {c.name}
        </span>
        <span className="telemetry shrink-0 text-[9px] tabular-nums text-muted-foreground">
          n={c.n_reference.toLocaleString()}
        </span>
      </span>
      {/*
        A viewBox in data units: x is the percentage itself, so no arithmetic
        maps value to position. preserveAspectRatio="none" lets the row stretch
        horizontally while non-scaling-stroke keeps every line one hairline
        wide -- without it, stretching would thicken the verticals and leave
        the horizontals thin.
      */}
      <svg
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        className="h-3 w-full overflow-visible"
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
          const y = marks.length === 1 ? 6 : k === 0 ? 3.5 : 8.5
          const lo = m.ci ? Math.max(0, m.ci[0]) : null
          const hi = m.ci ? Math.min(100, m.ci[1]) : null
          return (
            <g key={m.kind}>
              {lo != null && hi != null && (
                <>
                  <line
                    x1={lo}
                    x2={hi}
                    y1={y}
                    y2={y}
                    stroke={c.color}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Serifs, so the interval reads as bounded rather than as a
                      line that happens to stop. */}
                  {[lo, hi].map((x) => (
                    <line
                      key={x}
                      x1={x}
                      x2={x}
                      y1={y - 2}
                      y2={y + 2}
                      stroke={c.color}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </>
              )}
              {/*
                Producer's filled, user's open. The pair is told apart by fill
                rather than by colour, leaving the class colour to mean the
                class.
              */}
              <circle
                cx={m.v!}
                cy={y}
                r={2.2}
                fill={k === 0 ? c.color : "rgb(var(--p-surface))"}
                stroke={c.color}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>
    </li>
  )
}

/** The shared axis, drawn once beneath the rows it governs. */
function AccuracyAxis() {
  return (
    <div className="relative mt-1 h-3 w-full">
      <div
        className="absolute inset-x-0 top-0 border-t"
        style={{ borderColor: "rgb(var(--p-line-strong) / 0.45)" }}
        aria-hidden
      />
      {[0, 50, 100].map((t) => (
        <span
          key={t}
          className="telemetry absolute top-0.5 text-[8px] tabular-nums text-muted-foreground"
          style={{
            left: `${t}%`,
            // The end labels are pulled inside the axis rather than centred on
            // it: a centred "100" hangs half its width past the right edge and
            // is clipped by the column.
            transform:
              t === 0
                ? "none"
                : t === 100
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
          }}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

export function ClassAccuracyChart({
  classes,
}: {
  classes: LULCClassAccuracy[]
}) {
  // Classes the reference never sampled carry no accuracy in either direction.
  // Dropped rather than drawn as rows of dashes: a list of absences spends the
  // column's scarcest resource on nothing.
  const measured = classes.filter(
    (c) => c.producers_pct != null || c.users_pct != null
  )
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
        <p className="eyebrow !text-[9px] truncate">Accuracy by class</p>
        <span className="telemetry flex items-center gap-1 whitespace-nowrap text-[8px] text-muted-foreground">
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
export function DisagreementBar({ a }: { a: LULCAgreement }) {
  const quantity = Math.max(0, a.quantity_disagreement_pct)
  const allocation = Math.max(0, a.allocation_disagreement_pct)
  // Taken from the reported total rather than as 100 minus the other two: the
  // three are computed independently and a rounding gap should show as a gap
  // rather than be silently absorbed into agreement.
  const agree = Math.max(0, Math.min(100, a.overall_pct))
  const total = agree + quantity + allocation || 100
  const parts = [
    { key: "agree", label: "agreement", v: agree, fill: "rgb(var(--p-accent))" },
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
        <p className="eyebrow !text-[9px] truncate">Agreement with MapBiomas</p>
        <span className="telemetry whitespace-nowrap text-[9px] tabular-nums text-foreground">
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
            <rect width="2" height="2" fill="rgb(var(--p-accent) / 0.18)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="2"
              stroke="rgb(var(--p-accent))"
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
      <div className="telemetry flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground">
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
export function ConfusionMatrix({
  a,
  title,
}: {
  a: LULCAgreement
  title?: string
}) {
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
      {title && <p className="eyebrow !text-[9px] truncate">{title}</p>}
      <p className="text-[10px] leading-snug text-muted-foreground">
        Rows = MapBiomas reference · columns = this run. Off-diagonal cells are
        the pairs actually confused.
      </p>
      <div className="min-w-0 overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[9px]">
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
                    className="telemetry block h-24 max-h-24 overflow-hidden whitespace-nowrap text-left text-[9px] text-muted-foreground"
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
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: rowClass.color }}
                      aria-hidden
                    />
                    <span className="truncate text-[10px] text-muted-foreground">
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
                        className="telemetry flex min-h-[1.6rem] min-w-[1.6rem] items-center justify-center rounded-[2px] px-1"
                        style={{
                          background:
                            cell > 0
                              ? `rgb(var(--p-accent) / ${0.15 + t * 0.65})`
                              : "rgb(var(--p-line) / 0.08)",
                          boxShadow: diag
                            ? "inset 0 0 0 1px rgb(var(--p-line-strong) / 0.9)"
                            : undefined,
                        }}
                        title={`${rowClass.name} → ${colClass.name}: ${cell.toLocaleString()} cells`}
                      >
                        <span
                          className={
                            t > 0.55 ? "text-background" : "text-foreground"
                          }
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
