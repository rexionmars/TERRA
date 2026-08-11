/**
 * Heading for a block of controls inside a left-dock panel.
 *
 * Defined once. This markup was duplicated byte for byte in the classification,
 * surface-water and solar panels, so a change to the panel idiom had to be made
 * three times and could be made in two.
 *
 * `step` is optional and is what distinguishes a sequence from a set. The
 * classification and surface-water panels number their sections because they
 * are stages of one run: an area, then a period, then a model, then a single
 * action. A panel whose sections are independently runnable products passes no
 * step, because numbering them would assert an order that does not exist.
 */
import { useCompactPanel } from "@/components/ui/PanelDensity"
import { cn } from "@/lib/utils"
export function PanelSection({
  step,
  title,
  children,
}: {
  step?: string
  title: string
  children: React.ReactNode
}) {
  /*
    Tighter where the container asked for it. The heading keeps its step
    number: it says this is stage two of four, which is as true in a column as
    in a panel -- what changes is how much air it is given, not what it says.
  */
  const compact = useCompactPanel()
  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      <div className="flex items-center gap-1.5">
        {step && (
          <span
            className={cn(
              "telemetry text-primary",
              compact ? "text-[9px]" : "text-[10px]"
            )}
          >
            {step}
          </span>
        )}
        <span
          className={cn("eyebrow !text-foreground", compact && "!text-[9px]")}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}
