/**
 * The map's own controls, at the measurements the map already used.
 *
 * Leaflet's zoom and draw bars were styled in index.css and those rules died
 * with the library, so the numbers live here: a 2.125rem square, `--p-ink` at
 * 0.82 behind an 18px blur, a hairline between buttons in a bar and a hairline
 * around it.
 *
 * ONE COPY, because there were three -- the work map's stack, the board's
 * drawing surface, and the camera's own control, which had drifted into a
 * labelled pill twice the height of its neighbours. OverlayToolsPanel records
 * what that costs: "a narrower one beside them reads as a different kind of
 * control", and a wider one reads as a different kind of control that is also
 * shouting.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/** One bar of controls: the hairline, the radius and the shadow. */
export function MapBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.28)]",
        "shadow-[0_2px_8px_rgb(0_0_0/0.28)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One control: a glyph, and its name where a name belongs.
 *
 * The label is the title and the accessible name, not text on the button. A
 * map's chrome sits over the imagery it controls, and a control that spells
 * itself out takes ground from the thing being looked at -- which is the whole
 * argument for a toolbar of glyphs rather than a row of words.
 */
export function MapButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-[2.125rem] items-center justify-center transition-colors",
        "border-b border-[rgb(var(--p-line)/0.22)] last:border-b-0",
        "bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-primary"
          : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One control that opens a short list, at the same measurements as the rest.
 *
 * A CYCLE WAS THE FIRST SHAPE AND IT ASKED THE READER TO COUNT. Three answers
 * behind one button means the second is two presses away and the third is
 * either one or two depending on where the reader already is -- and the button
 * can only name where it is going, never where it could go. A list names all
 * three and costs one press to any of them.

 * It opens to the LEFT because the rail is at the map's right edge; a panel
 * hung the other way would open off the surface it belongs to.
 *
 * IN A PORTAL, AND THAT IS NOT CAUTION. MapBar carries `overflow-hidden` --
 * which is what clips its buttons to its own radius -- so a panel positioned
 * beside the rail is a panel outside the bar's box, and the first version of
 * this drew nothing at all: the button lit up, the list rendered, and the bar
 * cut it away. Measured from the trigger and hung on the body instead, which
 * is also what keeps it above the map's own canvas without a z-index race.
 *
 * The trigger carries the current choice's own glyph rather than a fixed one:
 * the rail is glyphs without words, so a control whose icon does not move says
 * nothing about what it is set to.
 */
export function MapMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  children,
}: {
  label: string;
  value: T;
  options: readonly { id: T; name: string; icon: React.ReactNode }[];
  onChange: (id: T) => void;
  /** The trigger's glyph: the current option's, chosen by the caller. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  /*
    Where the panel goes, measured rather than assumed. `right` is the distance
    from the viewport's right edge to the trigger's left edge, less the gap --
    the same relation the CSS had, in the coordinates a fixed element uses.
  */
  const place = useCallback(() => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ top: r.top, right: window.innerWidth - r.left + 6 });
  }, []);

  /*
    Closed by a press anywhere else and by Escape. `pointerdown` rather than
    `click`, so a press that lands on the map both closes this and reaches the
    map -- a menu that swallowed the first press would cost a second one to do
    anything after opening it.
  */
  useEffect(() => {
    if (!open) return;
    place();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!host.current?.contains(t) && !panel.current?.contains(t)) {
        setOpen(false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    // The rail is anchored to the map's corner, so anything that moves the
    // corner moves the trigger under a panel that is no longer beside it.
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const panel = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);
  return (
    <div ref={host} className="relative">
      <button
        type="button"
        title={`${label}: ${current?.name ?? value}`}
        aria-label={`${label}: ${current?.name ?? value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-[2.125rem] items-center justify-center transition-colors",
          "border-b border-[rgb(var(--p-line)/0.22)] last:border-b-0",
          "bg-[rgb(var(--p-ink)/0.82)] backdrop-blur-[18px]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          open
            ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-primary"
            : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.92)] hover:text-foreground",
        )}
      >
        {children}
      </button>
      {open &&
        at &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ position: "fixed", top: at.top, right: at.right }}
            className={cn(
              "z-[401] w-44 overflow-hidden",
              "rounded-md border border-[rgb(var(--p-line)/0.28)]",
              "bg-[rgb(var(--p-ink)/0.92)] backdrop-blur-[18px]",
              "shadow-[0_2px_8px_rgb(0_0_0/0.28)]",
            )}
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === value}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition-colors",
                  o.id === value
                    ? "bg-[rgb(var(--p-surface-raised)/0.92)] text-foreground"
                    : "text-muted-foreground hover:bg-[rgb(var(--p-surface-raised)/0.6)] hover:text-foreground",
                )}
              >
                <span className={o.id === value ? "text-primary" : undefined}>
                  {o.icon}
                </span>
                {o.name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
