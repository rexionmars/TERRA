import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"
import "./index.css"
import App from "./App"
import { AppErrorFallback, ErrorBoundary } from "./components/ErrorBoundary"

function dismissSplash(opts: { minMs?: number } = {}): void {
  const minMs = opts.minMs ?? 180
  const el = document.getElementById("splash")
  if (!el) return

  const started = performance.now()

  const finish = () => {
    const wait = Math.max(0, minMs - (performance.now() - started))
    window.setTimeout(() => {
      const onDone = () => {
        el.remove()
      }
      el.addEventListener("transitionend", onDone, { once: true })
      el.classList.add("is-done")
      window.setTimeout(onDone, 400)
    }, wait)
  }

  requestAnimationFrame(() => requestAnimationFrame(finish))
}

/*
  React.StrictMode is omitted, and the reason it was omitted has gone.

  It was leaflet-draw: StrictMode's development-only double-mounting
  re-initialised that imperative control twice, leaving two draw handlers that
  corrupted the vertex count and finished polygons early. leaflet-draw is no
  longer in the application.

  Left off rather than turned on, because turning it on is its own change and
  needs its own verification: every imperative surface here would mount twice
  in development -- two MapLibre maps per screen, two three.js scenes in the
  studio, each building and disposing a WebGL context. That may be fine; it has
  not been tested, and a flag that doubles the graphics work is not something to
  flip while tidying up after a library.
*/
const container = document.getElementById("root")
const root = createRoot(container!)

root.render(
  <ThemeProvider
    attribute="data-theme"
    defaultTheme="dark"
    enableSystem
    storageKey="geosense-theme"
  >
    {/*
      THE OUTERMOST RING, inside the provider rather than around it.

      The fallback paints in the palette tokens, and which set of them applies
      is decided by the data-theme attribute next-themes writes from an effect.
      Placed around the provider, a component that throws during the FIRST
      render unmounts it before that effect has run, and the one screen a reader
      sees after a crash is the only screen in the application that ignored
      their choice of theme.

      Nothing narrower can stand in for it. A throw anywhere below unmounts
      every part of the tree, and an error nobody foresaw is not obliged to
      happen where a smaller ring was put.
    */}
    <ErrorBoundary fallback={(state) => <AppErrorFallback {...state} />}>
      <App />
    </ErrorBoundary>
    <Toaster
      theme="system"
      position="bottom-right"
      closeButton
      gap={10}
      offset={16}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "terra-toast",
          title: "terra-toast-title",
          description: "terra-toast-desc",
          closeButton: "terra-toast-close",
          success: "terra-toast-success",
          error: "terra-toast-error",
          info: "terra-toast-info",
          warning: "terra-toast-warning",
        },
      }}
    />
  </ThemeProvider>
)

// Hand off HTML boot strip to React SplashScreen as soon as the tree paints.
dismissSplash({ minMs: 180 })
