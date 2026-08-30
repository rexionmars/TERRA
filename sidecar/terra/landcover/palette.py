"""
Canonical MapBiomas class metadata for every raster this application renders.

Both the classification path (infer.py) and the reference path (lulc.py) draw
MapBiomas class ids, and both previously carried their own MAPBIOMAS_COLORS
literal. The two disagreed on every class they shared, so a prediction and the
MapBiomas reference it is compared against were painted in different colours
for the same class, and the legend shown next to the reference image described
the prediction palette instead:

    class 3  Forest Formation        infer #006d2c   lulc #006400
    class 21 Agriculture-Pasture     infer #fee391   lulc #fff3bf
    class 25 Non-vegetated Area      infer #d73027   lulc #ffa07a
    class 39 Soybean                 infer #4292c6   lulc #f5b3c8
    class 41 Other Temporary Crops   infer #9e9ac8   lulc #e974ed

The values below are the reference-path palette, which follows MapBiomas
conventions (class 39 #f5b3c8 matches the published Collection 8 soybean
colour). Adopting it leaves the MapBiomas reference rendering unchanged and
moves the prediction and the frontend legend into agreement with it, so an
overlay drawn by this application stays comparable to a published MapBiomas
map.

Not retroactive: class_statistics stamps the colour into every ClassStat and
that is serialised into summary_json, so runs saved before this change keep
their original colours. Each stored run stays internally consistent with its
own overlay PNG; only a comparison across the two eras mixes palettes.

frontend/src/lib/classPalette.ts mirrors these values for the static legend and
must be edited in step.
"""

from __future__ import annotations

# Full MapBiomas legend used by the reference path.
MAPBIOMAS_LEGEND = {
    3: "Forest Formation",
    4: "Savanna Formation",
    9: "Forest Plantation",
    11: "Wetland",
    15: "Pasture",
    20: "Sugar Cane",
    21: "Agriculture-Pasture Mosaic",
    24: "Urban Area",
    25: "Non-vegetated Area",
    33: "Water",
    39: "Soybean",
    41: "Other Temporary Crops",
    46: "Coffee",
}

MAPBIOMAS_COLORS = {
    3: "#006400",
    4: "#00ff00",
    9: "#ad4400",
    11: "#45c2a5",
    15: "#ffd966",
    20: "#c59ff4",
    21: "#fff3bf",
    24: "#d4271e",
    25: "#ffa07a",
    33: "#0000ff",
    39: "#f5b3c8",
    41: "#e974ed",
    46: "#d082de",
}

# The closed set the classifier can emit. There is no reject class, so every
# pixel is assigned to whichever of these five is nearest in feature space.
CLASSIFIER_CLASS_IDS = (3, 21, 25, 39, 41)

CLASSIFIER_LEGEND = {cid: MAPBIOMAS_LEGEND[cid] for cid in CLASSIFIER_CLASS_IDS}
CLASSIFIER_COLORS = {cid: MAPBIOMAS_COLORS[cid] for cid in CLASSIFIER_CLASS_IDS}
