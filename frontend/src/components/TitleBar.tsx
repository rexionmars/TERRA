import { Minus, Square, X } from "@/components/icons"
import { BRAND_TAGLINE } from "@/lib/brand"
import { useEffect, useState } from "react"
import {
  BrowserOpenURL,
  Environment,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../../wailsjs/runtime/runtime"
import type { CreditPart } from "@/lib/basemaps"
import { cn } from "@/lib/utils"

/**
 * One credited party, reachable where its licence asks it to be.
 *
 * A button calling BrowserOpenURL rather than an anchor with target="_blank".
 * This is a WKWebView, and Wails declares WKUIDelegate without implementing
 * createWebViewWith, so a blank-target link is silently ignored -- the click
 * does nothing at all. On a link the ODbL requires to be reachable, silently
 * nothing is the one outcome that cannot be shipped.
 *
 * Exported because the board's drawing map credits its basemap too, and an
 * anchor written there would be that silent failure a second time.
 */
export function Credit({ part }: { part: CreditPart }) {
  if (!part.href) return <span>{part.label}</span>
  return (
    <button
      type="button"
      onClick={() => BrowserOpenURL(part.href!)}
      className="cursor-pointer hover:text-foreground hover:underline"
    >
      {part.label}
    </button>
  )
}

/**
 * The bar over the screens that are not the map: sign-in and settings. The map has
 * a bar of its own, which says where the reader is; here there is only the name
 * and the window's buttons.
 */
export function TitleBar() {
  return (
    <header
      className={cn(
        /*
          32pt tall, twice the height at which macOS centres the traffic
          lights in a hidden title bar; see main.go. It is the frame's top
          edge where the map's frame reaches into its corners (ShellCorners):
          the page below is panels on the same ground, so the bar carries no
          line and no ground of its own.
        */
        "app-draggable relative flex h-8 shrink-0 items-center justify-between bg-app pr-2",
        /*
          The window's traffic lights own the first 69pt, and the wordmark
          keeps a centimetre clear of them: a physical distance between two
          things seen side by side, so it is written as one.
        */
        "pl-[calc(4.3125rem+1cm)]"
      )}
    >
      <div className="flex items-center gap-2">
        <img src="/terra-logo.png" alt="" className="size-6 object-contain" />
        <span className="font-display text-heading font-semibold tracking-[0.14em]">
          TERRA
        </span>
        <span className="eyebrow hidden sm:inline">{BRAND_TAGLINE}</span>
      </div>
      <WindowControls />
    </header>
  )
}

/**
 * The window's own buttons, where the platform does not draw them.
 *
 * Exported for the map shell's bar, which replaces this one and has the same
 * obligation: on Windows and Linux there is no other way to close the window.
 */
export function WindowControls() {
  /*
    Whether the platform draws the window controls, asked once.

    Not a user-agent string: Wails reports the platform it was built for, which
    is the thing being asked about. Starts false, so the buttons are absent for
    the frame before the answer arrives -- appearing late reads as the bar
    settling, where disappearing late reads as a glitch.
  */
  const [onMac, setOnMac] = useState(false)
  useEffect(() => {
    let cancelled = false
    void Environment()
      .then((env) => {
        if (!cancelled) setOnMac(env.platform === "darwin")
      })
      .catch(() => {
        /* No runtime to ask: leave the buttons drawn, which is the safe way
           to be wrong -- a window with no controls cannot be closed. */
      })
    return () => {
      cancelled = true
    }
  }, [])
  /*
    NOT ON macOS, where the platform draws them itself.

    These were written for a frameless window, which has no controls of its own.
    The window is titled now -- frameless made macOS composite it off the path it
    uses for titled windows, and that slowed every other window sharing its space
    -- so the traffic lights sit at the other end of the bar, and drawing a second
    set beside the avatar put two sets of window controls on one window.
  */
  if (onMac) return null
  return (
    <div className="app-no-drag flex items-center gap-1">
      <WindowButton onClick={WindowMinimise} title="Minimize">
        <Minus className="h-3.5 w-3.5" />
      </WindowButton>
      <WindowButton onClick={WindowToggleMaximise} title="Maximize">
        <Square className="h-3 w-3" />
      </WindowButton>
      <WindowButton onClick={Quit} danger title="Close">
        <X className="h-3.5 w-3.5" />
      </WindowButton>
    </div>
  )
}

function WindowButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground ${
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  )
}
