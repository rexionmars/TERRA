/**
 * What each product is, and the limit on reading it, in one place.
 *
 * THE LIMIT TRAVELS WITH THE PRODUCT. The README lists them under its own
 * heading, and a reader who starts a run from a list on a map never passes that
 * heading: a screening result read without it is the failure the roadmap names
 * first. So the product list and the result panel both draw it, from here.
 */
import type { BoardToolId } from "@/lib/mapTools"

export interface ProductNote {
  /** One line, saying what the product measures and from what. */
  hint: string
  /** The limit a reader has to hold while reading the result. */
  limit: string
}

export const PRODUCT_NOTES: Record<BoardToolId, ProductNote> = {
  classify: {
    hint: "Land cover in five MapBiomas classes, from a Sentinel-2 series.",
    limit:
      "The legend is fixed and the models were fitted for western Paraná. An area elsewhere can return a confident and wrong result. Hectares are pixel counts, uncorrected for classification error.",
  },
  compose: {
    hint: "Ways of looking at the area: one Sentinel-2 scene, two of them, the period's cloud-free median, or a published biomass map.",
    limit: "A way of looking at one acquisition. It measures nothing over the period.",
  },
  water: {
    hint: "Water masks from a spectral index, thresholded by Otsu per date.",
    limit: "Persistent and ephemeral water are reported apart and are never summed.",
  },
  mineral: {
    hint: "Surface mineralogy from EMIT reflectance, identified by a port of Tetracorder. Needs an Earthdata token.",
    limit:
      "Band depth is not abundance. Vegetation, water and cloud suppress the answer, so over vegetated ground the identified area is a small part of the area of interest.",
  },
  fields: {
    hint: "Field polygons delineated from two Sentinel-2 scenes.",
    limit:
      "Not measured on Paraná fields. Adjacent fields sown with one crop on one day come out as one.",
  },
  health: {
    hint: "NDVI and NDRE against the same days of the year in three earlier seasons.",
    limit:
      "A departure is not a diagnosis. A later sowing, another crop or a fallow field departs from earlier seasons as a stressed one does.",
  },
  overlap: {
    hint: "Hectares of the area on public registers, read when the job runs.",
    limit:
      "An overlap is a screening result and not a finding of irregularity. APP and legal-reserve polygons are not read.",
  },
  radar: {
    hint: "Sentinel-1 VV and VH through the period, per date and relative orbit.",
    limit:
      "The canopy-loss thresholds are not calibrated against harvest records. Paved ground, radar shadow and smooth bare soil can read as open water.",
  },
  zones: {
    hint: "Zones where a field grew alike over several seasons, from per-season NDVI.",
    limit:
      "They show where the canopy differed, not why. Soil, drainage, compaction or a past management line draw the same boundary.",
  },
}
