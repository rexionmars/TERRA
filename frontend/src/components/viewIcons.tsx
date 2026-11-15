/*
  The icons that carry colour: the composition panel's choices (the kinds of
  view and the scene they are drawn from) and the mineral map's readings on the
  pie's Mineral ring.

  This file is their source. Each icon draws what its word means, and was kept
  only when it read as that word at 20 px with no label beside it:

    RGB             three discs of light that add: yellow, cyan, magenta, white
    Index           the division sign, its dots the two bands (NIR, red)
    Components      a prism splitting light into red, green and blue, the
                    channels the view gives the first three components
    Clusters        three groups of alike points
    Change          delta, half loss and half gain
    Canopy          crowns under the sun's light
    Biomass         a weight with a leaf in it: living mass
    One scene       one image
    Period median   a stack of images, the middle one lit

    Coverage        the area, filled as far as the swath reached
    Mineral classes a cluster of three crystals, three classes
    References      a book with a spectrum on its cover: the library
    Passes          the satellite in flight, its panels across its heading
    Fractional cover a ring of three shares: green, soil, dry
    Band position   a spectrum's absorption marked, and pointed to on its axis;
                    the library's position a faint tick beside it
    Acid-sulfate    jarosite's ochre crystal and a drop of acid
    Confidence      the normal curve, its middle band shaded
    Against EMIT    a confusion matrix, its diagonal lit: agreement cell by cell

  A change keeps to the rules they were built on: a 20-unit grid with a margin
  of 2; neutral strokes of 1.5 with round caps and joins; one corner radius, 2
  on frames and 1 on small parts; colour only as flat fills, never outlined;
  every shape from stated arcs and lines, not drawn by eye.

  Unlike icons.tsx these carry colour, because the colour is what several of
  them mean: the three channels, the cluster groups, a loss and a gain. The
  neutral parts are currentColor; the colours are the Okabe-Ito tokens --oi-*
  in index.css, one value per theme. A token sits in an element's style, where
  every engine resolves var(), rather than in its fill or stroke attribute,
  where that is not assured.
*/
import type { Icon } from "@/components/icons"
import type { NodeKind } from "@/lib/compositorGraph"

/*
  20 units, the grid they are drawn on. The body is set as markup, as in
  icons.tsx: it is this file's own constant, and as a string each glyph costs
  its path data and nothing else.
*/
function glyph(body: string): Icon {
  return function ViewIcon(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    )
  }
}

export const ViewRgb = glyph(
  '<defs><clipPath id="v7-r"><circle cx="10" cy="7.3" r="4.6" fill="#000"/></clipPath><clipPath id="v7-g"><circle cx="7.489" cy="11.65" r="4.6" fill="#000"/></clipPath><clipPath id="v7-rg" clip-path="url(#v7-r)"><circle cx="7.489" cy="11.65" r="4.6" fill="#000"/></clipPath></defs><circle cx="10" cy="7.3" r="4.6" style="fill:var(--oi-vermillion, #D55E00)"/><circle cx="7.489" cy="11.65" r="4.6" style="fill:var(--oi-green, #009E73)"/><circle cx="12.511" cy="11.65" r="4.6" style="fill:var(--oi-blue, #0072B2)"/><circle cx="7.489" cy="11.65" r="4.6" fill="#F0E442" clip-path="url(#v7-r)"/><circle cx="12.511" cy="11.65" r="4.6" fill="#CC79A7" clip-path="url(#v7-r)"/><circle cx="12.511" cy="11.65" r="4.6" fill="#56B4E9" clip-path="url(#v7-g)"/><circle cx="12.511" cy="11.65" r="4.6" fill="#FFFFFF" clip-path="url(#v7-rg)"/>'
)

export const ViewIndex = glyph(
  '<circle cx="10" cy="4" r="2.25" fill="currentColor"/><rect x="2.5" y="8.75" width="15" height="2.5" rx="1.25" fill="currentColor"/><circle cx="10" cy="16" r="2.25" style="fill:var(--oi-vermillion, #D55E00)"/>'
)

export const ViewComponents = glyph(
  '<path d="M11.75 8.763 L17.912 6.398 A6.6 6.6 0 0 1 18.349 8.648 Z" style="fill:var(--oi-vermillion, #D55E00)"/><path d="M11.75 8.763 L18.349 8.648 A6.6 6.6 0 0 1 17.99 10.912 Z" style="fill:var(--oi-green, #009E73)"/><path d="M11.75 8.763 L17.99 10.912 A6.6 6.6 0 0 1 16.879 12.917 Z" style="fill:var(--oi-blue, #0072B2)"/><path d="M8.221 5.35 A0.9 0.9 0 0 1 9.779 5.35 L13.721 12.176 A0.9 0.9 0 0 1 12.941 13.526 L5.059 13.526 A0.9 0.9 0 0 1 4.279 12.176 Z" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.75 11.563 L6.25 8.763" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const ViewClusters = glyph(
  '<circle cx="5.843" cy="5.05" r="1.85" style="fill:var(--oi-orange, #E69F00)"/><circle cx="7.748" cy="8.35" r="1.85" style="fill:var(--oi-orange, #E69F00)"/><circle cx="3.938" cy="8.35" r="1.85" style="fill:var(--oi-orange, #E69F00)"/><circle cx="14.157" cy="5.05" r="1.85" style="fill:var(--oi-sky, #56B4E9)"/><circle cx="16.062" cy="8.35" r="1.85" style="fill:var(--oi-sky, #56B4E9)"/><circle cx="12.252" cy="8.35" r="1.85" style="fill:var(--oi-sky, #56B4E9)"/><circle cx="10" cy="12.25" r="1.85" style="fill:var(--oi-green, #009E73)"/><circle cx="11.905" cy="15.55" r="1.85" style="fill:var(--oi-green, #009E73)"/><circle cx="8.095" cy="15.55" r="1.85" style="fill:var(--oi-green, #009E73)"/>'
)

export const ViewChange = glyph(
  '<defs><linearGradient id="v7-delta" x1="2" x2="18" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0.5" style="stop-color:var(--oi-vermillion, #D55E00)"/><stop offset="0.5" style="stop-color:var(--oi-blue, #0072B2)"/></linearGradient></defs><path d="M10 3.6 L16.9 16.1 H3.1 Z" fill="none" stroke="url(#v7-delta)" stroke-width="2.25" stroke-linejoin="round"/>'
)

export const ViewCanopy = glyph(
  '<circle cx="3.75" cy="3.75" r="1.5" style="fill:var(--oi-orange, #E69F00)"/><path stroke-width="0.4" stroke-linejoin="round" d="M6.05 4.17 L8.25 3.75 L6.05 3.33 Z M5.079 5.673 L6.932 6.932 L5.673 5.079 Z M3.33 6.05 L3.75 8.25 L4.17 6.05 Z" style="fill:var(--oi-orange, #E69F00);stroke:var(--oi-orange, #E69F00)"/><path d="M7.6 12.5 V17.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.4 10.1 V17.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.2 12.5 V17.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><g style="fill:var(--oi-green, #009E73)"><circle cx="7.6" cy="12.5" r="3"/><circle cx="11.4" cy="10.1" r="3.5"/><circle cx="15.2" cy="12.5" r="3"/></g>'
)

export const ViewBiomass = glyph(
  '<defs><mask id="v7-leaf"><rect width="20" height="20" fill="#fff"/><path d="M7.8 14.3 L11.7 11" stroke="#000" stroke-width="0.9" stroke-linecap="round"/></mask></defs><circle cx="10" cy="4.25" r="2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.225 8.321 A1.6 1.6 0 0 1 7.735 7.25 L12.265 7.25 A1.6 1.6 0 0 1 13.775 8.321 L16.155 15.121 A1.6 1.6 0 0 1 14.645 17.25 L5.355 17.25 A1.6 1.6 0 0 1 3.845 15.121 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path mask="url(#v7-leaf)" d="M6.9 15.1 A5.6 5.6 0 0 1 13.3 9.6 A5.6 5.6 0 0 1 6.9 15.1 Z" style="fill:var(--oi-green, #009E73)"/>'
)

export const SourceOneScene = glyph(
  '<defs><clipPath id="v7-one"><path d="M2.75 6 A1.25 1.25 0 0 1 4 4.75 L16 4.75 A1.25 1.25 0 0 1 17.25 6 L17.25 14.5 A1.25 1.25 0 0 1 16 15.75 L4 15.75 A1.25 1.25 0 0 1 2.75 14.5 Z"/></clipPath></defs><g clip-path="url(#v7-one)" fill="currentColor"><path d="M4.643 17.5 A0.6 0.6 0 0 1 4.125 16.598 L7.913 10.087 A0.6 0.6 0 0 1 8.933 10.058 L13.227 16.57 A0.6 0.6 0 0 1 12.726 17.5 Z"/><path d="M11.363 17.5 A0.6 0.6 0 0 1 10.845 16.598 L13.067 12.779 A0.6 0.6 0 0 1 14.064 12.719 L16.952 16.538 A0.6 0.6 0 0 1 16.474 17.5 Z"/><circle cx="13.52" cy="8.125" r="1.5"/></g><path d="M2.75 6 A1.25 1.25 0 0 1 4 4.75 L16 4.75 A1.25 1.25 0 0 1 17.25 6 L17.25 14.5 A1.25 1.25 0 0 1 16 15.75 L4 15.75 A1.25 1.25 0 0 1 2.75 14.5 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const SourcePeriodMedian = glyph(
  '<path d="M7.75 5 V5.75 A1.25 1.25 0 0 1 9 4.5 H16.5 A1.25 1.25 0 0 1 17.75 5.75 V11.25 A1.25 1.25 0 0 1 16.5 12.5 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.55"/><path d="M5.25 7.5 V8.25 A1.25 1.25 0 0 1 6.5 7 H14 A1.25 1.25 0 0 1 15.25 8.25 V13.75 A1.25 1.25 0 0 1 14 15 H14.75" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--oi-blue, #0072B2)"/><defs><clipPath id="v7-stack"><path d="M2.75 10.75 A1.25 1.25 0 0 1 4 9.5 L11.5 9.5 A1.25 1.25 0 0 1 12.75 10.75 L12.75 16.25 A1.25 1.25 0 0 1 11.5 17.5 L4 17.5 A1.25 1.25 0 0 1 2.75 16.25 Z"/></clipPath></defs><g clip-path="url(#v7-stack)" fill="currentColor"><path d="M4.147 19.25 A0.6 0.6 0 0 1 3.617 18.369 L6.103 13.679 A0.6 0.6 0 0 1 7.147 13.651 L9.964 18.341 A0.6 0.6 0 0 1 9.45 19.25 Z"/><path d="M8.969 19.25 A0.6 0.6 0 0 1 8.436 18.373 L9.815 15.723 A0.6 0.6 0 0 1 10.844 15.664 L12.637 18.314 A0.6 0.6 0 0 1 12.14 19.25 Z"/><circle cx="10.28" cy="11.885" r="1.14"/></g><path d="M2.75 10.75 A1.25 1.25 0 0 1 4 9.5 L11.5 9.5 A1.25 1.25 0 0 1 12.75 10.75 L12.75 16.25 A1.25 1.25 0 0 1 11.5 17.5 L4 17.5 A1.25 1.25 0 0 1 2.75 16.25 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const MineralCoverage = glyph(
  '<defs><clipPath id="mn2-cov"><path d="M3.055 8.064 A1.2 1.2 0 0 1 3.4 7.1 L6.976 3.524 A1.2 1.2 0 0 1 8.204 3.235 L11.611 4.37 A1.2 1.2 0 0 0 12.387 4.365 L15.228 3.37 A1.2 1.2 0 0 1 16.819 4.618 L16.265 10.343 A1.2 1.2 0 0 0 16.276 10.656 L17.04 15.24 A1.2 1.2 0 0 1 15.98 16.631 L10.25 17.224 A1.2 1.2 0 0 1 9.761 17.173 L4.503 15.491 A1.2 1.2 0 0 1 3.674 14.464 Z"/></clipPath></defs><path d="M0 0 H14 L8.5 20 H0 Z" clip-path="url(#mn2-cov)" style="fill:var(--oi-blue, #0072B2)"/><path d="M3.055 8.064 A1.2 1.2 0 0 1 3.4 7.1 L6.976 3.524 A1.2 1.2 0 0 1 8.204 3.235 L11.611 4.37 A1.2 1.2 0 0 0 12.387 4.365 L15.228 3.37 A1.2 1.2 0 0 1 16.819 4.618 L16.265 10.343 A1.2 1.2 0 0 0 16.276 10.656 L17.04 15.24 A1.2 1.2 0 0 1 15.98 16.631 L10.25 17.224 A1.2 1.2 0 0 1 9.761 17.173 L4.503 15.491 A1.2 1.2 0 0 1 3.674 14.464 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const MineralClasses = glyph(
  '<defs><mask id="mn2-cls"><rect width="20" height="20" fill="#fff"/><g transform="rotate(-21 6.9 17.25)"><path d="M6.9 8.45 V16.25" stroke="#000" stroke-width="0.8" stroke-linecap="round"/></g><g transform="rotate(21 13.1 17.25)"><path d="M13.1 9.2 V16.25" stroke="#000" stroke-width="0.8" stroke-linecap="round"/></g><g><path d="M10 3.7 V16.5" stroke="#000" stroke-width="0.8" stroke-linecap="round"/></g><path d="M9.63 2.907 A0.5 0.5 0 0 1 10.37 2.907 L12.37 5.107 A0.5 0.5 0 0 1 12.5 5.443 L12.5 15.49 A0.5 0.5 0 0 1 12.287 15.899 L10.287 17.299 A0.5 0.5 0 0 1 9.713 17.299 L7.713 15.899 A0.5 0.5 0 0 1 7.5 15.49 L7.5 5.443 A0.5 0.5 0 0 1 7.63 5.107 Z" fill="none" stroke="#000" stroke-width="1.6"/></mask><mask id="mn2-front"><rect width="20" height="20" fill="#fff"/><path d="M10 3.7 V16.5" stroke="#000" stroke-width="0.8" stroke-linecap="round"/></mask></defs><g mask="url(#mn2-cls)"><path transform="rotate(-21 6.9 17.25)" d="M6.53 7.657 A0.5 0.5 0 0 1 7.27 7.657 L8.87 9.417 A0.5 0.5 0 0 1 9 9.753 L9 15.52 A0.5 0.5 0 0 1 8.787 15.929 L7.187 17.049 A0.5 0.5 0 0 1 6.613 17.049 L5.013 15.929 A0.5 0.5 0 0 1 4.8 15.52 L4.8 9.753 A0.5 0.5 0 0 1 4.93 9.417 Z" style="fill:var(--oi-orange, #E69F00)"/><path transform="rotate(21 13.1 17.25)" d="M12.73 8.407 A0.5 0.5 0 0 1 13.47 8.407 L14.97 10.057 A0.5 0.5 0 0 1 15.1 10.393 L15.1 15.59 A0.5 0.5 0 0 1 14.887 15.999 L13.387 17.049 A0.5 0.5 0 0 1 12.813 17.049 L11.313 15.999 A0.5 0.5 0 0 1 11.1 15.59 L11.1 10.393 A0.5 0.5 0 0 1 11.23 10.057 Z" style="fill:var(--oi-green, #009E73)"/></g><g mask="url(#mn2-front)"><path d="M9.63 2.907 A0.5 0.5 0 0 1 10.37 2.907 L12.37 5.107 A0.5 0.5 0 0 1 12.5 5.443 L12.5 15.49 A0.5 0.5 0 0 1 12.287 15.899 L10.287 17.299 A0.5 0.5 0 0 1 9.713 17.299 L7.713 15.899 A0.5 0.5 0 0 1 7.5 15.49 L7.5 5.443 A0.5 0.5 0 0 1 7.63 5.107 Z" style="fill:var(--oi-sky, #56B4E9)"/></g>'
)

export const MineralReferences = glyph(
  '<path d="M4.25 4 A1.25 1.25 0 0 1 5.5 2.75 L15 2.75 A1.25 1.25 0 0 1 16.25 4 L16.25 16 A1.25 1.25 0 0 1 15 17.25 L5.5 17.25 A1.25 1.25 0 0 1 4.25 16 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.75 3 V17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 9.25 C9.5 6.25 10.5 6.25 11.5 9.25 S13.5 12.25 14.25 8.75" fill="none" stroke-width="1.5" stroke-linecap="round" style="stroke:var(--oi-vermillion, #D55E00)"/><path d="M8.5 14.25 H13.75" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/>'
)

export const MineralPasses = glyph(
  '<path d="M6.55 10.056 l-1.838 1.838" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/><path d="M8.954 11.046 l-2.97 2.97" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/><path d="M9.944 13.45 l-1.838 1.838" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/><g transform="translate(11.5 8.5) rotate(45) scale(0.95)"><defs><mask id="mn3-cells" maskUnits="userSpaceOnUse" x="-10" y="-10" width="20" height="20"><rect x="-10" y="-10" width="20" height="20" fill="#fff"/><path d="M-6.4 -1.6 V1.6 M-4.6 -1.6 V1.6 M4.6 -1.6 V1.6 M6.4 -1.6 V1.6" stroke="#000" stroke-width="0.6"/></mask></defs><g mask="url(#mn3-cells)"><rect x="-8.2" y="-1.85" width="5.4" height="3.7" rx="0.6" style="fill:var(--oi-blue, #0072B2)"/><rect x="2.8" y="-1.85" width="5.4" height="3.7" rx="0.6" style="fill:var(--oi-blue, #0072B2)"/></g><rect x="-2.8" y="-0.4" width="5.6" height="0.8" fill="currentColor"/><rect x="-2.1" y="-2.1" width="4.2" height="4.2" rx="0.8" fill="currentColor"/></g>'
)

export const MineralCover = glyph(
  '<path d="M10.471 4.018 A6.0 6.0 0 1 1 8.599 15.834" fill="none" stroke-width="3.6" style="stroke:var(--oi-green, #009E73)"/><path d="M7.704 15.543 A6.0 6.0 0 0 1 4.884 6.865" fill="none" stroke-width="3.6" style="stroke:var(--oi-vermillion, #D55E00)"/><path d="M5.438 6.103 A6.0 6.0 0 0 1 9.529 4.018" fill="none" stroke-width="3.6" style="stroke:var(--oi-orange, #E69F00)"/>'
)

export const MineralPositions = glyph(
  '<path d="M2.75 9.5 C4.25 5.5 6.25 4.5 7.25 6.25 C8.25 8 8.5 10.75 9.75 10.75 C11 10.75 11.25 7 12.5 5.75 C13.75 4.5 15.5 4.25 17.25 4.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.75 15 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.75 13.25 V16.75" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/><path d="M9.75 10.75 V15" fill="none" stroke-width="1" stroke-dasharray="1 1.1" style="stroke:var(--oi-vermillion, #D55E00)"/><circle cx="9.75" cy="10.75" r="1.6" style="fill:var(--oi-vermillion, #D55E00)"/><path d="M9.363 16.473 A0.5 0.5 0 0 1 10.137 16.473 L11.332 17.933 A0.5 0.5 0 0 1 10.945 18.75 L8.555 18.75 A0.5 0.5 0 0 1 8.168 17.933 Z" style="fill:var(--oi-vermillion, #D55E00)"/>'
)

export const MineralAcid = glyph(
  '<defs><mask id="mn2-acid"><rect width="20" height="20" fill="#fff"/><path d="M7 4.95 V16.25" stroke="#000" stroke-width="0.8" stroke-linecap="round"/></mask></defs><g mask="url(#mn2-acid)"><path d="M6.556 4.238 A0.6 0.6 0 0 1 7.444 4.238 L10.144 7.208 A0.6 0.6 0 0 1 10.3 7.612 L10.3 14.628 A0.6 0.6 0 0 1 10.044 15.119 L7.344 17.009 A0.6 0.6 0 0 1 6.656 17.009 L3.956 15.119 A0.6 0.6 0 0 1 3.7 14.628 L3.7 7.612 A0.6 0.6 0 0 1 3.856 7.208 Z" style="fill:var(--oi-orange, #E69F00)"/></g><path d="M14.25 3 L16.961 8.714 A3.0 3.0 0 1 1 11.539 8.714 Z" stroke-linejoin="round" stroke-width="0.6" style="fill:var(--oi-vermillion, #D55E00);stroke:var(--oi-vermillion, #D55E00)"/>'
)

export const MineralConfidence = glyph(
  '<path d="M7.583 16 L7.583 8.534 L7.885 7.738 L8.188 6.981 L8.49 6.286 L8.792 5.677 L9.094 5.178 L9.396 4.806 L9.698 4.577 L10 4.5 L10.302 4.577 L10.604 4.806 L10.906 5.178 L11.208 5.677 L11.51 6.286 L11.812 6.981 L12.115 7.738 L12.417 8.534 L12.417 16 Z" style="fill:var(--oi-blue, #0072B2)"/><path d="M2.75 15.764 L3.052 15.676 L3.354 15.562 L3.656 15.414 L3.958 15.227 L4.26 14.994 L4.562 14.709 L4.865 14.365 L5.167 13.957 L5.469 13.481 L5.771 12.937 L6.073 12.325 L6.375 11.649 L6.677 10.918 L6.979 10.144 L7.281 9.343 L7.583 8.534 L7.885 7.738 L8.188 6.981 L8.49 6.286 L8.792 5.677 L9.094 5.178 L9.396 4.806 L9.698 4.577 L10 4.5 L10.302 4.577 L10.604 4.806 L10.906 5.178 L11.208 5.677 L11.51 6.286 L11.812 6.981 L12.115 7.738 L12.417 8.534 L12.719 9.343 L13.021 10.144 L13.323 10.918 L13.625 11.649 L13.927 12.325 L14.229 12.937 L14.531 13.481 L14.833 13.957 L15.135 14.365 L15.438 14.709 L15.74 14.994 L16.042 15.227 L16.344 15.414 L16.646 15.562 L16.948 15.676 L17.25 15.764" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.75 16.75 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const MineralAgreement = glyph(
  '<rect x="2.75" y="2.75" width="3.25" height="3.25" rx="0.6" style="fill:var(--oi-blue, #0072B2)"/><rect x="6.5" y="2.75" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.55"/><rect x="10.25" y="2.75" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="14" y="2.75" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="2.75" y="6.5" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="6.5" y="6.5" width="3.25" height="3.25" rx="0.6" style="fill:var(--oi-blue, #0072B2)"/><rect x="10.25" y="6.5" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="14" y="6.5" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="2.75" y="10.25" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="6.5" y="10.25" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="10.25" y="10.25" width="3.25" height="3.25" rx="0.6" style="fill:var(--oi-blue, #0072B2)"/><rect x="14" y="10.25" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.55"/><rect x="2.75" y="14" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="6.5" y="14" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="10.25" y="14" width="3.25" height="3.25" rx="0.6" fill="currentColor" fill-opacity="0.18"/><rect x="14" y="14" width="3.25" height="3.25" rx="0.6" style="fill:var(--oi-blue, #0072B2)"/>'
)

/** The mineral map's readings, each on its own option of the pie's Mineral ring. */
export const MINERAL_READING_ICONS: Partial<Record<NodeKind, Icon>> = {
  mineralCoverage: MineralCoverage,
  mineralClasses: MineralClasses,
  mineralReferences: MineralReferences,
  mineralPasses: MineralPasses,
  mineralCover: MineralCover,
  mineralPositions: MineralPositions,
  mineralAcid: MineralAcid,
  mineralConfidence: MineralConfidence,
  mineralAgreement: MineralAgreement,
}
