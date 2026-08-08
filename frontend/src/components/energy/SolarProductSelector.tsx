/**
 * Which photovoltaic product the left column configures, and what it returns.
 *
 * Driven from the product table, not from markup per product: the marker beside
 * each label is the first of the three statements of output kind the screen
 * makes before anything is run, and it has to agree with the other two.
 *
 * A radio group rather than a set of buttons, because the four are exclusive
 * alternatives: the column below configures exactly one of them. The role is
 * only a name for that, so the arrow-key movement and the single tab stop the
 * role promises are implemented here; the ARIA attribute alone would announce
 * a behaviour that does not exist.
 */
import { useRef } from "react"
import { CheckCircle2 } from "lucide-react"
import type { SolarProductId, SolarResults } from "@/lib/energyState"
import { cn } from "@/lib/utils"
import { PanelSection } from "@/components/ui/PanelSection"
import { SOLAR_PRODUCTS, outputKindLabel } from "./solarProducts"

export function SolarProductSelector({
  selected,
  onSelect,
  results,
  running,
}: {
  selected: SolarProductId
  onSelect: (id: SolarProductId) => void
  /** Held results, so a product that already has one is marked in the list. */
  results: SolarResults
  running: SolarProductId | null
}) {
  const refs = useRef<Partial<Record<SolarProductId, HTMLButtonElement | null>>>(
    {}
  )

  // Selection follows focus, per the ARIA radio group pattern: moving within
  // the group selects, and the group is left with Tab.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = SOLAR_PRODUCTS.findIndex((p) => p.id === selected)
    let next: number
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (current + 1) % SOLAR_PRODUCTS.length
        break
      case "ArrowUp":
      case "ArrowLeft":
        next = (current - 1 + SOLAR_PRODUCTS.length) % SOLAR_PRODUCTS.length
        break
      case "Home":
        next = 0
        break
      case "End":
        next = SOLAR_PRODUCTS.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    const id = SOLAR_PRODUCTS[next].id
    onSelect(id)
    refs.current[id]?.focus()
  }

  return (
    <PanelSection title="Product">
      <div role="radiogroup" aria-label="Photovoltaic product" className="flex flex-col gap-1.5">
        {SOLAR_PRODUCTS.map((p) => {
          const active = selected === p.id
          const held = !!results[p.id]
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              // Roving tabindex: the group is one tab stop.
              tabIndex={active ? 0 : -1}
              ref={(el) => {
                refs.current[p.id] = el
              }}
              onClick={() => onSelect(p.id)}
              onKeyDown={onKeyDown}
              className={cn(
                "flex flex-col gap-0.5 rounded-sm border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-primary/60 bg-primary/10"
                  : "border-border hover:bg-secondary"
              )}
            >
              <span className="flex items-center gap-1.5 text-xs text-foreground">
                {held && (
                  <CheckCircle2
                    className="size-3 shrink-0 text-primary"
                    aria-hidden
                  />
                )}
                {p.label}
                {running === p.id && (
                  <span className="telemetry text-[9px] text-muted-foreground">
                    running
                  </span>
                )}
              </span>
              <span className="telemetry text-[10px] text-muted-foreground">
                {outputKindLabel(p)}
                {held ? " · result held" : ""}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        The four run independently and are not stages of one another. Two draw a
        raster over the AOI; two resolve the AOI at its centroid and return
        figures only. Each row states which.
      </p>
    </PanelSection>
  )
}
