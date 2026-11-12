import { useState } from "react"

import { CreateProject } from "../../../wailsjs/go/main/App"
import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import {
  Bell,
  Book,
  CaretDown,
  CaretRight,
  ChatCentered,
  Columns,
  Compass,
  Folders,
  Graph,
  Lifebuoy,
  Polygon,
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

/** What the rail can show as current. */
export type RailPlace =
  "explore" | "areas" | "analyses" | "compare" | "workflows" | "models" | "activity"

/*
  THE TRAFFIC LIGHTS ARE WIDER THAN THE RAIL. In the inset title bar main.go
  asks for, on macOS 26, they end 79px in and are centred 26px down, measured
  on captures of the window. The rail is 52, so the lights cannot sit over it
  alone. The bar runs the width of the window instead, over the rail and the
  map: one ground, one line under it and no rail edge through the third
  light. It is 52px tall so that the lights sit on its centre line.

  Nothing in the bar moves with the rail. The toggle has a fixed place, 92px in
  on macOS, 13px clear of the lights, and centred over the rail's column
  elsewhere, so the press that opens the rail leaves the button under the
  pointer for the press that closes it. The crumbs keep their place in the
  middle of the bar, so a press changes the rail and not the line being read.
  Only the toggle's glyph changes, to point the way the next press goes.

  Read off the navigator rather than asked of the runtime, as the title bar does.
  A wrong answer there is a window with no controls and is worth a round trip; here
  it is a few pixels of padding, and an answer that arrives late would slide the
  bar's contents on every launch.
*/
const RESERVES_TRAFFIC_LIGHTS = /Mac/i.test(navigator.platform)

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
              two fifths of the field, so a long area name is cut before the
              project's is.
            */
            current
              ? "max-w-[20rem] min-w-0 text-foreground"
              : "max-w-[40%] shrink-0 text-muted-foreground"
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
 * Where the reader is, in a bar across the top of the window, over the rail and
 * the map.
 *
 * The crumbs carry no arrow: each opens its menu when pressed, and the row reads as
 * a path to the current place rather than as two more controls.
 *
 * They sit in the middle of the window, in a field with its own ground and
 * edge, as a code editor's command centre does. The place is what this bar is
 * read for, and the field marks the two names as something to press.
 */
export function ShellTopBar({
  projectName,
  projects,
  activeProjectId,
  onActivateProject,
  areas,
  areaName,
  activeAreaId,
  onPickArea,
  railOpen,
  onToggleRail,
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
  railOpen: boolean
  onToggleRail: () => void
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
    /*
      THREE COLUMNS, THE MIDDLE ONE CENTRED ON THE WINDOW. The field is 38% of
      the window, as an editor's is, but never under 15rem, where two names
      stop fitting. The sides share what it leaves, and neither gives up the
      width of its own contents, so in a narrow window the field moves off
      centre and then narrows rather than running under the lights or the mark.
    */
    <header className="app-draggable relative z-500 grid h-13 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,min(max(38vw,15rem),36rem))_minmax(max-content,1fr)] items-center gap-x-3 border-b border-border bg-[rgb(var(--p-ink))]">
      {/*
        The part of the bar before the crumbs: the lights and the toggle on
        macOS, the rail's column elsewhere. Its width does not follow the
        rail's; see RESERVES_TRAFFIC_LIGHTS.
      */}
      <div
        className={cn(
          "flex h-full items-center",
          RESERVES_TRAFFIC_LIGHTS ? "w-31 pl-23" : "w-[3.25rem] pl-2.5"
        )}
      >
        <button
          type="button"
          onClick={onToggleRail}
          aria-pressed={railOpen}
          aria-label={railOpen ? "Hide the labels" : "Show the labels"}
          title={railOpen ? "Hide the labels" : "Show the labels"}
          className="app-no-drag flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        >
          {railOpen ? (
            <SidebarCollapse className="size-4" />
          ) : (
            <SidebarSimple className="size-4" />
          )}
        </button>
      </div>
      <nav
        aria-label="Project and area"
        className="flex h-8 min-w-0 items-center justify-center gap-0.5 rounded-md border border-[rgb(var(--p-line)/0.4)] bg-[rgb(var(--p-control))] px-1"
      >
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
        </Crumb>
      </nav>

      <div className="flex h-full items-center justify-end gap-1.5 pr-2">
        {/*
          The mark and the name open the application's menu, which holds what
          belongs to the application rather than to the place: project files,
          settings, the environment, the release notes, About. The name is the
          label for that (APP_MENU), set as the bar over the other screens sets
          it (TitleBar), with EO in the muted tone its tagline takes there. The
          operator search and the keymap print the same name as the way to
          these commands. The caret marks the logo as a menu and not a picture.

          The name goes below 40rem, where the field in the middle needs the
          width more than the bar needs to say what application this is.
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
                "app-no-drag flex h-8 items-center gap-1.5 rounded-sm pr-1 pl-0.5 transition-colors hover:bg-hover",
                p["aria-expanded"] && "bg-hover"
              )}
            >
              <img
                src="/terra-logo.png"
                alt=""
                draggable={false}
                className="size-7 shrink-0 object-contain"
              />
              <span className="font-display text-heading font-semibold tracking-[0.14em] whitespace-nowrap max-sm:hidden">
                TERRA <span className="text-muted-foreground">EO</span>
              </span>
              <CaretDown className="size-3 text-muted-foreground" />
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
          screen reach them too, but a command is also a row somewhere, and
          the operator search and the keymap name this menu as the place.
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
        <WindowControls />
      </div>
    </header>
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
        "relative flex h-9 shrink-0 items-center rounded-md transition-colors",
        open ? "w-full gap-3 px-2.5" : "w-9 justify-center",
        // A ground and not the accent: this says where the reader is, and the
        // palette spends the accent on what can be acted on.
        active
          ? "bg-[rgb(var(--p-surface-raised))] text-foreground"
          : "text-muted-foreground hover:bg-hover hover:text-foreground"
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
 * Down the left of the window, under the bar. The mark is in the bar, as the
 * application's menu.
 */
export function ShellRail({
  place,
  open,
  unseen,
  onExplore,
  onAreas,
  onAnalyses,
  onCompare,
  onWorkflows,
  onModels,
  onActivity,
}: {
  place: RailPlace
  open: boolean
  unseen: boolean
  onExplore: () => void
  onAreas: () => void
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
        "app-no-drag relative z-500 flex h-full shrink-0 flex-col bg-[rgb(var(--p-ink))]",
        open ? "w-52" : "w-[3.25rem]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col border-r border-border">
        {/*
          8px above the first button, as on either side of it, so its ground
          does not sit against the bar's line.
        */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 pb-1",
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
            icon={Polygon}
            label="Areas"
            open={open}
            active={place === "areas"}
            onClick={onAreas}
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
          <hr className={cn("my-1.5 border-border", open ? "mx-1.5" : "w-7")} />
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
              className={cn(
                "flex h-9 items-center rounded-md text-foreground transition-colors hover:bg-hover",
                open ? "w-full gap-3 px-1" : "w-9 justify-center"
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
