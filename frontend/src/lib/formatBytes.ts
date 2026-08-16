/**
 * Bytes as something a person can compare.
 *
 * Binary units, since that is what a file manager reports and a figure here
 * that disagrees with Finder reads as a bug in the screen showing it. One
 * decimal below 10 units, none above: "1.4 GB" is worth the digit, "847.3 MB"
 * is not.
 *
 * Shared rather than duplicated: the settings row and the storage modal show
 * the same numbers, and two copies of a formatter drift into two different
 * answers for one file.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value < 10 && unit > 0 ? 1 : 0
  return `${value.toFixed(digits)} ${units[unit]}`
}
