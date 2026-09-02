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

/*
  Three, and only one of them is work.

  It carried six. Four were screens the studio has since absorbed -- the map it
  grew out of, the two energy products, the flood envelope -- and the fifth was
  the project hub, whose management moved into the studio itself. What is left
  beside the studio is the account: signing in, and settings.
*/
export type AppScreen = "studio" | "auth" | "profile"

/**
 * A page of the settings screen, when something wants to open a particular one.
 *
 * The Python environment briefly had a screen of its own here, which gave one
 * subject three separate doors -- a full-screen route, a link inside settings,
 * and the first-run gate. It is a settings page like the others; opening it is
 * opening settings at that page.
 */
export type SettingsPage = "account" | "system"

interface AuthContextValue {
  user: User | null
  prefs: Preferences | null
  runs: InferenceRun[]
  projects: Project[]
  loading: boolean
  screen: AppScreen
  goStudio: () => void
  goAuth: () => void
  goProfile: (page?: SettingsPage) => void
  /** Which settings page to open on arrival, consumed once by ProfilePage. */
  settingsPage: SettingsPage | null
  /** Clears the above, so it steers one arrival rather than every one. */
  consumeSettingsPage: () => void
  /** The screen settings was opened from, for naming the way out. */
  settingsReturnTo: AppScreen
  /** Return to that screen. */
  leaveSettings: () => void
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
  const [screen, setScreen] = useState<AppScreen>("studio")

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
      setScreen("studio")
      notifySuccess(`Welcome back, ${u.display_name}.`)
    },
    [loadPrefsAndRuns]
  )

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const u = (await Register(email, password, displayName)) as unknown as User
      setUser(u)
      await loadPrefsAndRuns(u)
      setScreen("studio")
      notifySuccess("Account created.")
    },
    [loadPrefsAndRuns]
  )

  const logout = useCallback(async () => {
    await Logout()
    setUser(null)
    setPrefs(null)
    setScreen("studio")
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

  /*
    SAVING DOES NOT RE-APPLY, and this used to call `onPrefsApplied`.

    That callback is the LOAD path: it takes stored preferences and pushes them
    into the controls -- the default model, the overlay opacity, the theme, the
    saved-AOI catalog. Running it as the echo of every save meant that
    persisting ANYTHING re-applied EVERYTHING, and most of what is persisted has
    nothing to do with those controls.

    What it cost: `default_model` is "spectral" for most installs, so picking
    the temporal transformer and then touching anything that writes preferences
    put the picker back on spectral, silently, and the next run was a random
    forest with no sign on screen that a choice had been discarded. Five
    unrelated actions write preferences on their own -- the studio's layout on a
    debounced seam drag, the map view on pan and zoom, the layout mode toggle,
    the saved-AOI catalog on activation, and the what's-new version -- so the
    reset arrived at times bearing no relation to the control it reset.

    It was intermittent rather than constant because `SavePreferences` is a
    round trip: the reset landed only if the selection happened inside that
    window.

    No caller needs the echo. Every one of them already holds the state it just
    wrote, and Settings applies the theme itself rather than waiting to be told.
  */
  const savePrefs = useCallback(
    async (p: Preferences, opts?: { silent?: boolean }) => {
      await SavePreferences(p as never)
      setPrefs(p)
      if (!opts?.silent) notifySuccess("Preferences saved.")
    },
    []
  )

  /**
   * Which settings page the next arrival should land on.
   *
   * Cleared by consumeSettingsPage once ProfilePage has acted on it, so
   * returning to settings by hand shows the page last chosen there rather than
   * replaying the destination of whatever sent the user in the first time.
   */
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null)

  const consumeSettingsPage = useCallback(() => setSettingsPage(null), [])

  /**
   * Where settings was opened from, so leaving it returns there.
   *
   * Only the screen is kept: the sub-tabs -- which map tool, which energy
   * resource -- are held in App precisely so they survive a screen change, so
   * returning to the screen restores the tab that was open on it.
   *
   * Settings is the one screen with no work of its own to go back to. Every
   * other destination is a place the user chose; this one is a detour, and
   * the only way out was to pick a destination from the column, which meant
   * remembering what you had been doing and landing somewhere adjacent to it
   * rather than back in it.
   */
  const [settingsReturnTo, setSettingsReturnTo] = useState<AppScreen>("studio")

  const goProfile = useCallback(
    (page?: SettingsPage) => {
      setSettingsPage(page ?? null)
      // Not from settings to settings: a second visit must not overwrite the
      // work screen the first one recorded.
      if (screen !== "profile" && screen !== "auth") setSettingsReturnTo(screen)
      setScreen(user ? "profile" : "auth")
    },
    [user, screen]
  )

  /** Leave settings for the screen it was opened from. */
  const leaveSettings = useCallback(() => {
    setScreen(settingsReturnTo)
  }, [settingsReturnTo])

  /*
    THE PLAIN DESTINATIONS, EACH WITH ONE IDENTITY FOR THE LIFE OF THE PROVIDER.

    These were arrow literals written inside the context value below, which
    means they were rebuilt every time that memo recomputed -- and it recomputes
    on `runs`, on `projects`, on `prefs`, on `screen`. A consumer is entitled
    to put a callback from a context into a dependency array; that is what
    dependency arrays are for. These could not be put in one, because they were
    a different function on every recomputation and any effect depending on one
    re-ran forever.

    That is not hypothetical. ProfilePage's account effect held `goAuth` and
    called `refreshRuns`, so it ran, set `runs`, rebuilt this memo, got a new
    `goAuth`, and ran again -- and each pass re-seeded the display name field
    from the stored value, which is why the name could be typed into but never
    changed.

    `setScreen` is a state setter and React guarantees its identity, so the
    dependency lists are empty and these are built once. `goProfile` above
    cannot join them: it reads `user` and `screen` to decide where to land and
    what to record, so its identity properly follows those.
  */
  const goStudio = useCallback(() => setScreen("studio"), [])
  const goAuth = useCallback(() => setScreen("auth"), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      prefs,
      runs,
      projects,
      loading,
      screen,
      goStudio,
      goAuth,
      goProfile,
      settingsPage,
      consumeSettingsPage,
      settingsReturnTo,
      leaveSettings,
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
      consumeSettingsPage,
      settingsReturnTo,
      leaveSettings,
      goStudio,
      goAuth,
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
