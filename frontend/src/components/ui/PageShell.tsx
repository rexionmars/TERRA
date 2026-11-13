/**
 * What a full-page screen is in this system.
 *
 * The app runs two chassis. Everything that floats over a raster -- the map
 * tool panels, the status readouts, the two foot tracks -- is a `.panel`: a
 * bordered surface with the system radius, entering on a spring. Everything
 * that fills the window instead -- settings, analysis, sign-in, projects and
 * the modals -- was `.terra-workspace`, a flat fill with hairlines ported from
 * an editor theme, and it inherited the palette without ever taking the shape.
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
 *
 * Sign-in is the one page left on it. Settings, the other, became a
 * destination in the map's shell (components/shell/SettingsScreen.tsx), and
 * the section column and the panel body it was built from went with it.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function PageShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("app-no-drag flex h-full min-h-0 gap-3 bg-app p-3", className)}>
      {children}
    </div>
  )
}
