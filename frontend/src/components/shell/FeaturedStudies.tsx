import { useEffect, useRef, useState } from "react"

import { CaretLeft, CaretRight } from "@/components/icons"
import { STUDIES, type Study } from "@/lib/featuredStudies"

/*
  A slide is as wide as a column of the model grid above it, so a study card
  lines up under a model card. The grid's columns are at least 26rem with a
  1rem gap, so it holds two from 53rem and one below; a third would need 80rem,
  more than the page's 68rem of content. The row is the container measured.
*/
const SLIDE = "w-full shrink-0 snap-start @[53rem]:w-[calc((100%-1rem)/2)]"

const ARROW =
  "grid size-7 place-items-center rounded-full border border-border text-foreground transition-colors hover:bg-[rgb(var(--p-surface))] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent"

/*
  The featured studies, as a row of cards that scrolls sideways.

  THE ARROWS APPEAR ONLY WHEN THE ROW HOLDS MORE THAN IT SHOWS: they are
  measured from the row, at every resize and scroll, so a row that fits shows
  its cards and nothing to press. Each arrow turns a page, and the row snaps to
  the card at its start; under prefers-reduced-motion it jumps rather than
  glides.

  The row is padded on every side by as much as it is pulled out, so a card's
  shadow is not cut at the row's edge, and its scroll padding holds a snapped
  card where the page's content starts.
*/
export function FeaturedStudies() {
  const row = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState({ first: true, last: true })

  useEffect(() => {
    const el = row.current
    if (!el) return
    const measure = () => {
      const first = el.scrollLeft <= 1
      const last = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      setEnds((e) => (e.first === first && e.last === last ? e : { first, last }))
    }
    // An observer reports once when it starts, so this also takes the first measure.
    const resized = new ResizeObserver(measure)
    resized.observe(el)
    el.addEventListener("scroll", measure, { passive: true })
    return () => {
      resized.disconnect()
      el.removeEventListener("scroll", measure)
    }
  }, [])

  if (STUDIES.length === 0) return null
  const turn = (step: number) => {
    const el = row.current
    if (el) el.scrollBy({ left: step * el.clientWidth })
  }

  return (
    <section
      className="mt-12"
      aria-labelledby="featured-studies-title"
      aria-roledescription="carousel"
    >
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h3
            id="featured-studies-title"
            className="text-heading font-medium text-foreground"
          >
            Featured studies
          </h3>
          <p className="mt-1 text-label text-muted-foreground">
            What each study sets out to answer, and where it stands.
          </p>
        </div>
        {!(ends.first && ends.last) && (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => turn(-1)}
              disabled={ends.first}
              aria-label="Previous studies"
              className={ARROW}
            >
              <CaretLeft className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => turn(1)}
              disabled={ends.last}
              aria-label="Next studies"
              className={ARROW}
            >
              <CaretRight className="size-3" />
            </button>
          </div>
        )}
      </div>
      <div
        ref={row}
        className="@container -mx-6 mt-2 -mb-10 flex snap-x snap-mandatory scroll-px-6 [scrollbar-width:none] gap-4 overflow-x-auto scroll-smooth px-6 pt-6 pb-10 motion-reduce:scroll-auto"
      >
        {STUDIES.map((s, i) => (
          <div
            key={s.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${STUDIES.length}: ${s.name}`}
            className={SLIDE}
          >
            <StudyCard study={s} />
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * A study: its patch beside where it looks, its name, its aim, what it reads
 * and how it is held. Nothing on it opens a page, since a study has none in
 * TERRA.
 *
 * The credit the patch's data owes under CC BY 4.0 is the patch's tooltip
 * rather than a line on the card: the licence asks for it wherever the patch
 * is shown, and lets it be given in a manner reasonable for the medium.
 */
function StudyCard({ study: s }: { study: Study }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-md border border-[rgb(var(--p-line)/0.45)] bg-[rgb(var(--p-ink))] shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
      <div className="flex flex-1 items-start gap-5 p-5">
        <img
          src={s.patch}
          alt=""
          title={`${s.credit.text} · ${s.credit.source}`}
          draggable={false}
          decoding="async"
          className="size-36 shrink-0 object-contain"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="eyebrow">{s.place}</p>
          <h4 className="font-display text-title font-semibold text-foreground">
            {s.name}
          </h4>
          <p className="mt-1 text-label leading-relaxed text-muted-foreground">
            {s.aim}
          </p>
          <p className="mt-1.5 text-meta text-muted-foreground">
            Reads {s.reads.join(" · ")}
          </p>
          <p className="mt-3 text-label text-foreground">{s.status}</p>
        </div>
      </div>
    </article>
  )
}
