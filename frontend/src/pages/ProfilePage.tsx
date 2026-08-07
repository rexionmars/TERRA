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
import { cn } from "@/lib/utils"
import type { InferenceRun, LeftDockTabsMode, Preferences } from "@/lib/types"
import {
  leftDockTabsModeFromPrefs,
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
  { id: "appearance", label: "Appearance", count: 2 },
  { id: "session", label: "Session", count: 1 },
]

const btnGhost =
  "ar-ghost inline-flex h-8 items-center gap-1.5 rounded-sm border px-3 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"

const btnPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"

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
  const [leftDockTabs, setLeftDockTabs] =
    useState<LeftDockTabsMode>("retracted_only")
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
    leftDockTabs: "retracted_only" as LeftDockTabsMode,
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
      leftDockTabs: leftDockTabsModeFromPrefs(prefs),
    }
    setModel(next.model)
    setOpacity(next.opacity)
    setTheme(next.theme)
    setLeftDockTabs(next.leftDockTabs)
    prefsDraftRef.current = next
    prefsReady.current = true
  }, [prefs])

  const persistPreferences = useCallback(
    async (next: {
      model: string
      opacity: number
      theme: string
      leftDockTabs: LeftDockTabsMode
    }) => {
      if (!user) return
      const payload: Preferences = {
        user_id: user.id,
        default_model: next.model,
        overlay_opacity: next.opacity,
        theme: next.theme,
        extras_json: mergePreferenceExtras(prefs?.extras_json, {
          left_dock_tabs: next.leftDockTabs,
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
      leftDockTabs: LeftDockTabsMode
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
    <div className="terra-workspace app-no-drag flex h-full min-h-0 overflow-hidden">
      {/* TOC — VS Code settings tree */}
      <aside className="ar-sidebar flex w-[15.5rem] shrink-0 flex-col">
        <div className="border-b px-3 py-3" style={{ borderColor: "var(--ar-border)" }}>
          <p className="telemetry text-[10px] text-primary">SETTINGS</p>
          <p className="mt-1 truncate text-[12px] font-medium text-foreground">
            User
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto px-1.5 py-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className={cn(
                "ar-nav-item flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[12px]",
                activeSection === s.id && "is-active"
              )}
            >
              <span className="truncate text-foreground/90">{s.label}</span>
              <span className="telemetry shrink-0 text-[10px] text-muted-foreground">
                ({s.count})
              </span>
            </button>
          ))}
        </nav>
        <div
          className="border-t px-3 py-2"
          style={{ borderColor: "var(--ar-border)" }}
        >
          <button type="button" onClick={() => void logout()} className={btnGhost}>
            <LogOut className="h-3 w-3" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Settings editor */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="ar-header flex shrink-0 items-center justify-between gap-3 px-5 py-2.5">
          <div className="flex items-center gap-4">
            <span className="border-b border-foreground pb-0.5 text-[12px] font-medium text-foreground">
              User
            </span>
            <span className="text-[12px] text-muted-foreground">{user.email}</span>
          </div>
          <span className="telemetry hidden text-[10px] text-muted-foreground sm:inline">
            Changes apply automatically
          </span>
        </header>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto">
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
                    className="field-input ar-inset max-w-xs"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={() => setFocusedSetting("account.displayName")}
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
                  className="field-input ar-inset max-w-md opacity-70"
                  value={user.email}
                  readOnly
                  onFocus={() => setFocusedSetting("account.email")}
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
                  className="field-input ar-inset max-w-md"
                  value={model}
                  onFocus={() => setFocusedSetting("classification.model")}
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
                  className="w-full max-w-md accent-primary"
                  onFocus={() => setFocusedSetting("classification.opacity")}
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
                  className="field-input ar-inset max-w-xs"
                  value={theme}
                  onFocus={() => setFocusedSetting("appearance.theme")}
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

              <SettingRow
                id="appearance.dock"
                title="Left dock tabs"
                description="When the map left dock tabs should stay visible."
                focused={focusedSetting === "appearance.dock"}
                onFocus={() => setFocusedSetting("appearance.dock")}
              >
                <select
                  className="field-input ar-inset max-w-md"
                  value={leftDockTabs}
                  onFocus={() => setFocusedSetting("appearance.dock")}
                  onChange={(e) => {
                    const next = e.target.value as LeftDockTabsMode
                    setLeftDockTabs(next)
                    schedulePrefsSave({ leftDockTabs: next })
                  }}
                >
                  <option value="retracted_only">
                    Only when panels are hidden
                  </option>
                  <option value="always">Always visible</option>
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
                  onFocus={() => setFocusedSetting("session.analyses")}
                >
                  <ChartColumn className="h-3 w-3" />
                  Open analyses
                </button>
                {recentRuns.length === 0 ? (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    No recent analyses yet.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {recentRuns.map((r) => (
                      <li
                        key={r.id}
                        className="ar-raised flex items-center justify-between gap-3 px-3 py-2 text-[11px]"
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
        </div>
      </div>
    </div>
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
      <h2 className="mb-1 border-b pb-2 font-display text-[15px] font-semibold tracking-wide text-foreground"
        style={{ borderColor: "var(--ar-border)" }}
      >
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
        "settings-row relative border-l-2 py-3.5 pl-4 pr-2 transition-colors",
        focused
          ? "border-[var(--ar-select)] bg-[var(--ar-raised)]"
          : "border-transparent hover:bg-[color-mix(in_srgb,var(--ar-raised)_55%,transparent)]"
      )}
      onMouseDown={onFocus}
    >
      <div className="text-[13px] font-medium text-foreground">{title}</div>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
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
