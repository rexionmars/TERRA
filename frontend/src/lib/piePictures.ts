/**
 * The small picture beside each option of the boards' pie menus: what the option
 * does, shown on ground seen from orbit.
 *
 * EVERY PICTURE IS ONE TERRA ALREADY CREDITS, cropped, or with the operation the
 * option stands for applied to it: the majority filter run on a MapBiomas class
 * map, a class kept and the rest masked out, 1985 against 2024 over the same
 * ground. None is a result of this application. The product plates
 * (productPictures.ts) and the banner scenes (orbitScenes.ts) are used as they
 * are; what is made from them is in public/terra-pie/, at 48 px, twice the 24 px
 * disc the pie draws, each made as its entry's comment says.
 *
 * The credit is the source's, with "modified" where the picture was changed, as
 * CC BY asks; the pie shows it on the option's title, as a plate does.
 */
import type { ReadingKind } from "@/lib/compareBoard"
import type { NodeCategory, NodeKind } from "@/lib/compositorGraph"
import { SCENES } from "@/lib/orbitScenes"
import { PRODUCT_PICTURES, pictureCredit } from "@/lib/productPictures"

export interface PiePicture {
  /** Under public/. */
  path: string
  credit: string
}

const product = (id: keyof typeof PRODUCT_PICTURES, modified = false): string =>
  pictureCredit(PRODUCT_PICTURES[id]) + (modified ? " · modified" : "")

const scene = (path: string): string =>
  SCENES.find((s) => s.path === path)?.credit ?? ""

/** The MapBiomas class map of Paraná the classify plate is cut from. */
const MAPBIOMAS = product("classify", true)
const PIVOTS = scene("/terra-catalogue/primavera-do-leste.webp")

const PICTURES = {
  classes: { path: PRODUCT_PICTURES.classify.path, credit: product("classify") },
  ndvi: { path: PRODUCT_PICTURES.health.path, credit: product("health") },
  mineral: { path: PRODUCT_PICTURES.mineral.path, credit: product("mineral") },
  fields: { path: PRODUCT_PICTURES.fields.path, credit: product("fields") },
  zones: { path: PRODUCT_PICTURES.zones.path, credit: product("zones") },
  radar: { path: PRODUCT_PICTURES.radar.path, credit: product("radar") },
  overlap: { path: PRODUCT_PICTURES.overlap.path, credit: product("overlap") },
  // The 2024 frame, x 40-58 %, y 55-83 %, west of Curitiba, where forest and
  // farmland are most broken up, through a 5 x 5 majority (mode) filter.
  filter: { path: "/terra-pie/filter.webp", credit: MAPBIOMAS },
  // The classify plate's crop, its green classes kept and the rest flat grey.
  mask: { path: "/terra-pie/mask.webp", credit: MAPBIOMAS },
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
  // The pivots below, with the health plate laid at 60 % over the left half.
  mix: {
    path: "/terra-pie/mix.webp",
    credit: `${PIVOTS} · modified; ${product("health", true)}`,
  },
  // The health plate's top-left quarter.
  ndviNear: { path: "/terra-pie/ndvi-near.webp", credit: product("health", true) },
  // The mineral plate's bottom-right quarter.
  mineralNear: {
    path: "/terra-pie/mineral-near.webp",
    credit: product("mineral", true),
  },
  // Primavera do Leste, the 600 px square from x 900, y 150 of the banner scene.
  pivots: { path: "/terra-pie/pivots.webp", credit: `${PIVOTS} · modified` },
  // The same scene, the 500 px square from x 300, y 400.
  strips: { path: "/terra-pie/strips.webp", credit: `${PIVOTS} · modified` },
  // Serra de Caldas, the 380 px square from x 420, y 80 of the banner scene.
  reservoir: {
    path: "/terra-pie/reservoir.webp",
    credit: `${scene("/terra-catalogue/serra-de-caldas.webp")} · modified`,
  },
} satisfies Record<string, PiePicture>

type Theme = keyof typeof PICTURES

/** A category's picture, on the ring that lists the categories. */
const CATEGORY: Record<NodeCategory, Theme> = {
  input: "classes",
  filter: "filter",
  mask: "mask",
  color: "mix",
  analysis: "ndvi",
  mineral: "mineral",
  output: "pivots",
}

/*
  A node's picture, on its category's ring. A node that reads a product shows
  that product's plate; the rest of a category show the category's picture,
  or a closer crop of it, so the options of one ring tell apart where the
  picture can say something different.
*/
const KIND: Record<NodeKind, Theme> = {
  run: "classes",
  majority: "filter",
  sieve: "filter",
  morphology: "filter",
  fieldFilter: "fields",
  select: "mask",
  mask: "mask",
  mix: "mix",
  areas: "classes",
  change: "change",
  seasonDates: "ndviNear",
  health: "ndvi",
  fieldTable: "fields",
  zones: "zones",
  radar: "radar",
  overlap: "overlap",
  viewer: "pivots",
  globe: "strips",
  adoptFields: "fields",
  saveFields: "fields",
  pdfReport: "reservoir",
  mineralSave: "mineral",
  mineralCoverage: "mineral",
  mineralClasses: "mineral",
  mineralReferences: "mineralNear",
  mineralPasses: "mineral",
  mineralCover: "mineral",
  mineralPositions: "mineral",
  mineralAcid: "mineral",
  mineralConfidence: "mineral",
  mineralAgreement: "mineral",
}

const READING: Record<ReadingKind, Theme> = {
  differences: "change",
  shift: "shift",
  cohort: "cohort",
  spectra: "mineral",
  separability: "classes",
  library: "mineralNear",
  tables: "fields",
}

export const categoryPicture = (c: NodeCategory): PiePicture => PICTURES[CATEGORY[c]]
export const kindPicture = (k: NodeKind): PiePicture => PICTURES[KIND[k]]
export const readingPicture = (r: ReadingKind): PiePicture => PICTURES[READING[r]]
