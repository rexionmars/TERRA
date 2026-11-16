/**
 * Illegal gold mining in the Kayapó Indigenous Land: the pictures the Models
 * catalogue's banner turns through (components/shell/CatalogueHero.tsx), and
 * where each came from.
 */

import type { Scene } from "@/lib/orbitScenes"

/*
  ONLY PICTURES FREE TO SHOW WITH A CREDIT AND FREE TO CROP: CC BY, the
  Copernicus licence or the public domain. Not CC BY-ND, which forbids the crop;
  not CC BY-SA, which would put the banner itself under that licence. Ibama's own
  site is ND, and many of its photos on Commons are SA, so these are the ones
  Commons holds under CC BY 2.0.

  Each is cropped to a band 2.4 times as wide as it is high around its subject,
  resized to 2400 px wide with Lanczos and passed through cwebp -q 82, as the
  scenes of lib/orbitScenes.ts are.
*/
export const CATALOGUE_SCENES: readonly Scene[] = [
  {
    // Commons, "Terra Indígena Kayapó, Pará (38197293234).jpg", 3000x2000.
    path: "/terra-catalogue/kayapo-valley.webp",
    place: "Kayapó Indigenous Land, Pará",
    subject:
      "A valley cleared and dug out by gold mining inside unbroken forest, seen " +
      "from the air during an Ibama operation in October 2017",
    // No-break spaces keep the licence on one line.
    credit: "Photo Felipe Werneck/Ibama, Oct 2017 · CC\u00a0BY\u00a02.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Terra_Ind%C3%ADgena_Kayap%C3%B3,_Par%C3%A1_(38197293234).jpg",
    focus: "50% 70%",
  },
  {
    // Commons, "Terra Indígena Kayapó, Pará (37221249744).jpg", 3000x2000.
    path: "/terra-catalogue/kayapo-pit.webp",
    place: "Kayapó Indigenous Land, Pará",
    subject:
      "An Ibama agent on the spoil of a mining pit, with a helicopter behind " +
      "and dead trees around, in October 2017",
    credit: "Photo Felipe Werneck/Ibama, Oct 2017 · CC\u00a0BY\u00a02.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Terra_Ind%C3%ADgena_Kayap%C3%B3,_Par%C3%A1_(37221249744).jpg",
    focus: "50% 45%",
  },
  {
    // Commons, "Terra Indígena Kayapó, Pará (37877727176).jpg", 3000x2000.
    path: "/terra-catalogue/kayapo-camp.webp",
    place: "Kayapó Indigenous Land, Pará",
    subject:
      "A flooded mining pit, a miners' camp and an excavator in burnt forest, " +
      "with an Ibama helicopter landed beside them, in October 2017",
    credit: "Photo Felipe Werneck/Ibama, Oct 2017 · CC\u00a0BY\u00a02.0",
    source:
      "https://commons.wikimedia.org/wiki/File:Terra_Ind%C3%ADgena_Kayap%C3%B3,_Par%C3%A1_(37877727176).jpg",
    focus: "50% 40%",
  },
]
