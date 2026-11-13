import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A card on the page's ground, as the catalogue's model cards are: the ink a
 * step below the frame, a hairline at the line colour, the container radius.
 */
export const CARD =
  "rounded-md border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))]"

/*
  SETTINGS ARE GROUPED INTO CARDS, ONE ROW PER SETTING: what it is and what it
  does on the left, the control on the right, so the eye runs down one column
  of names and another of states. The rows were a list down a hairline, each a
  title, a paragraph and a control under it, which made a page of twelve
  settings three screens long and put every control at a different height.
*/
export function SettingGroup({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="mt-10 first:mt-0">
      <h3 className="text-heading font-medium text-foreground">{title}</h3>
      {description && (
        <p className="mt-0.5 max-w-prose text-label text-muted-foreground">
          {description}
        </p>
      )}
      <div className={cn(CARD, "mt-3 divide-y divide-[rgb(var(--p-line)/0.3)]")}>
        {children}
      </div>
    </section>
  )
}

export function SettingRow({
  title,
  description,
  children,
  stacked = false,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  /** The control under the text, for one wider than the column beside it. */
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-x-8 gap-y-3 px-5 py-4",
        stacked ? "flex-col" : "flex-wrap items-center justify-between"
      )}
    >
      <div className="min-w-0 flex-1 basis-72">
        <p className="text-read font-medium text-foreground">{title}</p>
        {description && (
          <div className="mt-0.5 max-w-prose text-label text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {children !== undefined && (
        <div className={cn("min-w-0", !stacked && "shrink-0")}>{children}</div>
      )}
    </div>
  )
}

/**
 * One choice among a few, all in view: a track with the chosen one raised.
 * A radio group to assistive technology, which is what it is.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-full bg-[rgb(var(--p-sunk))] p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1 text-label transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
            o.value === value
              ? "bg-[rgb(var(--p-surface-raised))] text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
