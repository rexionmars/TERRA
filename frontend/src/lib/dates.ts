/**
 * The acquisition calendar.
 *
 * Every product on the map screen selects scenes that have already been
 * acquired, so the calendar has a right edge and it is today. A period ending
 * in the future is not a wider search: the listing returns the same scenes and
 * the run reports a date range the data does not cover.
 */

export const DAY_MS = 86_400_000

/** Today as a UTC day number, which is what the period track works in. */
export function todayDay(): number {
  return Math.floor(Date.now() / DAY_MS)
}

/**
 * Today as YYYY-MM-DD, for the `max` of a date field.
 *
 * UTC, matching the day arithmetic the track uses, so a field and the track
 * cannot disagree about where the calendar ends by one day.
 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
