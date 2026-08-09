import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Camera, ChartColumn, FolderOpen, LogOut, Save, Trash2 } from "lucide-react"
import { useTheme } from "next-themes"
import { useAuth } from "@/lib/auth"
import { AvatarCircle } from "@/components/AvatarCircle"
import { ActivityGrid } from "@/components/ActivityGrid"
import { PageAside, PageBody, PageShell } from "@/components/ui/PageShell"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"
import { EnvironmentPanel } from "@/components/EnvironmentPanel"
import { cn } from "@/lib/utils"
import type { InferenceRun, Preferences } from "@/lib/types"
import { mergePreferenceExtras } from "@/lib/preferenceExtras"
import { displayRunLabel } from "@/lib/aoiLabel"
import { runRowLine } from "@/lib/runSummary"

const MAX_AVATAR_BYTES = 2_000_000

type SettingsSectionId = "account" | "system"

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
const SECTIONS: {
  id: SettingsSectionId
  label: string
  /** How many settings the page holds, where that is a countable thing. */
  count?: number
}[] = [
  { id: "account", label: "Account", count: 7 },
  // No count. The other page is a list of controls, and the number says how
  // long the list is. This one reports the state of an environment and offers
  // what to do about it, so "(1)" would be counting the wrong thing.
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
    goAnalysis,
    settingsPage,
    consumeSettingsPage,
  } = useAuth()
  const { setTheme: setNextTheme } = useTheme()
  const [name, setName] = useState("")
  const [theme, setTheme] = useState("dark")
  const [busy, setBusy] = useState(false)
  /*
    Account unless something asked for a particular page -- the first-run gate
    asks for System, since an unusable interpreter is the reason it opened
    settings at all.
  */
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    settingsPage ?? "account"
  )

  /*
    Read once, then cleared.

    The request steers one arrival. Left standing it would survive this page
    unmounting -- opening settings by hand afterwards would land on System
    again, overriding the page the user last chose, with nothing on screen
    explaining why it keeps jumping there.
  */
  useEffect(() => {
    if (settingsPage) consumeSettingsPage()
  }, [settingsPage, consumeSettingsPage])
  const [focusedSetting, setFocusedSetting] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const prefsReady = useRef(false)
  const savePrefsTimer = useRef<number | null>(null)
  const prefsDraftRef = useRef({ theme: "dark" })

  useEffect(() => {
    if (!user) {
      goAuth()
      return
    }
    setName(user.display_name)
    void refreshRuns()
  }, [user, goAuth, refreshRuns])

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
  const persistPreferences = useCallback(
    async (next: { theme: string }) => {
      if (!user) return
      const payload: Preferences = {
        user_id: user.id,
        default_model: prefs?.default_model || "spectral",
        overlay_opacity: prefs?.overlay_opacity ?? 0.75,
        theme: next.theme,
        extras_json: mergePreferenceExtras(prefs?.extras_json, {}),
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

  const schedulePrefsSave = useCallback(
    (patch: Partial<{ theme: string }>) => {
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
                      <Trash2 className="h-3 w-3" />
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
                    <Save className="h-3 w-3" />
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
                description="Full history lives in the project hub. The most recent are listed here."
                focused={focusedSetting === "account.analyses"}
                onFocus={() => setFocusedSetting("account.analyses")}
              >
                <button type="button" onClick={goAnalysis} className={btnGhost}>
                  <ChartColumn className="h-3 w-3" />
                  Open project hub
                </button>
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
                  <LogOut className="h-3 w-3" />
                  Sign out
                </button>
              </SettingRow>
            </Section>
          )}

          {/* Not wrapped in a SettingRow. A row is a labelled field with a
              description beside it, which is right for a name or a slider and
              wrong for this: wrapped, the page showed its title twice and
              indented the whole thing as though it were one control's value. */}
          {activeSection === "system" && (
            <Section>
              <div className="pt-3">
                <EnvironmentPanel />
              </div>
            </Section>
          )}
        </div>
      </PageBody>
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
