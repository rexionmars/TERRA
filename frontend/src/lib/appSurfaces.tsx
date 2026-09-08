/**
 * The surfaces the application menu opens, and the state that keeps them.
 *
 * WHAT THEY HAVE IN COMMON. Four things here could be reached exactly once and
 * then never again: the splash still is shown while the window boots and
 * replaced, the release notes appear on the first launch after an upgrade and
 * mark themselves seen, and the storage report and the Python environment live
 * inside the account page, which is a different screen from wherever the reader
 * is working. None is about what is on screen -- they are about the
 * application -- so a per-screen home was never right for them.
 *
 * WHY A HOOK AND NOT A MENU. The application menu already exists: the studio
 * bar opens one at its left end, where Blender puts File, and its own note
 * says so. A second menu on the wordmark would have been a second answer to
 * "where are this application's own commands", which is the question that menu
 * was built to answer. So this module owns the rooms and the existing menu
 * keeps the door.
 *
 * The caller renders the items with its own menu primitives -- one menu, one
 * look -- and drops `surfaces` anywhere in its tree. Everything here portals
 * or is a modal, so where it lands does not matter.
 */
import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { GetAppVersion } from "../../wailsjs/go/main/App"
import { BRAND_TAGLINE, RELEASE_NAME } from "@/lib/brand"
import { notesForVersion } from "@/lib/whatsNew"
import { useStorageReport } from "@/lib/storageReport"
import { EnvironmentPanel } from "@/components/EnvironmentPanel"
import { SplashScreen } from "@/components/SplashScreen"
import { StorageModal } from "@/components/StorageModal"
import { WhatsNewModal } from "@/components/WhatsNewModal"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"

/** Which surface the menu opened, or none. One at a time, by construction. */
type Showing = "splash" | "whatsnew" | "environment" | "about" | null

/** What the caller's menu needs to draw one item. */
export interface AppSurfaceItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface AppSurfaces {
  /** The items above the caller's own, in the order they should be drawn. */
  items: {
    splash: AppSurfaceItem
    releaseNotes: AppSurfaceItem
    environment: AppSurfaceItem
    storage: AppSurfaceItem
    about: AppSurfaceItem
  }
  /** Render this once, anywhere: every piece of it portals or is a modal. */
  surfaces: React.ReactNode
}

export function useAppSurfaces(): AppSurfaces {
  const [showing, setShowing] = useState<Showing>(null)
  const storage = useStorageReport()
  const close = useCallback(() => setShowing(null), [])

  return {
    items: {
      splash: { label: "Splash screen", onSelect: () => setShowing("splash") },
      releaseNotes: {
        label: `What\u2019s new in ${RELEASE_NAME}`,
        onSelect: () => setShowing("whatsnew"),
      },
      environment: {
        label: "Python environment\u2026",
        onSelect: () => setShowing("environment"),
      },
      /*
        Measures before it opens, so the dialog never renders against a report
        that has not arrived. The wait sits on this press, which is where the
        reader is already looking -- and the caller closes its menu first, so
        the delay reads as the dialog coming rather than as the menu having
        ignored the click.
      */
      storage: {
        label: "Storage\u2026",
        disabled: storage.busy,
        onSelect: () => void storage.measureAndOpen(),
      },
      about: { label: "About TERRA", onSelect: () => setShowing("about") },
    },
    surfaces: (
      <>
        {showing === "splash" && <SplashReplay onDone={close} />}
        {showing === "whatsnew" && <ReleaseNotes onClose={close} />}
        {showing === "environment" && (
          <ModalShell
            onDismiss={close}
            labelledBy="app-environment-title"
            className="h-[min(82vh,760px)] w-[min(94vw,780px)]"
          >
            <ModalHeader
              eyebrow="System"
              title="Python environment"
              titleId="app-environment-title"
              subtitle="The interpreter the analyses run in, and what is installed in it."
              onClose={close}
            />
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <EnvironmentPanel />
            </div>
          </ModalShell>
        )}
        {showing === "about" && <About onClose={close} />}
        {storage.open && storage.report && (
          <StorageModal
            report={storage.report}
            busy={storage.busy}
            note={storage.note}
            problem={storage.problem}
            onRefresh={() => void storage.refresh()}
            onPurge={() => void storage.purge()}
            onClose={storage.close}
          />
        )}
      </>
    ),
  }
}

/**
 * The splash, shown because it was asked for.
 *
 * Over everything and dismissed by anything: this is a still, not a dialog --
 * there is nothing in it to decide, so any press or key puts it away. `live`
 * is false, which is what stops it claiming to be booting something.
 */
function SplashReplay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const done = () => onDone()
    document.addEventListener("pointerdown", done)
    document.addEventListener("keydown", done)
    return () => {
      document.removeEventListener("pointerdown", done)
      document.removeEventListener("keydown", done)
    }
  }, [onDone])

  return createPortal(
    <div className="fixed inset-0 z-[500]">
      <SplashScreen live={false} />
    </div>,
    document.body
  )
}

/**
 * The notes for the release that is running.
 *
 * The gate that shows these on an upgrade asks for everything since the
 * version last seen. Asked for deliberately, that span is the wrong question:
 * the reader wants to know what this release is, not what they have missed. So
 * it is the running version's entry, and the newest one when the running
 * version has none -- which is what a development build between tags is.
 */
function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    GetAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v?.trim() || "")
      })
      .catch(() => {
        if (!cancelled) setVersion("")
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (version === null) return null

  const entries = notesForVersion(version)
  if (!entries.length) return null

  return (
    <WhatsNewModal
      currentVersion={version || entries[0].version}
      entries={entries}
      onContinue={onClose}
    />
  )
}

/** Name, release, version. What the application is, and which one this is. */
function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("")

  useEffect(() => {
    let cancelled = false
    GetAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v?.trim() ?? "")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ModalShell
      onDismiss={onClose}
      labelledBy="app-menu-about-title"
      className="w-[min(92vw,26rem)]"
    >
      <ModalHeader
        eyebrow="About"
        title="TERRA"
        titleId="app-menu-about-title"
        subtitle={BRAND_TAGLINE}
        onClose={onClose}
      />
      <div className="px-4 py-4">
        <img
          src="/terra-logo.png"
          alt=""
          className="mb-4 h-12 w-12 object-contain"
        />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-meta">
          <dt className="text-muted-foreground">Release</dt>
          <dd className="text-foreground">{RELEASE_NAME}</dd>
          <dt className="text-muted-foreground">Version</dt>
          {/*
            Read from the binary rather than from a constant in this bundle: a
            number the frontend keeps is a number that can disagree with the
            application it is describing, which is the whole reason to ask.
          */}
          <dd className="tabular-nums text-foreground">
            {version || "unknown"}
          </dd>
        </dl>
      </div>
    </ModalShell>
  )
}
