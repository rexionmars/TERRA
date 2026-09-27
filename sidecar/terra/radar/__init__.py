"""
Sentinel-1 radar: an area's C-band backscatter over a period, which cloud does
not interrupt.

The source is the Planetary Computer's `sentinel-1-rtc` collection: IW GRD
scenes with radiometric terrain correction, gamma0 in linear power at 10 m,
VV and VH. Terrain flattening removes most of the brightness a slope adds, so
a field on a hillside and one on a plain are read on one scale.

What is measured, per acquisition (one date and one relative orbit):

- VV and VH: the mean gamma0 over the area's valid cells, in linear power,
  then in dB. Averaging N cells in power reduces the speckle of a single cell
  (equivalent number of looks about 4.4 for these products) by N.
- The cross ratio VH/VV, in dB: it rises as a canopy develops, since volume
  scattering adds to VH more than to VV (Veloso et al., 2017).
- The share of the area read as open water: below fixed VH and VV thresholds
  after a Lee filter (Lee, 1980), since calm water scatters the signal away
  from the sensor. VH carries the test because wind roughens water and raises
  VV more than VH (series.py gives the figures). Paved ground, radar shadow and
  very smooth bare soil can read the same way.

A CANOPY LOSS -- a harvest, most often -- is a drop in VH of at least
`HARVEST_DROP_DB` between two passes of one relative orbit, with the cross
ratio falling by at least `CR_DROP_DB` from above the orbit's median. The
cross ratio is what separates it from the drying of the soil after rain, which
takes VV and VH down together. It lies between the two passes either side of
the drop; losses of several orbits that overlap are one event, placed where
they overlap. Every event of the period is reported, since a period across a
winter and a summer crop holds two harvests. The thresholds are fixed in this
package and were not calibrated against harvest records: a lodged or a
hail-struck canopy, a desiccated cover crop or a flooded field reads as a loss
as well.

Orbits are kept apart throughout. The incidence angle differs between them,
and so does the level of the backscatter over one surface; a series mixing
them would show that difference as change.

References
  Lee, J.-S. (1980). Digital image enhancement and noise filtering by use of
    local statistics. IEEE TPAMI, 2(2), 165-168.
  Veloso, A. et al. (2017). Understanding the temporal behavior of crops using
    Sentinel-1 and Sentinel-2-like data for agricultural applications. Remote
    Sensing of Environment, 199, 415-426.
"""
