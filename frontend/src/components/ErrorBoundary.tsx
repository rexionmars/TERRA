/**
 * What stands where a component was, once it has thrown.
 *
 * React unmounts the whole tree when a render throws, and in a desktop window
 * that is the end of the session: there is no address bar to reload from and
 * no tab to reopen, only a frame painted the colour of nothing. The same
 * failure in a browser costs one keystroke. That difference is the entire
 * argument for this file -- until now the application had no boundary at all,
 * so any thrown render anywhere emptied the window.
 *
 * A CLASS, because getDerivedStateFromError and componentDidCatch are the only
 * way React offers to catch a render error. There is no hook equivalent, and
 * React 19 has not added one; this is the API, not a lapse in style.
 *
 * TWO RINGS, which do different jobs. The root ring is the last resort and can
 * only offer a reload, since by the time it draws there is nothing left of the
 * tree to keep. The studio ring sits around a single panel, so a figure that
 * throws costs its own area and leaves the board, the scene and the unsaved
 * arrangement standing -- the difference between losing a chart and losing the
 * work that produced it.
 */
import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { btnGhostDense, btnPrimary } from "@/components/ui/buttons"
import { cn } from "@/lib/utils"

export interface ErrorFallbackProps {
  error: Error
  /**
   * React's trace of which components were rendering, or empty.
   *
   * Empty on the first paint of the fallback: getDerivedStateFromError is
   * handed the error alone and componentDidCatch, which carries the stack,
   * runs after. The disclosure below omits the block rather than reserving
   * space for one that may never arrive.
   */
  componentStack: string
  /** Discards the error and mounts the children again. */
  reset: () => void
}

interface Props {
  /**
   * The subtree, as a node or as a builder.
   *
   * A builder is not a convenience. An element handed in has ALREADY been
   * evaluated, in the caller's own render, above this boundary -- so a throw
   * while assembling a panel's props happens outside the thing meant to
   * contain it and takes the caller down instead. Passing a function moves
   * that work into the boundary's own subtree, where it can be caught.
   */
  children: ReactNode | (() => ReactNode)
  fallback: (props: ErrorFallbackProps) => ReactNode
}

interface State {
  error: Error | null
  componentStack: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" }

  static getDerivedStateFromError(thrown: unknown): State {
    return {
      /*
        Normalised, because `throw` accepts any value and a fallback that reads
        `.message` off a thrown string would report nothing at all -- which is
        the same blank window in a smaller frame.
      */
      error: thrown instanceof Error ? thrown : new Error(String(thrown)),
      componentStack: "",
    }
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    // Nothing is logged here on purpose. React 19 reports an error a boundary
    // caught through the root's onCaughtError, which writes it to the console
    // with this same stack, so a console call here would be one duplicate line
    // per crash carrying no information the fallback does not already show.
    this.setState({ componentStack: info.componentStack ?? "" })
  }

  reset = () => this.setState({ error: null, componentStack: "" })

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (error) {
      return this.props.fallback({ error, componentStack, reset: this.reset })
    }
    const { children } = this.props
    return typeof children === "function" ? <Built build={children} /> : children
  }
}

/** The builder, called from inside the boundary's subtree. See Props.children. */
function Built({ build }: { build: () => ReactNode }) {
  return <>{build()}</>
}

/**
 * The message and the trace, closed.
 *
 * Shown at all because the person in front of this window is frequently the
 * person who can act on it, and a crash reported as "something went wrong"
 * cannot be acted on by anyone. Closed by default because a component stack is
 * the second question and never the first.
 *
 * One definition for both rings, so the panel's disclosure cannot come to say
 * less than the root's.
 */
function CrashDetail({
  error,
  componentStack,
}: {
  error: Error
  componentStack: string
}) {
  return (
    <details className="w-full">
      <summary className="cursor-pointer select-none text-meta text-muted-foreground">
        Error detail
      </summary>
      <p className="mt-1.5 text-body break-words text-foreground">
        {error.message || "The thrown value carried no message."}
      </p>
      {componentStack ? (
        <pre className="selectable mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-micro text-muted-foreground">
          {componentStack.trim()}
        </pre>
      ) : null}
    </details>
  )
}

/**
 * The last resort: the tree is gone and a reload is the only way back.
 *
 * No retry. `reset` re-mounts the same children from the same state, which for
 * the root is the state that just threw, and a button that reliably throws
 * again is worse than no button. The studio's ring has one because a panel's
 * inputs change under it -- another run arrives, an area is retyped -- so
 * trying again there is a question with two possible answers.
 */
export function AppErrorFallback({ error, componentStack }: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="flex min-h-screen w-full items-center justify-center p-6"
      // The window's own ground. The tree that used to paint a background is
      // the thing that just unmounted.
      style={{ background: "rgb(var(--p-ink))" }}
    >
      <div
        className="w-full max-w-lg rounded-md border p-5"
        style={{
          background: "rgb(var(--p-surface))",
          borderColor: "rgb(var(--p-line) / 0.5)",
        }}
      >
        <p className="flex items-center gap-1.5 text-meta text-destructive-quiet">
          <AlertTriangle className="size-3 shrink-0" />
          Interface stopped
        </p>
        <h1 className="mt-1 text-heading text-foreground">
          A component threw while drawing this window
        </h1>
        <p className="mt-2 text-body text-muted-foreground">
          React unmounted the tree rather than leave it half drawn. Analyses
          already saved are on disk and were not touched; anything held only in
          this session -- a studio arrangement that was never saved, a run
          that was never stored -- does not survive the reload.
        </p>
        <div className="mt-3">
          <CrashDetail error={error} componentStack={componentStack} />
        </div>
        <button
          type="button"
          className={cn(btnPrimary, "mt-4")}
          onClick={() => window.location.reload()}
        >
          <RotateCcw className="size-3" />
          Reload the window
        </button>
      </div>
    </div>
  )
}

/**
 * One studio panel, replaced by what happened to it.
 *
 * Fills the area's body and paints its own ink, which is not decoration: the
 * viewport's area is transparent so the WebGL canvas behind it shows through,
 * and text laid over a rendered scene cannot be read at any contrast the
 * palette can offer. It takes pointer events back for the same reason -- that
 * area is pointer-transparent by design, and a retry nobody can press is a
 * dead end.
 */
export function PanelErrorFallback({
  error,
  componentStack,
  reset,
  panel,
}: ErrorFallbackProps & {
  /** The editor's own label, so the message names what is missing. */
  panel: string
}) {
  return (
    <div
      role="alert"
      className="pointer-events-auto flex h-full w-full flex-col items-start gap-2 overflow-auto p-3"
      style={{ background: "rgb(var(--p-ink))" }}
    >
      <p className="flex items-center gap-1.5 text-meta text-destructive-quiet">
        <AlertTriangle className="size-3 shrink-0" />
        {panel} stopped drawing
      </p>
      <p className="text-body text-muted-foreground">
        The rest of the board is unaffected. Trying again rebuilds this panel
        from the state as it stands now, and the area can be retyped or closed
        from its header either way.
      </p>
      <CrashDetail error={error} componentStack={componentStack} />
      <button type="button" className={btnGhostDense} onClick={reset}>
        <RotateCcw className="size-3" />
        Try again
      </button>
    </div>
  )
}
