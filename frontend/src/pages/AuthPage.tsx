import { useState } from "react"
import { SignIn, UserPlus } from "@phosphor-icons/react"
import { useAuth } from "@/lib/auth"
import { PageShell } from "@/components/ui/PageShell"
import { btnPrimaryCommit } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"

export function AuthPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      if (mode === "login") {
        await login(email.trim(), password)
      } else {
        await register(email.trim(), password, displayName.trim())
      }
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/i, ""))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell className="items-center justify-center overflow-y-auto">
      <div className="flex w-full max-w-md flex-col justify-center gap-4 px-5 py-10 sm:px-6">
        <div>
          <p className="telemetry text-meta text-accent-quiet">AUTH</p>
          <h1 className="mt-0.5 font-display text-xl font-semibold tracking-wide">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Local account stored on this machine. No cloud sync.
          </p>
        </div>

        <div className="flex gap-0.5 rounded-sm border border-border bg-secondary p-0.5">
          <TabButton
            active={mode === "login"}
            onClick={() => setMode("login")}
            icon={<SignIn className="h-3 w-3" />}
          >
            Login
          </TabButton>
          <TabButton
            active={mode === "register"}
            onClick={() => setMode("register")}
            icon={<UserPlus className="h-3 w-3" />}
          >
            Register
          </TabButton>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-sm border border-border bg-secondary/50 p-4"
        >
          {mode === "register" && (
            <Field label="Display name">
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="field-input focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Your name"
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <input
              required
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Min. 6 characters"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </Field>

          {error && <p className="text-body text-destructive-quiet">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className={cn(btnPrimaryCommit, "mt-1 w-full tracking-wide")}
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </PageShell>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  )
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "nav-item flex flex-1 items-center justify-center gap-1.5 rounded-sm py-2 text-body font-medium",
        active && "is-active"
      )}
    >
      {icon}
      {children}
    </button>
  )
}
