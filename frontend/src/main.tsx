import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { Toaster } from "sonner"
import "./components/leafletDrawPatch"
import "./index.css"
import App from "./App"

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

// Note: React.StrictMode is intentionally omitted. Its development-only
// double-mounting of effects re-initializes the imperative leaflet-draw control
// twice, leaving two active draw handlers that corrupt the vertex count and
// finish polygons prematurely.
const container = document.getElementById("root")
const root = createRoot(container!)

root.render(
  <ThemeProvider
    attribute="data-theme"
    defaultTheme="dark"
    enableSystem
    storageKey="geosense-theme"
  >
    <App />
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
