/**
 * What the saved data is made of, at a size worth reading.
 *
 * This was a row in Account, which is a column about as wide as a sentence.
 * The subject is a table plus two breakdowns plus a list of every analysis, and
 * none of that fits beside a label -- so the settings row now reports the total
 * and opens this.
 *
 * Everything here is measured by walking the directory. The database records
 * what was saved, not what is on disk, and the two come apart after a failed
 * delete or a restore from an older archive. A storage screen is only worth
 * having if it is believed, so it reports what it can see.
 */
import { useMemo, useState } from "react"
import { CircleNotch, ArrowsClockwise, Trash } from "@phosphor-icons/react"
import { ModalShell, ModalHeader } from "@/components/ui/ModalShell"
import { btnGhost } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"
import { displayRunLabel } from "@/lib/aoiLabel"
import { formatBytes } from "@/lib/formatBytes"
import type { store } from "../../wailsjs/go/models"

type Tab = "overview" | "analyses" | "projects"

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "analyses", label: "Analyses" },
  { id: "projects", label: "Projects" },
]

export function StorageModal({
  report,
  busy,
  note,
  problem,
  onRefresh,
  onPurge,
  onClose,
}: {
  report: store.StorageReport
  busy: boolean
  note: string | null
  problem: string | null
  onRefresh: () => void
  onPurge: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>("overview")

  return (
    <ModalShell
      onDismiss={onClose}
      labelledBy="storage-modal-title"
      className="h-[min(78vh,720px)] w-[min(94vw,860px)]"
      // A measure or a purge is in flight; a stray click on the scrim should
      // not abandon a screen that is mid-change.
      dismissible={!busy}
    >
      <ModalHeader
        eyebrow="LOCAL DATA"
        title="Storage"
        titleId="storage-modal-title"
        subtitle={`${formatBytes(report.total_bytes)} in ${report.data_dir}`}
        onClose={onClose}
        actions={
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className={btnGhost}
          >
            <ArrowsClockwise className={cn("size-3.5", busy && "animate-spin")} />
            Measure again
          </button>
        }
      />

      <div className="flex shrink-0 gap-1 border-b border-border px-4 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "true" : undefined}
            className={cn(
              "nav-item px-2.5 py-1 text-emphasis",
              tab === t.id && "is-active"
            )}
          >
            {t.label}
            {t.id === "analyses" && report.runs.length > 0 && (
              <span className="telemetry ml-1.5 text-meta text-muted-foreground">
                {report.runs.length}
              </span>
            )}
            {t.id === "projects" && report.by_project.length > 0 && (
              <span className="telemetry ml-1.5 text-meta text-muted-foreground">
                {report.by_project.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {problem && (
          <p className="mb-3 rounded-sm border border-destructive-quiet/40 px-3 py-2 text-body text-destructive-quiet">
            {problem}
          </p>
        )}
        {note && (
          <p className="mb-3 rounded-sm border border-border px-3 py-2 text-body text-muted-foreground">
            {note}
          </p>
        )}

        {tab === "overview" && (
          <Overview report={report} busy={busy} onPurge={onPurge} />
        )}
        {tab === "analyses" && <Analyses report={report} />}
        {tab === "projects" && <Projects report={report} />}
      </div>
    </ModalShell>
  )
}

function Overview({
  report,
  busy,
  onPurge,
}: {
  report: store.StorageReport
  busy: boolean
  onPurge: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* The proportions before the numbers. Which of four things is most of
          the disk is the first question, and a bar answers it faster than a
          column of byte counts. */}
      <ProportionBar
        segments={report.buckets.map((b) => ({
          label: b.label,
          bytes: b.bytes,
        }))}
        total={report.total_bytes}
      />

      <Section title="Where it goes">
        <ul className="flex flex-col gap-1.5">
          {report.buckets.map((b) => (
            <li
              key={b.label}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-sm border border-border bg-sunk px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-body text-foreground">{b.label}</span>
                {/* What removing it would cost, beside the number. A size with
                    no stated consequence invites clearing it. */}
                <p className="text-micro text-muted-foreground">
                  {b.consequence}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="telemetry text-body text-foreground">
                  {formatBytes(b.bytes)}
                </span>
                <p className="telemetry text-micro text-muted-foreground">
                  {b.files} {b.files === 1 ? "file" : "files"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {report.by_kind.length > 0 && (
        <Section
          title="By analysis type"
          hint="Which kind of work the space belongs to."
        >
          <GroupTable groups={report.by_kind} total={report.total_bytes} />
        </Section>
      )}

      {report.by_file_type.length > 0 && (
        <Section
          title="By file type"
          hint="A GeoTIFF is the export-quality raster; a map overlay is what the map draws."
        >
          <GroupTable groups={report.by_file_type} total={report.total_bytes} />
        </Section>
      )}

      <Section title="Reclaimable">
        {report.orphan_count > 0 ? (
          <div className="rounded-sm border border-border bg-sunk px-3 py-2">
            <p className="text-body text-foreground">
              {formatBytes(report.orphan_bytes)} in {report.orphan_count}{" "}
              {report.orphan_count === 1 ? "folder" : "folders"} no analysis
              refers to.
            </p>
            <p className="mt-0.5 text-micro text-muted-foreground">
              Left behind when an analysis was deleted. Nothing in TERRA can
              open these, and no export includes them.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={onPurge}
              className={cn(btnGhost, "mt-2")}
            >
              {busy ? (
                <CircleNotch className="size-3.5 animate-spin" />
              ) : (
                <Trash className="size-3.5" />
              )}
              Clear them
            </button>
          </div>
        ) : (
          <p className="text-body text-muted-foreground">
            Nothing is unreferenced — every file belongs to an analysis or a
            project. Analyses are removed by deleting them in the project hub,
            which removes their files too.
          </p>
        )}
        {/* Stated because it is otherwise a puzzle: a run that opens onto no
            imagery looks broken rather than like a product that saves none. */}
        {report.empty_runs > 0 && (
          <p className="mt-2 text-micro text-muted-foreground">
            {report.empty_runs}{" "}
            {report.empty_runs === 1 ? "analysis holds" : "analyses hold"} no
            files. Some products save no imagery; there is nothing to reclaim
            from them.
          </p>
        )}
      </Section>
    </div>
  )
}

function Analyses({ report }: { report: store.StorageReport }) {
  const withFiles = useMemo(
    () => report.runs.filter((r) => !r.empty),
    [report.runs]
  )

  if (withFiles.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No analysis has saved files yet.
      </p>
    )
  }

  const largest = withFiles[0].bytes
  return (
    <>
      <p className="mb-3 text-body text-muted-foreground">
        Largest first. Deleting an analysis in the project hub removes its files
        as well.
      </p>
      <ul className="flex flex-col gap-1">
        {withFiles.map((r) => (
          <li key={r.run_id} className="rounded-sm px-2 py-1.5 hover:bg-secondary/55">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body text-foreground">
                {displayRunLabel(r.label) || r.kind}
              </span>
              <span className="telemetry shrink-0 text-body text-muted-foreground">
                {formatBytes(r.bytes)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              {/* Relative to the largest, not to the total: at 60 analyses
                  every bar would be a sliver of the whole and the comparison
                  that matters is between them. */}
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.max(2, (r.bytes / largest) * 100)}%` }}
                />
              </div>
              <span className="telemetry shrink-0 text-micro text-muted-foreground">
                {r.created_at ? r.created_at.slice(0, 10) : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function Projects({ report }: { report: store.StorageReport }) {
  if (report.by_project.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No project has saved compositions or exports yet.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {report.by_project.map((p) => (
        <li
          key={p.project_id}
          className="flex items-baseline justify-between gap-3 rounded-sm border border-border bg-sunk px-3 py-2"
        >
          <div className="min-w-0">
            <span className="truncate text-body text-foreground">{p.name}</span>
            <p className="text-micro text-muted-foreground">
              {p.overlays} {p.overlays === 1 ? "file" : "files"}
            </p>
          </div>
          <span className="telemetry shrink-0 text-body text-muted-foreground">
            {formatBytes(p.bytes)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A single bar showing how the whole divides, in the buckets' own order. */
function ProportionBar({
  segments,
  total,
}: {
  segments: { label: string; bytes: number }[]
  total: number
}) {
  if (total <= 0) return null
  const shades = [
    "bg-primary/80",
    "bg-primary/55",
    "bg-primary/35",
    "bg-muted-foreground/40",
  ]
  const visible = segments.filter((s) => s.bytes > 0)
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
        {visible.map((s, i) => (
          <div
            key={s.label}
            className={shades[i % shades.length]}
            style={{ width: `${(s.bytes / total) * 100}%` }}
            title={`${s.label}: ${formatBytes(s.bytes)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {visible.map((s, i) => (
          <span
            key={s.label}
            className="flex items-center gap-1.5 text-micro text-muted-foreground"
          >
            <span
              className={cn("size-2 rounded-sm", shades[i % shades.length])}
            />
            {s.label} · {formatBytes(s.bytes)}
          </span>
        ))}
      </div>
    </div>
  )
}

function GroupTable({
  groups,
  total,
}: {
  groups: store.StorageGroup[]
  total: number
}) {
  return (
    <ul className="flex flex-col gap-1">
      {groups.map((g) => (
        <li key={g.key} className="flex items-center gap-3 px-1 py-1">
          <span className="w-40 shrink-0 truncate text-body text-foreground">
            {g.label}
          </span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{
                width: total > 0 ? `${(g.bytes / total) * 100}%` : "0%",
              }}
            />
          </div>
          <span className="telemetry w-20 shrink-0 text-right text-body text-muted-foreground">
            {formatBytes(g.bytes)}
          </span>
          <span className="telemetry w-10 shrink-0 text-right text-micro text-muted-foreground">
            {g.count}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <p className="eyebrow mb-1">{title}</p>
      {hint && <p className="mb-2 text-micro text-muted-foreground">{hint}</p>}
      {children}
    </section>
  )
}
