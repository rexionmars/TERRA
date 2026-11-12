import { useState } from "react"

import {
  ImportModel,
  PickModelPackage,
  RemoveModel,
} from "../../../wailsjs/go/main/App"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { CaretRight, Play, Trash, UploadSimple } from "@/components/icons"
import { ConfirmDelete } from "@/components/ui/ConfirmDelete"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { btnGhost, btnPrimaryCommit } from "@/components/ui/buttons"
import { MAPBIOMAS_CLASS_LEGEND } from "@/lib/classPalette"
import { fileSize, refreshModels, useInstalledModels } from "@/lib/installedModels"
import { notifyError, notifyInfo } from "@/lib/notify"
import type { ModelFact, ModelInfo, ModelKind } from "@/lib/types"
import { cn } from "@/lib/utils"

/*
  Drawn at its own pixels, magnified without smoothing. The pictures the
  published packages carry are class maps, and an interpolated class map shows
  colours that belong to no class.
*/
const PICTURE = "shrink-0 object-cover [image-rendering:pixelated]"

const keyOf = (m: ModelInfo) => `${m.manifest.id}@${m.manifest.version}`

/**
 * Models: the packages installed on this machine, as cards, and a page for each.
 *
 * THE APPLICATION SHIPS NO MODEL. This is where the reader installs the ones
 * they want and removes the ones they do not, and everything the screen says
 * about a model -- what it reads, how it works, how it was evaluated, its
 * limits and files -- comes from that model's own package (model.json), so a
 * model nobody wrote a line of this file for is described as fully as the
 * first ones were. internal/models says how a package is checked.
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
  const { models, loaded } = useInstalledModels()
  const [open, setOpen] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const card = models.find((m) => keyOf(m) === open) ?? null

  const importPackage = async () => {
    setAsking(false)
    try {
      const path = await PickModelPackage()
      if (!path) return
      const info = (await ImportModel(path)) as unknown as ModelInfo
      await refreshModels()
      notifyInfo(`${info.manifest.name} ${info.manifest.version} installed`)
      setOpen(keyOf(info))
    } catch (e) {
      notifyError("The model could not be installed", e)
    }
  }

  return (
    <div className="app-no-drag absolute inset-0 z-480 flex flex-col bg-app">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-4">
        {card ? (
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
              {card.manifest.name}
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
          {card ? (
            <ModelPage
              card={card}
              current={current}
              onRun={onRun}
              onRemoved={() => setOpen(null)}
            />
          ) : (
            <ModelList
              models={models}
              loaded={loaded}
              current={current}
              onOpen={(m) => setOpen(keyOf(m))}
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
  models,
  loaded,
  current,
  onOpen,
  onImport,
}: {
  models: readonly ModelInfo[]
  loaded: boolean
  current: ModelKind
  onOpen: (m: ModelInfo) => void
  onImport: () => void
}) {
  const n = models.length
  return (
    <>
      <h2 className="font-display text-display font-semibold text-foreground">
        Installed models
      </h2>
      <p className="mt-1 text-label text-muted-foreground">
        {n === 0
          ? "TERRA ships without models: install the ones you want to run."
          : `${n} ${n === 1 ? "model" : "models"} on this machine, each checked against its own digests before every run`}
      </p>
      {loaded && n === 0 && (
        <div className="mt-6 max-w-prose rounded-md border border-dashed border-border p-6">
          <p className="text-read text-foreground">No model is installed yet.</p>
          <p className="mt-2 text-label text-muted-foreground">
            A model comes as a package: a zip holding its files and a model.json that
            names each with its SHA-256. Import one you have, and Classification will
            offer it.
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
      <ul className="mt-6 grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-4">
        {models.map((m) => (
          <li key={keyOf(m)}>
            <button
              type="button"
              onClick={() => onOpen(m)}
              className="flex h-full w-full overflow-hidden rounded-md border border-border bg-[rgb(var(--p-surface))] text-left transition-colors hover:border-[rgb(var(--p-line-strong)/0.6)] hover:bg-[rgb(var(--p-head))] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Picture model={m} className="size-44" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
                <span className="flex items-center gap-2">
                  <span className="text-heading font-medium text-foreground">
                    {m.manifest.name}
                  </span>
                  <span className="telemetry text-meta text-muted-foreground">
                    {m.manifest.version}
                  </span>
                  {m.manifest.id === current && <InUse />}
                </span>
                <span className="text-label text-muted-foreground">
                  {m.manifest.summary}
                </span>
                <span className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  <Tag>{taskName(m.manifest.task)}</Tag>
                  {(m.manifest.requires ?? []).map((r) => (
                    <Tag key={r}>needs {r}</Tag>
                  ))}
                  <Tag>
                    {m.manifest.evaluation?.figures[0]
                      ? `${m.manifest.evaluation.figures[0].label} ${m.manifest.evaluation.figures[0].value}`
                      : "No evaluation recorded"}
                  </Tag>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function ModelPage({
  card,
  current,
  onRun,
  onRemoved,
}: {
  card: ModelInfo
  current: ModelKind
  onRun: (id: ModelKind) => void
  onRemoved: () => void
}) {
  const m = card.manifest
  const [removing, setRemoving] = useState<"ask" | "busy" | null>(null)
  const remove = async () => {
    setRemoving("busy")
    try {
      await RemoveModel(m.id, m.version)
      await refreshModels()
      onRemoved()
    } catch (e) {
      notifyError("The model could not be removed", e)
      setRemoving(null)
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        <Picture model={card} className="size-48 rounded-md border border-border" />
        <div className="min-w-0 flex-1 basis-80">
          <p className="eyebrow">
            {taskName(m.task)} · {m.version}
          </p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-display font-semibold text-foreground">
            {m.name}
            {m.id === current && <InUse />}
          </h2>
          <p className="mt-2 max-w-prose text-read text-muted-foreground">
            {m.summary}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => onRun(m.id)}
              className={btnPrimaryCommit}
            >
              <Play className="size-3.5" />
              Run on the map
            </button>
            <button
              type="button"
              onClick={() => setRemoving("ask")}
              className={btnGhost}
            >
              <Trash className="size-3.5" />
              Remove
            </button>
            <span className="text-label text-muted-foreground">
              {m.requires?.length
                ? `Needs ${m.requires.join(" and ")}, installed from Settings › System.`
                : "Runs in every installation."}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
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
              { label: "Digest", value: card.digest.slice(0, 16) },
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
          title={`${m.name} ${m.version}`}
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

function Picture({ model, className }: { model: ModelInfo; className: string }) {
  if (!model.picture_uri) {
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
      src={model.picture_uri}
      alt=""
      title={
        model.manifest.picture
          ? `Picture: ${model.manifest.picture.author} · ${model.manifest.picture.license}`
          : undefined
      }
      draggable={false}
      className={cn(PICTURE, className)}
    />
  )
}

const taskName = (task: string) =>
  task === "land_cover" ? "Land use and land cover" : task.replace(/_/g, " ")

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

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-border px-1.5 py-0.5 text-meta text-muted-foreground">
      {children}
    </span>
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
