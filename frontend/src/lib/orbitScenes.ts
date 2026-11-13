/**
 * Ground seen from orbit: the scenes the interface's banners are set on, and
 * where each came from. The Models catalogue turns through them
 * (components/shell/CatalogueHero.tsx), and a profile takes one as its cover
 * (components/shell/ProfileSection.tsx).
 */

/** A scene a banner shows, and where it came from. */
export interface Scene {
  /** Under public/. */
  path: string
  /** Where it is, as the banner names it. */
  place: string
  /** What the picture shows, for whoever has to pick one later. */
  subject: string
  /** The sensor, the date and the credit its licence asks for, as printed. */
  credit: string
  source: string
  /** Where a banner's band sits in the file: a CSS object-position. */
  focus: string
}

/*
  GROUND SEEN FROM ORBIT IN TRUE COLOUR, the kind of scene TERRA's models read,
  each showing land covers a model tells apart: fields and pivots, forest
  against cleared land, rivers and a town, savanna, a reservoir. Only true
  colour, so the scenes read as one set; a false-colour composite turning
  between them would look like a different picture of the same thing.

  Each is cropped to a band about 2.4 times as wide as it is high, leaving out
  any mark printed on the original, which the credit a banner prints stands in
  for; resized to 2400 px wide with Lanczos where the original is wider; and
  passed through cwebp -q 82, as docs/RELEASING.md encodes the stills.
*/
export const SCENES: readonly Scene[] = [
  {
    // Sentinel Hub, "Soy Production In Brazil", 3669x1768, cropped to y 0..1690.
    path: "/terra-catalogue/primavera-do-leste.webp",
    place: "Primavera do Leste, Mato Grosso",
    subject:
      "Centre pivots and fields between strips of forest, in Sentinel-2 true " +
      "colour on 28 July 2017",
    credit:
      "Sentinel-2, 28 Jul 2017 · Contains modified Copernicus Sentinel data 2017 · " +
      "Sentinel Hub, CC BY 2.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Soy_Production_In_Brazil_(46200453114).jpg",
    focus: "50% 35%",
  },
  {
    // Sentinel Hub (Monja Šebela), "Amazon Rainforest", the 3840 px rendition of
    // the 13020x7700 original, cropped to y 340..1940.
    path: "/terra-catalogue/amazon-edge.webp",
    place: "Amazon forest edge, 9.4° S 52.1° W",
    subject:
      "Unbroken forest west of a river and cleared land east of it, in Sentinel-2 " +
      "true colour on 18 July 2019",
    credit:
      "Sentinel-2, 18 Jul 2019 · Contains modified Copernicus Sentinel data 2019 · " +
      "Sentinel Hub, CC BY 2.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Amazon_Rainforest_(50098118502).png",
    focus: "50% 50%",
  },
  {
    // NASA Earth Observatory, "From Forest to Field in Pará", 7766x7766,
    // cropped to y 777..4013.
    path: "/terra-catalogue/santarem.webp",
    place: "Santarém, Pará",
    subject:
      "The Amazon and the Tapajós meeting at Santarém, with the town, cleared " +
      "fields and forest, in Landsat 8 true colour on 23 September 2024",
    credit:
      "Landsat 8, 23 Sep 2024 · NASA Earth Observatory, Landsat data from USGS · " +
      "public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:From_Forest_to_Field_in_Par%C3%A1_(154708).jpg",
    focus: "50% 40%",
  },
  {
    // NASA, "Central Brazil Cerrado", 1301x867, cropped to y 162..704 and kept
    // at its own width: no larger rendition is published.
    path: "/terra-catalogue/serra-de-caldas.webp",
    place: "Serra de Caldas, Goiás",
    subject:
      "The Cerrado plateau of the Serra de Caldas beside Caldas Novas and a " +
      "reservoir, in Landsat 9 true colour on 19 May 2025",
    credit: "Landsat 9, 19 May 2025 · NASA, Landsat data from USGS · public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:Central_Brazil_Cerrado_(Landsat_9,_2025-05-19).jpg",
    focus: "50% 50%",
  },
]
