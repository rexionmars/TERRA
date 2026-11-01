/**
 * Where an editor's own pulldowns go: View, Add and Node for the compositor.
 *
 * Written where their state is and drawn in the bar above, so that state does not
 * have to be lifted out of the editor to reach a bar the editor does not own. A
 * state rather than a ref for the host, because a portal has to re-render once the
 * node exists and a ref does not say when that happened.
 */
import { createContext, useContext } from "react"
import { createPortal } from "react-dom"

export const AreaHeaderMenusHost = createContext<HTMLElement | null>(null)

export function AreaHeaderMenus({ children }: { children: React.ReactNode }) {
  const host = useContext(AreaHeaderMenusHost)
  return host ? createPortal(children, host) : null
}
