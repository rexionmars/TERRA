"""
GeoPackage files opened on the map.

A GeoPackage is an SQLite database laid out by the OGC GeoPackage Encoding
Standard (OGC 12-128r18, version 1.3.1). This slice lists what a file holds and
writes each of its feature layers as GeoJSON in longitude and latitude on
WGS 84 (reader.py), points, lines and polygons alike, for the map to draw. It
writes nothing to the project: a polygon becomes an area only when the reader
asks for it on the map.
"""
