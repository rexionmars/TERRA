import { useState } from "react"

import { CaretLeft, CaretRight, Pause, Play } from "@/components/icons"
import {
  BannerFigure,
  PHOTO_CHIP,
  SceneCredit,
  TabbedBanner,
} from "@/components/ui/TabbedBanner"
import { SCENES } from "@/lib/orbitScenes"
import { cn } from "@/lib/utils"

/** How long a scene stays before the next, in seconds. */
const DWELL_S = 8

const CHIP_BUTTON =
  "grid size-6 place-items-center rounded-full transition-colors hover:bg-[rgb(236_232_223/0.14)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"

const prefersStill = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

/*
  The scenes of lib/orbitScenes.ts, turning under a title the page's ground
  holds (TabbedBanner), so they turn without touching it.

  THE SCENES TURN ON A CLOCK THE READER CAN SEE: the bar in the shown scene's
  dot fills over DWELL_S, and the scene turns when it is full, on the bar's
  animationend, so pausing the bar pauses the turn and there is no second timer
  to keep in step with it. The bar stops while the pointer is over the picture,
  and for good once a control there takes keyboard focus or the pause button is
  pressed, until play is pressed; under prefers-reduced-motion it starts
  stopped, and the scenes change without the cross-fade.
*/
export function CatalogueHero({
  published,
  installed,
}: {
  /** How many models the catalogue lists; null until it is read. */
  published: number | null
  installed: number
}) {
  const [shown, setShown] = useState(0)
  const [held, setHeld] = useState(prefersStill)
  const [hovered, setHovered] = useState(false)
  const turning = !held && !hovered
  const scene = SCENES[shown]
  const go = (step: number) =>
    setShown((i) => (i + step + SCENES.length) % SCENES.length)

  return (
    <section aria-labelledby="catalogue-title">
      <TabbedBanner
        held={
          <>
            <p className="eyebrow">Catalogue</p>
            <h2
              id="catalogue-title"
              className="mt-1.5 font-display text-hero font-semibold whitespace-nowrap text-foreground"
            >
              Models that map the land
            </h2>
          </>
        }
        role="group"
        aria-roledescription="carousel"
        aria-label="Scenes from orbit"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={(e) => {
          if (e.target.matches(":focus-visible")) setHeld(true)
        }}
      >
        {SCENES.map((s, i) => (
          <img
            key={s.path}
            src={s.path}
            alt=""
            draggable={false}
            decoding="async"
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none",
              i === shown ? "opacity-100" : "opacity-0"
            )}
            style={{ objectPosition: s.focus }}
          />
        ))}
        <div
          aria-live={turning ? "off" : "polite"}
          className="absolute top-3 right-3 left-3 flex justify-end"
        >
          <SceneCredit scene={scene} />
        </div>
        <div
          className={cn(
            PHOTO_CHIP,
            "absolute right-3 bottom-3 flex items-center p-0.5"
          )}
        >
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous scene"
            className={CHIP_BUTTON}
          >
            <CaretLeft className="size-3" />
          </button>
          <span className="flex items-center gap-1.5 px-1">
            {SCENES.map((s, i) => (
              <button
                key={s.path}
                type="button"
                onClick={() => setShown(i)}
                aria-label={`Scene ${i + 1} of ${SCENES.length}: ${s.place}`}
                aria-current={i === shown ? "true" : undefined}
                className="grid h-6 place-items-center rounded-full focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "block h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300",
                    i === shown
                      ? "w-5 bg-[rgb(236_232_223/0.3)]"
                      : "w-1.5 bg-[rgb(236_232_223/0.5)] hover:bg-[rgb(236_232_223/0.85)]"
                  )}
                >
                  {i === shown && (
                    <span
                      key={shown}
                      onAnimationEnd={() => go(1)}
                      className="block h-full origin-left rounded-full bg-[rgb(236_232_223)]"
                      style={{
                        animationName: "terra-scene-dwell",
                        animationDuration: `${DWELL_S}s`,
                        animationTimingFunction: "linear",
                        animationFillMode: "both",
                        animationPlayState: turning ? "running" : "paused",
                      }}
                    />
                  )}
                </span>
              </button>
            ))}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next scene"
            className={CHIP_BUTTON}
          >
            <CaretRight className="size-3" />
          </button>
          <span aria-hidden className="mx-0.5 h-3.5 w-px bg-[rgb(236_232_223/0.3)]" />
          <button
            type="button"
            onClick={() => setHeld((h) => !h)}
            aria-label={held ? "Turn the scenes" : "Stop the scenes"}
            className={CHIP_BUTTON}
          >
            {held ? <Play className="size-2.5" /> : <Pause className="size-2.5" />}
          </button>
        </div>
      </TabbedBanner>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
        <p className="max-w-prose text-read text-muted-foreground">
          The models published for TERRA, each with a page that says what it reads, how
          it was evaluated and where it falls short. A download is checked against the
          SHA-256 listed here before it is installed, and the model runs only on this
          machine.
        </p>
        {published !== null && (
          <dl className="flex gap-8">
            <BannerFigure label="Published" value={published} />
            <BannerFigure label="Installed" value={installed} />
          </dl>
        )}
      </div>
    </section>
  )
}
