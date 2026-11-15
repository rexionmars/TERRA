/*
  The thin-line icons of the map's tool rail, the application menu, the
  navigation rail on the window's left edge, the eight products (Product*),
  which the call site tints with the product's colour, and Settings' Appearance
  and the Workflows menu's Manage, which shared one glyph before.

  This file is their source. They keep Breeze's grammar, so they sit with the
  Breeze glyphs of icons.tsx: a 16-unit grid, the drawing inside 2..14 (1..15
  where it must), one-unit lines on half units so they fall on whole pixels at
  1x, monochrome in currentColor; round caps and joins, which change nothing at
  1x and soften corners at 2x. Each draws what its label means, and was kept only
  when it read as that at 16 px with no label beside it:

    Products              the catalogue of products the panel lists
    Compositions          three channels laid together: the RGB discs, in line
    Result                a run's result read in numbers: a page with its bars
    Points                a point on the map: the pin
    Layers                three layers stacked
    Search for a place    the lens
    Base: photograph      the globe the photograph is of
    Base: streets         a road, its centre line dashed
    Base: topographic     contour lines round a summit off centre
    Imagery               a satellite, sending down
    Relief                mountains
    Draw an area          an outline dashed as it is drawn, the pencil at its last vertex
    Edit the area         the outline with a handle on each vertex
    Import an area        an arrow entering a page
    Move the stack apart  two layers and the arrow between them
    Curtain               one frame, the handle dividing it
    Delete the area       a bin
    Open project file     an open folder
    Save project file     the disk
    Save project file as  the disk, and a pencil to name it
    Reveal project file   a folder, looked into
    Search operators      the lens over a list of commands
    Settings              a gear
    Keymap                a keyboard
    Start screen          a house
    Python environment    a terminal and its prompt
    Storage               a store of data: the cylinder
    What's new            sparkles
    Splash screen         a window with TERRA's triangular mark
    About TERRA           the information sign
    Explore               a compass, its needle's north half filled
    Analyses              where the analyses are kept: a folder with a chart
    Compare               two results side by side, the arrow between them
    Workflows             the editor's own picture: one node feeding two
    Models                the package a model is installed from: a cube
    Activity              the bell
    Feedback              a speech bubble with its lines
    Help                  a question mark in a ring
    User guide            the guide, open
    Hide the labels       the rail's column, the arrow going in
    Show the labels       the rail's column, the arrow coming out
    Classification        pixels, a gap between each, in three classes in patches
    Surface water         three waves
    Mineral map           a crystal and the ridge between its faces
    Field boundaries      neighbouring fields sharing their boundaries
    Vegetation health     a leaf, and a pulse across it
    Overlap               a field over a protected area's dashed boundary, the overlap filled
    Sentinel-1 radar      a radar screen, its sweep and what it found
    Management zones      one field in zones on the diagonal, in tones low to high
    Appearance            light and dark: the disc half filled
    Manage workflows      the saved workflows listed, each row marked with a node

  Drawn again after failing that test: the satellite turned on its diagonal
  (a chain), the area's solid outline with the pencil (a price tag), round
  concentric contours (a target), a neural network for the models (a blur),
  scattered pixels for a classification (a keypad), a square over a round blob
  for an overlap (the "shapes" icon), level bands for zones (a barrel), and a
  link of two nodes on each row of the workflows list (a row of spectacles).
*/
import type { Icon } from "@/components/icons"

/*
  The body is set as markup, as in icons.tsx: it is this file's own constant,
  and as a string each glyph costs its path data and nothing else.
*/
function glyph(body: string): Icon {
  return function LineIcon(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        width="1em"
        height="1em"
        fill="none"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    )
  }
}

export const LineProducts = glyph(
  '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="9" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineCompositions = glyph(
  '<circle cx="8" cy="6.1" r="3.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.05" cy="9.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.95" cy="9.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineResult = glyph(
  '<path d="M9.5 1.5 H4.5 Q3.5 1.5 3.5 2.5 V13.5 Q3.5 14.5 4.5 14.5 H11.5 Q12.5 14.5 12.5 13.5 V4.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 1.5 V3.5 Q9.5 4.5 10.5 4.5 H12.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="5.5" y="9.5" width="1.5" height="3.0" fill="currentColor"/><rect x="7.75" y="7.0" width="1.5" height="5.5" fill="currentColor"/><rect x="10" y="8.5" width="1.5" height="4.0" fill="currentColor"/>'
)

export const LinePoints = glyph(
  '<path d="M8 14.5 L4.357 8.439 A4.25 4.25 0 1 1 11.643 8.439 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="6.25" r="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineLayers = glyph(
  '<path d="M8 2.5 L13.5 5.5 L8 8.5 L2.5 5.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 8.5 L8 11.5 L13.5 8.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11.5 L8 14.5 L13.5 11.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSearch = glyph(
  '<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.182 10.182 L13.782 13.782" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineBasePhoto = glyph(
  '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="8" cy="8" rx="2.6" ry="6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 8 H14 M3.1 5 H12.9 M3.1 11 H12.9" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineBaseStreets = glyph(
  '<path d="M2.5 14.5 L6.5 1.5 M13.5 14.5 L9.5 1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 13.5 V2.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.4"/>'
)

export const LineBaseTopo = glyph(
  '<path d="M1.5 10.5 C1.5 6.5 3.5 3 7.5 2.5 C10 2.25 11.5 4 13.5 4.25 C15 4.5 14.75 8 13.25 10 C11.75 12.25 12.5 14 9 14 C6 14 1.5 13.5 1.5 10.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 9.25 C4.5 7 6 5.5 8.25 5.25 C10 5 11.75 6 11.25 7.75 C10.75 9.25 10.25 11.25 8 11.5 C6.25 11.75 4.5 11 4.5 9.25 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 8.5 C7 7.75 7.75 7.25 8.5 7.25 C9.25 7.25 9.5 8 9.25 8.5 C9 9.25 8.25 9.5 7.75 9.25 C7.25 9 7 9 7 8.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineImagery = glyph(
  '<rect x="1.5" y="4.5" width="4" height="2.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="10.5" y="4.5" width="4" height="2.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 4.5 V7 M12.5 4.5 V7 M5.5 5.75 H6.5 M9.5 5.75 H10.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="6.5" y="2.5" width="3" height="6" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.75 11.25 Q8 13 10.25 11.25 M4 13.25 Q8 16 12 13.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineRelief = glyph(
  '<path d="M1.5 13.5 L6 5 L9 10 L11 7.5 L14.5 13.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 7.6 L6 8.6 L7.2 7.3" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineDrawArea = glyph(
  '<path d="M9.0 13.0 L2.5 10.5 L4.0 3.5 L11.5 2.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.3" stroke-linecap="round"/><circle cx="2.5" cy="10.5" r="1" fill="currentColor"/><circle cx="4.0" cy="3.5" r="1" fill="currentColor"/><circle cx="11.5" cy="2.5" r="1" fill="currentColor"/><path d="M9.886 10.525 L13.988 6.424 L15.826 8.262 L11.725 12.364 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.886 10.525 L9.25 13 L11.725 12.364" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.856 7.555 L14.695 9.394" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineEditArea = glyph(
  '<defs><mask id="ln-edit"><rect width="16" height="16" fill="#fff"/><rect x="1.9" y="3.4" width="3.2" height="3.2" fill="#000"/><rect x="8.9" y="1.15" width="3.2" height="3.2" fill="#000"/><rect x="11.4" y="8.4" width="3.2" height="3.2" fill="#000"/><rect x="4.15" y="11.4" width="3.2" height="3.2" fill="#000"/></mask></defs><g mask="url(#ln-edit)"><path d="M3.5 5 L10.5 2.75 L13 10 L5.75 13 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><rect x="2.5" y="4" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="9.5" y="1.75" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="12" y="9" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.75" y="12" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineImportArea = glyph(
  '<defs><mask id="ln-imp"><rect width="16" height="16" fill="#fff"/><rect x="0" y="6" width="9.8" height="7" fill="#000"/></mask></defs><g mask="url(#ln-imp)"><path d="M10.5 1.5 H6 Q5 1.5 5 2.5 V13.5 Q5 14.5 6 14.5 H12.5 Q13.5 14.5 13.5 13.5 V4.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 1.5 V3.5 Q10.5 4.5 11.5 4.5 H13.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><path d="M1.5 9.5 H8.5 M6 7 L8.5 9.5 L6 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSpread = glyph(
  '<path d="M7 1.5 L11.5 3.75 L7 6 L2.5 3.75 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10 L11.5 12.25 L7 14.5 L2.5 12.25 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 4.5 V11.5 M12.5 6 L14 4.5 L15.5 6 M12.5 10 L14 11.5 L15.5 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineCurtain = glyph(
  '<rect x="2.5" y="3.5" width="11.0" height="9.0" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 1.5 V14.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="currentColor"/>'
)

export const LineDelete = glyph(
  '<path d="M2.5 4.5 H13.5 M6.25 4.5 V2.5 H9.75 V4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4.5 L4.75 13.5 Q4.85 14.5 5.85 14.5 H10.15 Q11.15 14.5 11.25 13.5 L12 4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.75 7 V12 M9.25 7 V12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineFolderOpen = glyph(
  '<path d="M2.5 12.5 V3.5 Q2.5 2.5 3.5 2.5 H5.75 L7.25 4 H11.5 Q12.5 4 12.5 5 V6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 12.5 L4.5 7.5 Q4.75 6.5 5.75 6.5 H14 Q15 6.5 14.6 7.5 L12.5 12.5 Q12.25 13.5 11.25 13.5 H3.5 Q2.5 13.5 2.5 12.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSave = glyph(
  '<path d="M2.5 3.5 Q2.5 2.5 3.5 2.5 H11 L13.5 5 V12.5 Q13.5 13.5 12.5 13.5 H3.5 Q2.5 13.5 2.5 12.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 2.5 V5.5 H10 V2.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.5" y="8.5" width="7" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSaveAs = glyph(
  '<defs><mask id="ln-saveas"><rect width="16" height="16" fill="#fff"/><path d="M7.6 14.6 L15.6 6.6" stroke="#000" stroke-width="5.4" stroke-linecap="round"/></mask></defs><g mask="url(#ln-saveas)"><path d="M2.5 3.5 Q2.5 2.5 3.5 2.5 H11 L13.5 5 V12.5 Q13.5 13.5 12.5 13.5 H3.5 Q2.5 13.5 2.5 12.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 2.5 V5.5 H10 V2.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.5" y="8.5" width="7" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><path d="M9.028 11.917 L13.129 7.815 L14.685 9.371 L10.583 13.472 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.028 11.917 L8.25 14.25 L10.583 13.472" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.998 8.947 L13.553 10.502" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineReveal = glyph(
  '<defs><mask id="ln-reveal"><rect width="16" height="16" fill="#fff"/><circle cx="11" cy="11" r="4.4" fill="#000"/></mask></defs><g mask="url(#ln-reveal)"><path d="M1.5 12.5 V3.5 Q1.5 2.5 2.5 2.5 H5 L6.5 4 H12.5 Q13.5 4 13.5 5 V7" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 12.5 H8" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><circle cx="10.5" cy="10.5" r="2.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.445 12.445 L14.845 14.845" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSearchOperators = glyph(
  '<path d="M1.5 3.5 H7 M1.5 6.5 H4.5 M1.5 9.5 H4.5 M1.5 12.5 H6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="7.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.975 9.975 L15.175 13.175" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSettings = glyph(
  '<path d="M12.663 7.094 L14.203 7.238 L14.203 8.762 L12.663 8.906 L11.938 10.656 L12.925 11.848 L11.848 12.925 L10.656 11.938 L8.906 12.663 L8.762 14.203 L7.238 14.203 L7.094 12.663 L5.344 11.938 L4.152 12.925 L3.075 11.848 L4.062 10.656 L3.337 8.906 L1.797 8.762 L1.797 7.238 L3.337 7.094 L4.062 5.344 L3.075 4.152 L4.152 3.075 L5.344 4.062 L7.094 3.337 L7.238 1.797 L8.762 1.797 L8.906 3.337 L10.656 4.062 L11.848 3.075 L12.925 4.152 L11.938 5.344 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineKeymap = glyph(
  '<rect x="1.5" y="4.5" width="13.0" height="8.0" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="3.75" y="6.25" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="6.25" y="6.25" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="8.75" y="6.25" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="11.25" y="6.25" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="3.75" y="8.5" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="6.25" y="8.5" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="8.75" y="8.5" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><rect x="11.25" y="8.5" width="1.5" height="1.5" rx="0.3" fill="currentColor"/><path d="M5.5 10.75 H10.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineHome = glyph(
  '<path d="M1.5 8 L8 2.5 L14.5 8" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 6.5 V13.5 H12.5 V6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 13.5 V9.5 H9.5 V13.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LinePython = glyph(
  '<rect x="1.5" y="2.5" width="13.0" height="11.0" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 5 H14.5 M4 7.5 L6 9.25 L4 11 M7.5 11 H11" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineStorage = glyph(
  '<ellipse cx="8" cy="4" rx="5.5" ry="1.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 4 V12 C2.5 13 5 13.75 8 13.75 C11 13.75 13.5 13 13.5 12 V4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 8 C2.5 9 5 9.75 8 9.75 C11 9.75 13.5 9 13.5 8" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineWhatsNew = glyph(
  '<path d="M6.5 4 Q6.5 9 11.5 9 Q6.5 9 6.5 14 Q6.5 9 1.5 9 Q6.5 9 6.5 4 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.25 1.35 Q12.25 3.75 14.65 3.75 Q12.25 3.75 12.25 6.15 Q12.25 3.75 9.85 3.75 Q12.25 3.75 12.25 1.35 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineSplash = glyph(
  '<rect x="1.5" y="2.5" width="13.0" height="11.0" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5 L11 10.75 H5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineAbout = glyph(
  '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="5" r="0.85" fill="currentColor"/><path d="M8 7.5 V11.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineExplore = glyph(
  '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.9 5.1 L8.85 8.85 L7.15 7.15 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M5.1 10.9 L7.15 7.15 L8.85 8.85 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineAnalyses = glyph(
  '<path d="M1.5 12.5 V3.5 Q1.5 2.5 2.5 2.5 H5.75 L7.25 4 H13.5 Q14.5 4 14.5 5 V12.5 Q14.5 13.5 13.5 13.5 H2.5 Q1.5 13.5 1.5 12.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 11 L6.5 8.25 L8.75 9.75 L12 6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineCompare = glyph(
  '<rect x="1.5" y="5.5" width="5.5" height="9.0" rx="1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="9" y="5.5" width="5.5" height="9.0" rx="1" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 2.75 H12.5 M5 1.25 L3.5 2.75 L5 4.25 M11 1.25 L12.5 2.75 L11 4.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineWorkflows = glyph(
  '<rect x="1.5" y="6.5" width="4.0" height="3.0" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="10.5" y="2.5" width="4.0" height="3.0" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="10.5" y="10.5" width="4.0" height="3.0" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 8 C8 8 8 4 10.5 4 M5.5 8 C8 8 8 12 10.5 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineModels = glyph(
  '<path d="M8 1.75 L13.75 5 V11 L8 14.25 L2.25 11 V5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.25 5 L8 8.25 L13.75 5 M8 8.25 V14.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineActivity = glyph(
  '<path d="M4 11.5 V7.5 C4 5.1 5.8 3.25 8 3.25 C10.2 3.25 12 5.1 12 7.5 V11.5 L13.5 12.5 H2.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 1.75 V3.25 M6.5 14.25 Q8 15.25 9.5 14.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineFeedback = glyph(
  '<path d="M3 2.5 H13 Q14.5 2.5 14.5 4 V9.5 Q14.5 11 13 11 H7.25 L4 13.75 V11 H3 Q1.5 11 1.5 9.5 V4 Q1.5 2.5 3 2.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 5.5 H11.5 M4.5 8 H9" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineHelp = glyph(
  '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 6.25 C6 4.9 7 4.25 8 4.25 C9.1 4.25 10 5 10 6.1 C10 7.6 8 7.75 8 9.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="11.5" r="0.85" fill="currentColor"/>'
)

export const LineGuide = glyph(
  '<path d="M8 4.5 C6.5 3.25 4 3 1.5 3.25 V13 C4 12.75 6.5 13 8 14.25 C9.5 13 12 12.75 14.5 13 V3.25 C12 3 9.5 3.25 8 4.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 4.5 V14.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineLabelsHide = glyph(
  '<rect x="1.5" y="2.5" width="13.0" height="11.0" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 2.5 V13.5 M11 5.5 L8.5 8 L11 10.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineLabelsShow = glyph(
  '<rect x="1.5" y="2.5" width="13.0" height="11.0" rx="1.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 2.5 V13.5 M9 5.5 L11.5 8 L9 10.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineProductClass = glyph(
  '<rect x="2.15" y="2.15" width="3.6" height="3.6" rx="0.6" fill="currentColor"/><rect x="6.65" y="2.15" width="3.6" height="3.6" rx="0.6" fill="currentColor"/><rect x="11.15" y="2.15" width="3.6" height="3.6" rx="0.6" fill="currentColor" fill-opacity="0.45"/><rect x="2.15" y="6.65" width="3.6" height="3.6" rx="0.6" fill="currentColor"/><rect x="6.65" y="6.65" width="3.6" height="3.6" rx="0.6" fill="currentColor" fill-opacity="0.45"/><rect x="11.15" y="6.65" width="3.6" height="3.6" rx="0.6" fill="currentColor" fill-opacity="0.45"/><rect x="2.65" y="11.65" width="2.60" height="2.60" rx="0.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.6"/><rect x="7.15" y="11.65" width="2.60" height="2.60" rx="0.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.6"/><rect x="11.15" y="11.15" width="3.6" height="3.6" rx="0.6" fill="currentColor" fill-opacity="0.45"/>'
)

export const LineProductWater = glyph(
  '<path d="M1.5 4.5 Q3.125 2.9 4.75 4.5 T8 4.5 T11.25 4.5 T14.5 4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 8.5 Q3.125 6.9 4.75 8.5 T8 8.5 T11.25 8.5 T14.5 8.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 12.5 Q3.125 10.9 4.75 12.5 T8 12.5 T11.25 12.5 T14.5 12.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineProductMineral = glyph(
  '<path d="M8 1.5 L12 4.25 L12 11.25 L8 14.5 L4 11.25 L4 4.25 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 1.5 V14.5 M4 4.25 L8 6 L12 4.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineProductFields = glyph(
  '<path d="M2 4 L8 2.5 L9 8.5 L2.5 10 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 2.5 L14 4.5 L13.5 9.5 L9 8.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 10 L3.5 14 L12.5 13.5 L13.5 9.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineProductHealth = glyph(
  '<defs><mask id="pr-health"><rect width="16" height="16" fill="#fff"/><path d="M1.5 9 H5 L6.5 6 L8.5 12 L10 7.5 L11 9 H14.5" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#pr-health)"><path d="M2.5 13.5 A8.6 8.6 0 0 1 13.5 2.5 A8.6 8.6 0 0 1 2.5 13.5 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><path d="M1.5 9 H5 L6.5 6 L8.5 12 L10 7.5 L11 9 H14.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineProductOverlap = glyph(
  '<defs><clipPath id="pr-field"><path d="M1.5 4 L9.5 2 L11 9.5 L2.5 11 Z"/></clipPath></defs><path d="M6.5 8 C8 6.25 10.5 6.75 12 6.25 C14 5.75 14.75 8 14.5 10 C14.25 12 15 13.75 12.75 14.5 C10.75 15 9.25 13.75 7.5 14 C5.5 14.25 5 12.5 5.25 10.75 C5.5 9.5 5.75 8.75 6.5 8 Z" clip-path="url(#pr-field)" fill="currentColor" fill-opacity="0.55"/><path d="M6.5 8 C8 6.25 10.5 6.75 12 6.25 C14 5.75 14.75 8 14.5 10 C14.25 12 15 13.75 12.75 14.5 C10.75 15 9.25 13.75 7.5 14 C5.5 14.25 5 12.5 5.25 10.75 C5.5 9.5 5.75 8.75 6.5 8 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.4 1.2"/><path d="M1.5 4 L9.5 2 L11 9.5 L2.5 11 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineProductRadar = glyph(
  '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="3.25" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.6"/><path d="M8 8 L12.18 3.02" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="0.9" fill="currentColor"/><circle cx="5" cy="10.5" r="1.1" fill="currentColor"/>'
)

export const LineProductZones = glyph(
  '<defs><clipPath id="pr-zones"><path d="M2 6 L6 2 L11 3.25 L14.5 2 L13.5 9 L14.25 14 L8 14.5 L2.5 13 Z"/></clipPath></defs><g clip-path="url(#pr-zones)"><path d="M0 10.5 C4 8 7 9 16 2.5 L16 0 L0 0 Z" fill="currentColor" fill-opacity="0.55"/><path d="M0 10.5 C4 8 7 9 16 2.5 L16 7.5 C9 13.5 5 12.5 0 15 Z" fill="currentColor" fill-opacity="0.22"/><path d="M0 10.5 C4 8 7 9 16 2.5 M0 15 C5 12.5 9 13.5 16 7.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g><path d="M2 6 L6 2 L11 3.25 L14.5 2 L13.5 9 L14.25 14 L8 14.5 L2.5 13 Z" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)

export const LineAppearance = glyph(
  '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 1.5 A6.5 6.5 0 0 1 8 14.5 Z" fill="currentColor"/>'
)

export const LineManageWorkflows = glyph(
  '<rect x="1.5" y="2" width="3" height="3" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 3.5 H14.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="1.5" y="6.5" width="3" height="3" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 8 H14.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><rect x="1.5" y="11" width="3" height="3" rx="0.75" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 12.5 H14.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>'
)
