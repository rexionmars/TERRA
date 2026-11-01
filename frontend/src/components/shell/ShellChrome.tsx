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
  SidebarSimple,
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
import { REPO_URL } from "@/lib/brand"
import { notifyError } from "@/lib/notify"
import { openProjectFile, projectFileName } from "@/lib/projectFiles"
import { cn } from "@/lib/utils"

/** What the rail can show as current. */
export type RailPlace =
  "explore" | "areas" | "analyses" | "compare" | "workflows" | "activity"

/*
  THE RAIL IS NARROWER THAN THE TRAFFIC LIGHTS ARE WIDE. They end about 61px in and
  the rail is 52, as the layout this follows has it, so on macOS they sit across the
  seam. The strip above the mark and the header are one band for that reason: one
  ground, one line under it and no rail edge through the third light. The header
  then starts its contents clear of them.

  Read off the navigator rather than asked of the runtime, as the title bar does.
  A wrong answer there is a window with no controls and is worth a round trip; here
  it is a blank strip, and an answer that arrives late would slide the mark on every
  launch.
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
            "app-no-drag h-7 max-w-[20rem] truncate rounded-sm px-1.5 text-heading transition-colors hover:bg-hover hover:text-foreground",
            current ? "text-foreground" : "text-muted-foreground"
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
 * Where the reader is, beside the rail rather than over it.
 *
 * The crumbs carry no arrow: each opens its menu when pressed, and the row reads as
 * a path to the current place rather than as two more controls.
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
    <header
      className={cn(
        "app-draggable relative z-[500] flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-[rgb(var(--p-ink))] pr-2",
        RESERVES_TRAFFIC_LIGHTS && !railOpen ? "pl-[1.125rem]" : "pl-2"
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
        <SidebarSimple className="size-4" />
      </button>
      <nav
        aria-label="Project and area"
        className="flex min-w-0 flex-1 items-center gap-0.5"
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
            className="app-no-drag flex h-7 items-center gap-1 rounded-sm border border-border px-2 text-read text-foreground transition-colors hover:bg-hover"
          >
            Options
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
        {appItem(app.items.environment)}
        {appItem(app.items.storage)}
        {appItem(app.items.releaseNotes)}
        {appItem(app.items.splash)}
        {appItem(app.items.about)}
      </MenuPopover>
      <WindowControls />
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
 * The full height of the window, with the mark at its head.
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
  onActivity: () => void
}) {
  const { user, loading, goProfile, goAuth } = useAuth()
  const link = (path: string) => () => BrowserOpenURL(`${REPO_URL}${path}`)
  return (
    <nav
      aria-label="Application"
      className={cn(
        "app-no-drag relative z-[500] flex h-full shrink-0 flex-col bg-[rgb(var(--p-ink))] transition-[width] duration-150",
        open ? "w-52" : "w-[3.25rem]"
      )}
    >
      {RESERVES_TRAFFIC_LIGHTS && (
        <div className="app-draggable h-11 shrink-0 border-b border-border" />
      )}
      <div className="flex min-h-0 flex-1 flex-col border-r border-border">
        <div
          className={cn(
            "flex h-11 shrink-0 items-center",
            open ? "gap-3 px-3" : "justify-center"
          )}
        >
          <img
            src="/terra-logo.png"
            alt="TERRA"
            className="size-7 shrink-0 rounded-md object-contain"
          />
          {open && (
            <span className="font-display text-sm font-semibold tracking-[0.14em] text-foreground">
              TERRA
            </span>
          )}
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto py-1",
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
