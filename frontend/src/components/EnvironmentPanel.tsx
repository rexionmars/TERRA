/**
 * The Python environment, as a section of the settings screen.
 *
 * A section rather than a destination of its own: choosing which interpreter
 * runs the analyses is a setting, and it belongs beside the other settings.
 * Given its own place in the navigation it became a third door to one thing,
 * next to the settings row and the first-run gate.
 *
 * This is what the LITE install never had. Its path asked a user to install
 * Python, make a virtual environment, install a requirements file that is not
 * in the download, and export a variable that a desktop launch never reads --
 * and then, if any of that went wrong, said nothing until an analysis died
 * mid-run on an import.
 *
 * So it states what is true rather than what is convenient: which interpreter
 * is in use and how it was picked, which dependency is missing and what that
 * specifically stops working, and whether an environment variable is
 * overriding the choice offered here.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react"
import { EventsOn } from "../../wailsjs/runtime/runtime"
import {
  BuildManagedEnvironment,
  CancelEnvironmentBuild,
  InspectEnvironment,
  ListOptionalPackages,
  ManageOptionalPackage,
  UseInterpreter,
} from "../../wailsjs/go/main/App"
import type { main, pyenv } from "../../wailsjs/go/models"
import { btnGhost, btnPrimaryCommit } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"

type SetupEvent = {
  step: string
  line?: string
  error?: string
}

/** How an interpreter came to be the one in use, in the user's terms. */
const ORIGIN_LABEL: Record<string, string> = {
  managed: "created by TERRA",
  bundled: "shipped with TERRA",
  chosen: "chosen here",
  venv: "a project environment",
  path: "found on this machine",
  detected: "detected automatically",
  // The interpreter chosen here is no longer where it was, so this is a
  // fallback. Said plainly, because the alternative is a selection that
  // silently stopped applying.
  abandoned: "detected automatically · the interpreter chosen here is gone",
  TERRA_PYTHON: "forced by TERRA_PYTHON",
}

/*
  Takes no callback for "the environment now works".

  It had one while this was a full-screen route that the first-run gate opened
  and had to be dismissed from. As a settings page there is nothing to dismiss:
  the user is somewhere they can stay, and the panel reporting its own new state
  is the whole of the feedback.
*/
export function EnvironmentPanel() {
  const [state, setState] = useState<main.EnvironmentState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [log, setLog] = useState<SetupEvent[]>([])
  const [building, setBuilding] = useState(false)
  const [optional, setOptional] = useState<pyenv.OptionalPackage[]>([])
  const logRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setState(await InspectEnvironment())
      setProblem(null)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Static for the life of the build, so fetched once rather than per refresh.
  useEffect(() => {
    ListOptionalPackages()
      .then((list) => setOptional(list ?? []))
      .catch(() => {})
  }, [])

  // pip's own lines, as they arrive. An install takes minutes, and its output
  // is the only honest answer to "is this stuck".
  useEffect(() => {
    return EventsOn("env:setup", (ev: SetupEvent) => {
      setLog((prev) => [...prev.slice(-400), ev])
      if (ev.step === "failed") {
        setBuilding(false)
        setProblem(ev.error ?? "the environment could not be built")
      } else if (ev.step === "done") {
        setBuilding(false)
        void refresh()
      }
    })
  }, [refresh])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const build = async (basePython: string) => {
    setLog([])
    setProblem(null)
    setBuilding(true)
    try {
      await BuildManagedEnvironment(basePython)
    } catch (e) {
      setBuilding(false)
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  /*
    Install or remove one optional package.

    Reports through the same "env:setup" events a build uses -- pip's output is
    the honest answer to "is this stuck" for a multi-gigabyte download too, and
    the listener above already refreshes the panel when it ends.
  */
  const manage = async (name: string, install: boolean) => {
    setLog([])
    setProblem(null)
    setBuilding(true)
    try {
      await ManageOptionalPackage(name, install)
    } catch (e) {
      setBuilding(false)
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  const choose = async (path: string) => {
    setBusyPath(path)
    setProblem(null)
    try {
      await UseInterpreter(path)
      await refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyPath(null)
    }
  }

  const active = state?.active ?? null
  const missing = (active?.packages ?? []).filter(
    (p) => !p.optional && (!p.present || p.version_problem)
  )
  // Optional packages are no longer listed as "degraded" here: the section
  // below names them, says what they cost, and offers to install them, which
  // is the whole of what a reader needed from that line.

  return (
    <div className="flex flex-col gap-3">
      {state?.env_override && (
        <Notice tone="warning">
          <span className="telemetry">TERRA_PYTHON</span> is set to{" "}
          <span className="telemetry">{state.env_override}</span>, and it overrides
          everything chosen here. Unset it to let this screen decide.
        </Notice>
      )}
      {/*
        The GEOSENSE_ prefix was retired in favour of TERRA_, and the old names
        were dropped rather than kept as aliases. Nothing else can report that:
        by definition these are values the application has stopped reading, so
        a GEOSENSE_PYTHON left in a shell profile simply stops working with no
        symptom anywhere.
      */}
      {(state?.retired_vars ?? []).length > 0 && (
        <Notice tone="warning">
          {(state?.retired_vars ?? []).length === 1 ? "This variable is" : "These variables are"}{" "}
          set and no longer read:{" "}
          <span className="telemetry">
            {(state?.retired_vars ?? []).join(", ")}
          </span>
          . The prefix is now <span className="telemetry">TERRA_</span> — rename
          them, or unset them to stop them being misleading.
        </Notice>
      )}
      {problem && <Notice tone="error">{problem}</Notice>}

      {/*
        The state of things, said plainly, at the top.

        Everything below reports detail -- which interpreter, which package,
        which path -- and detail only answers a question the reader already
        has. Someone sent here by the first-run gate does not have it yet: they
        pressed nothing and arrived anyway. This is the sentence that tells
        them what is true before the evidence for it.
      */}
      {active && !active.usable && (
        <Notice tone="error">
          No analysis can run yet.{" "}
          {active.unreachable
            ? "The selected interpreter could not be started."
            : !active.python_ok
              ? `TERRA needs Python ${active.min_python} or newer.`
              : "The selected interpreter is missing packages the sidecar imports."}{" "}
          Pick a Python below and press <strong>Build environment</strong> —
          TERRA installs the rest itself.
        </Notice>
      )}

      {/* What is in use, and whether it works. */}
      <section className="rounded-sm border border-border bg-secondary/50 p-4">
        <p className="eyebrow mb-3">In use</p>
        {loading && !active ? (
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            checking
          </p>
        ) : !active ? (
          <p className="text-body text-muted-foreground">
            No interpreter is resolved yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="telemetry min-w-0 truncate text-emphasis text-foreground">
                {active.executable}
              </span>
              <StatusPill
                ok={active.usable}
                label={
                  active.unreachable
                    ? "cannot be run"
                    : active.usable
                      ? `ready · python ${active.python_version}`
                      : `python ${active.python_version} · incomplete`
                }
              />
            </div>
            <p className="mt-1 text-body text-muted-foreground">
              {ORIGIN_LABEL[active.origin] ?? active.origin}
              {!active.python_ok &&
                ` · TERRA needs Python ${active.min_python} or newer`}
            </p>

            {missing.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {missing.map((p) => (
                  <PackageRow key={p.module} pkg={p} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/*
        The optional models, with a way to get them.

        torch is outside requirements.txt on purpose -- it outweighs everything
        else the application ships, so every install paying for it to serve the
        people who want the neural models would be the wrong default. But the
        panel only ever reported its absence: "without it: Temporal Transformer
        and Prithvi" told the user what they were missing and left them to work
        out where pip lived. Removal is offered for the same reason it is
        optional: it is gigabytes, and someone who tried the neural models
        should be able to reclaim them without rebuilding the environment.
      */}
      {optional.length > 0 && active && !active.unreachable && (
        <section className="rounded-sm border border-border bg-secondary/50 p-4">
          <p className="eyebrow mb-1">Optional models</p>
          <p className="mb-3 text-body text-muted-foreground">
            Large downloads TERRA does not install by default. Everything else
            works without them.
          </p>
          <ul className="flex flex-col gap-2">
            {optional.map((pkg) => {
              const installed = (active.packages ?? []).some(
                (p) => p.distribution === pkg.name && p.present
              )
              return (
                <li
                  key={pkg.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-body text-foreground">
                      <span className="telemetry">{pkg.name}</span>
                      {installed ? " · installed" : ` · ${pkg.size}`}
                    </p>
                    <p className="text-micro text-muted-foreground">
                      enables {pkg.enables}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={building || busyPath !== null}
                    onClick={() => void manage(pkg.name, !installed)}
                    className={installed ? btnGhost : btnPrimaryCommit}
                  >
                    {installed ? "Remove" : "Install"}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* The recommended repair, and the interpreters it can be built on. */}
      <section className="rounded-sm border border-border bg-secondary/50 p-4">
        <p className="eyebrow mb-1">Interpreters on this machine</p>
        <p className="mb-3 text-body text-muted-foreground">
          TERRA can build its own environment from any Python{" "}
          {active?.min_python ?? "3.12"} or newer, and keep it beside its database
          rather than inside the application — so an update does not discard it.
        </p>

        <ul className="flex flex-col gap-2">
          {(state?.candidates ?? []).map((c) => (
            <CandidateRow
              key={c.path}
              candidate={c}
              active={c.path === active?.executable}
              disabled={building || busyPath !== null}
              busy={busyPath === c.path}
              onBuild={() => void build(c.path)}
              onChoose={() => void choose(c.path)}
            />
          ))}
          {(state?.candidates ?? []).length === 0 && !loading && (
            <li className="text-body text-muted-foreground">
              No Python was found. Install Python {active?.min_python ?? "3.12"} and
              check again.
            </li>
          )}
        </ul>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || building}
            className={btnGhost}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Check again
          </button>
          {building && (
            <button
              type="button"
              onClick={() => void CancelEnvironmentBuild()}
              className={btnGhost}
            >
              <X className="size-3.5" />
              Stop
            </button>
          )}
        </div>
      </section>

      {/*
        Where the application is reading its parts from.

        Read-only on purpose. These are properties of the installation, and the
        environment variables that override them cannot be usefully set by the
        application itself -- one written into this process does not survive a
        relaunch, and making it survive would mean editing a shell profile or
        the registry from a desktop app. They are set in the terminal that
        launches TERRA, by someone who already has one.

        What was missing was seeing them. Until now these appeared only in the
        boot log, behind a splash screen, so a TERRA_MODEL_DIR exported and
        forgotten kept selecting a model directory with nothing on screen
        saying which.
      */}
      {(state?.paths ?? []).length > 0 && (
        <section className="rounded-sm border border-border bg-secondary/50 p-4">
          <p className="eyebrow mb-1">Locations</p>
          <p className="mb-3 text-body text-muted-foreground">
            Where TERRA reads its parts from, as resolved at startup. Set by the
            installation and by environment variables, not editable here.
          </p>
          <ul className="flex flex-col gap-2">
            {(state?.paths ?? []).map((p) => (
              <PathRow key={p.label} path={p} />
            ))}
          </ul>
          {state?.config_path && (
            <p className="mt-3 text-micro text-muted-foreground">
              The interpreter choice is saved in{" "}
              <span className="telemetry break-all">{state.config_path}</span>
            </p>
          )}
        </section>
      )}

      {log.length > 0 && (
        <section className="rounded-sm border border-border bg-secondary/50 p-4">
          <p className="eyebrow mb-3">{building ? "Installing" : "Last install"}</p>
          {/* Verbatim, not summarised. What pip is resolving is the only
                  honest answer to why this is taking minutes, and on failure
                  the reason is in these lines. */}
          <div
            ref={logRef}
            className="panel-scroll max-h-56 overflow-y-auto rounded-sm border border-border bg-background p-2"
          >
            {log.map((ev, i) => (
              <p
                key={i}
                className={cn(
                  "telemetry whitespace-pre-wrap break-all text-micro leading-relaxed",
                  ev.error ? "text-destructive-quiet" : "text-muted-foreground"
                )}
              >
                {ev.error ?? ev.line}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "telemetry flex shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-meta",
        ok
          ? "bg-primary/20 text-accent-quiet"
          : "bg-secondary text-muted-foreground"
      )}
    >
      {ok ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
      {label}
    </span>
  )
}

/**
 * One dependency, named by what its absence costs.
 *
 * "pvlib is missing" means nothing to an agronomist. "the photovoltaic model"
 * is the thing they came for, and the sidecar states it, so it is what shows.
 */
function PackageRow({ pkg }: { pkg: pyenv.EnvPackage }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-body">
      <span
        className={cn(
          "telemetry shrink-0 rounded-sm px-1 text-micro uppercase",
          pkg.optional
            ? "border border-border text-muted-foreground"
            : "bg-destructive-quiet/15 text-destructive-quiet"
        )}
      >
        {pkg.optional ? "degraded" : "missing"}
      </span>
      <span className="telemetry text-foreground">{pkg.distribution}</span>
      {pkg.version_problem ? (
        <span className="text-muted-foreground">
          {pkg.version_problem}
          {pkg.wanted && <> · needs {pkg.wanted}</>}
          {pkg.why && <> · {pkg.why}</>}
        </span>
      ) : (
        <span className="text-muted-foreground">without it: {pkg.blocks}</span>
      )}
    </li>
  )
}

/**
 * One resolved location, and whether it is actually there.
 *
 * A missing path is called out rather than left to be noticed. Each of these
 * resolves to something whether or not it exists -- the model directory falls
 * back to a legacy training path that is absent in every release -- so a path
 * that is not there reads exactly like one that is, until an analysis fails on
 * it minutes later.
 */
function PathRow({ path }: { path: main.ResolvedPath }) {
  return (
    <li className="rounded-sm border border-border bg-background px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-body text-foreground">{path.label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Named, because a variable set once in a shell profile keeps
              deciding this and is the last thing anyone suspects. */}
          {path.source && (
            <span className="telemetry rounded-sm border border-border px-1 text-micro text-muted-foreground">
              {path.source}
            </span>
          )}
          {!path.exists && (
            <span className="telemetry flex items-center gap-1 rounded-sm bg-destructive-quiet/15 px-1 text-micro uppercase text-destructive-quiet">
              <AlertTriangle className="size-3" />
              not found
            </span>
          )}
        </div>
      </div>
      <p className="telemetry mt-0.5 break-all text-micro text-muted-foreground">
        {path.path || "not resolved"}
      </p>
      {!path.exists && path.blocks && (
        <p className="mt-1 text-micro text-muted-foreground">
          without it: {path.blocks}
        </p>
      )}
    </li>
  )
}

function CandidateRow({
  candidate,
  active,
  disabled,
  busy,
  onBuild,
  onChoose,
}: {
  candidate: pyenv.PythonCandidate
  active: boolean
  disabled: boolean
  busy: boolean
  onBuild: () => void
  onChoose: () => void
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="telemetry truncate text-body text-foreground">
          {candidate.path}
        </p>
        <p className="text-micro text-muted-foreground">
          {ORIGIN_LABEL[candidate.origin] ?? candidate.origin}
          {active && " · in use"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onChoose}
          disabled={disabled || active}
          className={btnGhost}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Use as is
        </button>
        <button
          type="button"
          onClick={onBuild}
          disabled={disabled}
          className={btnPrimaryCommit}
        >
          Build environment
        </button>
      </div>
    </li>
  )
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "error"
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        "rounded-sm border px-3 py-2 text-body",
        tone === "error"
          ? "border-destructive-quiet/40 text-destructive-quiet"
          : "border-border text-muted-foreground"
      )}
    >
      {children}
    </p>
  )
}
