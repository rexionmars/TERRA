/**
 * Heading for a block of controls.
 *
 * Defined once. This markup was duplicated byte for byte across three panels of
 * the screens that are gone, so a change to the idiom had to be made three
 * times and could be made in two.
 *
 * `step` is optional and is what distinguishes a sequence from a set. A panel
 * whose sections are independently runnable products passes none, because
 * numbering them would assert an order that does not exist.
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
