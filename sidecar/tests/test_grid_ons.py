"""
The ONS reader's decisions about which file a window resolves to, and about
when a cached file is still the one ONS publishes.

Every property here was a silent wrong answer before it was a test. A duplicate
period resolved by catalogue order reads a superseded file; a cached file whose
revision is not checked serves fourteen months of a rewritten record; a missing
column dropped by a filter returns a frame that is short rather than an error.
None of them raise, and none of them are visible in the frame that comes back.
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from terra.grid import ons


def catalogue_frame(rows):
    return pd.DataFrame(rows).sort_values('period').reset_index(drop=True)


# --- which file a period is -------------------------------------------------

def test_a_monthly_filename_reads_as_year_and_month():
    assert ons._period_of(
        'https://x/RESTRICAO_COFF_FOTOVOLTAICA_DETAIL_2025_09.csv') == '2025-09'


def test_an_annual_filename_reads_as_the_year_alone():
    assert ons._period_of('https://x/EAR_DIARIO_SUBSISTEMA_2025.csv') == '2025'


def test_a_filename_carrying_no_period_reads_as_empty_not_as_a_guess():
    assert ons._period_of('https://x/CAPACIDADE_GERACAO.csv') == ''


def test_the_later_revision_of_a_duplicated_period_wins(monkeypatch):
    """
    ONS publishes two live resources for 2024-09, one from 2024-10 and one from
    the 2025-02 rewrite. Resolved by catalogue order, which file a run reads
    depends on what CKAN happened to return first.
    """
    payload = {'success': True, 'result': {'resources': [
        {'format': 'CSV', 'url': 'https://x/D_2024_09.csv',
         'last_modified': '2025-02-13T18:55:39'},
        {'format': 'CSV', 'url': 'https://x/OLD_2024_09.csv',
         'last_modified': '2024-10-04T15:12:46'},
    ]}}
    monkeypatch.setattr(ons, '_open_catalogue', lambda url, timeout: payload)

    cat = ons.catalogue('pv_curtailment_detail')

    assert len(cat) == 1
    assert cat['last_modified'].iloc[0] == '2025-02-13T18:55:39'


def test_an_unknown_dataset_names_the_ones_that_exist():
    with pytest.raises(KeyError, match='pv_curtailment_detail'):
        ons.catalogue('solar_curtailment')


# --- which files a window costs ---------------------------------------------

def test_a_one_day_window_still_costs_the_month_it_falls_in():
    cat = catalogue_frame([
        {'period': '2025-07', 'url': '', 'filename': '', 'last_modified': ''},
        {'period': '2025-08', 'url': '', 'filename': '', 'last_modified': ''},
        {'period': '2025-09', 'url': '', 'filename': '', 'last_modified': ''},
    ])

    got = ons.periods_covering('2025-08-10', '2025-08-10', cat)

    assert list(got['period']) == ['2025-08']


def test_a_window_spanning_a_month_boundary_costs_both():
    cat = catalogue_frame([
        {'period': '2025-07', 'url': '', 'filename': '', 'last_modified': ''},
        {'period': '2025-08', 'url': '', 'filename': '', 'last_modified': ''},
        {'period': '2025-09', 'url': '', 'filename': '', 'last_modified': ''},
    ])

    got = ons.periods_covering('2025-07-28', '2025-08-03', cat)

    assert list(got['period']) == ['2025-07', '2025-08']


def test_an_annual_record_is_selected_by_year_not_by_month():
    """
    The curtailment records are monthly and the load records annual. Compared
    as strings without distinguishing the two, '2025' sorts below '2025-01' and
    an annual file is never selected for a window inside its own year.
    """
    cat = catalogue_frame([
        {'period': '2024', 'url': '', 'filename': '', 'last_modified': ''},
        {'period': '2025', 'url': '', 'filename': '', 'last_modified': ''},
    ])

    got = ons.periods_covering('2025-06-01', '2025-06-30', cat)

    assert list(got['period']) == ['2025']


# --- when a cached file is still the published one --------------------------

def test_a_file_whose_revision_matches_the_catalogue_is_read_from_cache(tmp_path):
    path = tmp_path / 'D_2025_09.csv'
    path.write_text('x')
    ons._stamp_path(path).write_text(json.dumps(
        {'last_modified': '2026-05-04T15:18:54'}))

    assert ons._cached_revision(path) == '2026-05-04T15:18:54'


def test_a_file_with_no_stamp_reads_as_unverifiable_not_as_current(tmp_path):
    """
    The distinction the POWER cache had to make too. A file written before this
    module existed, or restored from a backup, carries no revision -- and a
    modification time on this disk is when it was written here, not when ONS
    published it.
    """
    path = tmp_path / 'D_2025_09.csv'
    path.write_text('x')

    assert ons._cached_revision(path) is None


def test_a_superseded_cached_file_is_downloaded_again(tmp_path, monkeypatch):
    """
    ONS rewrote every month of 2025-01..2026-03 in a batch in 2026-04/05. A
    cache keyed on period alone serves the old revision of all fourteen.
    """
    dataset = 'pv_curtailment_detail'
    path = tmp_path / dataset / 'D_2025_09.csv'
    path.parent.mkdir(parents=True)
    path.write_text('stale')
    ons._stamp_path(path).write_text(json.dumps(
        {'last_modified': '2025-02-13T18:19:48'}))

    downloaded = []

    def fake_download(url, dest, timeout):
        downloaded.append(url)
        dest.write_text('fresh')

    monkeypatch.setattr(ons, '_download', fake_download)
    row = {'period': '2025-09', 'filename': 'D_2025_09.csv',
           'url': 'https://x/D_2025_09.csv',
           'last_modified': '2026-05-04T15:18:54'}

    got, prov = ons.fetch_period(dataset, row, tmp_path)

    assert downloaded == ['https://x/D_2025_09.csv']
    assert got.read_text() == 'fresh'
    assert prov['source'] == 'fetch'
    assert '2025-02-13T18:19:48' in prov['note']


def test_a_current_cached_file_is_not_downloaded_again(tmp_path, monkeypatch):
    dataset = 'pv_curtailment_detail'
    path = tmp_path / dataset / 'D_2025_09.csv'
    path.parent.mkdir(parents=True)
    path.write_text('cached')
    ons._stamp_path(path).write_text(json.dumps(
        {'last_modified': '2026-05-04T15:18:54'}))

    def refuse(url, dest, timeout):
        raise AssertionError('downloaded a file the catalogue had not changed')

    monkeypatch.setattr(ons, '_download', refuse)
    row = {'period': '2025-09', 'filename': 'D_2025_09.csv',
           'url': 'https://x/D_2025_09.csv',
           'last_modified': '2026-05-04T15:18:54'}

    _, prov = ons.fetch_period(dataset, row, tmp_path)

    assert prov['source'] == 'cache'


# --- the boundary between ingest and query ----------------------------------

def test_ons_offers_no_way_to_query_the_record_only_to_fetch_it():
    """
    The store is a hard requirement of this slice, so that answering "this
    plant, this window" has exactly one implementation. An earlier version
    answered it here too, from the files, with its own copy of the
    exclusive-midnight window rule -- correct, 195 times slower, and a second
    place for that rule to be fixed in only one of two. This pins the boundary
    so the second path cannot come back by accident.
    """
    for gone in ('read', '_select', '_catalogue_from_cache'):
        assert not hasattr(ons, gone), (
            f'ons.{gone} answers a question store.py owns')


def test_ons_still_decides_which_files_a_window_needs():
    """
    Removing the query path must not remove the ingest planning: something has
    to say which period files cover the window being loaded.
    """
    assert callable(ons.periods_covering)
    assert callable(ons.fetch_period)
    assert callable(ons.catalogue)
