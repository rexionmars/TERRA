/**
 * The start screen, as Blender's splash and Solara's: a picture across the top,
 * then what to begin and what to reopen side by side, then the ways to the
 * keymap, the settings and the release.
 *
 * Opened once per launch when the studio first mounts, unless turned off from
 * its own foot, and again from the Options menu (START). It goes on a press
 * outside it, on Escape, on any of its own actions, and when the work starts
 * without it -- a studio opened or a plane put on the board some other way.
 *
 * Not a modal. The keymap keeps working under it, so Cmd-N or F3 pressed with
 * it open do what they say, and it closes behind them.
 */
import { useEffect, useRef, useState } from "react"
import { File, FolderOpen, Stack, type Icon } from "@/components/icons"

import { GetAppVersion } from "../../../wailsjs/go/main/App"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { BRAND_TAGLINE } from "@/lib/brand"
import {
  OPERATORS,
  pollOperator,
  runOperator,
  shortcut,
  type OperatorId,
} from "@/lib/operators"
import { projectFileName } from "@/lib/projectFiles"
import type { Studio } from "@/lib/studios"
import { cn } from "@/lib/utils"

/** As many as Blender lists; the rest are behind Manage workflows. */
const RECENT_SHOWN = 5

/*
  The picture across the top: the ararajuba, the golden parakeet the mark is
  drawn from. It is not a release still. The release's code name stays in
  RELEASE_NAME and FEATURED_STILL, which this card does not show.

  CC BY-SA 3.0, from Wikimedia Commons, where it is also offered under the
  GFDL. The licence asks for the author, the licence and a way to the source.
  The card names the first two and links to the file's page, which states all
  three. The file here is cropped and resized from the original, so it is an
  adaptation and carries the same licence. That binds this one file and not
  the code around it.

  Produced as docs/RELEASING.md encodes the stills. The 3197x2530 original was
  cropped at full width to the card's 500:210, from y 253 to 1596, then resized
  to 1600x672 with Lanczos and passed through cwebp -q 82, giving 67 KB.
*/
const START_PICTURE = {
  path: "/terra-start-ararajuba.webp",
  subject:
    "a golden parakeet (Guaruba guarouba) on a branch, facing right, its " +
    "head in the upper right of the frame, on a dark brown ground",
  author: "H. Zell",
  license: "CC BY-SA 3.0",
  source:
    "https://commons.wikimedia.org/wiki/File:Guaruba_guarouba_-_Karlsruhe_Zoo_01.jpg",
}

/*
  Claimed once per launch, not per mount: the studio screen remounts whenever a
  studio is opened, and a start screen that came back each time would be in the
  way of the work it exists to begin.
*/
let launchClaimed = false

/** True the first time it is asked in a launch, false after. */
export function claimLaunchStart(): boolean {
  if (launchClaimed) return false
  launchClaimed = true
  return true
}

function Row({
  icon: Glyph,
  label,
  hint,
  title,
  disabled,
  checked,
  onSelect,
}: {
  icon?: Icon
  label: string
  hint?: string
  title?: string
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group flex h-7 w-full min-w-0 items-center gap-2.5 rounded-sm px-1.5 text-left text-body transition-colors",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        disabled
          ? "cursor-not-allowed text-muted-foreground/50"
          : "text-foreground/90 hover:bg-hover hover:text-foreground"
      )}
    >
      {checked ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span className="size-1.5 rounded-xs bg-accent" aria-hidden />
        </span>
      ) : Glyph ? (
        <Glyph className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      {hint && (
        <span className="telemetry ml-auto shrink-0 pl-2 text-meta text-muted-foreground">
          {hint}
        </span>
      )}
    </button>
  )
}

export function StartScreen({
  onClose,
  studios,
  openStudioId,
  onOpenStudio,
  onBrowse,
  showAtLaunch,
  onShowAtLaunchChange,
  recentFiles,
  onOpenFile,
}: {
  onClose: () => void
  /** The active project's studios, most recently saved first. */
  studios: readonly Studio[]
  openStudioId: string | null
  onOpenStudio: (studio: Studio) => void
  /** Opens the workspace that holds the Browser. */
  onBrowse: () => void
  showAtLaunch: boolean
  onShowAtLaunchChange: (show: boolean) => void
  /** Project files opened or saved, newest first. */
  recentFiles: readonly string[]
  onOpenFile: (path: string) => void
}) {
  const [version, setVersion] = useState<string | null>(null)
  const rows = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    GetAppVersion()
      .then((v) => {
        if (!cancelled && v) setVersion(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // The first row takes the focus, so the keyboard starts where the eye does.
  // The rows are searched, not the card, because the picture's credit is a
  // button and comes before them.
  useEffect(() => {
    rows.current
      ?.querySelector<HTMLElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened over it takes its own Escape first.
      if (e.key !== "Escape" || document.querySelector('[aria-modal="true"]')) return
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  const act = (run: () => unknown) => () => {
    onClose()
    run()
  }
  const opRow = (id: OperatorId, label?: string) => {
    const poll = pollOperator(id)
    return (
      <Row
        icon={OPERATORS[id].icon}
        label={label ?? OPERATORS[id].label}
        hint={shortcut(id)}
        title={poll === true ? OPERATORS[id].description : poll}
        disabled={poll !== true}
        onSelect={act(() => runOperator(id))}
      />
    )
  }

  return (
    <div
      className="absolute inset-0 z-495 flex items-center justify-center p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Start"
        className="w-[500px] max-w-full overflow-hidden rounded-md border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{
          background: "var(--s-panel)",
          borderColor: "rgb(var(--p-line) / 0.4)",
        }}
      >
        {/*
          The picture at the card's width, under the void scrim, with the
          lockup and the outlined wordmark over it. It stays dark in either
          theme, as the splash does.
        */}
        <div
          className="relative h-[210px] overflow-hidden"
          style={{ background: "#04060b" }}
        >
          <img
            src={START_PICTURE.path}
            alt=""
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
          {/*
            Dark at the top for the two lines set there, dark at the foot for
            the wordmark and the credit. Measured over the ararajuba at the
            card's size, against the brightest pixel under each line, in the
            line's own colour:
            - the tagline, bone at 92%: 12.06;
            - the version, bone at 92%: 8.03;
            - the credit, bone at 70%: 6.33;
            - the wordmark: 4.49, over the 3.0 that large type needs.
            The three lines clear WCAG's 4.5. The stops were set over Cumulus,
            a bright cloud, where the tagline read 5.96. They stay at that
            strength so that a lighter picture does not need them redone.
          */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(4 6 11 / 0.86) 0%, rgb(4 6 11 / 0.62) 22%, rgb(4 6 11 / 0.15) 42%, rgb(4 6 11 / 0.55) 70%, rgb(4 6 11 / 0.9) 100%)",
            }}
            aria-hidden
          />
          <div className="absolute top-4 left-5 flex items-center gap-2.5">
            <img src="/terra-logo.png" alt="" className="size-6" draggable={false} />
            <span
              className="telemetry w-min border-l pl-2.5 text-micro leading-tight tracking-[0.14em] uppercase"
              style={{
                color: "rgb(236 232 223 / 0.92)",
                borderColor: "rgb(236 232 223 / 0.3)",
              }}
            >
              {BRAND_TAGLINE}
            </span>
          </div>
          {version && (
            <span
              className="telemetry absolute top-4 right-4 text-meta tracking-[0.12em] uppercase"
              style={{ color: "rgb(236 232 223 / 0.92)" }}
            >
              v{version}
            </span>
          )}
          <img
            src="/terra-wordmark.svg"
            alt="TERRA"
            width={4669}
            height={728}
            className="absolute bottom-4 left-5 h-auto w-[300px]"
            draggable={false}
          />
          <button
            type="button"
            className="absolute right-4 bottom-3.5 cursor-pointer text-meta hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            style={{ color: "rgb(236 232 223 / 0.7)" }}
            title="Cropped and resized from the original on Wikimedia Commons"
            onClick={() => BrowserOpenURL(START_PICTURE.source)}
          >
            Photo: {START_PICTURE.author} · {START_PICTURE.license}
          </button>
        </div>

        <div ref={rows} className="grid grid-cols-2 gap-x-6 px-6 pt-4 pb-2">
          <section className="min-w-0">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">Start</p>
            {opRow("WORKFLOW_NEW")}
            {opRow("PROJECT_OPEN")}
            <Row
              icon={FolderOpen}
              label="Browse saved analyses"
              title="Every saved analysis, filed under its project"
              onSelect={act(onBrowse)}
            />
            {opRow("SEARCH")}
          </section>
          <section className="min-w-0">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">
              Recent workflows
            </p>
            {studios.length ? (
              studios
                .slice(0, RECENT_SHOWN)
                .map((s) => (
                  <Row
                    key={s.id}
                    icon={Stack}
                    label={s.name}
                    checked={s.id === openStudioId}
                    title={s.id === openStudioId ? "Already open" : `Open "${s.name}"`}
                    onSelect={act(() => onOpenStudio(s))}
                  />
                ))
            ) : (
              <p className="px-1.5 py-1.5 text-meta leading-relaxed text-muted-foreground">
                No workflow saved in this project yet. A saved workflow is listed here.
              </p>
            )}
            {studios.length > 0 && opRow("WORKFLOW_MANAGE", "More\u2026")}
          </section>
        </div>

        {/*
          The files, under the studios: a studio is this project's, a file can
          be any project's, and reopening one is the other thing a reader
          arrives here to do.
        */}
        {recentFiles.length > 0 && (
          <section className="min-w-0 px-6 pb-2">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">
              Recent project files
            </p>
            <div className="grid grid-cols-2 gap-x-6">
              {recentFiles.slice(0, RECENT_SHOWN - 1).map((path) => (
                <Row
                  key={path}
                  icon={File}
                  label={projectFileName(path)}
                  title={path}
                  onSelect={act(() => onOpenFile(path))}
                />
              ))}
            </div>
          </section>
        )}

        <div className="mx-6 border-t border-hairline" />

        <div className="grid grid-cols-2 gap-x-6 px-6 pt-2 pb-3">
          <section className="min-w-0">
            {opRow("KEYMAP")}
            {opRow("PREFERENCES", "Settings")}
          </section>
          <section className="min-w-0">
            {opRow("RELEASE_NOTES")}
            {opRow("ABOUT")}
          </section>
        </div>

        <label className="flex items-center gap-2 border-t border-hairline px-6 py-2 text-meta text-muted-foreground">
          <input
            type="checkbox"
            checked={showAtLaunch}
            onChange={(e) => onShowAtLaunchChange(e.target.checked)}
            className="focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
          Show this when TERRA opens
        </label>
      </div>
    </div>
  )
}
