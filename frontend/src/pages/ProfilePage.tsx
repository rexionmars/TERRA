import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  ArrowLeft,
  Camera,
  CircleNotch,
  Download,
  FloppyDisk,
  FolderOpen,
  HardDrive,
  Heart,
  SignOut,
  Star,
  Trash,
  Upload,
} from "@phosphor-icons/react"
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime"
import {
  ChooseBackupArchive,
  ExportBackup,
  InspectStorage,
  PurgeOrphanedRunAssets,
  RestoreBackup,
} from "../../wailsjs/go/main/App"
import type { store } from "../../wailsjs/go/models"
import { AnimatePresence } from "motion/react"
import { useTheme } from "next-themes"
import { useAuth } from "@/lib/auth"
import { AvatarCircle } from "@/components/AvatarCircle"
import { ActivityGrid } from "@/components/ActivityGrid"
import { PageAside, PageBody, PageShell } from "@/components/ui/PageShell"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"
import { EnvironmentPanel } from "@/components/EnvironmentPanel"
import { StorageModal } from "@/components/StorageModal"
import {
  setStudioGutter,
  studioGutterOn,
  subscribeStudioGutter,
} from "@/lib/studioGutter"
import {
  TELEMETRY_FIGURES,
  setStudioTelemetry,
  studioTelemetry,
  subscribeStudioTelemetry,
  type StudioTelemetry,
  type TelemetryKey,
} from "@/lib/studioTelemetry"
import { cn } from "@/lib/utils"
import type {
  InferenceRun,
  Preferences,
} from "@/lib/types"
import {
  alwaysShowWhatsNewFromPrefs,
  mergePreferenceExtras,
} from "@/lib/preferenceExtras"
import { displayRunLabel } from "@/lib/aoiLabel"
import { formatBytes } from "@/lib/formatBytes"
import { runRowLine } from "@/lib/runSummary"

const MAX_AVATAR_BYTES = 2_000_000

type SettingsSectionId = "account" | "telemetry" | "system"

/**
 * The pages of settings, grouped by subject.
 *
 * There were five, and two were the same subject: "Account" held who you are
 * and "Session" held your work, split for no reason anyone chose -- they grew
 * apart. Worse, "Session" contained no session at all, which made the run list
 * read as something signing out would take with it. Sign out itself was in
 * neither, sitting in the column's footer, as far from the account it ends as
 * the layout allowed.
 *
 * "Analysis" is gone. It held the default model and the overlay opacity, and
 * both are already set where they are used -- the model in the Classification
 * panel, the opacity in the overlay tools -- so the page was a second place to
 * change something the map changes better, next to the thing it affects.
 *
 * "Appearance" is gone as a page but not as a setting: the colour theme moved
 * into Account. One control was never a page, and the theme belongs to the
 * person signed in rather than to the installation, which is what Account is.
 */
/*
  The project and the way to support it. Both taken from what the repository
  already declares -- the remote, and .github/FUNDING.yml, which names
  `github: rexionmars` -- rather than guessed: a sponsor button that leads
  nowhere is worse than no button.
*/
const REPO_URL = "https://github.com/rexionmars/TERRA"
const SPONSOR_URL = "https://github.com/sponsors/rexionmars"

const SECTIONS: {
  id: SettingsSectionId
  label: string
  /** How many settings the page holds, where that is a countable thing. */
  count?: number
}[] = [
  { id: "account", label: "Account", count: 12 },
  // No count. The other page is a list of controls, and the number says how
  // long the list is. This one reports the state of an environment and offers
  // what to do about it, so "(1)" would be counting the wrong thing.
  /*
    Counted, unlike System: this page IS a list of controls, and the number says
    how long the list is.
  */
  { id: "telemetry", label: "Telemetry", count: TELEMETRY_FIGURES.length },
  { id: "system", label: "System" },
]

const focusRing =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

export function ProfilePage({
  loadingRun,
  onOpenRun,
}: {
  loadingRun?: boolean
  onOpenRun: (run: InferenceRun) => Promise<void>
}) {
  const {
    user,
    runs,
    prefs,
    logout,
    updateProfile,
    setAvatar,
    clearAvatar,
    savePrefs,
    refreshRuns,
    goAuth,
    settingsPage,
    consumeSettingsPage,
    settingsReturnTo,
    leaveSettings,
  } = useAuth()
  const { setTheme: setNextTheme } = useTheme()
  const [name, setName] = useState("")
  const [theme, setTheme] = useState("dark")
  const [busy, setBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupResult, setBackupResult] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restorePreview, setRestorePreview] =
    useState<store.RestorePreview | null>(null)
  const [restoreResult, setRestoreResult] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [storage, setStorage] = useState<store.StorageReport | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const [storageNote, setStorageNote] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [storageOpen, setStorageOpen] = useState(false)
  /*
    Account, always, unless something asks otherwise while this is open.

    It used to initialise from settingsPage, which made opening settings by
    hand land on System: useState only reads its argument on the first render,
    so a request left over from the first-run gate steered every later arrival
    that reused the same mount, and re-mounting read a value that had not been
    cleared yet. Either way the user pressed Settings and got the Python
    environment.

    The request is applied by the effect below instead, which runs when the
    request actually arrives rather than whenever this component happens to
    mount.
  */
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("account")

  /*
    Applied once, then cleared.

    Clearing is what keeps it to one arrival: left standing, the next visit
    would be steered by a request nobody made this time, with nothing on screen
    explaining why settings keeps opening somewhere the user did not choose.
  */
  useEffect(() => {
    if (!settingsPage) return
    setActiveSection(settingsPage)
    consumeSettingsPage()
  }, [settingsPage, consumeSettingsPage])
  const [focusedSetting, setFocusedSetting] = useState<string | null>(null)
  /*
    Read from the module the studio reads, not from a copy held here.

    The scene and the status bar subscribe to the same store, so a switch flipped
    here takes effect on an open studio rather than on the next one -- including
    the one figure whose cost is the work it does, which stops when it is
    switched off.
  */
  const telemetry = useSyncExternalStore(
    subscribeStudioTelemetry,
    studioTelemetry
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const prefsReady = useRef(false)
  const savePrefsTimer = useRef<number | null>(null)
  const prefsDraftRef = useRef({ theme: "dark" })

  /*
    THREE JOBS, THREE EFFECTS. They were one, and the one ran whenever any of
    the three had reason to -- which is how refreshing the run list came to
    overwrite what was being typed into the display name field.

    Gating them apart is what fixes it, and the stable `goAuth` in lib/auth.tsx
    is what stops the loop that made it constant rather than occasional. Either
    alone would leave the other half standing: a stable callback still lets an
    avatar upload discard a half-typed name, and split effects still spin if
    the callback they depend on is rebuilt on every context recomputation.
  */

  /** Signed out with settings open: there is nothing here to show. */
  useEffect(() => {
    if (!user) goAuth()
  }, [user, goAuth])

  /*
    The stored name SEEDS the field, and replaces what is in it only when the
    stored name itself changes.

    Keyed on the string rather than on `user`, which is a fresh object after
    every save -- of the name, of an avatar, of anything. Keyed on the object,
    uploading a photo mid-edit would have reverted the half-typed name to the
    one on disk.
  */
  const storedName = user?.display_name ?? ""
  useEffect(() => {
    setName(storedName)
  }, [storedName])

  /* Once, on arrival. `refreshRuns` is stable, so this is a mount effect. */
  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  useEffect(() => {
    if (!prefs) return
    const next = { theme: prefs.theme || "dark" }
    setTheme(next.theme)
    prefsDraftRef.current = next
    prefsReady.current = true
  }, [prefs])

  /*
    The model and the opacity are written back exactly as they were read.

    This page no longer edits them -- both are set where they are used, on the
    map -- but Preferences carries them, so a save that omitted them would
    write a zero opacity and an empty model over whatever is stored. Passing
    the stored value through keeps a theme change to being a theme change.
  */
  /*
    The store first and the preferences after, deliberately.

    Writing preferences means a round trip through the bridge and the database,
    and a switch that waited for it would feel like it had not registered. The
    store is what the studio reads, so flipping it first makes the change
    immediate; the save is how it survives a restart.
  */
  const persistTelemetry = useCallback(
    async (key: TelemetryKey, on: boolean) => {
      const next: StudioTelemetry = { ...studioTelemetry(), [key]: on }
      setStudioTelemetry(next)
      if (!user) return
      await savePrefs({
        user_id: user.id,
        default_model: prefs?.default_model || "spectral",
        overlay_opacity: prefs?.overlay_opacity ?? 0.75,
        theme: prefs?.theme || "dark",
        extras_json: mergePreferenceExtras(prefs?.extras_json, {
          studio_telemetry: next,
        }),
      })
    },
    [user, prefs?.default_model, prefs?.overlay_opacity, prefs?.theme, prefs?.extras_json, savePrefs]
  )

  /*
    The store first and the preferences after, for the reason persistTelemetry
    states above it: a switch that waited for the round trip would feel like it
    had not registered, and the store is what the studio reads.
  */
  const persistPanelGap = useCallback(
    async (on: boolean) => {
      setStudioGutter(on)
      if (!user) return
      await savePrefs({
        user_id: user.id,
        default_model: prefs?.default_model || "spectral",
        overlay_opacity: prefs?.overlay_opacity ?? 0.75,
        theme: prefs?.theme || "dark",
        extras_json: mergePreferenceExtras(prefs?.extras_json, {
          studio_panel_gap: on,
        }),
      })
    },
    [user, prefs?.default_model, prefs?.overlay_opacity, prefs?.theme, prefs?.extras_json, savePrefs]
  )

  const persistPreferences = useCallback(
    async (next: {
      theme: string
      alwaysShowWhatsNew?: boolean
    }) => {
      if (!user) return
      const payload: Preferences = {
        user_id: user.id,
        default_model: prefs?.default_model || "spectral",
        overlay_opacity: prefs?.overlay_opacity ?? 0.75,
        theme: next.theme,
        extras_json: mergePreferenceExtras(prefs?.extras_json, {
          /*
            Tested against undefined, not for truth, unlike the two above.
            Those carry strings whose absent value is falsy anyway; this one is
            a boolean, and a truthiness test would drop `false` as though it
            had never been set -- leaving the setting impossible to turn off.
          */
          ...(next.alwaysShowWhatsNew !== undefined
            ? { always_show_whats_new: next.alwaysShowWhatsNew }
            : {}),
        }),
      }
      await savePrefs(payload)
      if (
        next.theme === "dark" ||
        next.theme === "light" ||
        next.theme === "system"
      ) {
        setNextTheme(next.theme)
      }
    },
    [
      prefs?.default_model,
      prefs?.overlay_opacity,
      prefs?.extras_json,
      savePrefs,
      setNextTheme,
      user,
    ]
  )

  const alwaysShowWhatsNew = alwaysShowWhatsNewFromPrefs(prefs)
  /*
    From the store rather than from `prefs`, so the row reflects what the
    studio is actually drawing. App seeds the store from preferences on
    sign-in; reading the blob again here would be a second parse of the same
    value that can disagree with it while a save is in flight.
  */
  const panelGap = useSyncExternalStore(subscribeStudioGutter, studioGutterOn)

  /*
    Named from the destination itself. This read a navigation table, so that
    the button and the column would agree on the wording; there is no column
    now, and one destination is work. Settings can still be reached from
    sign-in, which is the case the neutral word covers.
  */
  const returnLabel = settingsReturnTo === "studio" ? "Studio" : "the studio"

  const schedulePrefsSave = useCallback(
    (
      patch: Partial<{
        theme: string
        alwaysShowWhatsNew: boolean
      }>
    ) => {
      if (!prefsReady.current) return
      prefsDraftRef.current = { ...prefsDraftRef.current, ...patch }
      if (savePrefsTimer.current) window.clearTimeout(savePrefsTimer.current)
      savePrefsTimer.current = window.setTimeout(() => {
        void persistPreferences(prefsDraftRef.current)
      }, 280)
    },
    [persistPreferences]
  )

  useEffect(() => {
    return () => {
      if (savePrefsTimer.current) window.clearTimeout(savePrefsTimer.current)
    }
  }, [])

  const recentRuns = useMemo(() => runs.slice(0, 3), [runs])

  /*
    The column switches the page; it does not scroll to a heading.

    Every section used to be mounted at once in one scrolling page, with the
    column scrolling to an anchor and an IntersectionObserver guessing which
    heading was in view to light the right entry. Two consequences, both bad:
    the page grows without bound as settings are added, and the column looks
    like navigation while behaving like a table of contents.

    Rendering one section at a time is what the column already appeared to do,
    and it removes the observer, the scroll and the refs that fed them.
  */
  const page = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0]

  if (!user) return null

  const saveAccount = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await updateProfile(name.trim())
    } finally {
      setBusy(false)
    }
  }

  /*
    The archive is built before the save dialog opens, so a large history
    spends its time with the button showing it is working rather than behind a
    dialog the user has already answered.

    An empty path means the dialog was cancelled, which is not an error and not
    a success -- it clears both and says nothing.
  */
  const exportBackup = async () => {
    setBackupBusy(true)
    setBackupError(null)
    setBackupResult(null)
    try {
      const dest = await ExportBackup()
      if (dest) setBackupResult(`Saved to ${dest}`)
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e))
    } finally {
      setBackupBusy(false)
    }
  }

  /*
    Measured on demand, not on mount.

    Walking the data directory costs real time once there are hundreds of
    analyses, and Account is opened to change a display name far more often
    than to look at disk usage. Paying for it every visit would slow the common
    case for the rare one.
  */
  const loadStorage = async () => {
    setStorageBusy(true)
    setStorageError(null)
    setStorageNote(null)
    try {
      setStorage(await InspectStorage())
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : String(e))
    } finally {
      setStorageBusy(false)
    }
  }

  /*
    Measured before the modal opens, not after.

    Opening first would render the dialog against no data, so its first frame
    would be an empty shell -- and every field in it would have to guard
    against a report that is not there yet. The button carries the wait
    instead, where the user already clicked.

    The error stays on the settings row for the same reason: a modal that opens
    only to say it could not measure anything is a worse way to say it than a
    line under the button.
  */
  const openStorage = async () => {
    setStorageBusy(true)
    setStorageError(null)
    setStorageNote(null)
    try {
      setStorage(await InspectStorage())
      setStorageOpen(true)
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : String(e))
    } finally {
      setStorageBusy(false)
    }
  }

  /*
    Clears only the folders no analysis points at.

    No confirmation, deliberately: nothing in the application can open these
    files and no export includes them, so there is nothing for the user to
    weigh. A dialog asking them to approve deleting something they cannot see
    or reach would be theatre.
  */
  const purgeOrphans = async () => {
    setStorageBusy(true)
    setStorageError(null)
    try {
      const result = await PurgeOrphanedRunAssets()
      setStorageNote(
        `Cleared ${formatBytes(result.freed_bytes)} from ${result.removed} ${
          result.removed === 1 ? "folder" : "folders"
        }.`
      )
      setStorage(await InspectStorage())
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : String(e))
    } finally {
      setStorageBusy(false)
    }
  }

  /*
    Choosing a backup describes it and changes nothing.

    An archive that cannot be restored says so here, before the user has agreed
    to replace anything -- a refusal at this point costs them a file dialog,
    the same refusal after the swap would cost them their data.
  */
  const chooseBackup = async () => {
    setRestoreBusy(true)
    setRestoreError(null)
    setRestoreResult(null)
    try {
      const preview = await ChooseBackupArchive()
      if (!preview) return // Cancelled.
      if (preview.problem) {
        setRestoreError(preview.problem)
        return
      }
      setRestorePreview(preview)
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoreBusy(false)
    }
  }

  /*
    The restore itself.

    Signing out afterwards is not tidiness: the session belonged to the database
    that was just replaced, and every restored account carries no password hash.
    Staying on a profile page describing a user who no longer exists would be
    the application lying about its own state.
  */
  const runRestore = async () => {
    if (!restorePreview) return
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      const result = await RestoreBackup(restorePreview.archive_path)
      setRestorePreview(null)
      setRestoreResult(
        `Restored ${result.runs_restored} analyses and ${result.projects_restored} projects. ` +
          `Your previous data is at ${result.previous_data_path}. Sign in again to continue.`
      )
      // Read before signing out: goAuth unmounts this page.
      window.setTimeout(() => void logout(), 2500)
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoreBusy(false)
    }
  }

  const onPickPhoto = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith("image/")) return
    if (file.size > MAX_AVATAR_BYTES) return
    setBusy(true)
    try {
      const dataURI = await readAsDataURL(file)
      await setAvatar(dataURI)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <PageShell>
      <PageAside>
        {/* Whose settings, which the removed header used to say twice. The
            display name rather than the literal "User": it is the one thing
            here the title bar does not already carry. */}
        {/*
          The way out, named after where it goes.
          
          Settings is the only screen with no work of its own to return to, and
          leaving it meant picking a destination from the navigation column --
          which required remembering what you had been doing, and landed you
          beside it rather than back in it: from the solar tab, the nearest
          column entry is Classification, which is a different product on a
          different screen.
          
          The label comes from the navigation table, so it is the same word the
          column uses for the place it returns to.
        */}
        <button
          type="button"
          onClick={leaveSettings}
          className={cn(
            "flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-emphasis",
            "text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
            focusRing
          )}
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            Back to {returnLabel}
          </span>
        </button>

        <div className="border-b border-border px-3 py-3">
          <p className="telemetry text-meta text-accent-quiet">SETTINGS</p>
          <p className="mt-1 truncate text-emphasis font-medium text-foreground">
            {user.display_name}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-1.5 py-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              aria-current={activeSection === s.id ? "true" : undefined}
              className={cn(
                "nav-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-emphasis",
                focusRing,
                activeSection === s.id && "is-active"
              )}
            >
              <span className="truncate text-foreground/90">{s.label}</span>
              {/* Muted reads 3.20 to 1 on the active row's accent fill, under
                  the 4.5 floor, so the count follows the label up on that row
                  rather than staying the one unreadable thing on it. */}
              {s.count !== undefined && (
                <span
                  className={cn(
                    "telemetry shrink-0 text-meta",
                    activeSection === s.id
                      ? "text-foreground/80"
                      : "text-muted-foreground"
                  )}
                >
                  ({s.count})
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {/* Kept from the deleted header, next to the column it describes.
              Only the preferences autosave -- the display name still has its
              own Save -- so it reads as a property of the page, not a promise
              about every control on it. */}
          <p className="telemetry text-meta text-muted-foreground">
            Preferences apply automatically
          </p>
        </div>
      </PageAside>

      <PageBody>
        <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-8">
          {/* The page's one heading. Each section used to carry its own, which
              is why System showed "System" and then "Python environment"
              directly beneath it. */}
          <h2 className="mb-1 border-b border-border pb-2 font-display text-heading font-semibold tracking-wide text-foreground">
            {page.label}
          </h2>

          {activeSection === "account" && (
            <Section>
              <SettingRow
                id="account.photo"
                title="Profile photo"
                description="Shown in the app sidebar. PNG, JPEG or WebP, max 2 MB."
                focused={focusedSetting === "account.photo"}
                onFocus={() => setFocusedSetting("account.photo")}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <AvatarCircle uri={user.avatar_uri} size="lg" />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className={btnGhost}
                  >
                    <Camera className="h-3 w-3" />
                    Upload
                  </button>
                  {user.avatar_uri && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void clearAvatar()}
                      className={btnGhost}
                    >
                      <Trash className="h-3 w-3" />
                      Remove
                    </button>
                  )}
                </div>
              </SettingRow>

              <SettingRow
                id="account.displayName"
                title="Display name"
                description="Name shown in the title bar and analysis headers."
                focused={focusedSetting === "account.displayName"}
                onFocus={() => setFocusedSetting("account.displayName")}
              >
                <div className="flex max-w-md flex-wrap items-center gap-2">
                  <input
                    className="field-input max-w-xs focus-visible:ring-1 focus-visible:ring-ring"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !name.trim()}
                    onClick={() => void saveAccount()}
                    className={btnPrimary}
                  >
                    <FloppyDisk className="h-3 w-3" />
                    Save
                  </button>
                </div>
              </SettingRow>

              <SettingRow
                id="account.email"
                title="Email"
                description="Local account identifier. Not editable."
                focused={focusedSetting === "account.email"}
                onFocus={() => setFocusedSetting("account.email")}
              >
                <input
                  className="field-input max-w-md opacity-70 focus-visible:ring-1 focus-visible:ring-ring"
                  value={user.email}
                  readOnly
                />
              </SettingRow>

              {/* Was a section called "Session", which held no session: it held
                  your work. Your identity and your history are the same
                  subject, and splitting them put the run list under a heading
                  that suggested it would be lost on sign-out. */}
              <SettingRow
                id="account.activity"
                title="Activity"
                description="Runs per day over the last year. A run is one classification, composition, water, solar or wind analysis."
                focused={focusedSetting === "account.activity"}
                onFocus={() => setFocusedSetting("account.activity")}
              >
                <ActivityGrid />
              </SettingRow>

              <SettingRow
                id="account.analyses"
                title="Saved analyses"
                description="The most recent are listed here. The full history is in the studio's Browser, filed by project."
                focused={focusedSetting === "account.analyses"}
                onFocus={() => setFocusedSetting("account.analyses")}
              >
                {recentRuns.length === 0 ? (
                  <p className="mt-3 text-body text-muted-foreground">
                    No recent analyses yet.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {recentRuns.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-3 rounded-sm border border-border bg-secondary px-3 py-2 text-body"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {displayRunLabel(r.label) || r.model_kind}
                          </div>
                          <div className="mt-0.5 truncate text-muted-foreground">
                            {runRowLine(r)}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={!!loadingRun}
                          onClick={() => void onOpenRun(r)}
                          className={btnGhost}
                        >
                          <FolderOpen className="h-3 w-3" />
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </SettingRow>

              {/* Everything this application saves lives in one directory on
                  one machine: no server, no account holding a second copy. A
                  reinstalled laptop takes every analysis with it, and until
                  now there was no way out. */}
              <SettingRow
                id="account.backup"
                title="Backup"
                description="Writes your analyses, projects and their images to a single ZIP file. Passwords and sessions are left out, so the file can be stored or sent without carrying a credential."
                focused={focusedSetting === "account.backup"}
                onFocus={() => setFocusedSetting("account.backup")}
              >
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={() => void exportBackup()}
                  className={btnGhost}
                >
                  {backupBusy ? (
                    <CircleNotch className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {backupBusy ? "Writing backup" : "Export backup"}
                </button>
                {/* The written path, not just "done". A file the user chose
                    the location of is one they have to find again. */}
                {backupResult && (
                  <p className="telemetry mt-2 break-all text-micro text-muted-foreground">
                    {backupResult}
                  </p>
                )}
                {backupError && (
                  <p className="mt-2 text-body text-destructive-quiet">
                    {backupError}
                  </p>
                )}
              </SettingRow>

              {/* Where the space went, measured rather than estimated.
                  Nothing else reports this: the data directory grows with
                  every analysis and the application never mentions it, so a
                  user whose disk is filling has no way to learn that this is
                  where it went or what is safe to remove. */}
              <SettingRow
                id="account.storage"
                title="Storage"
                description="What the saved data is made of, measured on disk. Opens a full breakdown by analysis, type and project."
                focused={focusedSetting === "account.storage"}
                onFocus={() => setFocusedSetting("account.storage")}
              >
                <button
                  type="button"
                  disabled={storageBusy}
                  onClick={() => void openStorage()}
                  className={btnGhost}
                >
                  {storageBusy ? (
                    <CircleNotch className="h-3 w-3 animate-spin" />
                  ) : (
                    <HardDrive className="h-3 w-3" />
                  )}
                  {storage
                    ? `${formatBytes(storage.total_bytes)} used`
                    : "Measure storage"}
                </button>
                {storageError && (
                  <p className="mt-2 text-body text-destructive-quiet">
                    {storageError}
                  </p>
                )}
              </SettingRow>

              {/* A restore replaces everything, so it is two steps: choose a
                  file and read what it holds, then confirm. One click from a
                  file dialog to a replaced database is the wrong weight for an
                  operation this size. */}
              <SettingRow
                id="account.restore"
                title="Restore from backup"
                description="Replaces everything here with the contents of a backup. Your current data is moved aside rather than deleted, and accounts come back needing a new password."
                focused={focusedSetting === "account.restore"}
                onFocus={() => setFocusedSetting("account.restore")}
              >
                {!restorePreview ? (
                  <button
                    type="button"
                    disabled={restoreBusy}
                    onClick={() => void chooseBackup()}
                    className={btnGhost}
                  >
                    {restoreBusy ? (
                      <CircleNotch className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    Choose a backup
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 rounded-sm border border-border bg-sunk px-3 py-2">
                    {/* What is about to arrive, and what it displaces. Stated
                        before the action, not reported after it. */}
                    <p className="text-body text-foreground">
                      This backup holds {restorePreview.manifest.counts.runs}{" "}
                      {restorePreview.manifest.counts.runs === 1
                        ? "analysis"
                        : "analyses"}{" "}
                      and {restorePreview.manifest.counts.projects}{" "}
                      {restorePreview.manifest.counts.projects === 1
                        ? "project"
                        : "projects"}
                      , written {restorePreview.manifest.created_at.slice(0, 10)}.
                    </p>
                    <p className="text-body text-muted-foreground">
                      Restoring replaces the{" "}
                      {restorePreview.current.runs}{" "}
                      {restorePreview.current.runs === 1
                        ? "analysis"
                        : "analyses"}{" "}
                      and {restorePreview.current.projects}{" "}
                      {restorePreview.current.projects === 1
                        ? "project"
                        : "projects"}{" "}
                      currently here. You will be signed out and will need to set
                      a password again.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={restoreBusy}
                        onClick={() => void runRestore()}
                        className={btnPrimary}
                      >
                        {restoreBusy && (
                          <CircleNotch className="h-3 w-3 animate-spin" />
                        )}
                        Replace my data
                      </button>
                      <button
                        type="button"
                        disabled={restoreBusy}
                        onClick={() => setRestorePreview(null)}
                        className={btnGhost}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {restoreResult && (
                  <div className="mt-2 flex flex-col gap-1">
                    <p className="text-body text-foreground">{restoreResult}</p>
                  </div>
                )}
                {restoreError && (
                  <p className="mt-2 text-body text-destructive-quiet">
                    {restoreError}
                  </p>
                )}
              </SettingRow>

              {/* Was a page of its own holding this one control. A single
                  setting is not a page, and the theme is a property of the
                  person signed in rather than of the installation -- which is
                  the difference between this page and System. */}
              <SettingRow
                id="account.theme"
                title="Color theme"
                description="Controls the overall light/dark appearance of TERRA."
                focused={focusedSetting === "account.theme"}
                onFocus={() => setFocusedSetting("account.theme")}
              >
                <select
                  className="field-input max-w-xs focus-visible:ring-1 focus-visible:ring-ring"
                  value={theme}
                  onChange={(e) => {
                    const next = e.target.value
                    setTheme(next)
                    schedulePrefsSave({ theme: next })
                  }}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </SettingRow>

              {/*
                After the one that decides what a session opens WITH, because
                this decides what it opens THROUGH -- the notes stand in front
                of the surface it chose.
              */}
              <SettingRow
                id="account.whatsnew"
                title="Release notes"
                description="What's New reports what a version changed. It is shown once, when the product version is newer than the last one seen; kept always, it is shown at every start."
                focused={focusedSetting === "account.whatsnew"}
                onFocus={() => setFocusedSetting("account.whatsnew")}
              >
                <div className="flex max-w-md flex-col gap-2">
                  <select
                    className="field-input max-w-xs focus-visible:ring-1 focus-visible:ring-ring"
                    value={alwaysShowWhatsNew ? "always" : "once"}
                    onChange={(e) =>
                      schedulePrefsSave({
                        alwaysShowWhatsNew: e.target.value === "always",
                      })
                    }
                  >
                    <option value="once">Once per version</option>
                    <option value="always">At every start</option>
                  </select>
                  <p className="text-meta leading-relaxed text-muted-foreground">
                    {alwaysShowWhatsNew
                      ? "Every start opens on the notes for this version, until this is set back. They are read from the first release rather than from the last one seen, so nothing is withheld for having been acknowledged once."
                      : "A release announces itself once and then stays out of the way. Takes effect at the next start, which is the only moment the notes are reached."}
                  </p>
                </div>
              </SettingRow>

              {/*
                After the two that decide what a session opens with and
                through, because this decides what it LOOKS like once open --
                and it is the only setting here the reader can watch take
                effect, since the studio is behind this page.
              */}
              <SettingRow
                id="account.panelgap"
                title="Space between panels"
                description="The studio separates its panels with a gap of the window's own ground. Closed, they meet flush and a hairline border tells them apart instead."
                focused={focusedSetting === "account.panelgap"}
                onFocus={() => setFocusedSetting("account.panelgap")}
              >
                <div className="flex max-w-md flex-col gap-2">
                  <select
                    className="field-input max-w-xs focus-visible:ring-1 focus-visible:ring-ring"
                    value={panelGap ? "gap" : "flush"}
                    onChange={(e) => void persistPanelGap(e.target.value === "gap")}
                  >
                    <option value="gap">A gap</option>
                    <option value="flush">Flush, with a border</option>
                  </select>
                  <p className="text-meta leading-relaxed text-muted-foreground">
                    {panelGap
                      ? "Five pixels, and the same at the window's edge. The division still runs down the middle of it, so the gap is what a drag grabs to resize two panels."
                      : "Every panel gains five pixels in each direction, which is a row of a table or a line of a reading. The border that returns is a boundary to resolve where the gap was one to see."}
                  </p>
                </div>
              </SettingRow>

              {/* Sign out belongs to the account, not to the bottom of a
                  column. It sat in the aside footer, as far from the identity
                  it ends as the layout allowed. */}
              <SettingRow
                id="account.signout"
                title="Sign out"
                description="Saved runs and projects stay on this machine and are here when you sign back in."
                focused={focusedSetting === "account.signout"}
                onFocus={() => setFocusedSetting("account.signout")}
              >
                <button
                  type="button"
                  onClick={() => void logout()}
                  className={btnGhost}
                >
                  <SignOut className="h-3 w-3" />
                  Sign out
                </button>
              </SettingRow>
            </Section>
          )}

          {/* Not wrapped in a SettingRow. A row is a labelled field with a
              description beside it, which is right for a name or a slider and
              wrong for this: wrapped, the page showed its title twice and
              indented the whole thing as though it were one control's value. */}
          {activeSection === "telemetry" && (
            <Section>
              {/*
                All off until asked for. A status bar reporting its own
                performance to a reader who did not ask is chrome spent on a
                question they are not holding -- and one of these is not free,
                so it must not be running for anyone who has not read what it
                costs.

                Each row says what the figure means and which question it
                answers, because a reader switching these on is diagnosing
                something and the useful thing to know is which figure speaks
                to which symptom.
              */}
              <p className="px-4 pb-1 pt-3 text-body leading-relaxed text-muted-foreground">
                Figures the studio&rsquo;s status bar reports, beside the pointer
                bindings. Off by default; switch on what a symptom calls for.
              </p>
              {TELEMETRY_FIGURES.map((figure) => (
                <SettingRow
                  key={figure.key}
                  id={`telemetry.${figure.key}`}
                  title={figure.label}
                  description={figure.what}
                  focused={focusedSetting === `telemetry.${figure.key}`}
                  onFocus={() => setFocusedSetting(`telemetry.${figure.key}`)}
                >
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className={cn("mt-0.5 shrink-0", focusRing)}
                      checked={telemetry[figure.key] === true}
                      onChange={(e) =>
                        void persistTelemetry(figure.key, e.target.checked)
                      }
                    />
                    <span className="min-w-0 text-body leading-relaxed text-muted-foreground">
                      {figure.when}
                      {figure.cost && (
                        <>
                          {" "}
                          {/* The one figure that is not free says so where the
                              switch is, not in a note somewhere else. */}
                          <span className="text-destructive-quiet">
                            Costs: {figure.cost}
                          </span>
                        </>
                      )}
                    </span>
                  </label>
                </SettingRow>
              ))}
            </Section>
          )}

          {activeSection === "system" && (
            <Section>
              <div className="pt-3">
                <EnvironmentPanel />
              </div>
            </Section>
          )}

          {/*
            Outside the section switch, so it closes the page rather than one
            of its tabs -- and last, because an ask placed above the settings
            someone came here to change is an ask that interrupts them.

            Both links open in the system browser through BrowserOpenURL: this
            is a WKWebView with no createWebViewWith delegate, so an anchor
            with target="_blank" is silently ignored.
          */}
          <div
            className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4"
            style={{ borderColor: "var(--border)" }}
          >
            {/*
              THE MARK, NOT THE ICON, AND THEY ARE TWO DIFFERENT IMAGES. The
              icon is the wordless circle in frontend/public/terra-logo.png,
              drawn by the title bar and the splash and generated into the
              .icns and the .ico -- it is what the operating system shows when
              it has 32 px to show it in. The mark is the hexagonal badge
              carrying TERRA and EARTH OBSERVATION, which is what the README
              opens with and what the LaTeX manual references. This paragraph
              is the project speaking about itself as a project, to a reader
              who might go and look at the repository, so it is the mark that
              belongs beside it.

              Copied to public/ rather than reached for across the repository:
              docs/ is not under the Vite root and would need fs.allow widened
              to serve from it. The icon is already carried twice for the same
              reason -- build/appicon.png and public/terra-logo.png are one
              file in two places -- so this follows a path the project already
              takes rather than opening a new one.

              alt="" because the badge says TERRA and the sentence beside it
              says TERRA, and a screen reader announcing the name twice reads
              as two things rather than one. The text carries the meaning; the
              image is the signature on it.
            */}
            <img
              src="/terra-mark.png"
              alt=""
              className="h-10 w-auto shrink-0 self-start object-contain"
            />
            <p className="min-w-0 flex-1 text-meta leading-relaxed text-muted-foreground">
              TERRA is open source. If it is useful to you, a star helps other
              people find it, and sponsoring pays for the time that goes into it.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => BrowserOpenURL(REPO_URL)}
                className={`${btnGhost} cursor-pointer`}
              >
                <Star className="h-3 w-3" />
                Star on GitHub
              </button>
              <button
                type="button"
                onClick={() => BrowserOpenURL(SPONSOR_URL)}
                className={`${btnGhost} cursor-pointer`}
              >
                <Heart className="h-3 w-3" />
                Sponsor
              </button>
            </div>
          </div>
        </div>
      </PageBody>

      {/* Rendered only with a report in hand: openStorage measures first, so
          the dialog never has to guard against data that has not arrived. */}
      <AnimatePresence>
        {storageOpen && storage && (
          <StorageModal
            report={storage}
            busy={storageBusy}
            note={storageNote}
            problem={storageError}
            onRefresh={() => void loadStorage()}
            onPurge={() => void purgeOrphans()}
            onClose={() => setStorageOpen(false)}
          />
        )}
      </AnimatePresence>
    </PageShell>
  )
}

/**
 * One page of settings.
 *
 * It carries no heading and no anchor any more: one page is mounted at a time
 * and the body titles it once, so a heading here would print the same word
 * twice, and there is nothing left to scroll to.
 */
function Section({ children }: { children: React.ReactNode }) {
  return <section className="flex flex-col">{children}</section>
}

function SettingRow({
  id,
  title,
  description,
  children,
  focused,
  onFocus,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
  focused: boolean
  onFocus: () => void
}) {
  return (
    <div
      data-setting={id}
      className={cn(
        "relative border-l-2 py-3.5 pl-4 pr-2 transition-colors",
        focused
          ? // The marker was the accent at 22 percent, which composites to
            // rgb(95 54 38) and reads 1.31 to 1 against the row's own
            // background -- the mark that says which setting is in hand was
            // the one thing on the row nobody could see. At full strength it
            // measures 3.93, clearing what WCAG 1.4.11 asks of a state
            // indicator, and accent at full strength is what the system
            // reserves for exactly this.
            "border-primary bg-secondary"
          : "border-transparent hover:bg-secondary/55"
      )}
      // Focus, not just mouse. React's onFocus follows focusin, so it fires
      // when any control inside the row takes focus -- which is what the row
      // is trying to report. Bound to onMouseDown alone it reported only
      // pointer users, and every control underneath had to carry a duplicate
      // handler to cover the keyboard; a control added without one simply
      // moved focus into a row that never lit.
      onFocus={onFocus}
      onMouseDown={onFocus}
    >
      <div className="text-emphasis font-medium text-foreground">{title}</div>
      <p className="mt-1 max-w-2xl text-body leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
