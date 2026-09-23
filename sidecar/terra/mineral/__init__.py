"""
Surface mineralogy from imaging spectroscopy: Tetracorder on EMIT reflectance.

A port of the USGS/PSI Tetracorder expert system (Clark et al., 2003; Clark et
al., 2024), with the public rule set nearest the one the EMIT L2B product was
made with and the reference libraries convolved to EMIT's channels, applied to
EMIT L2A reflectance read from the LP DAAC over the area. It answers
which reference spectrum best explains each 60 m cell's diagnostic absorptions,
separately for the iron electronic region and the 2-2.5 um vibrational region,
and how deep the matched absorption is. It does not estimate abundance.

The reference data are derived from the Tetracorder repository (GPL-3.0, as
this application is) by sidecar/tools/build_tetracorder_rules.py.
"""
