import { useEffect, useState } from "react"

import {
  ImportModel,
  PickModelPackage,
  RemoveModel,
} from "../../../wailsjs/go/main/App"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import {
  ArrowsClockwise,
  CaretRight,
  Check,
  CircleNotch,
  DownloadSimple,
  Play,
  Trash,
  UploadSimple,
  X,
} from "@/components/icons"
import { CatalogueHero } from "@/components/shell/CatalogueHero"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { btnGhost, btnPrimaryCommit } from "@/components/ui/buttons"
import { MAPBIOMAS_CLASS_LEGEND } from "@/lib/classPalette"
import {
  fileSize,
  LAND_COVER,
  refreshModels,
  useInstalledModels,
} from "@/lib/installedModels"
import {
  cancelDownload,
  catalogEntry,
  compareVersions,
  downloadModel,
  ensureModelCatalog,
  readModelCatalog,
  useModelCatalog,
} from "@/lib/modelCatalog"
import { notifyError, notifyInfo } from "@/lib/notify"
import type {
  CatalogEntry,
  ModelCatalog,
  ModelDownload,
  ModelFact,
  ModelInfo,
  ModelKind,
  ModelManifest,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/*
  Drawn at its own pixels, magnified without smoothing. The pictures the
  published packages carry are class maps, and an interpolated class map shows
  colours that belong to no class.
*/
const PICTURE = "shrink-0 object-cover [image-rendering:pixelated]"

/** One model, by id: the newest version the catalogue lists and the newest installed. */
interface Row {
  id: string
  entry?: CatalogEntry
  installed?: ModelInfo
}

/** Where a model stands on this machine. */
type Standing =
  | { kind: "absent" }
  | { kind: "installed" }
  | { kind: "update"; from: string }
  | { kind: "downloading"; progress: ModelDownload }

/** The catalogue's models in its order, then the installed ones it does not list. */
function rowsOf(catalog: ModelCatalog | null, installed: readonly ModelInfo[]): Row[] {
  const ids: string[] = []
  for (const e of catalog?.models ?? []) {
    if (!ids.includes(e.manifest.id)) ids.push(e.manifest.id)
  }
  for (const m of installed) {
    if (!ids.includes(m.manifest.id)) ids.push(m.manifest.id)
  }
  return ids.map((id) => ({
    id,
    entry: catalogEntry(catalog, id),
    installed: installed.find((m) => m.manifest.id === id),
  }))
}

/**
 * What a row describes: the installed package when it is the catalogue's
 * version or newer, else the catalogue's. A model is described before it is
 * downloaded, from the manifest the catalogue carries.
 */
function shownOf(r: Row): {
  manifest: ModelManifest
  digest: string
  picture_uri: string
} {
  if (
    r.installed &&
    (!r.entry ||
      compareVersions(r.installed.manifest.version, r.entry.manifest.version) >= 0)
  ) {
    return r.installed
  }
  // A row is made from a catalogue entry or an installed package, so one is there.
  return (r.entry ?? r.installed) as CatalogEntry
}

function standingOf(
  r: Row,
  downloads: Readonly<Record<string, ModelDownload>>
): Standing {
  const progress = downloads[r.id]
  if (progress) return { kind: "downloading", progress }
  if (!r.installed) return { kind: "absent" }
  if (
    r.entry &&
    compareVersions(r.entry.manifest.version, r.installed.manifest.version) > 0
  ) {
    return { kind: "update", from: r.installed.manifest.version }
  }
  return { kind: "installed" }
}

/**
 * Models: the catalogue of published models, as cards, and a page for each.
 *
 * THE APPLICATION SHIPS NO MODEL. The reader looks through what the catalogue
 * offers, reads a model's page, and downloads the ones they want; a package of
 * their own is imported from a file. Everything the screen says about a model
 * -- what it reads, how it works, how it was evaluated, its limits and files --
 * comes from that model's manifest, which the catalogue carries before the
 * download and the package after it, so a model nobody wrote a line of this
 * file for is described as fully as the first ones were. lib/modelCatalog.ts
 * reads the catalogue and internal/models checks what is downloaded.
 *
 * Full screen over the map, as Compare and Workflows are, and in their frame:
 * a header with the place, and the page under it.
 */
export function ModelsScreen({
  current,
  onRun,
}: {
  /** The model Classification runs now. */
  current: ModelKind
  /** Back to the map, with Classification open on this model. */
  onRun: (id: ModelKind) => void
}) {
  const { models: installed, loaded } = useInstalledModels()
  const { catalog, reading, error, downloads } = useModelCatalog()
  const [open, setOpen] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  useEffect(ensureModelCatalog, [])

  const rows = rowsOf(catalog, installed)
  const row = rows.find((r) => r.id === open) ?? null

  const importPackage = async () => {
    setAsking(false)
    try {
      const path = await PickModelPackage()
      if (!path) return
      const info = (await ImportModel(path)) as unknown as ModelInfo
      await refreshModels()
      notifyInfo(`${info.manifest.name} ${info.manifest.version} installed`)
      setOpen(info.manifest.id)
    } catch (e) {
      notifyError("The model could not be installed", e)
    }
  }

  return (
    <div className="app-no-drag absolute inset-0 z-480 flex flex-col bg-app pt-[var(--frame-reach,0px)]">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-4">
        {row ? (
          <>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="text-title font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Models
            </button>
            <CaretRight className="size-3 text-muted-foreground" />
            <h1 className="text-title font-medium text-foreground">
              {shownOf(row).manifest.name}
            </h1>
          </>
        ) : (
          <h1 className="text-title font-medium text-foreground">Models</h1>
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => setAsking(true)} className={btnGhost}>
          <UploadSimple className="size-3.5" />
          Import a package
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[72rem] px-8 py-8">
          {row ? (
            <ModelPage
              row={row}
              standing={standingOf(row, downloads)}
              current={current}
              onRun={onRun}
              onRemoved={() => {
                if (!row.entry) setOpen(null)
              }}
            />
          ) : (
            <ModelList
              rows={rows}
              catalog={catalog}
              reading={reading}
              error={error}
              loaded={loaded}
              downloads={downloads}
              current={current}
              onOpen={(r) => setOpen(r.id)}
              onImport={() => setAsking(true)}
            />
          )}
        </div>
      </div>
      {asking && (
        <TrustDialog
          onCancel={() => setAsking(false)}
          onConfirm={() => void importPackage()}
        />
      )}
    </div>
  )
}

function ModelList({
  rows,
  catalog,
  reading,
  error,
  loaded,
  downloads,
  current,
  onOpen,
  onImport,
}: {
  rows: readonly Row[]
  catalog: ModelCatalog | null
  reading: boolean
  error: string | null
  loaded: boolean
  downloads: Readonly<Record<string, ModelDownload>>
  current: ModelKind
  onOpen: (r: Row) => void
  onImport: () => void
}) {
  const listed = rows.filter((r) => r.entry)
  const imported = rows.filter((r) => !r.entry)
  const card = (r: Row) => (
    <li key={r.id}>
      <ModelCard
        row={r}
        standing={standingOf(r, downloads)}
        current={current}
        onOpen={() => onOpen(r)}
      />
    </li>
  )
  return (
    <>
      <CatalogueHero
        published={catalog ? listed.length : null}
        installed={rows.filter((r) => r.installed).length}
      />
      <CatalogueNote catalog={catalog} reading={reading} error={error} />
      {listed.length > 0 && <ul className={GRID}>{listed.map(card)}</ul>}

      {imported.length > 0 && (
        <section className="mt-12">
          <h3 className="text-heading font-medium text-foreground">Imported</h3>
          <p className="mt-1 text-label text-muted-foreground">
            Installed from a file, not from the catalogue.
          </p>
          <ul className={GRID}>{imported.map(card)}</ul>
        </section>
      )}

      {loaded && !reading && rows.length === 0 && (
        <div className="mt-6 max-w-prose rounded-md border border-dashed border-border p-6">
          <p className="text-read text-foreground">No model to show.</p>
          <p className="mt-2 text-label text-muted-foreground">
            Without the catalogue, a model can still be installed from its package: a
            zip holding its files and a model.json that names each with its SHA-256.
          </p>
          <button
            type="button"
            onClick={onImport}
            className={cn(btnPrimaryCommit, "mt-4")}
          >
            <UploadSimple className="size-3.5" />
            Import a package
          </button>
        </div>
      )}
    </>
  )
}

const GRID =
  "mt-8 grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-4"

/** Where the list came from, and what to do when it is not the published one. */
function CatalogueNote({
  catalog,
  reading,
  error,
}: {
  catalog: ModelCatalog | null
  reading: boolean
  error: string | null
}) {
  const retry = (
    <button
      type="button"
      onClick={() => void readModelCatalog()}
      disabled={reading}
      className="text-accent-quiet underline-offset-2 hover:underline disabled:opacity-60"
    >
      {reading ? "Reading…" : "Try again"}
    </button>
  )
  const unsupported = catalog?.unsupported ?? 0
  // The published catalogue, read just now and whole, needs no note: the
  // banner says what it is.
  if (catalog?.origin === "online" && unsupported === 0) return null
  if (!catalog && !reading && !error) return null
  return (
    <div className="mt-4 max-w-prose text-label text-muted-foreground">
      {!catalog && reading && (
        <p className="flex items-center gap-1.5">
          <CircleNotch className="size-3.5 animate-spin" />
          Reading the catalogue from GitHub
        </p>
      )}
      {!catalog && !reading && error && (
        <p>
          The catalogue could not be read: {error}. {retry}
        </p>
      )}
      {catalog?.origin === "built-in" && (
        <p>
          The published catalogue could not be read: {catalog.problem}. This is the list
          as this version of TERRA knows it. {retry}
        </p>
      )}
      {unsupported > 0 && (
        <p className="mt-1">
          {unsupported} more {unsupported === 1 ? "model needs" : "models need"} a newer
          version of TERRA.
        </p>
      )}
    </div>
  )
}

/*
  A CARD IS A PICTURE THAT DARKENS INTO ITS TEXT, after a reference the user
  chose: the model's picture across the top, fading into the card's ground,
  with the name set over the darkest of it, the task under the name where a
  place's region would be, the summary, one line of facts, and at the foot the
  model's standing beside the way in.

  The whole card is the one control, as it was: it opens the model's page,
  which is where a model is downloaded and run. The pill at its foot says so
  and is not a second button, since a button inside a button is not one a
  reader can reach on its own.
*/
function ModelCard({
  row,
  standing,
  current,
  onOpen,
}: {
  row: Row
  standing: Standing
  current: ModelKind
  onOpen: () => void
}) {
  const shown = shownOf(row)
  const m = shown.manifest
  const figure = m.evaluation?.figures[0]
  // Who packaged a model is kept in its manifest and not shown: the card and
  // the page describe the model, not the people behind it.
  const facts = [
    figure ? `${figure.label} ${figure.value}` : "No evaluation recorded",
    ...(m.requires ?? []).map((r) => `needs ${r}`),
  ].filter(Boolean)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full flex-col overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))] text-left shadow-[0_12px_32px_rgb(0_0_0/0.35)] transition-colors hover:border-[rgb(var(--p-line-strong)/0.6)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="relative block h-44 shrink-0">
        <Picture
          uri={shown.picture_uri}
          manifest={m}
          className="absolute inset-0 size-full"
        />
        {/* The picture darkens into the card's ground, where the name sits. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--p-ink)/0)_30%,rgb(var(--p-ink)/0.75)_70%,rgb(var(--p-ink))_100%)]"
        />
        {row.installed && (
          <span className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-[rgb(4_6_11/0.62)] px-2 py-0.5 text-meta text-[rgb(236_232_223)] backdrop-blur-sm">
            <Check className="size-3" />
            {m.id === current ? "In use" : "Installed"}
          </span>
        )}
      </span>
      <span className="relative -mt-12 flex min-w-0 flex-1 flex-col gap-1 px-5 pb-4">
        <span className="flex items-baseline gap-2">
          <span className="font-display text-title font-semibold text-foreground">
            {m.name}
          </span>
          <span className="telemetry text-meta text-muted-foreground">{m.version}</span>
        </span>
        <span className="text-label text-foreground/80">{taskName(m.task)}</span>
        <span className="mt-2 text-label leading-relaxed text-muted-foreground">
          {m.summary}
        </span>
        <span className="telemetry mt-1.5 text-meta text-muted-foreground">
          {facts.join(" · ")}
        </span>
        <span className="mt-auto flex items-center gap-3 pt-4">
          <span className="min-w-0 flex-1">
            <StandingLine standing={standing} entry={row.entry} />
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[rgb(var(--p-text))] px-3.5 py-1.5 text-label font-medium text-[rgb(var(--p-ink))] transition-opacity group-hover:opacity-90">
            View model
            <CaretRight className="size-3" />
          </span>
        </span>
      </span>
    </button>
  )
}

/** One line on a card: installed, to download, or how far the download is. */
function StandingLine({
  standing,
  entry,
}: {
  standing: Standing
  entry?: CatalogEntry
}) {
  switch (standing.kind) {
    case "downloading":
      return <Progress progress={standing.progress} />
    case "installed":
      return (
        <span className="flex items-center gap-1.5 text-label text-foreground">
          <Check className="size-3.5 text-accent-quiet" />
          Installed
        </span>
      )
    case "update":
      return (
        <span className="flex items-center gap-1.5 text-label text-foreground">
          <ArrowsClockwise className="size-3.5 text-accent-quiet" />
          {entry?.manifest.version} available
          <span className="text-muted-foreground">· {standing.from} installed</span>
        </span>
      )
    case "absent":
      return (
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
          <DownloadSimple className="size-3.5" />
          Not installed{entry && ` · ${fileSize(entry.package.size)} to download`}
        </span>
      )
  }
}

/** A download's bar, and how much of it has arrived from where. */
function Progress({ progress: p }: { progress: ModelDownload }) {
  const share = p.total > 0 ? Math.min(1, p.received / p.total) : 0
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-label={`Downloading ${p.id}`}
      className="flex w-full flex-col gap-1.5"
    >
      <span className="block h-1 overflow-hidden rounded-sm bg-[rgb(var(--p-control))]">
        <span
          className="block h-full bg-primary transition-[width] duration-150"
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span className="text-label text-muted-foreground tabular-nums">
        Downloading from {p.source} · {fileSize(p.received)} of {fileSize(p.total)}
      </span>
    </span>
  )
}

function ModelPage({
  row,
  standing,
  current,
  onRun,
  onRemoved,
}: {
  row: Row
  standing: Standing
  current: ModelKind
  onRun: (id: ModelKind) => void
  onRemoved: () => void
}) {
  const shown = shownOf(row)
  const m = shown.manifest
  const { entry, installed } = row
  const [removing, setRemoving] = useState<"ask" | "busy" | null>(null)
  const remove = async () => {
    if (!installed) return
    setRemoving("busy")
    try {
      await RemoveModel(installed.manifest.id, installed.manifest.version)
      await refreshModels()
      setRemoving(null)
      onRemoved()
    } catch (e) {
      notifyError("The model could not be removed", e)
      setRemoving(null)
    }
  }
  const download = async () => {
    if (!entry) return
    try {
      const info = await downloadModel(entry)
      notifyInfo(`${info.manifest.name} ${info.manifest.version} installed`)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      if (why.includes("cancelled")) notifyInfo(`${m.name}: the download was cancelled`)
      else notifyError(`${m.name} could not be installed`, e)
    }
  }
  const offers = standing.kind === "absent" || standing.kind === "update"
  const needs = m.requires?.length
    ? `Needs ${m.requires.join(" and ")}, installed from Settings › System.`
    : "Runs in every installation."
  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        <Picture
          uri={shown.picture_uri}
          manifest={m}
          className="size-48 rounded-md border border-border"
        />
        <div className="min-w-0 flex-1 basis-80">
          <p className="eyebrow">
            {taskName(m.task)} · {m.version}
          </p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-display font-semibold text-foreground">
            {m.name}
            {m.id === current && installed && <InUse />}
          </h2>
          <p className="mt-2 max-w-prose text-read text-muted-foreground">
            {m.summary}
          </p>
          {standing.kind === "downloading" ? (
            <div className="mt-5 flex max-w-md items-center gap-3">
              <Progress progress={standing.progress} />
              <button
                type="button"
                onClick={() => cancelDownload(m.id)}
                className={btnGhost}
              >
                <X className="size-3.5" />
                Cancel
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              {offers && entry && (
                <button
                  type="button"
                  onClick={() => void download()}
                  className={btnPrimaryCommit}
                >
                  <DownloadSimple className="size-3.5" />
                  {standing.kind === "update"
                    ? `Update to ${entry.manifest.version}`
                    : "Download and install"}
                </button>
              )}
              {/* Classification is the only run a package starts on the map. */}
              {installed && m.task === LAND_COVER && (
                <button
                  type="button"
                  onClick={() => onRun(m.id)}
                  className={offers ? btnGhost : btnPrimaryCommit}
                >
                  <Play className="size-3.5" />
                  Run on the map
                </button>
              )}
              {installed && (
                <button
                  type="button"
                  onClick={() => setRemoving("ask")}
                  className={btnGhost}
                >
                  <Trash className="size-3.5" />
                  {standing.kind === "update"
                    ? `Remove ${installed.manifest.version}`
                    : "Remove"}
                </button>
              )}
              <span className="text-label text-muted-foreground">
                {offers && entry
                  ? `${fileSize(entry.package.size)} from ${entry.sources.map((x) => x.name).join(" or ")}. ${needs}`
                  : needs}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
        {/* Only a land-cover model lists classes; another estimates a quantity. */}
        {m.classes?.length ? (
          <Section title="What it predicts">
            <ul className="flex flex-col gap-1.5">
              {m.classes.map((code) => {
                const c = MAPBIOMAS_CLASS_LEGEND.find((x) => x.id === code)
                return (
                  <li key={code} className="flex items-center gap-2 text-read">
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-xs outline-1 -outline-offset-1 outline-[rgb(var(--p-line)/0.5)]"
                      style={{ background: c?.color ?? "transparent" }}
                    />
                    <span className="text-foreground">
                      {c?.name ?? "MapBiomas class"}
                    </span>
                    <span className="telemetry text-meta text-muted-foreground">
                      class {code}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Section>
        ) : null}
        <Section title="What it reads">
          <Facts rows={m.reads ?? []} />
        </Section>
        <Section title="How it works">
          <Facts rows={[{ label: "Family", value: m.family }, ...(m.method ?? [])]} />
        </Section>
        <Section title="How it was evaluated">
          {m.evaluation ? (
            <>
              <dl className="flex gap-8">
                {m.evaluation.figures.map((f) => (
                  <div key={f.label}>
                    <dt className="text-label text-muted-foreground">{f.label}</dt>
                    <dd className="telemetry mt-0.5 text-display text-foreground tabular-nums">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-label text-muted-foreground">
                {m.evaluation.method}
              </p>
              <p className="mt-1.5 text-label text-muted-foreground italic">
                {m.evaluation.source}
              </p>
            </>
          ) : (
            <p className="text-read text-muted-foreground">
              No evaluation is recorded in this model's package. Until there is one,
              read its maps against the MapBiomas reference for the same area.
            </p>
          )}
        </Section>
        {(m.limits?.length ?? 0) > 0 && (
          <Section title="Limits">
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-read text-muted-foreground marker:text-muted-foreground">
              {m.limits?.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Package">
          <Facts
            rows={[
              { label: "Id", value: `${m.id} ${m.version}` },
              { label: "Licence", value: m.license || "not stated" },
              ...(m.doi ? [{ label: "DOI", value: m.doi }] : []),
              { label: "Digest", value: shown.digest.slice(0, 16) },
              ...(entry
                ? [
                    {
                      label: "Download",
                      value: `${entry.package.name}, ${fileSize(entry.package.size)}, from ${entry.sources.map((x) => x.name).join(" or ")}`,
                    },
                  ]
                : []),
              ...(installed
                ? [{ label: "Installed", value: installed.manifest.version }]
                : []),
            ]}
          />
          <ul className="mt-3 flex flex-col gap-1">
            {Object.entries(m.files).map(([role, f]) => (
              <li key={role} className="flex items-baseline gap-3 text-read">
                <span className="telemetry text-label text-foreground">{f.name}</span>
                <span className="text-label text-muted-foreground tabular-nums">
                  {fileSize(f.size)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {m.picture && (
        <p className="mt-10 border-t border-border pt-4 text-meta text-muted-foreground">
          Picture: {m.picture.subject}. {m.picture.author} · {m.picture.license} ·{" "}
          <button
            type="button"
            onClick={() => m.picture && BrowserOpenURL(m.picture.source)}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            source
          </button>
        </p>
      )}

      {removing && (
        <ConfirmDelete
          eyebrow="REMOVE MODEL"
          title={`${m.name} ${installed?.manifest.version ?? m.version}`}
          subtitle="Its files leave this machine. Runs made with it keep their results and still name it; running it again needs it installed."
          confirmLabel="Remove"
          busy={removing === "busy"}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  )
}

/**
 * Said before the file is chosen, not after: a package's weights are pickles,
 * and loading one runs whatever it says. The digests in its manifest pin it to
 * what it was when installed; they say nothing of who made it.
 */
function TrustDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ModalShell
      onDismiss={onCancel}
      labelledBy="trust-title"
      className="w-full max-w-md"
    >
      <ModalHeader
        eyebrow="IMPORT A MODEL"
        titleId="trust-title"
        title="Only from a source you trust"
        subtitle="A model's files are loaded with Python's pickle, which can run code on this machine. TERRA checks that a package's files match its manifest, before installing and before every run, but it cannot tell who made them. Import a package you trained, or one from someone you trust."
      />
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onCancel} className={btnGhost}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={btnPrimaryCommit}>
          Choose a package
        </button>
      </div>
    </ModalShell>
  )
}

function Picture({
  uri,
  manifest,
  className,
}: {
  uri: string
  manifest: ModelManifest
  className: string
}) {
  if (!uri) {
    return (
      <span
        aria-hidden
        className={cn(
          "shrink-0 bg-[repeating-linear-gradient(135deg,rgb(var(--p-control))_0_6px,rgb(var(--p-surface))_6px_12px)]",
          className
        )}
      />
    )
  }
  return (
    <img
      src={uri}
      alt=""
      title={
        manifest.picture
          ? `Picture: ${manifest.picture.author} · ${manifest.picture.license}`
          : undefined
      }
      draggable={false}
      className={cn(PICTURE, className)}
    />
  )
}

/** What each task internal/models knows is called on a card and a page. */
const TASK_NAMES: Record<string, string> = {
  [LAND_COVER]: "Land use and land cover",
  time_series: "Time series",
  observation_quality: "Observation quality",
}

const taskName = (task: string) => TASK_NAMES[task] ?? task.replace(/_/g, " ")

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-label font-medium text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Facts({ rows }: { rows: readonly ModelFact[] }) {
  return (
    <dl className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-4 gap-y-2">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-label text-muted-foreground">{r.label}</dt>
          <dd className="text-read break-words text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The one Classification runs now; picking another happens in its form. */
function InUse() {
  return (
    <span
      title="Classification runs this model now"
      className="rounded-sm bg-[rgb(var(--p-surface-raised))] px-1.5 py-0.5 text-meta font-normal text-foreground"
    >
      In use
    </span>
  )
}
