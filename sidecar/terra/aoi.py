"""
The study area, however it arrived.

A polygon from the GeoJSON the application draws or imports, or from a KML the
notebooks used. Nothing here reads imagery or decides anything about the
ground; it turns what the caller sent into the one shape every product clips to.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from shapely.geometry import Polygon, shape


def polygon_from_geojson(geom):
    """Build a shapely Polygon from a GeoJSON geometry dict."""
    return shape(geom)


def parse_kml_coordinates(kml_path, target_name=None):
    """Extract polygon coordinates from a KML file (from the notebooks)."""
    tree = ET.parse(kml_path)
    root = tree.getroot()
    ns = {
        'kml': 'http://www.opengis.net/kml/2.2',
        'gx': 'http://www.google.com/kml/ext/2.2',
    }
    for placemark in root.findall('.//kml:Placemark', ns):
        name = placemark.find('kml:name', ns)
        name_text = name.text if name is not None else 'Unknown'
        if target_name and target_name.lower() not in name_text.lower():
            continue
        coords_elem = placemark.find('.//kml:coordinates', ns)
        if coords_elem is not None:
            coords_text = coords_elem.text.strip()
            coords = []
            for point in coords_text.split():
                parts = point.split(',')
                lon, lat = float(parts[0]), float(parts[1])
                coords.append((lon, lat))
            return {'name': name_text, 'coordinates': coords, 'polygon': Polygon(coords)}
    return None
