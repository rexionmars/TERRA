import { useEffect } from "react"
import type { WhatsNewEntry } from "@/lib/whatsNew"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { btnPrimary } from "@/components/ui/buttons"

interface WhatsNewModalProps {
  currentVersion: string
  entries: WhatsNewEntry[]
  onContinue: () => void
}

export function WhatsNewModal({
  currentVersion,
  entries,
  onContinue,
}: WhatsNewModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault()
        onContinue()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onContinue])

  return (
    <ModalShell
      onDismiss={onContinue}
      labelledBy="whats-new-title"
      className="w-full max-w-lg"
    >
      <ModalHeader
        eyebrow="WHAT’S NEW"
        titleId="whats-new-title"
        title={`What’s new in ${currentVersion}`}
        subtitle="Highlights since your last update."
        onClose={onContinue}
      />

        <div className="flex max-h-[min(28rem,60vh)] flex-col gap-3 overflow-y-auto bg-panel p-4">
          {entries.map((entry) => (
            <section key={entry.version} className="rounded-sm border border-border bg-secondary/50 p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <p className="eyebrow !text-foreground">{entry.title}</p>
                <span className="telemetry text-meta text-muted-foreground">
                  v{entry.version}
                </span>
              </div>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-emphasis text-muted-foreground">
                {entry.items.map((item) => (
                  <li key={item} className="marker:text-primary/80">
                    <span className="text-foreground/90">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            autoFocus
            onClick={onContinue}
            className={btnPrimary}
          >
            Continue
          </button>
        </div>
    </ModalShell>
  )
}
