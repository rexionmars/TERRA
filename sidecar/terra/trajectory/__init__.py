"""
The NDVI trajectory: an area's Sentinel-2 series over a period, run through an
installed time-series model, as a daily NDVI with its 95 % interval.

The model is a package the reader installs (terra.models); this slice brings
the code of its family, gp_series, and nothing of its numbers. Per acquisition
the area's clear pixels are reduced to six medians (series.py); the model keeps
one acquisition per date, sets aside the ones that disagree with their
neighbours, and fits a Gaussian process to the rest (gp_series.py). The
interval is scaled for the region the area lies in, where the model was
calibrated on that region, and by a global scale elsewhere (region.py).

THE INTERVAL IS WIDER WHERE THE SERIES IS EMPTY. Between two clear dates far
apart the trajectory is what the covariance carries across the gap, and the
interval says how little the data hold it there. It is a statement about the
series read, not about the field: a harvest between two clear dates is spread
over the gap rather than shown as a step.
"""
