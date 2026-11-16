/**
 * Studies the Models screen features above the models in preparation
 * (components/shell/FeaturedStudies.tsx): what each sets out to answer, how
 * it is held, and its patch.
 */

/** A study a featured card shows. */
export interface Study {
  id: string
  name: string
  /** Where it looks, as the card names it. */
  place: string
  /** Under public/: the study's patch, on a clear ground. */
  patch: string
  /** What it sets out to answer, in a sentence. Never a result. */
  aim: string
  /** What it reads, each in a few words. */
  reads: readonly string[]
  /** How it is held, as the card states it: for now, closed research. */
  status: string
  /**
   * The credit the patch's data asks for, and where it is from. The card does
   * not print it; it is the patch's tooltip.
   */
  credit: { text: string; source: string }
}

/*
  A STUDY IS DESCRIBED BY ITS AIM, NEVER BY A FINDING: a card is read as a
  claim, and a study before its registered plan has none to make. The status
  says the research is closed, and is changed here when that changes.

  The patches are exported from their SVG without the white ground, cropped to
  the patch, at 480 px, and passed through cwebp -q 90 -alpha_q 100.
*/
export const STUDIES: readonly Study[] = [
  {
    id: "illegal-mining",
    name: "Illegal mining",
    place: "Amazon forest, Brazil",
    patch: "/terra-studies/illegal-mining.webp",
    aim:
      "Whether operations that remove illegal miners from Indigenous Lands stop " +
      "new mining there, and where the mining goes instead.",
    reads: ["Sentinel-2 mining detections", "Indigenous Lands", "removal operations"],
    status: "Closed Research",
    // The orange cells on the patch are Amazon Mining Watch's 2025 detections.
    credit: {
      // No-break spaces keep the licence on one line.
      text: "Patch: mining cells from Amazon Mining Watch 2025, Earth Genome · CC\u00a0BY\u00a04.0",
      source: "https://source.coop/earthgenome/amazon-mining-watch",
    },
  },
]
