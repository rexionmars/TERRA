/**
 * Where the map is looking, published outside React.
 *
 * WHY THIS IS NOT STATE. The map reports its centre and zoom on every frame of
 * a pan -- that is what the map's `move` event is -- and the only thing in the
 * application that reads the live value is the coordinate readout in the title
 * bar. Routing it through `useState` in App put a new object on the ROOT
 * component sixty times a second, and App's subtree is every screen the
 * application has. React has no way to skip that: the object is new each frame,
 * nothing on the path is memoised, and so a drag on the map reconciled the
 * whole tree once per frame.
 *
 * That is measurable as the map being heavy to pan, and it is not only the
 * map's problem -- the same render is what a screen transition and the studio
 * switch land in the middle of.
 *
 * A store instead, so the one component that wants the live value subscribes to
 * it and nothing else hears. The committed value still goes through App on
 * `moveend`, where it is wanted for persistence and for restoring the position
 * across screens, and where it happens once per gesture rather than per frame.
 */
export interface MapPose {
  lat: number
  lon: number
  zoom: number
}

let pose: MapPose | null = null
const listeners = new Set<() => void>()

/** Called from the map's move handler. Replaces the pose and wakes readers. */
export function publishMapPose(next: MapPose): void {
  pose = next
  for (const fn of listeners) fn()
}

export function subscribeMapPose(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/**
 * The current pose, or null before the map has reported one.
 *
 * The reference is stable between publishes, which is what useSyncExternalStore
 * requires: a getSnapshot that built a new object each call would re-render its
 * subscriber on every check.
 */
export function mapPose(): MapPose | null {
  return pose
}
