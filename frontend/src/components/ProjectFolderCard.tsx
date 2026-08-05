import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"

function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M2 10.5C2 8.567 3.567 7 5.5 7H16.2c.7 0 1.37.3 1.84.82L20.5 10.5H42.5c1.933 0 3.5 1.567 3.5 3.5V32.5c0 1.933-1.567 3.5-3.5 3.5h-37C3.567 36 2 34.433 2 32.5V10.5Z"
        fill="rgb(var(--p-accent) / 0.16)"
        stroke="rgb(var(--p-accent) / 0.75)"
        strokeWidth="1.25"
      />
      <path
        d="M2 16H46"
        stroke="rgb(var(--p-accent))"
        strokeWidth="1"
        opacity="0.28"
      />
    </svg>
  )
}

export function ProjectFolderCard({
  project,
  onOpen,
  selected,
  className,
}: {
  project: Project
  onOpen: () => void
  selected?: boolean
  className?: string
}) {
  const runs = project.run_count ?? 0
  const overlays = project.overlay_count ?? 0

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col text-left transition-colors",
        selected ? "ar-select" : "ar-raised hover:brightness-110",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
        className
      )}
    >
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-4 pt-5 pb-2"
        style={{
          background: "var(--ar-bg, rgb(var(--p-ink)))",
          borderBottom: "1px solid var(--ar-border, rgb(var(--p-line) / 0.35))",
        }}
      >
        <FolderGlyph className="h-14 w-[4.25rem] shrink-0 transition-transform group-hover:scale-[1.04]" />
      </div>
      <div className="mt-auto min-w-0 px-3.5 py-3">
        <p className="truncate font-display text-sm font-semibold tracking-wide text-foreground">
          {project.name}
        </p>
        {/*
          On the selection background muted text measures 3.41:1, below WCAG
          1.4.3. Selected cards therefore use the full-contrast text color
          (9.54:1), which is also the conventional treatment for a selected row.
        */}
        <p
          className={cn(
            "telemetry mt-1 text-[10px]",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {runs} {runs === 1 ? "analysis" : "analyses"} · {overlays}{" "}
          {overlays === 1 ? "overlay" : "overlays"}
          {project.label ? ` · ${project.label}` : ""}
        </p>
      </div>
    </button>
  )
}
