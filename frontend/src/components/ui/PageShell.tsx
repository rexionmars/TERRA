/**
 * What a full-page screen is in this system.
 *
 * The app runs two chassis. Everything that floats over a raster -- the map
 * tool panels, the status readouts, the two foot tracks -- is a `.panel`: a
 * bordered surface with the system radius, entering on a spring. Everything
 * that fills the window instead -- settings, analysis, sign-in, projects and
 * the modals -- was `.terra-workspace`, a flat fill with hairlines ported from
 * an editor theme, and it inherited the sand palette without ever taking the
 * shape.
 *
 * The difference was never a decision. A page has no raster underneath, so it
 * cannot borrow the reason the glass exists -- but the surface, the border, the
 * radius and the entry are the identity, and none of those depend on there
 * being a map. A page is panels laid on the ink, at the same radius and the
 * same spring, which is what this file declares so the next screen does not
 * have to decide it again.
 *
 * The chrome a page does NOT carry: its own title. The title bar already names
 * the screen and the account, and a header repeating them costs a full band of
 * height above the content for nothing.
 */
import type { ReactNode, Ref } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

/** One spring for the whole family, so two pages never enter differently. */
const ENTER = { type: "spring", stiffness: 360, damping: 34 } as const

export function PageShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "app-no-drag flex h-full min-h-0 gap-3 bg-ink p-3",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * The section column, where a page has one.
 *
 * One width by default, because the three that existed -- 15rem, 15.5rem and
 * 16.5rem -- were not three decisions. They were the same column written three
 * times, and a user moving between settings and projects saw the content start
 * at a different place each time. A caller may still override it, but it needs
 * a reason rather than an omission.
 */
export function PageAside({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.aside
      className={cn(
        "panel flex w-64 shrink-0 flex-col overflow-hidden rounded-md",
        className
      )}
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={ENTER}
    >
      {children}
    </motion.aside>
  )
}

export function PageBody({
  children,
  className,
  scrollRef,
}: {
  children: ReactNode
  className?: string
  /** The scrolling box, for a page that observes what is in view. */
  scrollRef?: Ref<HTMLDivElement>
}) {
  return (
    <motion.main
      className={cn(
        "panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md",
        className
      )}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
    >
      <div ref={scrollRef} className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </motion.main>
  )
}
