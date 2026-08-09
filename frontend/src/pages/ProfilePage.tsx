import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Camera,
  ChartColumn,
  FolderOpen,
  LogOut,
  Save,
  Trash2,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useAuth } from "@/lib/auth"
import { AvatarCircle } from "@/components/AvatarCircle"
import { ActivityGrid } from "@/components/ActivityGrid"
import { PageAside, PageBody, PageShell } from "@/components/ui/PageShell"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"
import type { InferenceRun, Preferences } from "@/lib/types"
import {
  mergePreferenceExtras,
} from "@/lib/preferenceExtras"
import { displayRunLabel } from "@/lib/aoiLabel"
import { runRowLine } from "@/lib/runSummary"

const MAX_AVATAR_BYTES = 2_000_000

type SettingsSectionId = "account" | "classification" | "appearance" | "session"

const SECTIONS: {
  id: SettingsSectionId
  label: string
  count: number
}[] = [
  { id: "account", label: "Account", count: 3 },
  { id: "classification", label: "Classification", count: 2 },
  { id: "appearance", label: "Appearance", count: 1 },
  { id: "session", label: "Session", count: 2 },
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
  } = useAuth()
  const { setTheme: setNextTheme } = useTheme()
  const [name, setName] = useState("")
  const [model, setModel] = useState("spectral")
  const [opacity, setOpacity] = useState(0.75)
  const [theme, setTheme] = useState("dark")
  const [busy, setBusy] = useState(false)
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("account")
  const [focusedSetting, setFocusedSetting] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Partial<Record<SettingsSectionId, HTMLElement | null>>>(
    {}
  )
  const prefsReady = useRef(false)
  const savePrefsTimer = useRef<number | null>(null)
  const prefsDraftRef = useRef({
    model: "spectral",
    opacity: 0.75,
    theme: "dark",
  })

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
    const next = {
      model: prefs.default_model || "spectral",
      opacity: prefs.overlay_opacity ?? 0.75,
      theme: prefs.theme || "dark",
    }
    setModel(next.model)
    setOpacity(next.opacity)
    setTheme(next.theme)
    prefsDraftRef.current = next
    prefsReady.current = true
  }, [prefs])

  const persistPreferences = useCallback(
    async (next: {
      model: string
      opacity: number
      theme: string
    }) => {
      if (!user) return
      const payload: Preferences = {
        user_id: user.id,
        default_model: next.model,
        overlay_opacity: next.opacity,
        theme: next.theme,
        extras_json: mergePreferenceExtras(prefs?.extras_json, {
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
    [prefs?.extras_json, savePrefs, setNextTheme, user]
  )

  const schedulePrefsSave = useCallback(
    (patch: Partial<{
      model: string
      opacity: number
      theme: string
    }>) => {
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

  const scrollToSection = (id: SettingsSectionId) => {
    setActiveSection(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const nodes = SECTIONS.map((s) => sectionRefs.current[s.id]).filter(
      Boolean
    ) as HTMLElement[]
    if (nodes.length === 0) return

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const top = visible[0]?.target as HTMLElement | undefined
        const id = top?.dataset.section as SettingsSectionId | undefined
        if (id) setActiveSection(id)
      },
      { root, rootMargin: "-12% 0px -70% 0px", threshold: 0 }
    )
    for (const n of nodes) io.observe(n)
    return () => io.disconnect()
  }, [user])

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
              onClick={() => scrollToSection(s.id)}
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
          <button type="button" onClick={() => void logout()} className={btnGhost}>
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </PageAside>

      <PageBody scrollRef={contentRef}>
        <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-8">
            <Section
              id="account"
              title="Account"
              sectionRef={(el) => {
                sectionRefs.current.account = el
              }}
            >
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
                    onChange={(e) =>
                      void onPickPhoto(e.target.files?.[0] ?? null)
                    }
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
            </Section>

            <Section
              id="classification"
              title="Classification"
              sectionRef={(el) => {
                sectionRefs.current.classification = el
              }}
            >
              <SettingRow
                id="classification.model"
                title="Default model"
                description="Model pre-selected when opening New classification on the map."
                focused={focusedSetting === "classification.model"}
                onFocus={() => setFocusedSetting("classification.model")}
              >
                <select
                  className="field-input max-w-md focus-visible:ring-1 focus-visible:ring-ring"
                  value={model}
                  onChange={(e) => {
                    const next = e.target.value
                    setModel(next)
                    schedulePrefsSave({ model: next })
                  }}
                >
                  <option value="spectral">Random Forest (spectral)</option>
                  <option value="temporal_transformer">
                    Temporal Transformer
                  </option>
                  <option value="prithvi">Prithvi-EO 2.0</option>
                </select>
              </SettingRow>

              <SettingRow
                id="classification.opacity"
                title={`Overlay opacity · ${opacity.toFixed(2)}`}
                description="Default opacity for prediction and composition overlays on the map."
                focused={focusedSetting === "classification.opacity"}
                onFocus={() => setFocusedSetting("classification.opacity")}
              >
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={opacity}
                  className="w-full max-w-md rounded-sm accent-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    setOpacity(next)
                    schedulePrefsSave({ opacity: next })
                  }}
                />
              </SettingRow>
            </Section>

            <Section
              id="appearance"
              title="Appearance"
              sectionRef={(el) => {
                sectionRefs.current.appearance = el
              }}
            >
              <SettingRow
                id="appearance.theme"
                title="Color theme"
                description="Controls the overall light/dark appearance of TERRA."
                focused={focusedSetting === "appearance.theme"}
                onFocus={() => setFocusedSetting("appearance.theme")}
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
            </Section>

            <Section
              id="session"
              title="Session"
              sectionRef={(el) => {
                sectionRefs.current.session = el
              }}
            >
              <SettingRow
                id="session.activity"
                title="Activity"
                description="Runs per day over the last year. A run is one classification, composition, water, solar or wind analysis."
                focused={focusedSetting === "session.activity"}
                onFocus={() => setFocusedSetting("session.activity")}
              >
                <ActivityGrid />
              </SettingRow>

              <SettingRow
                id="session.analyses"
                title="Saved analyses"
                description="Full history lives in the Analysis hub. Recent runs are listed below."
                focused={focusedSetting === "session.analyses"}
                onFocus={() => setFocusedSetting("session.analyses")}
              >
                <button
                  type="button"
                  onClick={goAnalysis}
                  className={btnGhost}
                >
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
            </Section>
          </div>
      </PageBody>
    </PageShell>
  )
}

function Section({
  id,
  title,
  children,
  sectionRef,
}: {
  id: SettingsSectionId
  title: string
  children: React.ReactNode
  sectionRef: (el: HTMLElement | null) => void
}) {
  return (
    <section
      ref={sectionRef}
      data-section={id}
      className="mb-8 scroll-mt-3"
    >
      <h2 className="mb-1 border-b border-border pb-2 font-display text-heading font-semibold tracking-wide text-foreground">
        {title}
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  )
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
