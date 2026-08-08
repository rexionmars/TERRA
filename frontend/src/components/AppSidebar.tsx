import { Map, UserRound, LogIn, Github, ChartColumn, Zap } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { AvatarCircle } from "@/components/AvatarCircle"

interface AppSidebarProps {
  onOpenRepo: () => void
  hasAnalysis?: boolean
  /** If set, used instead of goAnalysis (e.g. back to list when already on detail). */
  onAnalysisClick?: () => void
}

export function AppSidebar({
  onOpenRepo,
  hasAnalysis = false,
  onAnalysisClick,
}: AppSidebarProps) {
  const { user, loading, screen, goMap, goAuth, goProfile, goAnalysis, goEnergy } =
    useAuth()

  return (
    <aside className="app-no-drag flex w-14 shrink-0 flex-col items-center border-r border-border/60 bg-ink py-3">
      <nav className="flex flex-1 flex-col items-center gap-1">
        <NavItem
          active={screen === "map"}
          title="Map"
          onClick={goMap}
          icon={<Map className="h-4 w-4" />}
        />
        {/* Zap rather than Sun or Wind: the screen holds both resources behind
            mutually exclusive tabs, and either weather glyph would name one of
            them and read as a forecast rather than as generation. */}
        <NavItem
          active={screen === "energy"}
          title="Energy"
          onClick={goEnergy}
          icon={<Zap className="h-4 w-4" />}
        />
        <NavItem
          active={screen === "analysis"}
          title="Analysis"
          onClick={onAnalysisClick ?? goAnalysis}
          icon={<ChartColumn className="h-4 w-4" />}
          badge={hasAnalysis}
        />
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1">
        {!loading && (
          <NavItem
            active={screen === "auth" || screen === "profile"}
            title={user ? "Settings" : "Sign in"}
            onClick={() => (user ? goProfile() : goAuth())}
            icon={
              user?.avatar_uri ? (
                <AvatarCircle uri={user.avatar_uri} size="sm" />
              ) : user ? (
                <UserRound className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )
            }
          />
        )}
        <NavItem
          active={false}
          title="Repository"
          onClick={onOpenRepo}
          icon={<Github className="h-4 w-4" />}
        />
      </div>
    </aside>
  )
}

function NavItem({
  active,
  title,
  onClick,
  icon,
  badge,
}: {
  active: boolean
  title: string
  onClick: () => void
  icon: React.ReactNode
  badge?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
      )}
    >
      {icon}
      {badge && !active && (
        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-[1px] bg-primary" />
      )}
    </button>
  )
}
