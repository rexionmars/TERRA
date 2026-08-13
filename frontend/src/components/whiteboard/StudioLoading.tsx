/**
 * What stands where the studio is going to be, while it is not there yet.
 *
 * TWO WAITS, and they are different lengths. The first is the code: the studio
 * is a lazy chunk carrying three.js, so the first open of a session downloads
 * and parses it before any of this file's neighbours exist. The second is the
 * rasters: every plane is a data URI decoded into a texture, and a board of
 * four areas carries a dozen.
 *
 * Until now the first wait showed NOTHING -- `Suspense fallback={null}` -- and
 * the second showed an empty board. The plan this surface comes from named the
 * problem when the studio was first designed and it was never built: a blank
 * frame between the press and the board reads as a button that did not work.
 * That is the whole argument. A reader who presses a control and sees no
 * change presses it again.
 *
 * SAYS WHICH WAIT IT IS. "Loading the studio" and "Placing 3 of 11 rasters"
 * are different answers to "why am I waiting", and only the second has an end
 * a reader can see coming. The first cannot be measured -- a chunk download
 * reports bytes, not readiness -- so it does not pretend to.
 *
 * PAINTED IN THE BOARD'S OWN INK, so the arrival is the board appearing rather
 * than one surface being swapped for another.
 */

export function StudioLoading({
  loaded,
  total,
}: {
  /** Omitted while the chunk is still downloading, which cannot be measured. */
  loaded?: number
  total?: number
}) {
  const measured = typeof loaded === "number" && typeof total === "number" && total > 0
  // Clamped, as the status bar's own progress is. The counter cannot exceed
  // its total today, and a width of 109% would be a silent overflow tomorrow.
  const pct = measured
    ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
    : 0

  return (
    <div
      // Fills whatever it is given: both callers position it themselves, one
      // over the whole studio and one over the areas alone.
      className="flex h-full w-full flex-col items-center justify-center gap-3"
      style={{ background: "rgb(var(--p-ink))" }}
      role="status"
      aria-live="polite"
    >
      {/*
        The board's own grid, faint, rather than a spinner.

        A spinner says only that something is happening; this says WHAT is
        coming. The studio's ground is a grid and a horizon, so a few lines of
        it are the cheapest honest promise of the surface being built.
      */}
      <svg
        viewBox="0 0 120 60"
        className="w-40 text-muted-foreground/25"
        aria-hidden
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={`h${i}`}
            x1={0}
            x2={120}
            y1={12 + i * 11}
            y2={12 + i * 11}
            stroke="currentColor"
            strokeWidth={0.5}
          />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <line
            key={`v${i}`}
            x1={10 + i * 16.6}
            x2={60 + (i - 3) * 5}
            y1={56}
            y2={12}
            stroke="currentColor"
            strokeWidth={0.5}
          />
        ))}
      </svg>

      <p className="text-meta text-muted-foreground">
        {measured
          ? `Placing ${loaded} of ${total} ${total === 1 ? "raster" : "rasters"}`
          : "Loading the studio"}
      </p>

      {/*
        A bar only where there is something to measure. An indeterminate bar
        that sweeps is a spinner wearing a bar's clothes, and it would promise
        a proportion the download cannot report.
      */}
      {measured && (
        <span
          className="h-1 w-40 overflow-hidden rounded-full"
          style={{ background: "rgb(var(--p-line) / 0.35)" }}
          aria-hidden
        >
          <span
            className="block h-full bg-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  )
}
