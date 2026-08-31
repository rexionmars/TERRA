# AOSP pointer assets

Android's default pointer set, as VectorDrawable sources. Vendored so the
cursor CSS is reproducible from a checkout with no network access and no
build-time dependency beyond the generator in `../../scripts/build-cursors.ts`.

## Provenance

Copied from `Tech-Tac/aosp-cursors`, which extracts them from the Android Open
Source Project. Only the `vector/` tree is taken. That tree is AOSP's own work
under Apache 2.0, and `NOTICE` beside this file is AOSP's notice, retained as
clause 4(d) of that licence requires. Nothing here is derived from the
`build_theme.js` pipeline in that repository, which is GPLv3 and would carry its
terms into anything built from it; the generator alongside this directory was
written against the XML rather than adapted from that script.

- Upstream: <https://github.com/Tech-Tac/aosp-cursors>
- Assets: Copyright The Android Open Source Project, Apache License 2.0
- Files are unmodified.

## Shape of the sources

Each pointer is two files. `pointer_<name>_vector_icon.xml` carries the hotspot
as `hotSpotX`/`hotSpotY` in dp against a 24 dp icon, and names the drawable that
draws it. `drawable/pointer_<name>_vector.xml` is a 24x24 viewport holding two
to five paths.

Colour is not literal in most paths. It is one of four theme attributes --
`pointerIconVectorFill`, `pointerIconVectorStroke`, and an `Inverse` of each --
which the generator resolves into the two variants TERRA ships. Five drawables
also carry literal colours, given in Android's `#AARRGGBB` order rather than
CSS's `#RRGGBBAA`; the generator reorders those.

## What is missing, and why

`pointer_wait` is upstream an `animation-list` of 88 frames. CSS takes a single
image per cursor and cannot animate one, so it is not vendored and `wait` and
`progress` keep the platform cursor.
