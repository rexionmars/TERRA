import { CaretLeft, CaretRight, X } from "@/components/icons"
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
  const parents = crumbs.slice(0, -1)
  const place = crumbs[crumbs.length - 1]
  /*
    THE WAY BACK IS A CONTROL, NOT ONLY A WORD. The path above the title steps
    back too, but it is a 10px label in the muted tone, and a reader inside a
    product did not find it: the only control in sight was the one that closes
    the panel. So the nearest step back is also a button the size of that one,
    on the other side of the header, where a way back is looked for.
  */
  const back = [...parents].reverse().find((c) => c.onClick)
  return (
    <aside
      ref={panelRef}
      aria-label={place?.label}
      className={cn(
        "map-chrome map-chrome-panel app-no-drag absolute top-[calc(var(--frame-reach,0px)+0.75rem)] right-[3.5rem] bottom-10 z-450 flex max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)] shadow-[0_2px_8px_rgb(0_0_0/0.28)]",
        wide ? "w-[44rem]" : "w-[26rem]"
      )}
    >
      <header
        className={cn(
          "flex h-12 shrink-0 items-center gap-1.5 border-b border-border pr-2",
          back ? "pl-2" : "pl-4"
        )}
      >
        {back && (
          <button
            type="button"
            onClick={back.onClick}
            aria-label={`Back to ${back.label}`}
            title={`Back to ${back.label}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <CaretLeft className="size-4" />
          </button>
        )}
        {/*
          TWO LINES: THE PATH IN TELEMETRY, THE PLACE IN DISPLAY. The path is
          where the panel sits, a small label to step back along; the place is
          what the reader came to, so it alone is set large, in the face of
          the mark.
        */}
        <nav
          aria-label="Panel path"
          className="flex min-w-0 flex-1 flex-col justify-center gap-1"
        >
          {parents.length > 0 && (
            <span className="eyebrow flex min-w-0 items-center gap-1 leading-none">
              {parents.map((c, i) => (
                <span key={c.label} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <span aria-hidden>/</span>}
                  {c.onClick ? (
                    <button
                      type="button"
                      onClick={c.onClick}
                      className="truncate uppercase underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    >
                      {c.label}
                    </button>
                  ) : (
                    <span className="truncate">{c.label}</span>
                  )}
                </span>
              ))}
            </span>
          )}
          <span
            aria-current="page"
            className="truncate font-display text-title leading-tight font-semibold text-foreground"
          >
            {place?.label}
          </span>
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
      {footer && (
        <footer className="shrink-0 border-t border-border p-3">{footer}</footer>
      )}
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
      <div className="flex flex-col gap-1.5 pt-2 pb-1 pl-[1.125rem]">{children}</div>
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
              // The tool column's lit button, in the accent's text colour.
              chosen
                ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-accent-quiet"
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
    <p className="rounded-sm border border-border px-3 py-2 text-label text-muted-foreground">
      {children}
    </p>
  )
}

/** Nothing to show, and what would put something there. */
export function PanelEmpty({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-title font-medium text-foreground">{title}</p>
      <p className="text-read text-muted-foreground">{children}</p>
    </div>
  )
}
