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
 *
 * Whether a section is open is the user's, and only the user's. See the state
 * below: the column does not fold or unfold itself when the screen changes.
 */
import {
  ChartColumn,
  ChevronRight,
  LogIn,
  Map as MapIcon,
  UserRound,
  Waves,
  Zap,
} from "lucide-react"
import { motion } from "motion/react"
import { useState, type ReactNode, useSyncExternalStore } from "react"
import {
  panelSelection,
  selectPanel,
  subscribePanelSelection,
} from "@/lib/panelSelection"
import { useAuth, type AppScreen } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { AvatarCircle } from "@/components/AvatarCircle"
import { MAP_TOOLS, type MapToolId } from "@/lib/mapTools"
import { ENERGY_TABS } from "@/lib/navigation"
import type { EnergyTab } from "@/pages/EnergyScreen"

export interface AppNavProps {
  hasAnalysis?: boolean
  /** Used instead of goAnalysis when the analysis screen is already open. */
  onAnalysisClick?: () => void
  /** The map's open tool panel, so its children can show which is current. */
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
  hasAnalysis = false,
  onAnalysisClick,
  energyTab,
  onEnergyTabChange,
  projectSwitcher,
}: AppNavProps) {
  /*
    Subscribed rather than received. Both this column and the map screen read
    which panel is open, and holding it in App meant a collapse reconciled every
    screen in order to change which of three panels was drawn. See
    lib/panelSelection.ts.
  */
  const leftPanel = useSyncExternalStore(
    subscribePanelSelection,
    panelSelection
  )
  const {
    user,
    loading,
    screen,
    goStudio,
    goAuth,
    goProfile,
    goAnalysis,
    goEnergy,
    goFlood,
  } = useAuth()

  const onMap = screen === "studio"
  const onEnergy = screen === "energy"

  /**
   * Which sections are open. Set by the user and by nothing else.
   *
   * This followed the screen in view, which meant navigating silently folded
   * and unfolded the column under the pointer: going to Energy closed Map, and
   * a list the user had opened to read would vanish because they went to look
   * at what it named. Expansion is a reading choice, navigation is a going
   * choice, and one does not imply the other.
   *
   * Both start open so the structure is visible without being hunted for. This
   * column is mounted outside the screen transition, so the state survives
   * navigation; it resets on restart, which is a session default rather than a
   * stored preference.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    map: true,
    energy: true,
  })
  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const mapChildren: NavChild[] = MAP_TOOLS.map((t) => ({
    key: t.id,
    label: t.label,
    active: onMap && leftPanel === t.id,
    onSelect: () => {
      selectPanel(t.id)
      goStudio()
    },
  }))

  const energyChildren: NavChild[] = ENERGY_TABS.map((c) => ({
    key: c.id,
    label: c.label,
    active: onEnergy && energyTab === c.id,
    onSelect: () => {
      onEnergyTabChange(c.id as typeof energyTab)
      goEnergy()
    },
  }))

  return (
    /*
      The width animates, the contents do not. This column is a flex item, so
      withholding it is a layout change rather than a fade: collapsing the
      outer width lets the map take the space over the same beat, while the
      inner element keeps its full measure so the labels slide out of view
      instead of reflowing into a narrower column on the way.
    */
    <motion.aside
      // One step up the surface scale from the title bar, which is bg-ink at 40
      // percent over the map. Both read as the same tone where the map is dark,
      // and the two are different surfaces: the title bar floats over the
      // content, the sidebar sits beside it.
      className="app-no-drag shrink-0 overflow-hidden border-r border-border/60 bg-surface"
      initial={{ width: 0 }}
      animate={{ width: "13.5rem" }}
      exit={{ width: 0 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
    >
    <div className="flex h-full w-[13.5rem] flex-col">
      {projectSwitcher && (
        <div className="border-b border-border/60 p-2">{projectSwitcher}</div>
      )}

      <nav aria-label="Sections" className="flex flex-1 flex-col gap-0.5 p-2">
        <NavItem
          id="studio"
          active={onMap}
          label="Map"
          onClick={goStudio}
          icon={<MapIcon className="size-4" />}
          items={mapChildren}
          expanded={expanded.map}
          onToggleExpanded={() => toggle("studio")}
        />
        {/* Zap rather than Sun or Wind: the screen holds both resources, and
            either weather glyph would name one of them and read as a forecast
            rather than as generation. */}
        <NavItem
          id="energy"
          active={onEnergy}
          label="Energy"
          onClick={goEnergy}
          icon={<Zap className="size-4" />}
          items={energyChildren}
          expanded={expanded.energy}
          onToggleExpanded={() => toggle("energy")}
        />
        {/* Waves rather than a rain or droplet glyph: the analysis reads
            terrain and no precipitation at all, so a cloud would name an
            input it does not have. See lib/navigation.ts, which carries the
            same group for the dock layout's bar. */}
        <NavItem
          id="flood"
          active={screen === "flood"}
          label="Flood envelope"
          onClick={goFlood}
          icon={<Waves className="size-4" />}
        />
        <NavItem
          id="analysis"
          active={screen === "analysis"}
          label="Project hub"
          onClick={onAnalysisClick ?? goAnalysis}
          icon={<ChartColumn className="size-4" />}
          badge={hasAnalysis}
        />
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border/60 p-2">
        {!loading && (
          <NavItem
            id="settings"
            active={screen === "auth" || screen === "profile"}
            /*
              WHO IS SIGNED IN, not where the entry leads.

              Every other entry in this column names a destination, and this
              one names a person, which is the same shape the account control
              takes in the applications this column is modelled on: the row is
              read as "you", and settings is what you get when you press
              yourself. The avatar beside it already said so and the word did
              not.

              The stored name is trimmed and falls back to the destination,
              because a row that renders as an empty string beside an avatar is
              a row with no label at all -- and the field that feeds it is only
              guarded at the point of save, not in the database.
            */
            label={user ? user.display_name.trim() || "Settings" : "Sign in"}
            /*
              The label truncates at 13.5rem and a truncated name is a name you
              cannot read. The title carries the whole of it.
            */
            title={user?.display_name.trim() || undefined}
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
      </div>
    </div>
    </motion.aside>
  )
}

function NavItem({
  id,
  active,
  label,
  title,
  onClick,
  icon,
  badge,
  items,
  expanded,
  onToggleExpanded,
}: {
  id: string
  active: boolean
  label: string
  /** The whole label, for a row narrow enough to truncate it. */
  title?: string
  onClick: () => void
  icon: ReactNode
  badge?: boolean
  items?: NavChild[]
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  const listId = `nav-${id}-children`
  return (
    <div className="flex flex-col">
      {/*
        Two controls, not one. Going somewhere and looking at what is there are
        different intentions, and a chevron that only reported state made the
        second impossible without doing the first. They are siblings rather than
        nested because a button inside a button is invalid, and a screen reader
        would have announced one control where there are two.
      */}
      <div
        className={cn(
          "group flex h-8 items-center rounded-sm transition-colors",
          active
            ? "bg-surface-raised text-foreground"
            : "text-muted-foreground hover:bg-surface-raised/70"
        )}
      >
        <button
          type="button"
          onClick={onClick}
          title={title}
          // aria-current names the destination in view for a screen reader,
          // which the previous rail conveyed with a background colour alone.
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-sm pl-2 text-left text-emphasis",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !active && "group-hover:text-foreground"
          )}
        >
          <span className={cn("shrink-0", active && "text-primary")}>{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge && !active && (
            <span className="size-1.5 shrink-0 rounded-[1px] bg-primary" />
          )}
        </button>

        {items?.length ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={!!expanded}
            aria-controls={expanded ? listId : undefined}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
            className={cn(
              "flex h-full w-7 shrink-0 items-center justify-center rounded-sm",
              "text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
          >
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                expanded && "rotate-90"
              )}
            />
          </button>
        ) : (
          // Keeps the labels of childless destinations on the same left edge as
          // the ones with a chevron.
          <span className="w-2 shrink-0" />
        )}
      </div>

      {items?.length && expanded ? (
        // The rail on the left is what makes these read as belonging to the
        // item above rather than as siblings of it.
        <ul
          id={listId}
          className="ml-4 flex flex-col border-l border-border/60 pl-2 pt-0.5"
        >
          {items.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={c.onSelect}
                aria-current={c.active ? "true" : undefined}
                className={cn(
                  "flex h-7 w-full items-center rounded-sm px-2 text-left text-emphasis transition-colors",
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
