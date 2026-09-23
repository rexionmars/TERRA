"""
The ground: elevation as the catalogue serves it, and what is derived from it.

`dem` reads a product over a window, merging the tiles it crosses; `hand`
computes height above nearest drainage over what was read. Both are consumed by
the flood products, and `dem` by the surface model as well, which is why they
sit below the products rather than inside one of them.
"""
