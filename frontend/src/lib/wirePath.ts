/**
 * The shapes a wire between two cards of a node field can take, and the SVG
 * path each one draws. The node fields are Workflows and Compare
 * (components/workspace/SocketCanvas.tsx); the reader picks one shape for both,
 * and it is kept with their preferences (session/wireShape.ts).
 *
 * A WIRE LEAVES AN OUTPUT GOING RIGHT AND ENTERS AN INPUT GOING RIGHT, since
 * outputs sit on a card's right edge and inputs on its left. Every shape but
 * the straight one keeps that: the curve leaves and arrives level, and the
 * right-angled shapes run a stub level out of the output and into the input
 * before they turn. A straight wire is one segment, socket to socket, and is
 * the one shape that crosses at an angle.
 *
 * AN INPUT BEHIND ITS OUTPUT IS REACHED AROUND, not through: the right-angled
 * shapes go out of the output, turn along the middle between the two heights,
 * come back past the input and enter it level. Two sockets at nearly the same
 * height have no middle to run along, so the wire runs below both.
 */

export const WIRE_SHAPES = [
  { id: "curved", label: "Curved" },
  { id: "straight", label: "Straight" },
  { id: "square", label: "Square corners" },
  { id: "rounded", label: "Rounded corners" },
] as const

export type WireShape = (typeof WIRE_SHAPES)[number]["id"]

/** The shape before the reader chooses one: the curve the fields always drew. */
export const DEFAULT_WIRE_SHAPE: WireShape = "curved"

export function isWireShape(v: unknown): v is WireShape {
  return WIRE_SHAPES.some((s) => s.id === v)
}

/** The run, in board units, a right-angled wire keeps level at each socket. */
export const STUB = 20
/** The largest radius of a rounded corner, in board units. */
export const CORNER = 10
/** How far below the lower socket a wire runs when there is no middle to use. */
const BELOW = 40

type Point = readonly [number, number]

/** A wire from the output at (x1, y1) to the input at (x2, y2). */
export function wirePath(
  shape: WireShape,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  switch (shape) {
    case "straight":
      return `M ${x1} ${y1} L ${x2} ${y2}`
    case "square":
      return polyline(route(x1, y1, x2, y2))
    case "rounded":
      return rounded(route(x1, y1, x2, y2), CORNER)
    case "curved": {
      const reach = Math.min(160, Math.max(30, Math.abs(x2 - x1) * 0.5))
      return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
    }
  }
}

/**
 * The corners of a right-angled wire: one turn down the middle when the input
 * is far enough ahead, else around, along the middle between the two heights.
 */
export function route(x1: number, y1: number, x2: number, y2: number): Point[] {
  if (x2 - x1 >= 2 * STUB) {
    const mx = (x1 + x2) / 2
    return simplify([
      [x1, y1],
      [mx, y1],
      [mx, y2],
      [x2, y2],
    ])
  }
  const my = Math.abs(y2 - y1) >= 2 * STUB ? (y1 + y2) / 2 : Math.max(y1, y2) + BELOW
  return simplify([
    [x1, y1],
    [x1 + STUB, y1],
    [x1 + STUB, my],
    [x2 - STUB, my],
    [x2 - STUB, y2],
    [x2, y2],
  ])
}

/** Drop repeated points and the middle of three in a line, which turn nothing. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    const before = out.at(-2)
    if (
      before &&
      last &&
      ((before[0] === last[0] && last[0] === p[0]) ||
        (before[1] === last[1] && last[1] === p[1]))
    ) {
      out[out.length - 1] = p
      continue
    }
    out.push(p)
  }
  return out
}

function polyline(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ")
}

/**
 * The polyline with each corner turned on a quarter curve. A corner's radius
 * is at most half of either segment beside it, so two corners never overlap
 * and a short jog stays a jog.
 */
function rounded(points: readonly Point[], radius: number): string {
  if (points.length < 3) return polyline(points)
  const parts = [`M ${points[0][0]} ${points[0][1]}`]
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1]
    const [cx, cy] = points[i]
    const [bx, by] = points[i + 1]
    const inLen = Math.hypot(cx - ax, cy - ay)
    const outLen = Math.hypot(bx - cx, by - cy)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const sx = cx - ((cx - ax) / inLen) * r
    const sy = cy - ((cy - ay) / inLen) * r
    const ex = cx + ((bx - cx) / outLen) * r
    const ey = cy + ((by - cy) / outLen) * r
    parts.push(`L ${sx} ${sy}`, `Q ${cx} ${cy} ${ex} ${ey}`)
  }
  const [lx, ly] = points[points.length - 1]
  parts.push(`L ${lx} ${ly}`)
  return parts.join(" ")
}
