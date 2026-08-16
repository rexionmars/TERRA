type NotifyTone = "success" | "error"

let ctx: AudioContext | null = null
let lastPlayAt = 0
const DEBOUNCE_MS = 80

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  return ctx
}

function tone(
  audio: AudioContext,
  freq: number,
  start: number,
  duration: number,
  peakGain: number
) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** Soft Web Audio chimes for success/error toasts. No-ops if audio is unavailable. */
export function playNotifySound(kind: NotifyTone) {
  const now = performance.now()
  if (now - lastPlayAt < DEBOUNCE_MS) return
  lastPlayAt = now

  try {
    const audio = getCtx()
    if (!audio) return
    void audio.resume().catch(() => {})

    const t0 = audio.currentTime + 0.01
    if (kind === "success") {
      tone(audio, 520, t0, 0.09, 0.045)
      tone(audio, 780, t0 + 0.07, 0.11, 0.04)
    } else {
      tone(audio, 200, t0, 0.14, 0.05)
      tone(audio, 160, t0 + 0.08, 0.12, 0.035)
    }
  } catch {
    // Ignore autoplay / context failures — toast still shows.
  }
}
