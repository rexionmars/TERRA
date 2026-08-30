"""
Finding one acquisition by id.

The fallback was inside render_composite with a comment describing something it
no longer did: it said the monthly-best list may have dropped the scene, which
stopped being true when the first query started passing monthly_best=False. The
only thing that can exclude a named scene is the cloud filter the caller set,
and nothing tested that the retry happens or that it is not made when there is
nothing to widen.
"""

from __future__ import annotations

import pytest

from terra.imagery import sentinel2
from terra.scenes import lookup


@pytest.fixture
def catalogue(monkeypatch):
    """list_stac_products answering per (max_cloud) from a table."""
    calls = []
    answers = {}

    def list_stac_products(polygon, start, end, tile_list=None, max_cloud=100.0,
                           monthly_best=True):
        calls.append({'max_cloud': max_cloud, 'monthly_best': monthly_best})
        return answers.get(max_cloud, [])

    monkeypatch.setattr(sentinel2, 'list_stac_products', list_stac_products)
    return {'calls': calls, 'answers': answers}


def scene(scene_id):
    return {'id': scene_id, 'date': None}


def test_a_scene_under_the_filter_is_found_in_one_query(catalogue):
    catalogue['answers'][30.0] = [scene('A'), scene('B')]

    found = lookup.find(None, '2024-01-01', '2024-03-01', 'B', max_cloud=30.0)

    assert found['id'] == 'B'
    assert len(catalogue['calls']) == 1


def test_a_scene_the_cloud_filter_excluded_is_asked_for_again(catalogue):
    catalogue['answers'][30.0] = [scene('A')]
    catalogue['answers'][100.0] = [scene('A'), scene('B')]
    said = []

    found = lookup.find(None, '2024-01-01', '2024-03-01', 'B', max_cloud=30.0,
                        note=said.append)

    assert found['id'] == 'B'
    assert [c['max_cloud'] for c in catalogue['calls']] == [30.0, 100.0]
    assert any('30%' in m for m in said), said


def test_both_queries_ask_for_every_scene_and_not_the_monthly_best(catalogue):
    """A monthly-best list holds one scene per month, and the id asked for is
    usually not the one it kept."""
    catalogue['answers'][30.0] = []
    catalogue['answers'][100.0] = [scene('B')]

    lookup.find(None, '2024-01-01', '2024-03-01', 'B', max_cloud=30.0)

    assert all(c['monthly_best'] is False for c in catalogue['calls'])


def test_no_retry_is_made_when_there_is_no_filter_to_widen(catalogue):
    catalogue['answers'][100.0] = [scene('A')]

    with pytest.raises(lookup.SceneNotFound, match='B'):
        lookup.find(None, '2024-01-01', '2024-03-01', 'B', max_cloud=100.0)

    assert len(catalogue['calls']) == 1


def test_a_scene_in_neither_answer_is_refused_by_name(catalogue):
    catalogue['answers'][30.0] = [scene('A')]
    catalogue['answers'][100.0] = [scene('A')]

    with pytest.raises(lookup.SceneNotFound, match='B'):
        lookup.find(None, '2024-01-01', '2024-03-01', 'B', max_cloud=30.0)

    assert len(catalogue['calls']) == 2
