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
export function PanelSection({
  step,
  title,
  children,
}: {
  step?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {step && (
          <span className="telemetry text-[10px] text-primary">{step}</span>
        )}
        <span className="eyebrow !text-foreground">{title}</span>
      </div>
      {children}
    </div>
  )
}
