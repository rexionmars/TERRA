/**
 * The application's navigation column.
 *
 * It replaced a 14px icon-only rail carrying three destinations while the app
 * had five screens, so two of them were reachable only from inside another. The
 * destinations are named, and the ones that hold sub-contexts show them: the
 * map's tool panels and the energy screen's two resources were previously a
 * vertical tab strip floating over the map and a tab strip inside a screen, so
 * neither could be seen without first arriving somewhere.
 *
 * A child does not navigate anywhere its parent does not: selecting one moves to
 * the parent screen and opens that context within it. That is why the map's
 * tools belong here at all -- they were a dock whose tabs opened a panel beside
 * the map, and the dock stops being a separate idea once the destinations are
 * named.
 */
import {
  ChartColumn,
  ChevronRight,
  Github,
  LogIn,
  Map as MapIcon,
  UserRound,
  Zap,
} from "lucide-react"
import type { ReactNode } from "react"
import { useAuth, type AppScreen } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { AvatarCircle } from "@/components/AvatarCircle"
import { MAP_TOOLS, type MapToolId } from "@/lib/mapTools"
import type { EnergyTab } from "@/pages/EnergyScreen"

export interface AppNavProps {
  onOpenRepo: () => void
  hasAnalysis?: boolean
  /** Used instead of goAnalysis when the analysis screen is already open. */
  onAnalysisClick?: () => void
  /** The map's open tool panel, so its children can show which is current. */
  leftPanel: MapToolId | null
  onLeftPanelChange: (id: MapToolId | null) => void
  /** The energy screen's open tab, for the same reason. */
  energyTab: EnergyTab
  onEnergyTabChange: (tab: EnergyTab) => void
  /** Slot for the project switcher, which names the context everything acts on. */
  projectSwitcher?: ReactNode
}

interface NavChild {
  key: string
  label: string
  active: boolean
  onSelect: () => void
}

export function AppNav({
  onOpenRepo,
  hasAnalysis = false,
  onAnalysisClick,
  leftPanel,
  onLeftPanelChange,
  energyTab,
  onEnergyTabChange,
  projectSwitcher,
}: AppNavProps) {
  const { user, loading, screen, goMap, goAuth, goProfile, goAnalysis, goEnergy } =
    useAuth()

  const onMap = screen === "map"
  const onEnergy = screen === "energy"

  const mapChildren: NavChild[] = MAP_TOOLS.map((t) => ({
    key: t.id,
    label: t.label,
    active: onMap && leftPanel === t.id,
    onSelect: () => {
      onLeftPanelChange(t.id)
      goMap()
    },
  }))

  const energyChildren: NavChild[] = (
    [
      { key: "solar", label: "Solar" },
      { key: "wind", label: "Wind" },
    ] as const
  ).map((c) => ({
    key: c.key,
    label: c.label,
    active: onEnergy && energyTab === c.key,
    onSelect: () => {
      onEnergyTabChange(c.key)
      goEnergy()
    },
  }))

  return (
    <aside className="app-no-drag flex w-[13.5rem] shrink-0 flex-col border-r border-border/60 bg-ink">
      {projectSwitcher && (
        <div className="border-b border-border/60 p-2">{projectSwitcher}</div>
      )}

      <nav aria-label="Sections" className="flex flex-1 flex-col gap-0.5 p-2">
        <NavItem
          active={onMap}
          label="Map"
          onClick={goMap}
          icon={<MapIcon className="size-4" />}
          items={mapChildren}
          expanded={onMap}
        />
        {/* Zap rather than Sun or Wind: the screen holds both resources, and
            either weather glyph would name one of them and read as a forecast
            rather than as generation. */}
        <NavItem
          active={onEnergy}
          label="Energy"
          onClick={goEnergy}
          icon={<Zap className="size-4" />}
          items={energyChildren}
          expanded={onEnergy}
        />
        <NavItem
          active={screen === "analysis"}
          label="Analysis"
          onClick={onAnalysisClick ?? goAnalysis}
          icon={<ChartColumn className="size-4" />}
          badge={hasAnalysis}
        />
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border/60 p-2">
        {!loading && (
          <NavItem
            active={screen === "auth" || screen === "profile"}
            label={user ? "Settings" : "Sign in"}
            onClick={() => (user ? goProfile() : goAuth())}
            icon={
              user?.avatar_uri ? (
                <AvatarCircle uri={user.avatar_uri} size="sm" />
              ) : user ? (
                <UserRound className="size-4" />
              ) : (
                <LogIn className="size-4" />
              )
            }
          />
        )}
        <NavItem
          active={false}
          label="Repository"
          onClick={onOpenRepo}
          icon={<Github className="size-4" />}
        />
      </div>
    </aside>
  )
}

function NavItem({
  active,
  label,
  onClick,
  icon,
  badge,
  items,
  expanded,
}: {
  active: boolean
  label: string
  onClick: () => void
  icon: ReactNode
  badge?: boolean
  items?: NavChild[]
  /** Children are shown only for the destination in view: a list of every
      sub-context at once is a menu, not a location. */
  expanded?: boolean
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onClick}
        // aria-current names the destination in view for a screen reader, which
        // the previous rail conveyed with a background colour alone.
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex h-8 items-center gap-2.5 rounded-sm px-2 text-left text-body transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active
            ? "bg-surface-raised text-foreground"
            : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
        )}
      >
        <span className={cn("shrink-0", active && "text-primary")}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge && !active && (
          <span className="size-1.5 shrink-0 rounded-[1px] bg-primary" />
        )}
        {items?.length ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
        ) : null}
      </button>

      {items?.length && expanded ? (
        // The rail on the left is what makes these read as belonging to the
        // item above rather than as siblings of it.
        <ul className="ml-4 flex flex-col border-l border-border/60 pl-2 pt-0.5">
          {items.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={c.onSelect}
                aria-current={c.active ? "true" : undefined}
                className={cn(
                  "flex h-7 w-full items-center rounded-sm px-2 text-left text-body transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  c.active
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
                )}
              >
                <span className="min-w-0 truncate">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
