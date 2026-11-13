import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence } from "motion/react"
import { useTheme } from "next-themes"

import {
  ChooseBackupArchive,
  ExportBackup,
  RestoreBackup,
} from "../../../wailsjs/go/main/App"
import type { store } from "../../../wailsjs/go/models"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { EnvironmentPanel } from "@/components/EnvironmentPanel"
import { KeymapTable } from "@/components/KeymapTable"
import { StorageModal } from "@/components/StorageModal"
import {
  CaretRight,
  Check,
  CircleNotch,
  Download,
  HardDrive,
  Heart,
  Keyboard,
  SlidersHorizontal,
  Star,
  Terminal,
  Upload,
  User,
} from "@/components/icons"
import { ProfileSection } from "@/components/shell/ProfileSection"
import {
  CARD,
  Segmented,
  SettingGroup,
  SettingRow,
} from "@/components/shell/settingsParts"
import { btnGhost, btnGhostDense, btnPrimary } from "@/components/ui/buttons"
import { useAuth, type SettingsPage } from "@/lib/auth"
import { REPO_URL } from "@/lib/brand"
import { formatBytes } from "@/lib/formatBytes"
import {
  alwaysShowWhatsNewFromPrefs,
  mergePreferenceExtras,
} from "@/lib/preferenceExtras"
import { useStorageReport } from "@/lib/storageReport"
import type { InferenceRun, Preferences } from "@/lib/types"
import { cn } from "@/lib/utils"

/*
  The way to support the project, from what the repository declares:
  .github/FUNDING.yml names `github: rexionmars`. A sponsor button that leads
  nowhere is worse than none.
*/
const SPONSOR_URL = "https://github.com/sponsors/rexionmars"

/*
  THE PAGES, BY WHOSE THEY ARE. The account's -- who you are, how TERRA looks
  to you, and what you have saved -- and the application's -- the environment
  the analyses run in, and the keys. The theme belongs to the person signed in
  rather than to the installation, so it is under the account.
*/
const PAGES: readonly {
  id: SettingsPage
  label: string
  icon: typeof User
  group: "Account" | "Application"
  /** What the page holds, under its heading. */
  summary: string
}[] = [
  { id: "profile", label: "Profile", icon: User, group: "Account", summary: "" },
  {
    id: "appearance",
    label: "Appearance",
    icon: SlidersHorizontal,
    group: "Account",
    summary: "How TERRA looks, and what it shows when it starts.",
  },
  {
    id: "data",
    label: "Data",
    icon: HardDrive,
    group: "Account",
    summary:
      "Everything you save lives in one directory on this machine, with no server holding a second copy. This is where to see it and take it with you.",
  },
  {
    id: "system",
    label: "System",
    icon: Terminal,
    group: "Application",
    summary:
      "The Python environment the analyses run in, and the logins they read data with.",
  },
  {
    id: "keymap",
    label: "Keymap",
    icon: Keyboard,
    group: "Application",
    summary: "Every command, with its keys and the menu it is in.",
  },
]

/**
 * Settings: a destination in the map's shell, as Models is, so it keeps the
 * rail, the frame and the path, and is left by pressing another place.
 *
 * A column of pages at the left and the page beside it, one at a time: the
 * column switches the page rather than scrolling to a heading, so a page does
 * not grow without bound as settings are added.
 */
export function SettingsScreen({
  section,
  onSection,
  onOpenRun,
  opening,
}: {
  section: SettingsPage
  onSection: (page: SettingsPage) => void
  onOpenRun: (run: InferenceRun) => void
  opening: boolean
}) {
  const { user } = useAuth()
  const page = PAGES.find((p) => p.id === section) ?? PAGES[0]
  /*
    Back to the top when the page changes: the column is a list of pages, and
    a page opened halfway down reads as a page with nothing at its head.
  */
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [section])

  if (!user) return null

  return (
    <div className="app-no-drag absolute inset-0 z-480 flex flex-col bg-app pt-[var(--frame-reach,0px)]">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-4">
        <button
          type="button"
          onClick={() => onSection("profile")}
          className="text-title font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Settings
        </button>
        <CaretRight className="size-3 text-muted-foreground" />
        <h1 className="text-title font-medium text-foreground">{page.label}</h1>
        <div className="flex-1" />
        <p className="telemetry text-meta text-muted-foreground">
          Preferences apply as they change
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings"
          className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border px-3 py-5"
        >
          {(["Account", "Application"] as const).map((group) => (
            <div key={group} className="mb-5">
              <p className="mb-1.5 px-2.5 text-meta text-muted-foreground">{group}</p>
              {PAGES.filter((p) => p.group === group).map((p) => {
                const active = p.id === section
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSection(p.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-read transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
                      // A ground and not the accent, as the rail marks a place.
                      active
                        ? "bg-[rgb(var(--p-surface-raised))] text-foreground"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground"
                    )}
                  >
                    <p.icon className="size-4 shrink-0" />
                    {p.label}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="flex-1" />
          <OpenSource />
        </nav>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[56rem] px-8 pt-8 pb-16">
            {section === "profile" ? (
              <ProfileSection onOpenRun={onOpenRun} opening={opening} />
            ) : (
              <>
                <h2 className="font-display text-display font-semibold text-foreground">
                  {page.label}
                </h2>
                <p className="mt-1 max-w-prose text-read text-muted-foreground">
                  {page.summary}
                </p>
                <div className="mt-8">
                  {section === "appearance" && <AppearancePage />}
                  {section === "data" && <DataPage />}
                  {section === "system" && <EnvironmentPanel />}
                  {section === "keymap" && (
                    <div className={CARD}>
                      <KeymapTable />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type Theme = "dark" | "light" | "system"

/*
  THE PREFERENCES ARE SAVED AS THEY CHANGE, a moment after the last change, so
  a reader going through the themes writes once. The model and the opacity are
  written back exactly as they were read: this page does not edit them -- both
  are set on the map, where they are used -- but Preferences carries them, and
  a save that left them out would write a zero opacity and an empty model over
  what is stored.
*/
function AppearancePage() {
  const { user, prefs, savePrefs } = useAuth()
  const { setTheme: applyTheme } = useTheme()
  const [theme, setTheme] = useState<Theme>("dark")
  const [always, setAlways] = useState(false)
  const ready = useRef(false)
  const timer = useRef<number | null>(null)
  const draft = useRef<{ theme: Theme; alwaysShowWhatsNew?: boolean }>({
    theme: "dark",
  })

  useEffect(() => {
    if (!prefs) return
    const t = (prefs.theme || "dark") as Theme
    setTheme(t)
    setAlways(alwaysShowWhatsNewFromPrefs(prefs))
    draft.current = { theme: t }
    ready.current = true
  }, [prefs])

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

  const persist = useCallback(
    async (next: { theme: Theme; alwaysShowWhatsNew?: boolean }) => {
      if (!user) return
      const payload: Preferences = {
        user_id: user.id,
        default_model: prefs?.default_model || "spectral",
        overlay_opacity: prefs?.overlay_opacity ?? 0.75,
        theme: next.theme,
        extras_json: mergePreferenceExtras(prefs?.extras_json, {
          /*
            Tested against undefined, not for truth: a truthiness test would
            drop `false` as though it had never been set, leaving the setting
            impossible to turn off.
          */
          ...(next.alwaysShowWhatsNew !== undefined
            ? { always_show_whats_new: next.alwaysShowWhatsNew }
            : {}),
        }),
      }
      await savePrefs(payload)
      applyTheme(next.theme)
    },
    [prefs, savePrefs, applyTheme, user]
  )

  const schedule = (patch: Partial<{ theme: Theme; alwaysShowWhatsNew: boolean }>) => {
    if (!ready.current) return
    draft.current = { ...draft.current, ...patch }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void persist(draft.current), 280)
  }

  return (
    <>
      <SettingGroup
        title="Theme"
        description="System follows the appearance macOS or Windows is set to, and changes with it."
      >
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-3 gap-3 px-5 py-5"
        >
          {(["dark", "light", "system"] as const).map((t) => (
            <ThemeChoice
              key={t}
              theme={t}
              chosen={theme === t}
              onChoose={() => {
                setTheme(t)
                schedule({ theme: t })
              }}
            />
          ))}
        </div>
      </SettingGroup>

      <SettingGroup title="Release notes">
        <SettingRow
          title="What's New"
          description={
            always
              ? "Every start opens on the notes for this version, read from the first release rather than the last one seen, until this is set back."
              : "A release announces itself once, at the first start after an update, and then stays out of the way."
          }
        >
          <Segmented
            label="When What's New is shown"
            value={always ? "always" : "once"}
            options={[
              { value: "once", label: "Once per version" },
              { value: "always", label: "At every start" },
            ]}
            onChange={(v) => {
              setAlways(v === "always")
              schedule({ alwaysShowWhatsNew: v === "always" })
            }}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

/*
  The window in small, in the theme's own colours, so a theme is chosen by how
  it looks rather than by its name: the frame, the rail's three places, a card
  with a panel on it, and the accent. Fixed colours, not tokens, since each
  draws a theme other than the one in use; System is the two, split.
*/
const SWATCH = {
  dark: { frame: "#0e0e0e", card: "#1b1b1b", panel: "#2c2c2c", line: "#4a4a4a" },
  light: { frame: "#d9d3d1", card: "#e9e5e3", panel: "#f7f5f4", line: "#a9a3a0" },
} as const

function ThemeChoice({
  theme,
  chosen,
  onChoose,
}: {
  theme: Theme
  chosen: boolean
  onChoose: () => void
}) {
  const label = { dark: "Dark", light: "Light", system: "System" }[theme]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onChoose}
      className={cn(
        "rounded-md border p-1.5 text-left transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        chosen
          ? "border-primary"
          : "border-[rgb(var(--p-line)/0.45)] hover:border-[rgb(var(--p-line-strong)/0.7)]"
      )}
    >
      <span className="relative block h-24 overflow-hidden rounded-sm">
        {theme === "system" ? (
          <>
            <Miniature colours={SWATCH.dark} />
            <span className="absolute inset-0 [clip-path:polygon(55%_0,100%_0,100%_100%,45%_100%)]">
              <Miniature colours={SWATCH.light} />
            </span>
          </>
        ) : (
          <Miniature colours={SWATCH[theme]} />
        )}
      </span>
      <span className="flex items-center gap-2 px-1 pt-2 pb-0.5 text-label text-foreground">
        <span
          aria-hidden
          className={cn(
            "grid size-3.5 place-items-center rounded-full border",
            chosen
              ? "border-primary bg-primary text-primary-foreground"
              : "border-[rgb(var(--p-line-strong)/0.8)]"
          )}
        >
          {chosen && <Check className="size-2.5" />}
        </span>
        {label}
      </span>
    </button>
  )
}

function Miniature({
  colours: c,
}: {
  colours: { frame: string; card: string; panel: string; line: string }
}) {
  return (
    <span className="absolute inset-0 flex gap-1 p-1" style={{ background: c.frame }}>
      <span className="flex w-3 flex-col items-center gap-1 pt-1.5">
        <span className="size-1.5 rounded-full" style={{ background: "#fc6f20" }} />
        <span className="size-1.5 rounded-full" style={{ background: c.line }} />
        <span className="size-1.5 rounded-full" style={{ background: c.line }} />
      </span>
      <span className="relative flex-1 rounded-sm" style={{ background: c.card }}>
        <span
          className="absolute top-2 right-2 bottom-2 w-2/5 rounded-xs p-1.5"
          style={{ background: c.panel }}
        >
          <span
            className="block h-1 w-3/4 rounded-full"
            style={{ background: c.line }}
          />
          <span
            className="mt-1 block h-1 w-1/2 rounded-full"
            style={{ background: c.line }}
          />
        </span>
      </span>
    </span>
  )
}

/*
  WHAT IS SAVED, AND HOW TO TAKE IT WITH YOU. The space is measured on disk
  rather than estimated, since nothing else reports it; the backup is built
  before its save dialog opens, so a large history spends its time with the
  button showing it is working; and a restore is two steps -- choose a file and
  read what it holds, then confirm -- because it replaces everything here.
*/
function DataPage() {
  const { logout } = useAuth()
  const storage = useStorageReport()
  const [backup, setBackup] = useState<{
    busy: boolean
    done?: string
    problem?: string
  }>({ busy: false })
  const [restore, setRestore] = useState<{
    busy: boolean
    preview?: store.RestorePreview
    done?: string
    problem?: string
  }>({ busy: false })

  const exportBackup = async () => {
    setBackup({ busy: true })
    try {
      const dest = await ExportBackup()
      // An empty path is a cancelled dialog: neither a success nor an error.
      setBackup({ busy: false, done: dest ? `Saved to ${dest}` : undefined })
    } catch (e) {
      setBackup({ busy: false, problem: e instanceof Error ? e.message : String(e) })
    }
  }

  /*
    Choosing a backup describes it and changes nothing. An archive that cannot
    be restored says so here, before anything is replaced.
  */
  const chooseBackup = async () => {
    setRestore({ busy: true })
    try {
      const preview = await ChooseBackupArchive()
      if (!preview) return setRestore({ busy: false })
      if (preview.problem) return setRestore({ busy: false, problem: preview.problem })
      setRestore({ busy: false, preview })
    } catch (e) {
      setRestore({ busy: false, problem: e instanceof Error ? e.message : String(e) })
    }
  }

  /*
    Signing out afterwards is not tidiness: the session belonged to the
    database just replaced, and every restored account carries no password
    hash. The result is shown for a moment first, since signing out leaves.
  */
  const runRestore = async () => {
    if (!restore.preview) return
    setRestore((r) => ({ ...r, busy: true }))
    try {
      const result = await RestoreBackup(restore.preview.archive_path)
      setRestore({
        busy: false,
        done:
          `Restored ${result.runs_restored} analyses and ${result.projects_restored} projects. ` +
          `Your previous data is at ${result.previous_data_path}. Sign in again to continue.`,
      })
      window.setTimeout(() => void logout(), 2500)
    } catch (e) {
      setRestore((r) => ({
        ...r,
        busy: false,
        problem: e instanceof Error ? e.message : String(e),
      }))
    }
  }

  const p = restore.preview
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`

  return (
    <>
      <SettingGroup title="Storage">
        <SettingRow
          title="Space used"
          description={
            storage.report
              ? "Measured on disk. The breakdown shows it by analysis, by type and by project, and what can be removed."
              : "What the saved data is made of, measured on disk, with a breakdown by analysis, type and project."
          }
        >
          <button
            type="button"
            disabled={storage.busy}
            onClick={() => void storage.measureAndOpen()}
            className={btnGhost}
          >
            {storage.busy ? (
              <CircleNotch className="size-3.5 animate-spin" />
            ) : (
              <HardDrive className="size-3.5" />
            )}
            {storage.report
              ? `${formatBytes(storage.report.total_bytes)} · Breakdown`
              : "Measure"}
          </button>
        </SettingRow>
        {storage.problem && (
          <p className="px-5 py-3 text-label text-destructive-quiet">
            {storage.problem}
          </p>
        )}
      </SettingGroup>

      <SettingGroup
        title="Backup"
        description="Passwords and sessions are left out of a backup, so the file can be stored or sent without carrying a credential."
      >
        <SettingRow
          title="Export a backup"
          description={
            backup.done ? (
              <span className="telemetry break-all text-foreground">{backup.done}</span>
            ) : backup.problem ? (
              <span className="text-destructive-quiet">{backup.problem}</span>
            ) : (
              "Your analyses, projects and their images, in one ZIP file."
            )
          }
        >
          <button
            type="button"
            disabled={backup.busy}
            onClick={() => void exportBackup()}
            className={btnGhost}
          >
            {backup.busy ? (
              <CircleNotch className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {backup.busy ? "Writing" : "Export"}
          </button>
        </SettingRow>
        <SettingRow
          title="Restore from a backup"
          stacked={!!p || !!restore.done}
          description={
            restore.problem ? (
              <span className="text-destructive-quiet">{restore.problem}</span>
            ) : (
              "Replaces everything here with what a backup holds. Your current data is moved aside, not deleted, and accounts come back needing a new password."
            )
          }
        >
          {restore.done ? (
            <p className="text-label text-foreground">{restore.done}</p>
          ) : p ? (
            <div className="flex flex-col gap-3 rounded-sm bg-[rgb(var(--p-sunk))] px-4 py-3">
              {/* What arrives and what it displaces, stated before the action. */}
              <p className="text-label text-foreground">
                This backup holds{" "}
                {plural(p.manifest.counts.runs, "analysis", "analyses")} and{" "}
                {plural(p.manifest.counts.projects, "project", "projects")}, written{" "}
                {p.manifest.created_at.slice(0, 10)}. Restoring replaces the{" "}
                {plural(p.current.runs, "analysis", "analyses")} and{" "}
                {plural(p.current.projects, "project", "projects")} here, and signs you
                out.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={restore.busy}
                  onClick={() => void runRestore()}
                  className={btnPrimary}
                >
                  {restore.busy && <CircleNotch className="size-3.5 animate-spin" />}
                  Replace my data
                </button>
                <button
                  type="button"
                  disabled={restore.busy}
                  onClick={() => setRestore({ busy: false })}
                  className={btnGhost}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={restore.busy}
              onClick={() => void chooseBackup()}
              className={btnGhost}
            >
              {restore.busy ? (
                <CircleNotch className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Choose a backup
            </button>
          )}
        </SettingRow>
      </SettingGroup>

      {/* Rendered only with a report in hand: measureAndOpen measures first. */}
      <AnimatePresence>
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
      </AnimatePresence>
    </>
  )
}

/*
  THE PROJECT SPEAKING ABOUT ITSELF, at the foot of the column, out of the way
  of the settings someone came to change. The mark rather than the icon: the
  icon is what the system shows at 32 px, the mark is the badge the README
  opens with, which is what a reader who goes to the repository will see. Both
  links open in the system browser through BrowserOpenURL, since this
  WKWebView ignores target="_blank".
*/
function OpenSource() {
  return (
    <div className={cn(CARD, "p-3")}>
      <div className="flex items-center gap-2.5">
        <img src="/terra-mark.png" alt="" className="h-9 w-auto shrink-0" />
        <p className="text-body text-muted-foreground">
          TERRA is open source. A star helps others find it; sponsoring pays for the
          time it takes.
        </p>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => BrowserOpenURL(REPO_URL)}
          className={cn(btnGhostDense, "flex-1")}
        >
          <Star className="size-3" />
          Star
        </button>
        <button
          type="button"
          onClick={() => BrowserOpenURL(SPONSOR_URL)}
          className={cn(btnGhostDense, "flex-1")}
        >
          <Heart className="size-3" />
          Sponsor
        </button>
      </div>
    </div>
  )
}
