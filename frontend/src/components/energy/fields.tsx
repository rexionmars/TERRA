/**
 * The fields a solar parameter takes, and the notes that qualify them.
 *
 * They were duplicated per product on a left-dock panel, which is how one
 * product ended up reading another product's progress channel. One definition
 * each, taking the value it renders and nothing else.
 *
 * What was beside them -- a run button, a progress bar, an output placeholder --
 * did not come across when the energy screen went. The run band draws the
 * button and reports the progress for every product now, so a second pair here
 * would be a second answer to one question.
 */

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
      />
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
      />
    </label>
  )
}

/** Explanatory paragraph under a group of controls. */
export function FieldNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

/**
 * The note raised when a parameter shared with another product is edited.
 *
 * Marked as a status region so a change reaches assistive technology without
 * moving focus: the note appears in response to typing in the field above it.
 */
export function SharedParameterNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-sm border border-primary/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground"
    >
      {children}
    </p>
  )
}

