import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { notifySuccess } from "@/lib/notify"
import {
  ClearAvatar,
  CurrentUser,
  GetPreferences,
  ListProjects,
  ListRuns,
  Login,
  Logout,
  Register,
  SavePreferences,
  SetAvatar,
  UpdateProfile,
} from "../../wailsjs/go/main/App"
import type { InferenceRun, Preferences, Project, User } from "@/lib/types"

export type AppScreen = "map" | "auth" | "profile" | "analysis" | "energy"

/**
 * A page of the settings screen, when something wants to open a particular one.
 *
 * The Python environment briefly had a screen of its own here, which gave one
 * subject three separate doors -- a full-screen route, a link inside settings,
 * and the first-run gate. It is a settings page like the others; opening it is
 * opening settings at that page.
 */
export type SettingsPage = "account" | "analysis" | "appearance" | "system"

interface AuthContextValue {
  user: User | null
  prefs: Preferences | null
  runs: InferenceRun[]
  projects: Project[]
  loading: boolean
  screen: AppScreen
  goMap: () => void
  goAuth: () => void
  goProfile: (page?: SettingsPage) => void
  goAnalysis: () => void
  goEnergy: () => void
  /** Which settings page to open on arrival, consumed once by ProfilePage. */
  settingsPage: SettingsPage | null
  navigate: (screen: AppScreen) => void
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (displayName: string) => Promise<void>
  setAvatar: (dataURI: string) => Promise<void>
  clearAvatar: () => Promise<void>
  savePrefs: (prefs: Preferences, opts?: { silent?: boolean }) => Promise<void>
  refreshRuns: () => Promise<void>
  refreshProjects: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  children,
  onPrefsApplied,
}: {
  children: ReactNode
  onPrefsApplied?: (p: Preferences) => void
}) {
  const [user, setUser] = useState<User | null>(null)
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [runs, setRuns] = useState<InferenceRun[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<AppScreen>("map")

  const refreshRuns = useCallback(async () => {
    try {
      const r = (await ListRuns(50)) as unknown as InferenceRun[]
      setRuns(r ?? [])
    } catch {
      setRuns([])
    }
  }, [])

  const refreshProjects = useCallback(async () => {
    try {
      const p = (await ListProjects()) as unknown as Project[]
      setProjects(p ?? [])
    } catch {
      setProjects([])
    }
  }, [])

  const loadPrefsAndRuns = useCallback(
    async (u: User) => {
      try {
        const p = (await GetPreferences()) as unknown as Preferences
        setPrefs(p)
        onPrefsApplied?.(p)
      } catch {
        setPrefs(null)
      }
      await Promise.all([refreshRuns(), refreshProjects()])
      void u
    },
    [onPrefsApplied, refreshRuns, refreshProjects]
  )

  useEffect(() => {
    CurrentUser()
      .then(async (u) => {
        const raw = u as User | null
        const next = raw?.id ? raw : null
        setUser(next)
        if (next) await loadPrefsAndRuns(next)
        else {
          try {
            const p = (await GetPreferences()) as unknown as Preferences
            setPrefs(p)
            onPrefsApplied?.(p)
          } catch {
            setPrefs(null)
          }
          await Promise.all([refreshRuns(), refreshProjects()])
        }
      })
      .catch(async () => {
        setUser(null)
        await Promise.all([refreshRuns(), refreshProjects()])
      })
      .finally(() => setLoading(false))
  }, [loadPrefsAndRuns, refreshRuns, refreshProjects, onPrefsApplied])

  const login = useCallback(
    async (email: string, password: string) => {
      const u = (await Login(email, password)) as unknown as User
      setUser(u)
      await loadPrefsAndRuns(u)
      setScreen("map")
      notifySuccess(`Welcome back, ${u.display_name}.`)
    },
    [loadPrefsAndRuns]
  )

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const u = (await Register(email, password, displayName)) as unknown as User
      setUser(u)
      await loadPrefsAndRuns(u)
      setScreen("map")
      notifySuccess("Account created.")
    },
    [loadPrefsAndRuns]
  )

  const logout = useCallback(async () => {
    await Logout()
    setUser(null)
    setPrefs(null)
    setScreen("map")
    notifySuccess("Signed out.")
    await Promise.all([refreshRuns(), refreshProjects()])
  }, [refreshRuns, refreshProjects])

  const updateProfile = useCallback(async (displayName: string) => {
    const u = (await UpdateProfile(displayName)) as unknown as User
    setUser(u)
    notifySuccess("Profile updated.")
  }, [])

  const setAvatar = useCallback(async (dataURI: string) => {
    const u = (await SetAvatar(dataURI)) as unknown as User
    setUser(u)
    notifySuccess("Photo updated.")
  }, [])

  const clearAvatar = useCallback(async () => {
    const u = (await ClearAvatar()) as unknown as User
    setUser(u)
    notifySuccess("Photo removed.")
  }, [])

  const savePrefs = useCallback(
    async (p: Preferences, opts?: { silent?: boolean }) => {
      await SavePreferences(p as never)
      setPrefs(p)
      onPrefsApplied?.(p)
      if (!opts?.silent) notifySuccess("Preferences saved.")
    },
    [onPrefsApplied]
  )

  /**
   * Which settings page the next arrival should land on.
   *
   * Null once ProfilePage has read it, so returning to settings by hand shows
   * the page last chosen there rather than replaying the destination of
   * whatever sent the user in the first time.
   */
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null)

  const goProfile = useCallback(
    (page?: SettingsPage) => {
      setSettingsPage(page ?? null)
      setScreen(user ? "profile" : "auth")
    },
    [user]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      prefs,
      runs,
      projects,
      loading,
      screen,
      goMap: () => setScreen("map"),
      goAuth: () => setScreen("auth"),
      goProfile,
      goAnalysis: () => setScreen("analysis"),
      goEnergy: () => setScreen("energy"),
      settingsPage,
      navigate: setScreen,
      login,
      register,
      logout,
      updateProfile,
      setAvatar,
      clearAvatar,
      savePrefs,
      refreshRuns,
      refreshProjects,
    }),
    [
      user,
      prefs,
      runs,
      projects,
      loading,
      screen,
      settingsPage,
      goProfile,
      login,
      register,
      logout,
      updateProfile,
      setAvatar,
      clearAvatar,
      savePrefs,
      refreshRuns,
      refreshProjects,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
