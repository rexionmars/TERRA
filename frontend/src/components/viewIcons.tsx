/*
  The icons of the composition panel's choices: the kinds of view and the scene
  they are drawn from.

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
