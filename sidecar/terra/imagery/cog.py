"""
What GDAL has to be told before it reads a Cloud-Optimized GeoTIFF over HTTP.

Every product that reads from the catalogue calls this first. The settings are
applied with setdefault, so an operator who has already chosen a value in the
environment keeps it.
"""

from __future__ import annotations

import os


def configure():
    """Tune GDAL/rasterio for efficient remote COG range reads."""
    os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif,.TIF,.tiff')
    os.environ.setdefault('GDAL_HTTP_MULTIRANGE', 'YES')
    os.environ.setdefault('GDAL_HTTP_MERGE_CONSECUTIVE_RANGES', 'YES')
    os.environ.setdefault('VSI_CACHE', 'TRUE')
