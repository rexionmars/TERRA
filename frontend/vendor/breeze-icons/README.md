# Breeze icons

The subset of KDE's Breeze icon theme that the interface draws, as the SVG
sources. Vendored because Breeze is published as a desktop icon theme and not
as a package: nothing on npm carries it, so the icons are reproducible from a
checkout only if the files are here. The generator in
`../../scripts/build-icons.ts` turns them into `src/components/icons.tsx`.

## Provenance

Copied from the `icons/` tree of KDE's `breeze-icons` repository at commit
`7d402d46afbbdbb73cf70be1ec3ee2aee1771279` (2026-10-02).

- Upstream: <https://invent.kde.org/frameworks/breeze-icons>, mirrored at
  <https://github.com/KDE/breeze-icons>
- Assets: Copyright 2014 Uri Herrera and others, LGPL-3.0-or-later
- `COPYING-ICONS` beside this file is upstream's notice and the licence text,
  unmodified. It is the notice "at a prominent place in the directory
  containing the elements" that the clarification in that file asks for.
- File contents are unmodified.

Only the 127 files the generator's table names are taken, out of roughly
eleven thousand. Each keeps its upstream path, `icons/<context>/<size>/<name>.svg`.

## Aliases are stored as copies

Upstream reaches many names through symbolic links: `download` is a link to
`edit-download`, `search` to `edit-find`. 30 of the files here are such names.
They are stored as regular files under the name the table asks for, holding the
bytes of the link's target, so that the table reads as what was chosen and the
tree works on a filesystem or an archive that does not keep links.

## Shape of the sources

A square viewport of 16 or 22 units at the origin, holding paths and the
occasional `rect` or `g`. Colour is not literal in most of them: a path asks for
`currentColor` and names a class -- `ColorScheme-Text`, `ColorScheme-NegativeText`
-- that an embedded stylesheet resolves to a colour of the desktop's scheme.

The generator drops that stylesheet and the classes, so every glyph paints in
the colour of the text it sits in. Six files also carry a literal colour; what
each becomes is written in the generator's `RECOLOUR` table, and a literal it
has not been told about is an error.

## Adding or changing an icon

Copy the SVG from upstream to the same path here, add or edit its line in the
`ICONS` table of `scripts/build-icons.ts`, and run `npm run build:icons`.
`npm run check:icons` fails when the generated file and the table disagree.
