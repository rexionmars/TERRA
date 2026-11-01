import { CaretRight, X } from "@/components/icons"
import { cn } from "@/lib/utils"

export interface Crumb {
  label: string
  /** Absent on the crumb that names where the reader is. */
  onClick?: () => void
}

/**
 * The one panel over the map.
 *
 * ONE, BY CONSTRUCTION. The shell holds a single value saying which is open, so
 * opening one closes the last rather than stacking or dividing the window; the
 * map stays the ground and a panel is something held up in front of it.
 *
 * Right of it is the tool column and under it the credit line, whose licences
 * ask that it stay reachable, so it stops short of both.
 */
export function ShellPanel({
  crumbs,
  onClose,
  footer,
  wide = false,
  bare = false,
  panelRef,
  children,
}: {
  crumbs: readonly Crumb[]
  onClose: () => void
  footer?: React.ReactNode
  /** For a reading with a figure across it, which the column's width cannot hold. */
  wide?: boolean
  /** For content that lays out and scrolls itself. */
  bare?: boolean
  /** For a popover inside the panel, which is portalled here and clamped to it. */
  panelRef?: (el: HTMLElement | null) => void
  children: React.ReactNode
}) {
  return (
    <aside
      ref={panelRef}
      aria-label={crumbs[crumbs.length - 1]?.label}
      className={cn(
        "panel app-no-drag absolute bottom-10 right-[3.5rem] top-3 z-[450] flex max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-md shadow-[0_10px_32px_rgb(0_0_0/0.45)]",
        wide ? "w-[44rem]" : "w-[26rem]"
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border pl-4 pr-2">
        <nav aria-label="Panel path" className="flex min-w-0 flex-1 items-center gap-1.5">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <span key={c.label} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <CaretRight className="size-3 shrink-0 text-muted-foreground" />}
                {c.onClick ? (
                  <button
                    type="button"
                    onClick={c.onClick}
                    className="truncate text-title text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {c.label}
                  </button>
                ) : (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={cn(
                      "truncate text-title",
                      last ? "font-medium text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            )
          })}
        </nav>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div
        className={cn(
          "min-h-0 flex-1",
          bare ? "overflow-hidden" : "panel-scroll overflow-y-auto px-4 py-3"
        )}
      >
        {children}
      </div>
      {footer && <footer className="shrink-0 border-t border-border p-3">{footer}</footer>}
    </aside>
  )
}

/** A section's heading inside a panel. */
export function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-read font-medium text-foreground">{children}</h3>
}

/**
 * One part of a long reading, which the reader opens as it is wanted.
 *
 * A column of eleven tables is read by scrolling past ten of them, which is what
 * the mineral map's cards were made to stop. Native, so the keyboard and a screen
 * reader already know what it is.
 */
export function PanelSection({
  title,
  open = false,
  children,
}: {
  title: string
  open?: boolean
  children: React.ReactNode
}) {
  return (
    <details open={open} className="group border-t border-border py-2 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-read font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <CaretRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="flex flex-col gap-1.5 pb-1 pl-[1.125rem] pt-2">{children}</div>
    </details>
  )
}

/** A choice between a few named values, where a menu would hide all but one. */
export function PanelChoices<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { id: T; label: string; title?: string; disabled?: boolean }[]
  onChange: (id: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const chosen = o.id === value
        return (
          <button
            key={String(o.id)}
            type="button"
            aria-pressed={chosen}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-sm px-2 py-1 text-label transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              chosen
                ? "bg-[rgb(var(--p-surface-raised))] text-foreground"
                : "text-muted-foreground hover:bg-hover hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The limit on reading what is above it. */
export function PanelLimit({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-border bg-[rgb(var(--p-control))] px-3 py-2 text-label text-muted-foreground">
      {children}
    </p>
  )
}

/** Nothing to show, and what would put something there. */
export function PanelEmpty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-title font-medium text-foreground">{title}</p>
      <p className="text-read text-muted-foreground">{children}</p>
    </div>
  )
}
