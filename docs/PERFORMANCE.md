# Performance

What has been measured about this application's frame rate and memory, what
turned out to cause it, and what was cleared. Written after an investigation
that spent most of its time in the wrong places, so the record of what is *not*
the cause is as much of the point as the record of what is.

---

## The window, not the page

**A frameless macOS window slowed every other window sharing its space.**

Wails builds the NSWindow in `WailsContext.m`, and it adds
`NSWindowStyleMaskTitled` only when the window is not frameless:

```objc
if( !frameless ) {
    if (!hideTitleBar) styleMask |= NSWindowStyleMaskTitled;
    styleMask |= NSWindowStyleMaskClosable;
}
```

So `Frameless: true` produced a borderless window, and macOS composites a
borderless window off the path it uses for titled ones. The cost did not land in
this application at all — it landed in WindowServer, and it was paid by every
window on the same space.

**The measurement that proved it.** Safari running the WebGL aquarium
benchmark, on the same machine at the same moment:

| Space | Safari's own frame rate |
| --- | --- |
| Any space without this window | 60fps, constant |
| The space this window occupied | 27–41fps |

A different application, slowed by ours being present. Nothing measured inside
our page could have shown this, which is why the investigation took as long as
it did.

**The fix is `Frameless: false`.** The look is kept by `TitleBar`:
`mac.TitleBarHidden()` gives a titled window with a transparent, title-less bar
and full-size content — the traffic lights over the application's own header,
which is what frameless was being used for. Custom drag regions are unaffected:
`--wails-draggable` is handled in the JavaScript runtime and does not depend on
the style mask.

`TitleBarHiddenInset()` is the same thing plus `UseToolbar`, and the toolbar
pushes the traffic lights in from the corner — right and down, past the `4.5rem`
the header reserves — into the wordmark. Hidden, not hidden-inset.

### What this looked like from inside

Every figure below was measured while the page was being delivered frames at
11Hz. None of them points at the cause:

| Figure | Reading |
| --- | --- |
| Frame work (controls, draw, helper, labels) | **0.0ms** |
| Draw calls / triangles | **9 / 72** |
| Pointer handler cost | **0.0ms**, events arriving at 120/s |
| WebContent process CPU | **2.8%**, 97% of samples parked in `mach_msg2_trap` |
| WebKit GPU process CPU | **0.1%** |
| WindowServer CPU | 35.6% |

Everything was waiting and nothing in the application was the reason.

---

## Tested and cleared

Each of these was a hypothesis with a plausible mechanism, tested in a
**production build**, and found not to be the cause. They are listed so the next
person does not spend the time again.

| Suspect | Mechanism proposed | Result |
| --- | --- | --- |
| `backdrop-filter` on `.panel` | 224 elements, each forcing a compositing layer, a backdrop buffer and an 18px blur per frame | No change. 65ms → 74ms gap, which is noise |
| Multisampling (`antialias: true`) | MSAA resolve is a full extra pass over a retina-sized buffer before the compositor can take it | No change |
| Canvas alpha channel (`alpha: true`) | An alpha canvas must be blended by the compositor every frame; an opaque one need not be | 24Hz → 26Hz, which is noise |
| Drawing buffer size | WebKit resolves and copies the buffer into a window-server surface every frame; 2808×1592 at 2x is 4.5M pixels | 11Hz → 24Hz. Real, and a symptom of the window problem rather than a cause |
| Rasters as base64 data URIs | Megabyte strings held per plane | Not supported by the numbers: a run's PNGs total 392KB, the largest 168KB |
| Development mode | Vite serving modules one at a time, React's development build, HMR, and an fsevents watcher over the whole repository including `.venv` and `node_modules` | **Real and large.** Always measure a `wails build` binary |

---

## The 60fps ceiling on macOS

WebKit paces page rendering updates near 60fps, so `requestAnimationFrame` is
delivered at 60Hz on a display running at 120. This is WKWebView's, not the
display's: `system_profiler` reports the built-in panel at 120.00Hz while the
studio's own readout showed 59–60.

The preference is `PreferPageRenderingUpdatesNear60FPSEnabled` and there is **no
public API for it**. The only route is
`[WKPreferences _setEnabled:NO forFeature:]`, which is private.

**This was implemented, measured and then removed.** It works — the page rate
went to 111–125Hz, the variation being the display's own adaptive refresh rather
than instability. It was taken out anyway:

- The problem worth solving was 11Hz, and it is solved. 60 against 120 is polish
  on something that already works.
- A private preference only pays while Apple leaves it in place, and the
  implementation was guarded to fail silently — so a macOS update returns the
  ceiling without warning. The feature is temporary by construction.

Published reports say the restriction was lifted in macOS 26 and the preference
ignored. That is not what this machine does: macOS 26.6.1, a 120Hz display, and
WKWebView delivering 60. Test rather than trust the note.

---

## React: one component holds the application

`App` carries 77 `useState` hooks across itself and `AppBody`, renders every
screen inline, and there is no `React.memo` anywhere in the frontend. Any
`setState` there reconciles the whole tree. Two paths did it far more often than
the work justified, and both are fixed by holding the value outside React and
letting the one component that wants it subscribe:

| Value | Was | Now |
| --- | --- | --- |
| The map's centre and zoom | Written into `App` on every frame of a drag, so the whole tree reconciled 60 times a second to update one line of text in the title bar | `lib/mapPose.ts`; the settled value still reaches `App` on `moveend`, where persistence wants it |
| Which tool panel is open | In `App` because two components read it and the map screen remounts on every return, which a `useState` inside the screen forgot | `lib/panelSelection.ts`; a module outlives the remount for free |

`AnimatePresence` also carried `mode="wait"`, under which the leaving screen had
to finish its 240ms exit before the arriving one was allowed to mount — and the
mount is the expensive half, since a screen here builds MapLibre, its overlays
and sometimes the studio.

**Still open:** the screens unmount and remount on every change. That is the
larger remaining cost in navigation and it is deliberate for now — keeping them
mounted means their effects keep running and the studio holds a WebGL context,
and WebKit caps how many of those may exist.

---

## Measuring

### The studio's own readout

Seven figures, each switched separately in **Profile → Telemetry**, all off by
default. `lib/studioTelemetry.ts` says what each one is for. The order in the
settings page is the order to reach for them in:

1. **Page frame rate** — how fast the browser delivers frames, from a loop that
   draws nothing. First, always: it is what says whether the studio is the cause
   at all. **It is the one figure that costs something** — it keeps the page
   animating for as long as the studio is open.
2. **Studio frame rate** — the studio draws on demand, so a long interval on a
   still scene is idling, not a fault.
3. **Frame work** — the only figure that accuses the scene itself.
4. **Pointer cost** — pointer handlers run outside the animation callback, so an
   expensive one blocks frames without appearing in the frame timing.
5. **Draw calls**, **GPU resources**, **Drawing buffer** — what is being
   submitted, what is being held, and how much of the frame there is to move.

### Traps in the tools

**`ps %CPU` on macOS is a lifetime average, not an instantaneous reading.** A
process that was busy an hour ago reports a high figure while idle. Use
`top -l N -s S` and read a sample after the first, which is the only one that is
instantaneous.

**On a render-on-demand surface, the interval between frames is not the frame
time.** The gap includes however long nothing asked for a frame. Measure the
work inside the callback separately, or a still scene reads as a slow scene.

**Sample the right process.** WebKit draws canvas and WebGL in a separate GPU
process, so a stack sample of the web content process shows almost no WebGL
work. `sample <pid>` both, and read the CPU of each.

**Attribute memory with `vmmap -summary <pid>`.** The region table separates the
JavaScript heap from `WebKit Malloc`, which is where WebCore's own strings and
image buffers live — a distinction that rules out or in "some JavaScript is
holding objects" in one command.

### The control experiment

The one that ended this investigation in thirty seconds, after hours inside the
page: **run a different application's benchmark on the same space.** If it is
also slow there and fast elsewhere, nothing inside this application's page is
the cause. Ask for that control the moment a symptom includes anything outside
the application's own window.
