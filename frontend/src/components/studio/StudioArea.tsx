/**
 * One area: a header that is a control surface, a toolbar, and a body.
 *
 * THE HEADER IS NOT A LABEL BAR. This is the correction that matters. The
 * first version of this file drew a name and three arrangement buttons and
 * called it a header, and the result was a studio with Blender's regions and
 * none of their contents: of about eighty controls in the studio, exactly one
 * that was not about the arrangement had reached a header. Blender's viewport
 * header alone carries a mode selector, four menus, transform orientation,
 * pivot, snapping, proportional editing, and on the right visibility, gizmos,
 * overlays, x-ray and four shading modes. That is where its density comes from.
 *
 * THREE ZONES, as Blender has them:
 *
 *   [type ⌄] [menus…]        [centre…]        [options…] │ (arrangement)
 *
 * `menus` is what the editor DOES, `centre` is how it is doing it, `options`
 * is what is shown. The zones are props because only the component holding the
 * studio's state can build them -- the same argument `studioEditors` makes for
 * keeping renderers out of the registry.
 *
 * THE ARRANGEMENT COSTS NO HEADER PIXELS. Splitting, joining and maximising
 * live on the header's context menu, which is where Blender puts them. Three
 * permanent buttons for operations performed once a session were spending the
 * scarcest space in the studio on the rarest actions.
 *
 * AN AREA TOO SMALL SAYS SO, rather than drawing something unreadable. The
 * domain-shift section was once fitted into a 15rem band and the outcome is
 * recorded in this codebase: "present in the code, invisible in use".
 */
import { useRef, useState } from "react"
import { Columns, ArrowsOut, ArrowsIn, Rows, X } from "@phosphor-icons/react"
import {
  STUDIO_EDITORS,
  studioEditor,
  type EditorId,
} from "@/lib/studioEditors"
import {
  StudioMenuItem,
  StudioMenuRule,
  StudioPopover,
} from "@/components/studio/StudioPopover"
import { StudioHeaderPopoverButton } from "@/components/studio/StudioHeaderControls"
import { cn } from "@/lib/utils"

/** The header's height, which the canvas has to clear to sit under its area. */
export const AREA_HEADER_PX = 26

/**
 * A mode an editor can be put into, offered beside the editor itself.
 *
 * Retyping an area and then finding the pane you wanted inside it is two
 * gestures for one intention. Blender's own type menu is flat, but its editors
 * mostly have one subject; the outliner here has three and the run editor
 * four, and the reader knows which one they want at the moment they choose
 * the editor -- not after it appears.
 */
export interface StudioEditorMode {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  active: boolean
  select: () => void
}

export interface AreaHeaderSlots {
  /** What the editor does: pulldowns, immediately right of the type button. */
  menus?: React.ReactNode
  /** How it is doing it: mode, orientation, snapping. */
  centre?: React.ReactNode
  /** What is shown: visibility, overlays, shading. Right-aligned. */
  options?: React.ReactNode
  /** A vertical strip of tools down the left of the body. */
  toolbar?: React.ReactNode
  /** A second strip under the header, for the active tool's settings. */
  toolSettings?: React.ReactNode
}

export function StudioArea({
  editor,
  rect,
  rootPx,
  surface,
  onRetype,
  onSplit,
  onClose,
  onMaximize,
  maximized,
  takenUnique,
  canClose,
  transparent = false,
  slots,
  modes,
  children,
}: {
  editor: EditorId
  rect: { x: number; y: number; w: number; h: number }
  rootPx: number
  /** The studio surface popovers are portalled into and clamped against. */
  surface: HTMLElement | null
  onRetype: (id: EditorId) => void
  onSplit: (dir: "row" | "col") => void
  onClose: () => void
  onMaximize: () => void
  maximized: boolean
  takenUnique: ReadonlySet<EditorId>
  canClose: boolean
  /** The viewport draws its own canvas behind the body, which must show. */
  transparent?: boolean
  slots?: AreaHeaderSlots
  /** Sub-modes per editor, offered under it in the type menu. */
  modes?: Partial<Record<EditorId, StudioEditorMode[]>>
  children: React.ReactNode
}) {
  const meta = studioEditor(editor)
  const [typeMenu, setTypeMenu] = useState(false)
  const [areaMenu, setAreaMenu] = useState(false)

  /*
    THE RIGHT-CLICK THAT DISMISSES, TOLD APART FROM THE ONE THAT SUMMONS.

    A context menu that cannot be closed by the gesture that opened it reads as
    stuck, and this one could not: the popover closes on any pointer press
    outside it, and the press of a second right-click on the header is exactly
    that. So the sequence was close-then-open on every attempt -- the menu
    blinked and stayed, and the only way out was to press somewhere else.

    Read at pointerdown rather than at contextmenu, and by hand rather than
    from the state: the popover's dismissal runs on a window listener in the
    capture phase, ahead of both, so by the time the contextmenu event arrives
    the only record that the menu HAD been open is the one taken here. React
    has not re-rendered in between -- both events are one task -- so the value
    this closure reads is still the pre-dismissal one.
  */
  const dismissedByRightPress = useRef(false)

  /*
    THE HEADER NAMES THE PANE, NOT THE EDITOR THAT HOLDS IT.

    An area set to Canopy > Season read "Canopy", which is the one thing about
    it a reader can already see -- the figures in the body are a season, not a
    stand -- while the answer to "which of the four is this" was folded away
    inside the menu that set it. The entrance says what was chosen there, which
    is what makes a second area beside it legible as a different reading of the
    same subject rather than as a duplicate.

    The GLYPH stays the editor's. Below 12rem the label withdraws and the icon
    is all that is left, and an area that has stopped saying which editor it is
    cannot be retyped by anyone who did not already know.
  */
  const pane = modes?.[editor]?.find((m) => m.active)

  const headerH = AREA_HEADER_PX
  const settingsH = slots?.toolSettings ? AREA_HEADER_PX : 0
  const bodyW = rect.w
  const bodyH = Math.max(0, rect.h - headerH - settingsH)
  const fits = bodyW >= meta.minRem * rootPx && bodyH >= meta.minRowRem * rootPx

  return (
    <div
      /*
        A TRANSPARENT AREA MUST ALSO BE TRANSPARENT TO THE POINTER.

        The viewport's canvas is drawn behind this rectangle rather than inside
        it, so that changing the arrangement never tears down the WebGL
        context. Painting the area transparent made the board visible again and
        left this div sitting over it: every press, drag and wheel landed on an
        empty box and the board stopped responding entirely.

        The root and the body let events through; the header takes them back,
        or its own menus would be unreachable for the one editor that needs
        the strip most.
      */
      className={cn(
        "absolute flex flex-col overflow-hidden border-r border-t",
        transparent && "pointer-events-none"
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderColor: "rgb(var(--p-line) / 0.28)",
        /*
          Only the BODY is transparent, never the whole area. Painting the root
          transparent for the viewport let the canvas run up through the header
          -- which is how the board's title block came to be drawn over two
          headers at once. A header is a layer nothing else draws into.
        */
        background: transparent ? "transparent" : "var(--s-panel)",
        /*
          A query container, so an editor can respond to the AREA's width
          rather than the window's. Without it a narrow area in a wide window
          still resolves `lg:` and draws a five-column grid into 20rem.
        */
        containerType: "inline-size",
      }}
    >
      {/* HEADER */}
      <div
        onPointerDown={(e) => {
          if (e.button === 2) dismissedByRightPress.current = areaMenu
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (dismissedByRightPress.current) {
            dismissedByRightPress.current = false
            // Closed here as well as by the popover, for the one press it does
            // not treat as an outside one: a right-click on the grip itself,
            // which is its anchor. The gesture is a toggle either way.
            setAreaMenu(false)
            return
          }
          setAreaMenu(true)
        }}
        // `studio-header` makes this the container the labels inside measure
        // against, so a name withdraws when THIS area narrows rather than when
        // the window does.
        className="studio-header pointer-events-auto relative flex shrink-0 items-center gap-0.5 overflow-hidden border-b px-1"
        style={{
          height: headerH,
          background: "var(--s-panel-head)",
          borderColor: "rgb(var(--p-line) / 0.22)",
        }}
      >
        {/* The editor selector, which is where Blender's header begins. */}
        <StudioPopover
          open={typeMenu}
          onOpenChange={setTypeMenu}
          surface={surface}
          widthRem={14}
          trigger={(p) => (
            <StudioHeaderPopoverButton
              {...p}
              icon={meta.icon}
              label={pane ? pane.label : meta.label}
              showLabel={rect.w > 12 * rootPx}
              open={typeMenu}
              title={pane ? `${meta.label} · ${pane.label} — ${meta.hint}` : meta.hint}
            />
          )}
        >
          {STUDIO_EDITORS.map((e) => {
            const blocked = !!e.unique && e.id !== editor && takenUnique.has(e.id)
            const subs = modes?.[e.id] ?? []
            return (
              <div key={e.id}>
                <StudioMenuItem
                  icon={e.icon}
                  label={e.label}
                  checked={e.id === editor}
                  disabled={blocked}
                  title={
                    blocked
                      ? `${e.label} owns the scene and can only be in one area`
                      : e.hint
                  }
                  onSelect={() => {
                    onRetype(e.id)
                    setTypeMenu(false)
                  }}
                />
                {/*
                  Indented rather than behind a flyout. Three items do not earn
                  the hover-intent, the second positioning pass and the
                  keyboard path a submenu needs, and a flyout in a 14rem
                  popover opens where there is no room for it.

                  Choosing one retypes AND sets the mode, which is the whole
                  point: it is one intention.
                */}
                {subs.map((m) => (
                  <StudioMenuItem
                    key={`${e.id}:${m.id}`}
                    icon={m.icon}
                    label={m.label}
                    indented
                    checked={e.id === editor && m.active}
                    disabled={blocked}
                    onSelect={() => {
                      m.select()
                      if (e.id !== editor) onRetype(e.id)
                      setTypeMenu(false)
                    }}
                  />
                ))}
              </div>
            )
          })}
        </StudioPopover>

        {slots?.menus}
        <span className="flex-1" />
        {slots?.centre}
        {slots?.centre && slots?.options ? <span className="flex-1" /> : null}
        {slots?.options}

        {/*
          The arrangement lives here, on the context menu, and costs the header
          nothing. An invisible affordance would be a problem for a reader who
          is not a full-time studio operator, so the type button's own menu
          carries the same entries at its foot.
        */}
        <StudioPopover
          open={areaMenu}
          onOpenChange={setAreaMenu}
          surface={surface}
          align="end"
          widthRem={13}
          trigger={(p) => (
            <button
              ref={p.ref as React.Ref<HTMLButtonElement>}
              type="button"
              onClick={p.onClick}
              aria-expanded={p["aria-expanded"]}
              aria-haspopup="menu"
              title="Area: split, close, maximise"
              className="ml-0.5 flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              {/* Blender's corner grip, which is also its split handle. */}
              <span className="text-[13px] leading-none">⌟</span>
            </button>
          )}
        >
          <StudioMenuItem
            icon={Columns}
            label="Split side by side"
            onSelect={() => {
              onSplit("row")
              setAreaMenu(false)
            }}
          />
          <StudioMenuItem
            icon={Rows}
            label="Split above and below"
            onSelect={() => {
              onSplit("col")
              setAreaMenu(false)
            }}
          />
          <StudioMenuRule />
          <StudioMenuItem
            icon={maximized ? ArrowsIn : ArrowsOut}
            label={maximized ? "Restore areas" : "Maximise area"}
            note="Ctrl Space"
            onSelect={() => {
              onMaximize()
              setAreaMenu(false)
            }}
          />
          <StudioMenuItem
            icon={X}
            label="Close area"
            disabled={!canClose}
            title={
              canClose
                ? "Its neighbour takes the space"
                : "The last area cannot be closed"
            }
            onSelect={() => {
              onClose()
              setAreaMenu(false)
            }}
          />
        </StudioPopover>
      </div>

      {/* TOOL SETTINGS, a second strip when the active tool has any. */}
      {slots?.toolSettings && (
        <div
          className="pointer-events-auto flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1"
          style={{
            height: AREA_HEADER_PX,
            background: "var(--s-panel-head)",
            borderColor: "rgb(var(--p-line) / 0.22)",
          }}
        >
          {slots.toolSettings}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {/* TOOLBAR, down the left of the body as Blender's T region is. */}
        {slots?.toolbar && (
          <div
            className="pointer-events-auto flex w-8 shrink-0 flex-col items-center gap-0.5 border-r py-1"
            style={{
              background: "var(--s-panel-head)",
              borderColor: "rgb(var(--p-line) / 0.22)",
            }}
          >
            {slots.toolbar}
          </div>
        )}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-hidden",
            // Only the viewport is see-through; every other editor draws in
            // its body and has to be able to be pressed there.
            !transparent && "pointer-events-auto"
          )}
        >
          {fits ? (
            children
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
              <meta.icon
                className="size-4 text-muted-foreground/60"
                strokeWidth={1.5}
              />
              <p className="text-[10px] leading-snug text-muted-foreground">
                {meta.label} needs {meta.minRem}×{meta.minRowRem} rem.
                <br />
                This area is {Math.round(bodyW / rootPx)}×
                {Math.round(bodyH / rootPx)}.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
