/**
 * The start screen, as Blender's splash and Solara's: the release's still across
 * the top, then what to begin and what to reopen side by side, then the ways to
 * the keymap, the settings and the release.
 *
 * Opened once per launch when the studio first mounts, unless turned off from
 * its own foot, and again from the Studio menu (START). It goes on a press
 * outside it, on Escape, on any of its own actions, and when the work starts
 * without it -- a studio opened or a plane put on the board some other way.
 *
 * Not a modal. The keymap keeps working under it, so Cmd-N or F3 pressed with
 * it open do what they say, and it closes behind them.
 */
import { useEffect, useRef, useState } from "react"
import { FolderOpen, Stack, type Icon } from "@phosphor-icons/react"

import { GetAppVersion } from "../../../wailsjs/go/main/App"
import { BRAND_TAGLINE, RELEASE_NAME } from "@/lib/brand"
import {
  OPERATORS,
  pollOperator,
  runOperator,
  shortcut,
  type OperatorId,
} from "@/lib/operators"
import { FEATURED_STILL, SPLASH_STILLS } from "@/lib/splashBackground"
import type { Studio } from "@/lib/studios"
import { cn } from "@/lib/utils"

/** As many as Blender lists; the rest are behind Manage studios. */
const RECENT_SHOWN = 5

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
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        disabled
          ? "cursor-not-allowed text-muted-foreground/50"
          : "text-foreground/90 hover:bg-hover hover:text-foreground"
      )}
    >
      {checked ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <span className="size-1.5 rounded-[1px] bg-accent" aria-hidden />
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
}) {
  const [version, setVersion] = useState<string | null>(null)
  const card = useRef<HTMLDivElement>(null)

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
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true })
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

  const still = SPLASH_STILLS.find((s) => s.name === FEATURED_STILL) ?? SPLASH_STILLS[0]
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
      className="absolute inset-0 z-[100] flex items-center justify-center p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={card}
        role="dialog"
        aria-label="Start"
        className="w-[500px] max-w-full overflow-hidden rounded-md border shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        style={{ background: "var(--s-panel)", borderColor: "rgb(var(--p-line) / 0.4)" }}
      >
        {/*
          The splash's own picture, at the card's width: the release's still
          under the void scrim, the lockup, and the outlined wordmark.
          Fixed dark, as the splash is, whatever the theme.
        */}
        <div className="relative h-[210px] overflow-hidden" style={{ background: "#04060b" }}>
          <img
            src={still.path}
            alt=""
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
          {/*
            Dark at the top for the two lines set there, dark at the foot for
            the wordmark. Measured over Cumulus at the card's size, the
            brightest pixel under each line against bone at 92%: the tagline
            5.96, the version 6.53. At 0.82 over the top and bone at 85% the
            tagline read 4.41, under WCAG's 4.5, where the cloud is brightest.
          */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(4 6 11 / 0.86) 0%, rgb(4 6 11 / 0.62) 22%, rgb(4 6 11 / 0.15) 42%, rgb(4 6 11 / 0.55) 70%, rgb(4 6 11 / 0.9) 100%)",
            }}
            aria-hidden
          />
          <div className="absolute left-5 top-4 flex items-center gap-2.5">
            <img src="/terra-logo.png" alt="" className="size-6" draggable={false} />
            <span
              className="telemetry w-min border-l pl-2.5 text-[9px] uppercase leading-tight tracking-[0.14em]"
              style={{ color: "rgb(236 232 223 / 0.92)", borderColor: "rgb(236 232 223 / 0.3)" }}
            >
              {BRAND_TAGLINE}
            </span>
          </div>
          <span
            className="telemetry absolute right-4 top-4 text-[10px] uppercase tracking-[0.12em]"
            style={{ color: "rgb(236 232 223 / 0.92)" }}
          >
            {version ? `v${version} \u00b7 ${RELEASE_NAME}` : RELEASE_NAME}
          </span>
          <img
            src="/terra-wordmark.svg"
            alt="TERRA"
            width={4669}
            height={728}
            className="absolute bottom-4 left-5 h-auto w-[300px]"
            draggable={false}
          />
          <span
            className="absolute bottom-3.5 right-4 text-[10px]"
            style={{ color: "rgb(236 232 223 / 0.7)" }}
            title={still.source}
          >
            {still.photographer}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 px-6 pb-2 pt-4">
          <section className="min-w-0">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">Start</p>
            {opRow("STUDIO_NEW")}
            <Row
              icon={FolderOpen}
              label="Browse saved analyses"
              title="The Data workspace, whose Browser files every run by project"
              onSelect={act(onBrowse)}
            />
            {opRow("SEARCH")}
          </section>
          <section className="min-w-0">
            <p className="mb-1 px-1.5 text-body text-muted-foreground">Recent studios</p>
            {studios.length ? (
              studios.slice(0, RECENT_SHOWN).map((s) => (
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
                No studio saved in this project yet. A saved studio is listed here.
              </p>
            )}
            {studios.length > 0 && opRow("STUDIO_MANAGE", "More\u2026")}
          </section>
        </div>

        <div className="mx-6 border-t border-hairline" />

        <div className="grid grid-cols-2 gap-x-6 px-6 pb-3 pt-2">
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
            className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          Show this when TERRA opens
        </label>
      </div>
    </div>
  )
}
