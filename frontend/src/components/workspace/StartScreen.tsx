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
import { BRAND_PHOTO, BRAND_TAGLINE } from "@/lib/brand"
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
  The picture across the top: the splash's photograph, cropped to the card, so
  the start screen opens on the picture the boot window has just shown. It is
  not a release still. The release's code name stays in RELEASE_NAME and
  FEATURED_STILL, which this card does not show. BRAND_PHOTO holds the credit,
  the licence's terms and how the file was produced.
*/
const START_PICTURE = {
  path: "/terra-start-water-tap.webp",
  subject:
    "two children at a concrete water tap in a dry field, filling a yellow " +
    "jerrycan, under a blue sky with hills behind",
}

/*
  The splash's base, here in the panel's colour: the tab rises from the card's
  panel into the picture's foot with the wordmark on it, so the picture and
  the rows below read as one piece, as the photograph and the bar do on the
  splash. Both are masks, painted with the theme's panel and text colours,
  since the panel is light under the light theme. 0.72 of the splash's full
  window, so the wordmark is 108 px wide in a 500 px card.

  The numbers are terra-name-tab.svg's: 305.66 by 34 units, the wordmark 150
  units wide and set 9.7 units below the tab's foot, where it sits on the
  splash's bar.
*/
const TAB_UNIT = 0.72

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
          lockup, the version and the credit over its sky and the tab at its
          foot. The picture and its type stay dark in either theme, as the
          splash does; the tab takes the panel's colour.

          Not clipped, so the wordmark can run down past the picture's foot
          onto the panel, as it runs onto the bar on the splash. The card
          itself clips at its rounded corners.
        */}
        <div className="relative h-[210px]" style={{ background: "#04060b" }}>
          <img
            src={START_PICTURE.path}
            alt=""
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
          {/*
            Dark at the top for the lines set on the sky, and clear from the
            middle down, so the people and the ground are shown as they were
            taken. Measured at the card's size, against the brightest pixel
            under each line, in the line's own colour: the tagline 6.49, the
            version 7.21, the credit 5.42. The credit read 4.55 at 80% bone, so
            it is set at the version's 92%. The wordmark is on the tab, in the
            panel's own text colour.
          */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(4 6 11 / 0.82) 0%, rgb(4 6 11 / 0.5) 24%, rgb(4 6 11 / 0) 52%)",
            }}
            aria-hidden
          />
          <div className="absolute top-4 left-5 flex items-center gap-2.5">
            <img src="/terra-logo.png" alt="" className="size-6" draggable={false} />
            <span
              className="w-min border-l pl-2.5 text-micro leading-tight tracking-[0.16em] capitalize"
              style={{
                color: "rgb(236 232 223 / 0.95)",
                borderColor: "rgb(236 232 223 / 0.55)",
              }}
            >
              {BRAND_TAGLINE}
            </span>
          </div>
          <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
            {version && (
              <span
                className="telemetry text-meta tracking-[0.12em] uppercase"
                style={{ color: "rgb(236 232 223 / 0.92)" }}
              >
                v{version}
              </span>
            )}
            <button
              type="button"
              className="cursor-pointer text-meta hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              style={{ color: "rgb(236 232 223 / 0.92)" }}
              title="Cropped and resized from the original on Pexels"
              onClick={() => BrowserOpenURL(BRAND_PHOTO.source)}
            >
              Photo: {BRAND_PHOTO.author} · {BRAND_PHOTO.license}
            </button>
          </div>
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: -2 * TAB_UNIT,
              width: 305.66 * TAB_UNIT,
              aspectRatio: "305.66 / 34",
              background: "var(--s-panel)",
              mask: 'url("/terra-name-tab.svg") center / 100% 100% no-repeat',
            }}
            aria-hidden
          />
          <div
            role="img"
            aria-label="TERRA"
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: -9.7 * TAB_UNIT,
              width: 150 * TAB_UNIT,
              aspectRatio: "4669 / 728",
              background: "var(--foreground)",
              mask: 'url("/terra-wordmark-filled.svg") center / 100% 100% no-repeat',
            }}
          />
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
