"""
Where one field ends and the next begins.

Field boundaries delineated from two Sentinel-2 dates by a network from the
Fields of The World baselines (Kerner et al., 2025, AAAI; Muhawenayo et al.,
2026, arXiv 2603.27101): a U-Net that labels every 10 m pixel as field
interior, field boundary or neither, from the red, green, blue and
near-infrared bands of a scene near sowing and a scene near harvest. Each
connected interior region becomes one polygon.

WHAT THE POLYGONS ARE NOT. They are what the network separates, not what a
farmer calls a field. Two adjacent fields sown with one crop on one day look
alike on both dates and come out as one polygon; one field with an internal
track or a management strip can come out as two. Sentinel-2 at 10 m also sets
a floor: a field a few pixels wide has a boundary as wide as its interior.
The Fields of The World training data hold no Paraná field; its Brazilian
samples are presence-only labels from western Bahia (Oldoni et al., 2020).
"""
