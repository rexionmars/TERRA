/*
  The icons that carry colour: the composition panel's choices (the kinds of
  view and the scene they are drawn from); on the workflows board's pie the node
  categories of the Add ring and every node on its category's ring; and on the
  compare board's pie the readings.

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

    Analysis        a magnifier over bars: examining the numbers
    Mineral         one crystal, its two faces in two blues
    Output          a tray with an arrow leaving it: what leaves the board
    Mix             two plates in perspective, one laid over the other
    Mask            a tile darkened but for the shape it keeps
    Run             play, in a ring
    Filter          a funnel, pixels of three classes going in

    Class areas     a bar per class, in the class's colour
    Season dates    a calendar, the season's curve marked at rise, peak and fall
    Health          a leaf, and a pulse across it
    Field table     a table, its header lit
    Zones           one field in three zones, low to high
    Radar series    a radar screen and its sweep
    Overlap         a field over a protected area, where they meet in alarm
    Majority filter a 3 x 3 window, its centre taking the class most hold
    Sieve           a sieve: the large patch stays, the specks fall through
    Opening/closing a patch's lobes and, dashed, the smooth hull the operations
                    leave
    Field filter    the Filter funnel, a field going in
    Select classes  a legend: swatches for the classes kept, an empty one left out
    Viewer          an eye
    Globe           the globe, an area drawn on it
    Make fields     a field with a plus badge
    Save fields     a page with a field on it, and the save badge
    PDF report      a page with its title band and lines of text
    Save GeoTIFF    a page with the mineral crystal, and the save badge

    Domain shift    one run's distribution and another's, moved along the
                    axis, the arrow from peak to peak
    Cohort          the reading's own figure: a point per target, divergence
                    along and agreement up, the source at the top of the axis
    Spectra         reflectance over wavelength, a curve per class: vegetation
                    with its red edge, soil, water
    Separability    two groups of alike points and the dashed boundary between
    Change and Mask are drawn as their word is above; Run and Mix as their
    category; Differences as Change (delta is "difference"), Library as
    References, Tables as Field table. Where a reading pairs a source with a
    target, the source is blue and the target orange.

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
import type { NodeCategory, NodeKind } from "@/lib/compositorGraph"
import type { ReadingKind } from "@/lib/compareBoard"

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

export const CategoryRun = glyph(
  '<circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 7.645 A0.9 0.9 0 0 1 9.385 6.886 L13.066 9.242 A0.9 0.9 0 0 1 13.066 10.758 L9.385 13.114 A0.9 0.9 0 0 1 8 12.355 Z" style="fill:var(--oi-orange, #E69F00)"/>'
)

export const CategoryOutput = glyph(
  '<path d="M2.75 10.5 V15.25 Q2.75 17.25 4.75 17.25 H15.25 Q17.25 17.25 17.25 15.25 V10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 12.5 L15.5 4.5" fill="none" stroke-width="2" stroke-linecap="round" style="stroke:var(--oi-blue, #0072B2)"/><path d="M16.441 2.874 A0.6 0.6 0 0 1 17.126 3.559 L16.43 8.08 A0.6 0.6 0 0 1 15.413 8.413 L11.587 4.587 A0.6 0.6 0 0 1 11.92 3.57 Z" style="fill:var(--oi-blue, #0072B2)"/>'
)

export const CategoryFilter = glyph(
  '<path d="M4.523 8.891 A0.8 0.8 0 0 1 5.063 7.5 L14.937 7.5 A0.8 0.8 0 0 1 15.477 8.891 L11.511 12.512 A0.8 0.8 0 0 0 11.25 13.103 L11.25 16.45 A0.8 0.8 0 0 1 10.45 17.25 L9.55 17.25 A0.8 0.8 0 0 1 8.75 16.45 L8.75 13.103 A0.8 0.8 0 0 0 8.489 12.512 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.75" y="2.5" width="2.6" height="2.6" rx="0.6" style="fill:var(--oi-orange, #E69F00)"/><rect x="8.75" y="3.5" width="2.6" height="2.6" rx="0.6" style="fill:var(--oi-sky, #56B4E9)"/><rect x="12.75" y="2.25" width="2.6" height="2.6" rx="0.6" style="fill:var(--oi-green, #009E73)"/>'
)

export const CategoryMask = glyph(
  '<defs><mask id="ad-mask"><rect width="20" height="20" fill="#fff"/><path d="M5.559 7.833 A1.2 1.2 0 0 1 6.26 6.655 L10.194 4.866 A1.2 1.2 0 0 1 11.588 5.161 L14.499 8.437 A1.2 1.2 0 0 1 14.71 9.696 L12.861 14.133 A1.2 1.2 0 0 1 11.571 14.857 L6.946 14.146 A1.2 1.2 0 0 1 5.932 13.045 Z" fill="#000" stroke="#000" stroke-width="2"/></mask></defs><path d="M2.75 4.75 A2 2 0 0 1 4.75 2.75 L15.25 2.75 A2 2 0 0 1 17.25 4.75 L17.25 15.25 A2 2 0 0 1 15.25 17.25 L4.75 17.25 A2 2 0 0 1 2.75 15.25 Z" mask="url(#ad-mask)" fill="currentColor" fill-opacity="0.28"/><path d="M5.559 7.833 A1.2 1.2 0 0 1 6.26 6.655 L10.194 4.866 A1.2 1.2 0 0 1 11.588 5.161 L14.499 8.437 A1.2 1.2 0 0 1 14.71 9.696 L12.861 14.133 A1.2 1.2 0 0 1 11.571 14.857 L6.946 14.146 A1.2 1.2 0 0 1 5.932 13.045 Z" style="fill:var(--oi-green, #009E73)"/><path d="M2.75 4.75 A2 2 0 0 1 4.75 2.75 L15.25 2.75 A2 2 0 0 1 17.25 4.75 L17.25 15.25 A2 2 0 0 1 15.25 17.25 L4.75 17.25 A2 2 0 0 1 2.75 15.25 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const CategoryMix = glyph(
  '<path d="M9.507 8.779 A1 1 0 0 1 10.493 8.779 L15.965 11.88 A1 1 0 0 1 15.965 13.62 L10.493 16.721 A1 1 0 0 1 9.507 16.721 L4.035 13.62 A1 1 0 0 1 4.035 11.88 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.556 4.601 A0.9 0.9 0 0 1 10.444 4.601 L14.618 6.967 A0.9 0.9 0 0 1 14.618 8.533 L10.444 10.899 A0.9 0.9 0 0 1 9.556 10.899 L5.382 8.533 A0.9 0.9 0 0 1 5.382 6.967 Z" style="fill:var(--oi-green, #009E73)"/>'
)

export const CategoryAnalysis = glyph(
  '<defs><clipPath id="ad-lens"><circle cx="8.75" cy="8.75" r="5.0"/></clipPath></defs><g clip-path="url(#ad-lens)"><rect x="4.5" y="9" width="2.1" height="3.25" rx="0.5" style="fill:var(--oi-sky, #56B4E9)"/><rect x="7.5" y="6" width="2.1" height="6.25" rx="0.5" style="fill:var(--oi-sky, #56B4E9)"/><rect x="10.5" y="7.75" width="2.1" height="4.5" rx="0.5" style="fill:var(--oi-sky, #56B4E9)"/></g><circle cx="8.75" cy="8.75" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.11 13.11 L17 17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
)

export const CategoryMineral = glyph(
  '<defs><clipPath id="ad-cry"><path d="M9.482 3.07 A0.7 0.7 0 0 1 10.518 3.07 L13.818 6.7 A0.7 0.7 0 0 1 14 7.171 L14 14.336 A0.7 0.7 0 0 1 13.701 14.909 L10.401 17.219 A0.7 0.7 0 0 1 9.599 17.219 L6.299 14.909 A0.7 0.7 0 0 1 6 14.336 L6 7.171 A0.7 0.7 0 0 1 6.182 6.7 Z"/></clipPath></defs><g clip-path="url(#ad-cry)"><rect x="0" y="0" width="10" height="20" style="fill:var(--oi-sky, #56B4E9)"/><rect x="10" y="0" width="10" height="20" style="fill:var(--oi-blue, #0072B2)"/></g>'
)

/** Each node category, on the pie's Add ring. Run and Mix are categories of one node. */
export const CATEGORY_ICONS: Record<NodeCategory, Icon> = {
  input: CategoryRun,
  output: CategoryOutput,
  filter: CategoryFilter,
  mask: CategoryMask,
  color: CategoryMix,
  analysis: CategoryAnalysis,
  mineral: CategoryMineral,
}

export const KindAreas = glyph(
  '<path d="M3 3 V17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="4.5" y="4" width="12.5" height="2.75" rx="0.8" style="fill:var(--oi-orange, #E69F00)"/><rect x="4.5" y="8.75" width="9" height="2.75" rx="0.8" style="fill:var(--oi-sky, #56B4E9)"/><rect x="4.5" y="13.5" width="5.5" height="2.75" rx="0.8" style="fill:var(--oi-green, #009E73)"/>'
)

export const KindSeasonDates = glyph(
  '<path d="M2.75 6.25 A2 2 0 0 1 4.75 4.25 L15.25 4.25 A2 2 0 0 1 17.25 6.25 L17.25 15.25 A2 2 0 0 1 15.25 17.25 L4.75 17.25 A2 2 0 0 1 2.75 15.25 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 2.75 V5.75 M13.5 2.75 V5.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.75 7.75 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.75 15.25 C7 15.25 7.75 9.75 10 9.75 C12.5 9.75 13 15.25 15.25 15.25" fill="none" stroke-width="1.5" stroke-linecap="round" style="stroke:var(--oi-green, #009E73)"/><circle cx="6.9" cy="12.5" r="1.15" fill="currentColor"/><circle cx="10" cy="9.75" r="1.15" fill="currentColor"/><circle cx="13.1" cy="12.5" r="1.15" fill="currentColor"/>'
)

export const KindHealth = glyph(
  '<defs><mask id="kd-health"><rect width="20" height="20" fill="#fff"/><path d="M2.5 11 H6.25 L7.75 7.75 L9.75 14 L11.5 9.25 L12.75 11 H17.5" fill="none" stroke="#000" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#kd-health)"><path d="M4 16.25 A9.6 9.6 0 0 1 16.25 4 A9.6 9.6 0 0 1 4 16.25 Z" style="fill:var(--oi-green, #009E73)"/></g><path d="M2.5 11 H6.25 L7.75 7.75 L9.75 14 L11.5 9.25 L12.75 11 H17.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindFieldTable = glyph(
  '<defs><clipPath id="kd-table"><path d="M2.75 5.5 A2 2 0 0 1 4.75 3.5 L15.25 3.5 A2 2 0 0 1 17.25 5.5 L17.25 14.5 A2 2 0 0 1 15.25 16.5 L4.75 16.5 A2 2 0 0 1 2.75 14.5 Z"/></clipPath></defs><rect x="0" y="0" width="20" height="7.25" clip-path="url(#kd-table)" style="fill:var(--oi-blue, #0072B2)"/><path d="M2.75 10.5 H17.25 M2.75 13.5 H17.25 M7.75 7.25 V16.5" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><path d="M2.75 5.5 A2 2 0 0 1 4.75 3.5 L15.25 3.5 A2 2 0 0 1 17.25 5.5 L17.25 14.5 A2 2 0 0 1 15.25 16.5 L4.75 16.5 A2 2 0 0 1 2.75 14.5 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindZones = glyph(
  '<defs><clipPath id="kd-zones"><path d="M3.076 7.757 A1.4 1.4 0 0 1 3.594 6.525 L7.37 3.504 A1.4 1.4 0 0 1 8.752 3.292 L12.066 4.581 A1.4 1.4 0 0 0 12.948 4.625 L14.957 4.067 A1.4 1.4 0 0 1 16.72 5.601 L16.029 10.781 A1.4 1.4 0 0 0 16.039 11.217 L16.719 14.957 A1.4 1.4 0 0 1 15.435 16.604 L9.839 16.977 A1.4 1.4 0 0 1 9.188 16.864 L4.503 14.827 A1.4 1.4 0 0 1 3.668 13.683 Z"/></clipPath></defs><g clip-path="url(#kd-zones)"><defs><mask id="kd-zcut"><rect width="20" height="20" fill="#fff"/><path d="M0 9.5 C5 8 8 12 20 7.5 M0 14.5 C6 12.5 10 16 20 12" fill="none" stroke="#000" stroke-width="1.1"/></mask></defs><g mask="url(#kd-zcut)"><path d="M0 9.5 C5 8 8 12 20 7.5 L20 0 L0 0 Z" style="fill:var(--oi-green, #009E73)"/><path d="M0 9.5 C5 8 8 12 20 7.5 L20 12 C10 16 6 12.5 0 14.5 Z" style="fill:var(--oi-orange, #E69F00)"/><path d="M0 14.5 C6 12.5 10 16 20 12 L20 20 L0 20 Z" style="fill:var(--oi-vermillion, #D55E00)"/></g></g><path d="M3.076 7.757 A1.4 1.4 0 0 1 3.594 6.525 L7.37 3.504 A1.4 1.4 0 0 1 8.752 3.292 L12.066 4.581 A1.4 1.4 0 0 0 12.948 4.625 L14.957 4.067 A1.4 1.4 0 0 1 16.72 5.601 L16.029 10.781 A1.4 1.4 0 0 0 16.039 11.217 L16.719 14.957 A1.4 1.4 0 0 1 15.435 16.604 L9.839 16.977 A1.4 1.4 0 0 1 9.188 16.864 L4.503 14.827 A1.4 1.4 0 0 1 3.668 13.683 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindRadar = glyph(
  '<path d="M10 10 L10 3.5 A6.5 6.5 0 0 1 15.629 6.75 Z" style="fill:var(--oi-green, #009E73)"/><circle cx="10" cy="10" r="3.75" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="10" r="1.1" fill="currentColor"/><circle cx="6.25" cy="12.75" r="1.2" style="fill:var(--oi-green, #009E73)"/>'
)

export const KindOverlap = glyph(
  '<defs><clipPath id="kd-field"><path d="M2.887 5.167 A1.2 1.2 0 0 1 3.914 3.838 L10.536 2.919 A1.2 1.2 0 0 1 11.893 3.967 L12.613 10.083 A1.2 1.2 0 0 1 11.586 11.412 L4.964 12.331 A1.2 1.2 0 0 1 3.607 11.283 Z"/></clipPath></defs><path d="M9.5 8.25 C12 6.75 15.5 7 17 9.5 C18 11.5 17 13.5 17.25 15 C17.5 17 14.5 17.75 12.25 17 C10.25 16.5 8 17.25 7.25 15.25 C6.5 13.25 7.5 9.5 9.5 8.25 Z" style="fill:var(--oi-green, #009E73)"/><path d="M9.5 8.25 C12 6.75 15.5 7 17 9.5 C18 11.5 17 13.5 17.25 15 C17.5 17 14.5 17.75 12.25 17 C10.25 16.5 8 17.25 7.25 15.25 C6.5 13.25 7.5 9.5 9.5 8.25 Z" clip-path="url(#kd-field)" style="fill:var(--oi-vermillion, #D55E00)"/><path d="M2.887 5.167 A1.2 1.2 0 0 1 3.914 3.838 L10.536 2.919 A1.2 1.2 0 0 1 11.893 3.967 L12.613 10.083 A1.2 1.2 0 0 1 11.586 11.412 L4.964 12.331 A1.2 1.2 0 0 1 3.607 11.283 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindMajority = glyph(
  '<rect x="3.125" y="3.125" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><rect x="7.875" y="3.125" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><rect x="12.625" y="3.125" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-orange, #E69F00)"/><rect x="3.125" y="7.875" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><rect x="7.875" y="7.875" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><rect x="12.625" y="7.875" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><rect x="3.125" y="12.625" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-orange, #E69F00)"/><rect x="7.875" y="12.625" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><rect x="12.625" y="12.625" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><path d="M6.775 8.375 A1.6 1.6 0 0 1 8.375 6.775 L10.875 6.775 A1.6 1.6 0 0 1 12.475 8.375 L12.475 10.875 A1.6 1.6 0 0 1 10.875 12.475 L8.375 12.475 A1.6 1.6 0 0 1 6.775 10.875 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindSieve = glyph(
  '<defs><clipPath id="kd-bowl"><path d="M3 7.5 H15 C15 11.5 12.5 13.75 9 13.75 C5.5 13.75 3 11.5 3 7.5 Z"/></clipPath></defs><path d="M5.5 7 V14.5 M7.5 7 V14.5 M9.5 7 V14.5 M11.5 7 V14.5 M13.5 7 V14.5 M2 10.25 H16 M2 12.25 H16" clip-path="url(#kd-bowl)" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><path d="M3 7.5 H15 C15 11.5 12.5 13.75 9 13.75 C5.5 13.75 3 11.5 3 7.5 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7.5 L17.75 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="9" cy="5.6" rx="3.4" ry="2.1" style="fill:var(--oi-green, #009E73)"/><circle cx="7" cy="16.25" r="1.1" style="fill:var(--oi-orange, #E69F00)"/><circle cx="10.75" cy="17.5" r="0.9" style="fill:var(--oi-orange, #E69F00)"/>'
)

export const KindMorphology = glyph(
  '<g style="fill:var(--oi-green, #009E73)"><circle cx="7.25" cy="7.5" r="3.0"/><circle cx="12.5" cy="8.25" r="2.8"/><circle cx="9.75" cy="12.5" r="3.1"/></g><path d="M2.95 7.5 L2.96 7.2 L2.992 6.902 L3.044 6.606 L3.117 6.315 L3.209 6.029 L3.322 5.751 L3.453 5.481 L3.603 5.221 L3.771 4.973 L3.956 4.736 L4.157 4.513 L4.373 4.304 L4.603 4.112 L4.845 3.935 L5.1 3.776 L5.365 3.635 L5.639 3.513 L5.921 3.41 L6.21 3.328 L6.503 3.265 L6.801 3.224 L7.1 3.203 L7.4 3.203 L7.699 3.224 L7.997 3.265 L13.212 4.212 L13.492 4.272 L13.767 4.351 L14.036 4.449 L14.297 4.565 L14.55 4.699 L14.793 4.851 L15.024 5.019 L15.243 5.203 L15.449 5.402 L15.641 5.615 L15.817 5.84 L15.977 6.077 L16.12 6.325 L16.246 6.582 L16.353 6.848 L16.441 7.12 L16.51 7.398 L16.56 7.679 L16.59 7.964 L16.6 8.25 L16.59 8.536 L16.56 8.821 L16.51 9.102 L16.441 9.38 L16.353 9.652 L16.246 9.918 L16.12 10.175 L13.635 14.566 L13.481 14.832 L13.31 15.086 L13.121 15.328 L12.915 15.556 L12.694 15.77 L12.459 15.967 L12.21 16.148 L11.95 16.311 L11.679 16.455 L11.398 16.58 L11.11 16.685 L10.814 16.769 L10.514 16.833 L10.21 16.876 L9.904 16.897 L9.596 16.897 L9.29 16.876 L8.986 16.833 L8.686 16.769 L8.39 16.685 L8.102 16.58 L7.821 16.455 L7.55 16.311 L7.29 16.148 L7.041 15.967 L6.806 15.77 L6.585 15.556 L6.379 15.328 L6.19 15.086 L6.019 14.832 L5.865 14.566 L5.73 14.29 L3.322 9.249 L3.209 8.971 L3.117 8.685 L3.044 8.394 L2.992 8.098 L2.96 7.8 Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.3 1.2" stroke-linejoin="round"/>'
)

export const KindFieldFilter = glyph(
  '<path d="M4.715 9.917 A0.8 0.8 0 0 1 5.225 8.5 L14.775 8.5 A0.8 0.8 0 0 1 15.285 9.917 L11.54 13.01 A0.8 0.8 0 0 0 11.25 13.627 L11.25 16.45 A0.8 0.8 0 0 1 10.45 17.25 L9.55 17.25 A0.8 0.8 0 0 1 8.75 16.45 L8.75 13.627 A0.8 0.8 0 0 0 8.46 13.01 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.866 4.105 A0.7 0.7 0 0 1 6.423 3.135 L11.071 2.554 A0.7 0.7 0 0 1 11.74 2.86 L13.333 5.249 A0.7 0.7 0 0 1 12.8 6.336 L7.497 6.715 A0.7 0.7 0 0 1 6.804 6.292 Z" style="fill:var(--oi-green, #009E73)"/>'
)

export const KindSelect = glyph(
  '<rect x="2.75" y="2.25" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-orange, #E69F00)"/><path d="M9 4.0 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="3.25" y="7.75" width="2.5" height="2.5" rx="0.6" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><path d="M9 9.0 H17.25" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><rect x="2.75" y="12.25" width="3.5" height="3.5" rx="0.8" style="fill:var(--oi-green, #009E73)"/><path d="M9 14.0 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindViewer = glyph(
  '<path d="M2.25 10 C4.5 5.75 7 4.5 10 4.5 C13 4.5 15.5 5.75 17.75 10 C15.5 14.25 13 15.5 10 15.5 C7 15.5 4.5 14.25 2.25 10 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><defs><mask id="kd-eye"><rect width="20" height="20" fill="#fff"/><circle cx="10" cy="10" r="1.2" fill="#000"/></mask></defs><g mask="url(#kd-eye)"><circle cx="10" cy="10" r="3.1" style="fill:var(--oi-blue, #0072B2)"/></g>'
)

export const KindGlobe = glyph(
  '<path d="M3.25 10 H16.75" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><ellipse cx="10" cy="10" rx="3.1" ry="6.95" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><path d="M10.652 5.784 A0.7 0.7 0 0 1 11.516 5.192 L14.102 5.838 A0.7 0.7 0 0 1 14.619 6.654 L14.137 9.064 A0.7 0.7 0 0 1 13.314 9.613 L10.888 9.128 A0.7 0.7 0 0 1 10.331 8.354 Z" style="fill:var(--oi-orange, #E69F00)"/><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const KindAdoptFields = glyph(
  '<defs><mask id="kd-make"><rect width="20" height="20" fill="#fff"/><circle cx="14.75" cy="14.75" r="4.6" fill="#000"/></mask></defs><g mask="url(#kd-make)"><path d="M2.856 7.1 A1.5 1.5 0 0 1 3.769 5.573 L9.547 3.15 A1.5 1.5 0 0 1 11.213 3.499 L14.724 7.185 A1.5 1.5 0 0 1 14.935 8.973 L11.576 14.758 A1.5 1.5 0 0 1 9.892 15.455 L4.506 14.018 A1.5 1.5 0 0 1 3.4 12.713 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g><defs><mask id="kd-badge-plus"><rect width="20" height="20" fill="#fff"/><path d="M14.75 13.05 V16.45 M13.05 14.75 H16.45" stroke="#000" stroke-width="1.3" stroke-linecap="round"/></mask></defs><g mask="url(#kd-badge-plus)"><circle cx="14.75" cy="14.75" r="3.5" style="fill:var(--oi-green, #009E73)"/></g>'
)

export const KindSaveFields = glyph(
  '<defs><mask id="kd-savef"><rect width="20" height="20" fill="#fff"/><circle cx="14.75" cy="14.75" r="4.6" fill="#000"/></mask></defs><g mask="url(#kd-savef)"><path d="M5 2.75 H11.5 L15.5 6.75 V15.25 Q15.5 17.25 13.5 17.25 H5 Q3 17.25 3 15.25 V4.75 Q3 2.75 5 2.75 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.25 2.75 V5.25 Q11.25 7 13 7 H15.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.542 10.165 A0.9 0.9 0 0 1 6.124 9.266 L8.902 8.224 A0.9 0.9 0 0 1 9.909 8.491 L11.493 10.392 A0.9 0.9 0 0 1 11.461 11.58 L9.144 14.075 A0.9 0.9 0 0 1 8.2 14.317 L6.326 13.692 A0.9 0.9 0 0 1 5.712 12.894 Z" style="fill:var(--oi-green, #009E73)"/></g><defs><mask id="kd-badge-kd-savef"><rect width="20" height="20" fill="#fff"/><path d="M14.75 12.95 V16.15 M13.25 14.65 L14.75 16.25 L16.25 14.65" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#kd-badge-kd-savef)"><circle cx="14.75" cy="14.75" r="3.5" fill="currentColor"/></g>'
)

export const KindPdfReport = glyph(
  '<path d="M5 2.75 H11.5 L15.5 6.75 V15.25 Q15.5 17.25 13.5 17.25 H5 Q3 17.25 3 15.25 V4.75 Q3 2.75 5 2.75 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.25 2.75 V5.25 Q11.25 7 13 7 H15.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="5.25" y="8.5" width="8" height="2.25" rx="0.6" style="fill:var(--oi-vermillion, #D55E00)"/><path d="M5.75 13.25 H12.75 M5.75 15.25 H10.5" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/><path d="M5.75 5.25 H9" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/>'
)

export const KindMineralSave = glyph(
  '<defs><mask id="kd-savem"><rect width="20" height="20" fill="#fff"/><circle cx="14.75" cy="14.75" r="4.6" fill="#000"/></mask></defs><g mask="url(#kd-savem)"><path d="M5 2.75 H11.5 L15.5 6.75 V15.25 Q15.5 17.25 13.5 17.25 H5 Q3 17.25 3 15.25 V4.75 Q3 2.75 5 2.75 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.25 2.75 V5.25 Q11.25 7 13 7 H15.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><defs><clipPath id="kd-cry"><path d="M7.88 7.907 A0.5 0.5 0 0 1 8.62 7.907 L10.42 9.887 A0.5 0.5 0 0 1 10.55 10.223 L10.55 13.88 A0.5 0.5 0 0 1 10.337 14.289 L8.537 15.549 A0.5 0.5 0 0 1 7.963 15.549 L6.163 14.289 A0.5 0.5 0 0 1 5.95 13.88 L5.95 10.223 A0.5 0.5 0 0 1 6.08 9.887 Z"/></clipPath></defs><g clip-path="url(#kd-cry)"><rect x="0" y="0" width="8.25" height="20" style="fill:var(--oi-sky, #56B4E9)"/><rect x="8.25" y="0" width="12" height="20" style="fill:var(--oi-blue, #0072B2)"/></g></g><defs><mask id="kd-badge-kd-savem"><rect width="20" height="20" fill="#fff"/><path d="M14.75 12.95 V16.15 M13.25 14.65 L14.75 16.25 L16.25 14.65" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#kd-badge-kd-savem)"><circle cx="14.75" cy="14.75" r="3.5" fill="currentColor"/></g>'
)

/**
 * Every node kind, on its category's ring. Change and Mask are drawn as their
 * word is elsewhere; Run and Mix, categories of one node, as their category.
 */
export const KIND_ICONS: Record<NodeKind, Icon> = {
  areas: KindAreas,
  seasonDates: KindSeasonDates,
  health: KindHealth,
  fieldTable: KindFieldTable,
  zones: KindZones,
  radar: KindRadar,
  overlap: KindOverlap,
  majority: KindMajority,
  sieve: KindSieve,
  morphology: KindMorphology,
  fieldFilter: KindFieldFilter,
  select: KindSelect,
  viewer: KindViewer,
  globe: KindGlobe,
  adoptFields: KindAdoptFields,
  saveFields: KindSaveFields,
  pdfReport: KindPdfReport,
  mineralSave: KindMineralSave,
  run: CategoryRun,
  mask: CategoryMask,
  mix: CategoryMix,
  change: ViewChange,
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

export const ReadingShift = glyph(
  '<path d="M2.75 14.781 L2.953 14.494 L3.156 14.162 L3.359 13.782 L3.562 13.353 L3.766 12.878 L3.969 12.359 L4.172 11.802 L4.375 11.214 L4.578 10.607 L4.781 9.992 L4.984 9.382 L5.188 8.794 L5.391 8.242 L5.594 7.743 L5.797 7.312 L6 6.962 L6.203 6.705 L6.406 6.549 L6.609 6.5 L6.812 6.559 L7.016 6.725 L7.219 6.991 L7.422 7.348 L7.625 7.787 L7.828 8.291 L8.031 8.847 L8.234 9.438 L8.438 10.048 L8.641 10.664 L8.844 11.27 L9.047 11.854 L9.25 12.408 L9.453 12.923 L9.656 13.395 L9.859 13.819 L10.062 14.195 L10.266 14.523 L10.469 14.805 L10.672 15.044 L10.875 15.244 L11.078 15.409 L11.281 15.543 L11.484 15.651 L11.688 15.736 L11.891 15.803 L12.094 15.855 L12.297 15.894 L12.5 15.923" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--oi-blue, #0072B2)"/><path d="M7.5 15.923 L7.703 15.894 L7.906 15.855 L8.109 15.803 L8.312 15.736 L8.516 15.651 L8.719 15.543 L8.922 15.409 L9.125 15.244 L9.328 15.044 L9.531 14.805 L9.734 14.523 L9.938 14.195 L10.141 13.819 L10.344 13.395 L10.547 12.923 L10.75 12.408 L10.953 11.854 L11.156 11.27 L11.359 10.664 L11.562 10.048 L11.766 9.438 L11.969 8.847 L12.172 8.291 L12.375 7.787 L12.578 7.348 L12.781 6.991 L12.984 6.725 L13.188 6.559 L13.391 6.5 L13.594 6.549 L13.797 6.705 L14 6.962 L14.203 7.312 L14.406 7.743 L14.609 8.242 L14.812 8.794 L15.016 9.382 L15.219 9.992 L15.422 10.607 L15.625 11.214 L15.828 11.802 L16.031 12.359 L16.234 12.878 L16.438 13.353 L16.641 13.782 L16.844 14.162 L17.047 14.494 L17.25 14.781" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--oi-orange, #E69F00)"/><path d="M2.75 16.75 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 3.25 H12.25 M10.75 1.75 L12.25 3.25 L10.75 4.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const ReadingCohort = glyph(
  '<path d="M2.75 2.75 V17.25 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5.75" cy="5.25" r="2" style="fill:var(--oi-blue, #0072B2)"/><circle cx="8.25" cy="7.0" r="1.6" style="fill:var(--oi-orange, #E69F00)"/><circle cx="10.75" cy="10.25" r="1.6" style="fill:var(--oi-orange, #E69F00)"/><circle cx="13.75" cy="9.25" r="1.6" style="fill:var(--oi-orange, #E69F00)"/><circle cx="15.0" cy="13.25" r="1.6" style="fill:var(--oi-orange, #E69F00)"/>'
)

export const ReadingSpectra = glyph(
  '<path d="M2.75 2.75 V17.25 H17.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.79 L7.938 10.556 L10.875 9.322 L13.812 8.089 L16.75 6.855" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--oi-orange, #E69F00)"/><path d="M5 13.335 L7.938 13.834 L10.875 14.334 L13.812 14.833 L16.75 15.332" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--oi-blue, #0072B2)"/><path d="M5 12.919 L5.245 12.741 L5.49 12.556 L5.734 12.411 L5.979 12.349 L6.224 12.392 L6.469 12.524 L6.714 12.704 L6.958 12.882 L7.203 13.023 L7.448 13.114 L7.693 13.157 L7.938 13.159 L8.182 13.127 L8.427 13.056 L8.672 12.933 L8.917 12.734 L9.161 12.419 L9.406 11.942 L9.651 11.258 L9.896 10.35 L10.141 9.265 L10.385 8.114 L10.63 7.043 L10.875 6.159 L11.12 5.498 L11.365 5.04 L11.609 4.74 L11.854 4.55 L12.099 4.432 L12.344 4.359 L12.589 4.316 L12.833 4.289 L13.078 4.274 L13.323 4.264 L13.568 4.258 L13.812 4.255 L14.057 4.253 L14.302 4.252 L14.547 4.251 L14.792 4.251 L15.036 4.25 L15.281 4.25 L15.526 4.25 L15.771 4.25 L16.016 4.25 L16.26 4.25 L16.505 4.25 L16.75 4.25" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--oi-green, #009E73)"/>'
)

export const ReadingSeparability = glyph(
  '<circle cx="5.25" cy="10.3" r="1.85" style="fill:var(--oi-orange, #E69F00)"/><circle cx="7.155" cy="13.6" r="1.85" style="fill:var(--oi-orange, #E69F00)"/><circle cx="3.345" cy="13.6" r="1.85" style="fill:var(--oi-orange, #E69F00)"/><circle cx="14.75" cy="5.3" r="1.85" style="fill:var(--oi-sky, #56B4E9)"/><circle cx="16.655" cy="8.6" r="1.85" style="fill:var(--oi-sky, #56B4E9)"/><circle cx="12.845" cy="8.6" r="1.85" style="fill:var(--oi-sky, #56B4E9)"/><path d="M5.25 3.5 L14.75 16.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2.6"/>'
)

/**
 * Every reading on the compare board's pie. Differences, Library and Tables
 * are drawn as their word is elsewhere.
 */
export const READING_ICONS: Record<ReadingKind, Icon> = {
  differences: ViewChange,
  shift: ReadingShift,
  cohort: ReadingCohort,
  spectra: ReadingSpectra,
  separability: ReadingSeparability,
  library: MineralReferences,
  tables: KindFieldTable,
}
