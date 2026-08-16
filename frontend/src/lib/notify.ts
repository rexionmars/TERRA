import { toast, type ExternalToast } from "sonner"
import { playNotifySound } from "@/lib/sounds"

function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error:\s*/i, "").trim() || "Something went wrong"
}

/** Compact path for toast descriptions. */
function shortPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join("/")}`
}

export function notifySuccess(
  title: string,
  description?: string,
  opts?: ExternalToast
) {
  playNotifySound("success")
  toast.success(title, {
    description,
    duration: 4200,
    ...opts,
  })
}

export function notifyError(
  title: string,
  error?: unknown,
  opts?: ExternalToast
) {
  playNotifySound("error")
  toast.error(title, {
    description: error !== undefined ? errText(error) : undefined,
    duration: 6500,
    ...opts,
  })
}

export function notifyInfo(
  title: string,
  description?: string,
  opts?: ExternalToast
) {
  toast.message(title, {
    description,
    duration: 4000,
    ...opts,
  })
}

export function notifyExportOk(dest: string) {
  notifySuccess("Exported", shortPath(dest))
}

export function notifyExportFail(error: unknown) {
  notifyError("Export failed", error)
}
