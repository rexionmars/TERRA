"""
Management zones: a field divided into three to five parts that have grown
alike over several seasons, for variable-rate application.

The method is Management Zone Analyst's (Fridgen et al., 2004), applied to a
Sentinel-2 series instead of yield maps or soil electrical conductivity:

1. Each season -- the requested period and the same days of the years before
   it -- gives one layer per 10 m cell: the 90th percentile of NDVI over the
   season's clear acquisitions, which reads the canopy near its peak without
   resting on one date. A cell with fewer than MIN_OBS clear acquisitions in a
   season has no value for it.
2. Each season's layer is standardised over the field. A season of maize and
   one of soybean differ in level; what the zones are drawn from is where the
   field stood relative to itself, season after season.
3. Fuzzy c-means (Bezdek, 1981) with the diagonal distance -- Euclidean over
   the standardised seasons -- and a fuzziness exponent of 1.30, as in MZA,
   for three, four and five zones. cluster.py says why not Mahalanobis.
4. For each number of zones the fuzziness performance index (FPI; Odeh et al.,
   1992) and the normalised classification entropy (NCE) are computed. Both
   fall as the partition becomes clearer; the number suggested is the one that
   ranks best on the two together, as MZA reads them. The other partitions are
   kept, so the choice can be changed.
5. Each cell takes the zone of its largest membership; patches smaller than
   MIN_ZONE_HA are merged into the zone around them, and the zones are
   numbered from the lowest mean NDVI to the highest.

WHAT THE ZONES ARE NOT. They are where the canopy differed, not why: soil,
drainage, compaction, a past management line or a pest patch all draw the
same boundary, and whether a zone should get more input or less is an
agronomic call the product does not make. With few clear acquisitions per
season -- a rainy summer -- the layers are noisy and so are the zones.

References
  Bezdek, J. C. (1981). Pattern Recognition with Fuzzy Objective Function
    Algorithms. Plenum Press.
  Fridgen, J. J., Kitchen, N. R., Sudduth, K. A., Drummond, S. T., Wiebold,
    W. J. and Fraisse, C. W. (2004). Management Zone Analyst (MZA): software
    for subfield management zone delineation. Agronomy Journal, 96(1), 100-108.
  Odeh, I. O. A., Chittleborough, D. J. and McBratney, A. B. (1992). Soil
    pattern recognition with fuzzy-c-means: application to classification and
    soil-landform interrelationships. Soil Science Society of America Journal,
    56(2), 505-516.
"""
