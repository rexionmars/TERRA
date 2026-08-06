import { forwardRef } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export type LeftDockPanel = "classify" | "compose" | "water" | "solar"

const TABS: { id: LeftDockPanel; label: string }[] = [
  { id: "classify", label: "New classification" },
  { id: "compose", label: "Compositions" },
  { id: "water", label: "Surface water" },
  { id: "solar", label: "Solar resource" },
]

interface LeftDockRailProps {
  active: LeftDockPanel | null
  onSelect: (id: LeftDockPanel) => void
}

/**
 * Vertical rectangular dock tabs with panel names (always on the left edge).
 * Click opens that panel; click the active tab again to hide.
 */
export const LeftDockRail = forwardRef<HTMLDivElement, LeftDockRailProps>(
  function LeftDockRail({ active, onSelect }, ref) {
    return (
      <motion.div
        ref={ref}
        className="app-no-drag absolute left-3 top-3 z-[1001] flex flex-col gap-1.5"
        initial={{ opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -14 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.label}
              aria-pressed={isActive}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "left-dock-tab panel flex h-[7.5rem] w-8 items-center justify-center rounded-sm px-0 py-2 text-[11px] font-medium tracking-wide transition-colors",
                isActive
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <span className="left-dock-tab-label">{tab.label}</span>
            </button>
          )
        })}
      </motion.div>
    )
  }
)
