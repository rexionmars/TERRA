"""Fields corrected by hand: a cut along a line, and neighbours joined across their strip."""

from __future__ import annotations

import json

import pytest
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, box, shape
from shapely.ops import transform

from terra import registry
from terra.fields import editing

# Shapes are laid out in metres in UTM 22S, near Toledo, PR, and handed over in
# degrees, as the map sends them.
_TO_DEG = Transformer.from_crs('EPSG:32722', 'EPSG:4326', always_xy=True).transform
_TO_M = Transformer.from_crs('EPSG:4326', 'EPSG:32722', always_xy=True).transform
X0, Y0 = 225_000.0, 7_262_000.0


def deg(geom):
    return transform(_TO_DEG, geom)


def metres(geojson):
    return transform(_TO_M, shape(geojson))


def rect(x, y, w, h, holes=()):
    outer = box(X0 + x, Y0 + y, X0 + x + w, Y0 + y + h)
    return Polygon(outer.exterior, [box(X0 + a, Y0 + b, X0 + c, Y0 + d).exterior for a, b, c, d in holes])


def line(*points):
    return LineString([(X0 + x, Y0 + y) for x, y in points])


# --- split -------------------------------------------------------------------


def test_a_line_across_a_field_cuts_it_in_two_largest_first():
    parts = editing.split(deg(rect(0, 0, 300, 200)), deg(line((100, -10), (100, 210))))
    assert [round(p['area_ha'], 2) for p in parts] == [4.0, 2.0]
    assert metres(parts[0]['geometry']).bounds[0] == pytest.approx(X0 + 100, abs=0.05)


def test_a_line_that_crosses_twice_cuts_three_parts():
    # A U-shaped field, and one line straight across both arms.
    u = rect(0, 0, 300, 300).difference(rect(100, 100, 100, 210))
    parts = editing.split(deg(u), deg(line((-10, 150), (310, 150))))
    assert len(parts) == 3
    assert sum(p['area_ha'] for p in parts) == pytest.approx(u.area / 1e4, rel=1e-6)


def test_a_line_that_stops_inside_cuts_nothing():
    with pytest.raises(editing.Refused, match='cross the field'):
        editing.split(deg(rect(0, 0, 300, 200)), deg(line((100, -10), (100, 150))))


def test_a_field_keeps_its_hole_through_a_cut():
    field = rect(0, 0, 300, 200, holes=[(200, 50, 250, 100)])
    parts = editing.split(deg(field), deg(line((100, -10), (100, 210))))
    assert sum(len(metres(p['geometry']).interiors) for p in parts) == 1


# --- join --------------------------------------------------------------------


def test_neighbours_ten_metres_apart_become_one_field_with_the_strip():
    a, b = rect(0, 0, 200, 100), rect(0, 110, 200, 100)
    joined = editing.join([deg(a), deg(b)])
    got = metres(joined['geometry'])
    assert got.geom_type == 'Polygon' and not got.interiors
    # The two fields and the 10 m strip between them, and nothing past its ends.
    assert got.area == pytest.approx(a.area + b.area + 200 * 10, rel=1e-3)
    assert got.bounds == pytest.approx((X0, Y0, X0 + 200, Y0 + 210), abs=0.05)


def test_fields_that_meet_at_a_corner_are_bridged():
    a, b = rect(0, 0, 100, 100), rect(110, 110, 100, 100)
    got = metres(editing.join([deg(a), deg(b)])['geometry'])
    assert got.geom_type == 'Polygon'
    assert got.area > a.area + b.area


def test_fields_farther_apart_than_the_strip_are_refused():
    with pytest.raises(editing.Refused, match='more than 25 m apart'):
        editing.join([deg(rect(0, 0, 200, 100)), deg(rect(0, 130, 200, 100))])


def test_touching_fields_are_their_union():
    # To within what the trip through degrees leaves along the shared edge.
    a, b = rect(0, 0, 200, 100), rect(0, 100, 200, 100)
    got = metres(editing.join([deg(a), deg(b)])['geometry'])
    assert got.area == pytest.approx(a.area + b.area, abs=1.0)


def test_a_join_keeps_a_fields_own_hole_and_fills_one_it_made():
    # Field a has a hole of its own, and a notch 4 m wide whose mouth faces b;
    # the strip seals the mouth, and the notch is then ground inside the field.
    notch = rect(96, 60, 4, 40)
    a = rect(0, 0, 200, 100, holes=[(20, 20, 40, 40)]).difference(notch)
    b = rect(0, 110, 200, 100)
    got = metres(editing.join([deg(a), deg(b)])['geometry'])
    assert len(got.interiors) == 1
    assert Polygon(got.interiors[0]).area == pytest.approx(400, rel=1e-3)
    assert got.contains(notch.centroid)


def test_three_fields_in_a_row_join_as_one():
    fields = [rect(0, 110 * i, 200, 100) for i in range(3)]
    got = metres(editing.join([deg(f) for f in fields])['geometry'])
    assert got.geom_type == 'Polygon'
    assert got.area == pytest.approx(3 * 200 * 100 + 2 * 200 * 10, rel=1e-3)


def test_one_field_is_not_a_join():
    with pytest.raises(editing.Refused, match='at least two'):
        editing.join([deg(rect(0, 0, 100, 100))])


# --- the action ----------------------------------------------------------------


def test_the_action_is_registered():
    assert registry.ACTIONS['field_edit'] == 'terra.fields.editing:edit'


def test_the_action_writes_the_parts(tmp_path, capsys):
    req = {
        'op': 'split',
        'field': deg(rect(0, 0, 300, 200)).__geo_interface__,
        'line': deg(line((100, -10), (100, 210))).__geo_interface__,
    }
    editing.edit(req, tmp_path)
    out = json.loads(capsys.readouterr().out)['field_edit']
    assert out['op'] == 'split'
    assert [round(p['area_ha'], 2) for p in out['parts']] == [4.0, 2.0]


def test_a_refused_edit_fails_with_its_sentence(tmp_path, capsys):
    req = {
        'op': 'join',
        'fields': [deg(rect(0, 0, 200, 100)).__geo_interface__,
                   deg(rect(0, 200, 200, 100)).__geo_interface__],
    }
    with pytest.raises(SystemExit):
        editing.edit(req, tmp_path)
    assert 'Only neighbours can be joined' in json.loads(capsys.readouterr().err)['error']
