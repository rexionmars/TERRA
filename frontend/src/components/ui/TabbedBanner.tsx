import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react"

import { BrowserOpenURL } from "../../../wailsjs/runtime/runtime"
import { risingTab } from "@/lib/frameCorners"
import type { Scene } from "@/lib/orbitScenes"
import { cn } from "@/lib/utils"

/** A chip set over a picture: dark glass with light text, in either theme. */
export const PHOTO_CHIP =
  "rounded-full bg-[rgb(4_6_11/0.62)] text-[rgb(236_232_223)] backdrop-blur-sm"

/*
  A BANNER WHOSE TITLE IS SET ON THE PAGE, NOT ON THE PICTURE. The page's
  ground rises into the picture's foot at the left to hold what `held` is, in
  the frame's construction (lib/frameCorners.ts), as the splash's base holds
  the name: a 60-degree side, a convex corner at its top and a fillet where it
  leaves the foot. So the title keeps the page's contrast in either theme,
  whatever the picture is bright with under it, and the picture is left whole
  everywhere else.

  The tab is drawn from the held block's measured box, which changes when Exo 2
  arrives after the fallback face.

  Square at the bottom left, which the tab covers: a rounded clip there lets a
  hairline of the picture through the tab's edge where both are antialiased.
  The page's ground under the banner is bg-app, which is what the tab is
  filled with; a banner set on another ground would show the tab.
*/
export function TabbedBanner({
  held,
  children,
  className,
  ...rest
}: {
  /** What the tab holds: the title, set on the page's ground. */
  held: ReactNode
  /** The picture, and anything set over it. */
  children?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const block = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = block.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const tab = box && risingTab(box.w, box.h)

  return (
    <div
      {...rest}
      className={cn(
        "relative h-64 overflow-hidden rounded-md rounded-bl-none bg-[rgb(var(--p-ink))]",
        className
      )}
    >
      {children}
      {tab && (
        <svg
          aria-hidden
          className="absolute bottom-0 left-0"
          width={tab.total}
          height={tab.height}
          viewBox={`0 0 ${tab.total} ${tab.height}`}
        >
          <path d={tab.d} className="fill-app" />
        </svg>
      )}
      <div ref={block} className="absolute bottom-0 left-0 pt-4 pr-6">
        {held}
      </div>
    </div>
  )
}

/** The credit a scene's licence asks for, over the picture; it opens the source. */
export function SceneCredit({ scene }: { scene: Scene }) {
  return (
    <button
      type="button"
      onClick={() => BrowserOpenURL(scene.source)}
      title={`${scene.place}: ${scene.subject}. Open the source`}
      className={cn(
        PHOTO_CHIP,
        "max-w-full truncate px-2.5 py-0.5 text-meta transition-colors hover:bg-[rgb(4_6_11/0.8)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      <span className="font-medium">{scene.place}</span> · {scene.credit}
    </button>
  )
}

/** One figure beside a banner: a label over a number or a short value. */
export function BannerFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="telemetry mt-0.5 text-display text-foreground tabular-nums">
        {value}
      </dd>
    </div>
  )
}
