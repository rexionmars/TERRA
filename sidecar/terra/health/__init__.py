"""
Vegetation health: an area's NDVI and NDRE this season against the same days of
the year in earlier seasons.

The question a field is asked is whether it looks as it usually looks at this
time of year. Each clear acquisition of the period gives the mean NDVI and NDRE
over the cells the scene classification calls clear; each is compared with the
acquisitions of the `baseline_years` seasons before it that fall within
`window_days` of the same day of the year, as a departure in standard
deviations. A map shows, cell by cell, the NDVI of the latest clear date minus
the median NDVI of the earlier seasons around that day of the year.

NDRE ((B8A - B05) / (B8A + B05)) beside NDVI because NDVI saturates over a
closed canopy, where the red edge still moves with chlorophyll content
(Gitelson and Merzlyak, 1994).

A DEPARTURE IS NOT A DIAGNOSIS. A field sown later than in earlier seasons,
with another crop, or left fallow departs as a stressed one does. The
comparison says where and when a field differs from its own record; what made
it differ is for someone who knows the field.
"""
