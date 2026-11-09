/**
 * The picture on each product's plate: what it shows, where it came from, and the
 * credit its licence asks for.
 *
 * A PICTURE OF THE KIND OF RESULT, NOT A GLYPH. Each is a crop of a published image
 * of what the product measures -- a MapBiomas map for the classification, an EMIT
 * mineral map for the mineral map -- so the list shows what a run returns before
 * one is started. None is this application's output, and most are not of Paraná;
 * `subject` says where each was taken.
 *
 * NO SHARE-ALIKE LICENCE. Public domain or CC BY, whose terms ask for the author's
 * name and the licence, and the Copernicus terms, which ask for the sentence in
 * `notice`. A share-alike licence would pass to the cropped file. ESA's images on
 * Commons carry CC BY-SA 3.0 IGO beside the Copernicus notice, which is why none
 * is here. The product's page draws the credit under its hint, and the plate
 * carries it as a tooltip.
 *
 * WebP at 88 px, twice the 44 px plate. The crop is written beside each entry as a
 * share of the original's width and height, so a plate can be cut again at another
 * size from the source rather than enlarged from this file.
 */
import type { ProductId } from "@/lib/mapTools"

export interface ProductPicture {
  path: string
  /** What the crop shows and where, for whoever has to replace it. */
  subject: string
  author: string
  license: string
  /** A sentence the source's terms ask to be shown with the credit. */
  notice?: string
  /** The file's page on Wikimedia Commons. */
  source: string
}

export const PRODUCT_PICTURES: Record<ProductId, ProductPicture> = {
  classify: {
    path: "/terra-products/classify.webp",
    // The 2024 frame, x 65.8-84.2 %, y 52.2-80.9 % of 600x383.
    subject:
      "the MapBiomas Collection 10 map of Paraná for 2024 around Curitiba: forest " +
      "in green, farming in cream, the city in red",
    author: "Parzeus, from MapBiomas Collection 10",
    license: "CC BY 4.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Brazil_-_Paran%C3%A1_land_use_change_1985-2024_-_MapBiomas.gif",
  },
  mineral: {
    path: "/terra-products/mineral.webp",
    // x 35.5-60.5 %, y 33.0-57.6 % of 2249x2289.
    subject:
      "EMIT's first-light mineral map over the Sahara: kaolinite in blue, goethite " +
      "in yellow and hematite in magenta",
    author: "NASA Scientific Visualization Studio",
    license: "Public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:Earth_Surface_Mineral_Dust_Source_Investigation_(EMIT)_for_hyperwall_(SVS31199_-_EMIT_first_light_PIA25424).tiff",
  },
  fields: {
    path: "/terra-products/fields.webp",
    // x 56.0-71.0 %, y 30.1-61.2 % of 3669x1768.
    subject:
      "Sentinel-2 natural colour over soy farms in Mato Grosso, near 15.4 S 54.5 W: " +
      "square and pivot fields in cream, rust and grey",
    author: "Sentinel Hub",
    license: "CC BY 2.0",
    notice: "Contains modified Copernicus Sentinel data",
    source:
      "https://commons.wikimedia.org/wiki/File:Soy_Production_In_Brazil_(46200453114).jpg",
  },
  health: {
    path: "/terra-products/health.webp",
    /*
      The frame Commons shows for the video, dated 2022-07-14; x 25.0-50.0 %,
      y 45.0-89.4 % of 1920x1080.
    */
    subject:
      "NDVI from Harmonized Landsat Sentinel-2 over fields in Nebraska: green where " +
      "the canopy is dense, yellow where it is thin",
    author: "NASA Scientific Visualization Studio",
    license: "Public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:Landsat_and_Sentinel_NDVI,_2022_(SVS31267_-_hls_ndvi_nebraska_2022_clear_1080p).webm",
  },
  overlap: {
    path: "/terra-products/overlap.webp",
    /*
      x 84.0-99.0 %, y 61.9-84.2 % of 1290x869, with its contrast stretched: 1 %
      clipped at each end, the same stretch on every channel so the hues stay.
      Unstretched, the forest and the clearings were one dull green at 44 px.
    */
    subject:
      "the edge of the Kayapó Indigenous Territory in Pará: forest against the " +
      "cleared grid of the farms beside it",
    author: "NASA World Wind",
    license: "Public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:Territoire_indig%C3%A8ne_de_Kayap%C3%B3.png",
  },
  radar: {
    path: "/terra-products/radar.webp",
    // x 28.0-42.0 %, y 39.0-61.2 % of 10000x6318.
    subject:
      "Sentinel-1 VV and VH as an RGB ratio over Burke, Australia: cropped fields " +
      "in orange on a blue ground",
    author: "Monja Šebela, Sentinel Hub",
    license: "CC BY 2.0",
    notice: "Contains modified Copernicus Sentinel data 2021",
    source:
      "https://commons.wikimedia.org/wiki/File:Agricultural_fields_with_SAR,_Burke,_Australia_(52240120022).png",
  },
  zones: {
    path: "/terra-products/zones.webp",
    /*
      The vegetation-density panel, x 10.0-25.0 %, y 20.5-29.7 % of 540x883. An
      airborne scanner rather than a satellite, and one date rather than several
      seasons: it shows the variation within a field that the zones are drawn
      from, which no free satellite picture found showed as clearly.
    */
    subject:
      "an airborne Daedalus image of vegetation density in irrigated fields at the " +
      "Maricopa Agricultural Center, Arizona: bands of denser and sparser canopy",
    author: "Susan Moran, USDA Agricultural Research Service",
    license: "Public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:Daedelus_comparison,_remote_sensing_in_precision_farming.jpg",
  },
  water: {
    path: "/terra-products/water.webp",
    // x 33.0-47.0 %, y 42.0-61.8 % of 15000x10633.
    subject:
      "Sentinel-2 over the Jalaput Reservoir, India, with the water in cyan from " +
      "the Ulyssys water-quality script",
    author: "Monja Šebela, Sentinel Hub",
    license: "CC BY 2.0",
    notice: "Contains modified Copernicus Sentinel data 2021",
    source:
      "https://commons.wikimedia.org/wiki/File:Jalaput_Reservoir,_India_(52233761286).png",
  },
}

/** The credit line: author and licence, then the notice when there is one. */
export function pictureCredit(p: ProductPicture): string {
  return [`Picture: ${p.author}`, p.license, p.notice].filter(Boolean).join(" · ")
}
