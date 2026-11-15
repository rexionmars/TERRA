/**
 * The small picture beside an option of the compare board's pie menu: what the
 * reading does, shown on ground seen from orbit.
 *
 * The workflows board's pie draws icons instead (components/viewIcons.tsx): its
 * categories each hold nodes that do different things, and its nodes are steps
 * of a method, so no crop of ground told them apart; the mineral map's nine
 * readings all showed the one mineral plate.
 *
 * EVERY PICTURE IS ONE TERRA ALREADY CREDITS, cropped, or with the operation the
 * option stands for applied to it: 1985 against 2024 over the same ground, two
 * places side by side. None is a result of this application. The product plates
 * (productPictures.ts) are used as they are; what is made from them is in
 * public/terra-pie/, at 48 px, twice the 24 px disc the pie draws, each made as
 * its entry's comment says.
 *
 * The credit is the source's, with "modified" where the picture was changed, as
 * CC BY asks; the pie shows it on the option's title, as a plate does.
 */
import type { ReadingKind } from "@/lib/compareBoard"
import { PRODUCT_PICTURES, pictureCredit } from "@/lib/productPictures"

export interface PiePicture {
  /** Under public/. */
  path: string
  credit: string
}

const product = (id: keyof typeof PRODUCT_PICTURES, modified = false): string =>
  pictureCredit(PRODUCT_PICTURES[id]) + (modified ? " · modified" : "")

/** The MapBiomas class map of Paraná the classify plate is cut from. */
const MAPBIOMAS = product("classify", true)

const PICTURES = {
  classes: { path: PRODUCT_PICTURES.classify.path, credit: product("classify") },
  mineral: { path: PRODUCT_PICTURES.mineral.path, credit: product("mineral") },
  fields: { path: PRODUCT_PICTURES.fields.path, credit: product("fields") },
  // The classify plate's crop in the 1985 frame above the diagonal, 2024 below.
  change: { path: "/terra-pie/change.webp", credit: MAPBIOMAS },
  // Two places either side of the diagonal: the fields plate and the overlap plate.
  shift: {
    path: "/terra-pie/shift.webp",
    credit: `${product("fields", true)}; ${product("overlap", true)}`,
  },
  // Four plates in a grid: classify, fields, overlap, health.
  cohort: {
    path: "/terra-pie/cohort.webp",
    credit: [
      product("classify", true),
      product("fields", true),
      product("overlap", true),
      product("health", true),
    ].join("; "),
  },
  // The mineral plate's bottom-right quarter.
  mineralNear: {
    path: "/terra-pie/mineral-near.webp",
    credit: product("mineral", true),
  },
} satisfies Record<string, PiePicture>

type Theme = keyof typeof PICTURES

const READING: Record<ReadingKind, Theme> = {
  differences: "change",
  shift: "shift",
  cohort: "cohort",
  spectra: "mineral",
  separability: "classes",
  library: "mineralNear",
  tables: "fields",
}

export const readingPicture = (r: ReadingKind): PiePicture => PICTURES[READING[r]]
