import { useState } from "react"

import { CreateProject } from "../../../wailsjs/go/main/App"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import {
  Bell,
  Book,
  CaretRight,
  ChatCentered,
  Columns,
  Compass,
  Folders,
  Graph,
  Lifebuoy,
  SidebarCollapse,
  SidebarSimple,
  SquaresFour,
  User,
  type Icon,
} from "@/components/icons"
import {
  OperatorMenuItem,
  MenuItem,
  MenuRule,
  MenuPopover,
} from "@/components/workspace/MenuPopover"
import { WindowControls } from "@/components/TitleBar"
import { btnGhostDense } from "@/components/ui/buttons"
import type { AppSurfaces } from "@/lib/appSurfaces"
import type { Area } from "@/lib/areas"
import { useAuth } from "@/lib/auth"
import { APP_MENU, REPO_URL } from "@/lib/brand"
import { notifyError } from "@/lib/notify"
import { openProjectFile, projectFileName } from "@/lib/projectFiles"
import { cn } from "@/lib/utils"

/**
 * What the rail can show as current: the places, the activity log, and the
 * account's settings, which the account at its foot opens.
 *
 * Areas is not one of them. It is a panel over the map, not a place, and it
 * opens from the area's step in the path (ShellPath), where an area is chosen.
 */
export type RailPlace =
  "explore" | "analyses" | "compare" | "workflows" | "models" | "activity" | "settings"

/*
  THE TRAFFIC LIGHTS ARE WIDER THAN THE RAIL. In the hidden title bar main.go
  asks for, on macOS 26, they end 69px in and are centred 16px down, measured
  on captures of the window. The rail is 52, so beside the closed rail the
  frame reaches into the card's top left corner to hold them (ShellCorners);
  the open rail, 208 wide, holds them itself. Either way the rail's first
  button starts below them.

  Read off the navigator rather than asked of the runtime, as the title bar does.
  A wrong answer there is a window with no controls and is worth a round trip; here
  it is a corner piece and a few pixels of padding, and an answer that arrives
  late would move the rail's buttons on every launch.
*/
export const RESERVES_TRAFFIC_LIGHTS = /Mac/i.test(navigator.platform)

const RAIL_KEY = "terra.rail-open"

/** Whether the rail was left showing its labels. Per viewer, so local storage. */
export function readRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1"
  } catch {
    return false
  }
}

export function keepRailOpen(open: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, open ? "1" : "0")
  } catch {
    // Held for this session only.
  }
}

function Crumb({
  label,
  title,
  current = false,
  open,
  onOpenChange,
  children,
}: {
  label: string
  title: string
  /** The last crumb, which names where the reader is. */
  current?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <MenuPopover
      open={open}
      onOpenChange={onOpenChange}
      surface={document.body}
      widthRem={18}
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          onClick={p.onClick}
          aria-expanded={p["aria-expanded"]}
          aria-haspopup="menu"
          title={title}
          className={cn(
            "app-no-drag h-6 truncate rounded-sm px-1.5 text-heading transition-colors hover:bg-hover hover:text-foreground",
            /*
              The place gives way first. The project keeps its name whole up to
              12rem, so a long area name is cut before the project's is.
            */
            current
              ? "max-w-[20rem] min-w-0 text-foreground"
              : "max-w-[12rem] shrink-0 text-muted-foreground"
          )}
        >
          {label}
        </button>
      )}
    >
      {children}
    </MenuPopover>
  )
}

/**
 * A name, and a project made from it and opened.
 *
 * In the project menu because an area belongs to a project and nothing can be
 * drawn before one is open, so a first launch reaches this before anything else.
 */
function NewProject({ onCreated }: { onCreated: (id: string) => void }) {
  const { refreshProjects } = useAuth()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const created = await CreateProject(trimmed, "")
      await refreshProjects()
      if (created?.id) onCreated(created.id)
    } catch (err) {
      notifyError("Could not create the project", err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={(e) => void create(e)}
      className="flex items-center gap-1 border-t border-border p-1.5"
    >
      <input
        aria-label="New project name"
        placeholder="New project name"
        className="field-input min-w-0 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={!name.trim() || busy} className={btnGhostDense}>
        Create
      </button>
    </form>
  )
}

/**
 * Where the reader is, as one path from the application to the place:
 * the mark and TERRA EO, then the project, then the area.
 *
 * Held in the frame's top right corner (ShellCorners), the corner the mark
 * stood in on the bar this replaced. One line rather than the name on one side
 * and the place in the middle: it reads as where the reader is, starting from
 * the application, and each step opens its own menu -- the application's, the
 * project's, the area's. The steps carry no caret: each opens its menu when
 * pressed, and the row reads as a path to the current place rather than as
 * three more controls.
 */
export function ShellPath({
  projectName,
  projects,
  activeProjectId,
  onActivateProject,
  areas,
  areaName,
  activeAreaId,
  onPickArea,
  onManageAreas,
  app,
  recentFiles,
}: {
  projectName: string
  projects: readonly { id: string; name: string }[]
  activeProjectId?: string | null
  onActivateProject?: (id: string) => void
  areas: readonly Area[]
  areaName: string
  activeAreaId?: string
  onPickArea: (area: Area) => void
  /** Opens the areas panel: every area and its fields, drawing, import, IBGE. */
  onManageAreas: () => void
  app: AppSurfaces
  /** Project files opened lately, newest first. */
  recentFiles: readonly string[]
}) {
  const [menu, setMenu] = useState<"project" | "area" | "options" | null>(null)
  const open = (m: "project" | "area" | "options") => (next: boolean) =>
    setMenu(next ? m : null)
  const roots = areas.filter((a) => !a.parent_id)
  const appItem = (i: AppSurfaces["items"][keyof AppSurfaces["items"]]) => (
    <MenuItem
      label={i.label}
      disabled={i.disabled}
      onSelect={() => {
        setMenu(null)
        i.onSelect()
      }}
    />
  )
  return (
    <nav
      aria-label="Where you are"
      className="flex h-full min-w-0 items-center gap-0.5"
    >
      {/*
        The mark and the name open the application's menu, which holds what
        belongs to the application rather than to the place: project files,
        settings, the environment, the release notes, About. The name is the
        label for that (APP_MENU), set as the title bar over the other screens
        sets it (TitleBar), with EO in the muted tone its tagline takes there.
        The operator search and the keymap print the same name as the way to
        these commands.

        The name goes below 40rem, where the place needs the width more than
        the path needs to say what application this is.
      */}
      <MenuPopover
        open={menu === "options"}
        onOpenChange={open("options")}
        surface={document.body}
        align="end"
        widthRem={15}
        trigger={(p) => (
          <button
            ref={p.ref}
            type="button"
            onClick={p.onClick}
            aria-expanded={p["aria-expanded"]}
            aria-haspopup="menu"
            aria-label={APP_MENU}
            title={APP_MENU}
            className={cn(
              "app-no-drag flex h-6 shrink-0 items-center gap-1.5 rounded-sm pr-1.5 pl-0.5 transition-colors hover:bg-hover",
              p["aria-expanded"] && "bg-hover"
            )}
          >
            <img
              src="/terra-logo.png"
              alt=""
              draggable={false}
              className="size-6 shrink-0 object-contain"
            />
            <span className="font-display text-heading font-semibold tracking-[0.14em] whitespace-nowrap max-sm:hidden">
              TERRA <span className="text-muted-foreground">EO</span>
            </span>
          </button>
        )}
      >
        <OperatorMenuItem id="PROJECT_OPEN" onDone={() => setMenu(null)} />
        <OperatorMenuItem id="PROJECT_SAVE" onDone={() => setMenu(null)} />
        <OperatorMenuItem id="PROJECT_SAVE_AS" onDone={() => setMenu(null)} />
        <OperatorMenuItem id="PROJECT_REVEAL" onDone={() => setMenu(null)} />
        {recentFiles.slice(0, 5).map((path) => (
          <MenuItem
            key={path}
            indented
            label={projectFileName(path)}
            title={path}
            onSelect={() => {
              setMenu(null)
              openProjectFile(path)
            }}
          />
        ))}
        <MenuRule />
        {/*
          The commands with no other menu. Their keys, the rail and the start
          screen reach them too, but a command is also a row somewhere, and the
          operator search and the keymap name this menu as the place.
        */}
        <OperatorMenuItem id="SEARCH" onDone={() => setMenu(null)} />
        <OperatorMenuItem id="PREFERENCES" onDone={() => setMenu(null)} />
        <OperatorMenuItem id="KEYMAP" onDone={() => setMenu(null)} />
        <OperatorMenuItem id="START" onDone={() => setMenu(null)} />
        <MenuRule />
        {appItem(app.items.environment)}
        {appItem(app.items.storage)}
        {appItem(app.items.releaseNotes)}
        {appItem(app.items.splash)}
        {appItem(app.items.about)}
      </MenuPopover>
      <CaretRight className="size-3 shrink-0 text-muted-foreground" />
      <Crumb
        label={projectName}
        title="Project"
        open={menu === "project"}
        onOpenChange={open("project")}
      >
        {projects.map((pr) => (
          <MenuItem
            key={pr.id}
            label={pr.name}
            checked={pr.id === activeProjectId}
            onSelect={() => {
              setMenu(null)
              onActivateProject?.(pr.id)
            }}
          />
        ))}
        <NewProject
          onCreated={(id) => {
            setMenu(null)
            onActivateProject?.(id)
          }}
        />
      </Crumb>
      <CaretRight className="size-3 shrink-0 text-muted-foreground" />
      <Crumb
        label={areaName}
        title="Area"
        current
        open={menu === "area"}
        onOpenChange={open("area")}
      >
        {roots.length ? (
          roots.map((a) => (
            <MenuItem
              key={a.id}
              label={a.name}
              checked={a.id === activeAreaId}
              onSelect={() => {
                setMenu(null)
                onPickArea(a)
              }}
            />
          ))
        ) : (
          <p className="px-2 py-1.5 text-label text-muted-foreground">
            No areas yet. Draw one with the pencil on the map.
          </p>
        )}
        <MenuRule />
        <MenuItem
          label="Manage areas…"
          title="Every area of the project and its fields: rename, delete, import, or take a boundary from IBGE"
          onSelect={() => {
            setMenu(null)
            onManageAreas()
          }}
        />
      </Crumb>
      <WindowControls />
    </nav>
  )
}

function RailButton({
  icon: Glyph,
  label,
  title,
  open,
  active = false,
  dot = false,
  onClick,
}: {
  icon: Icon
  label: string
  /** The tooltip, where it has to say more than the label does. */
  title?: string
  open: boolean
  active?: boolean
  /** Something new behind it. */
  dot?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        /*
          Round, a circle beside the closed rail and a pill beside the open
          one: the rail is the frame, and a place on it is marked as a stop on
          a line rather than as a control's box.
        */
        "relative flex h-9 shrink-0 items-center rounded-full text-foreground transition-colors",
        open ? "w-full gap-3 px-2.5" : "w-9 justify-center",
        // A ground and not the accent: this says where the reader is, and the
        // palette spends the accent on what can be acted on.
        active ? "bg-[rgb(var(--p-surface-raised))]" : "hover:bg-hover"
      )}
    >
      <Glyph className="size-[1.125rem] shrink-0" />
      {open && <span className="truncate text-read">{label}</span>}
      {dot && (
        <span
          aria-hidden
          className={cn(
            "absolute size-1.5 rounded-full bg-destructive-quiet",
            open ? "top-1.5 left-[1.5rem]" : "top-1.5 right-1.5"
          )}
        />
      )}
    </button>
  )
}

/** Up to two letters of a name, for the square that stands for an account. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

/**
 * Where a reader can go, as against what they can do where they are.
 *
 * Down the left of the window, on the frame's ground: the rail is the frame's
 * left side, so it carries no edge of its own. The mark is in the path at the
 * top right, as the application's menu.
 */
export function ShellRail({
  place,
  open,
  onToggle,
  unseen,
  onExplore,
  onAnalyses,
  onCompare,
  onWorkflows,
  onModels,
  onActivity,
}: {
  place: RailPlace
  open: boolean
  /** Shows or hides the labels. */
  onToggle: () => void
  unseen: boolean
  onExplore: () => void
  onAnalyses: () => void
  onCompare: () => void
  onWorkflows: () => void
  onModels: () => void
  onActivity: () => void
}) {
  const { user, loading, goProfile, goAuth } = useAuth()
  const link = (path: string) => () => BrowserOpenURL(`${REPO_URL}${path}`)
  return (
    /*
      THE WIDTH CHANGES AT ONCE, NOT OVER A TRANSITION. The map beside the rail
      takes the width the rail leaves, and a WebGL canvas cannot follow a width
      that moves every frame: MapLibre resizes its drawing buffer and renders
      the globe again on each change, at most every 50ms, and between two of
      those the browser stretches the previous frame to the new box. Changed at
      once, the map resizes a single time, in the frame the rail changes.
    */
    <nav
      aria-label="Application"
      className={cn(
        "app-no-drag relative z-500 flex h-full shrink-0 flex-col bg-app",
        open ? "w-52" : "w-[3.25rem]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/*
          The first button starts 8px below the traffic lights on macOS, and
          level with the card's top edge elsewhere.
        */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto pb-1",
            RESERVES_TRAFFIC_LIGHTS ? "pt-10" : "pt-2",
            open ? "px-2" : "items-center"
          )}
        >
          <RailButton
            icon={Compass}
            label="Explore"
            open={open}
            active={place === "explore"}
            onClick={onExplore}
          />
          <RailButton
            icon={Folders}
            label="Analyses"
            open={open}
            active={place === "analyses"}
            onClick={onAnalyses}
          />
          <RailButton
            icon={Columns}
            label="Compare"
            open={open}
            active={place === "compare"}
            onClick={onCompare}
          />
          <RailButton
            icon={Graph}
            label="Workflows"
            open={open}
            active={place === "workflows"}
            onClick={onWorkflows}
          />
          {/*
            The glyph Analyses gives a classification run: every model on the
            Models screen is a classifier.
          */}
          <RailButton
            icon={SquaresFour}
            label="Models"
            title="Models: the trained classifiers"
            open={open}
            active={place === "models"}
            onClick={onModels}
          />
          <div className="flex-1" />
          <RailButton
            icon={Bell}
            label="Activity"
            open={open}
            active={place === "activity"}
            dot={unseen}
            onClick={onActivity}
          />
          <RailButton
            icon={ChatCentered}
            label="Feedback"
            open={open}
            onClick={link("/issues")}
          />
          <RailButton
            icon={Lifebuoy}
            label="Help"
            open={open}
            onClick={link("/blob/main/docs/TROUBLESHOOTING.md")}
          />
          <RailButton
            icon={Book}
            label="User guide"
            open={open}
            onClick={link("/blob/main/docs/USER_GUIDE.md")}
          />
          {/*
            The rail's own control, on the rail: it changes nothing but the
            rail. Its glyph points the way the next press goes, and it keeps
            its place at the foot, so the press that opens the rail leaves it
            under the pointer for the press that closes it.
          */}
          <RailButton
            icon={open ? SidebarCollapse : SidebarSimple}
            label={open ? "Hide the labels" : "Show the labels"}
            open={open}
            onClick={onToggle}
          />
        </div>

        {!loading && (
          <div
            className={cn("flex shrink-0 pt-1 pb-2", open ? "px-2" : "justify-center")}
          >
            <button
              type="button"
              onClick={() => (user ? goProfile() : goAuth())}
              title={user ? "Settings" : "Sign in"}
              aria-label={user ? "Settings" : "Sign in"}
              aria-current={place === "settings" ? "page" : undefined}
              className={cn(
                "flex h-9 items-center rounded-md text-foreground transition-colors",
                open ? "w-full gap-3 px-1" : "w-9 justify-center",
                place === "settings"
                  ? "bg-[rgb(var(--p-surface-raised))]"
                  : "hover:bg-hover"
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[rgb(var(--p-surface-raised))] text-label font-medium">
                {user?.avatar_uri ? (
                  <img
                    src={user.avatar_uri}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : user?.display_name ? (
                  initials(user.display_name)
                ) : (
                  <User className="size-4 text-muted-foreground" />
                )}
              </span>
              {open && (
                <span className="truncate text-read">
                  {user?.display_name || "Sign in"}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
