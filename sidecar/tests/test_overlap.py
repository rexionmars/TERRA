"""Socio-environmental overlap: rows, areas and periods, without the network."""

from __future__ import annotations

import pytest
from shapely.geometry import box, mapping

from terra.overlap import actions, geometry, sources

# A 0.01 degree square near Cascavel, PR: about 1 km by 1.1 km.
AREA = box(-53.36, -24.87, -53.35, -24.86)


def feature(geom, **props):
    return {'type': 'Feature', 'geometry': mapping(geom), 'properties': props}


@pytest.fixture
def plane():
    centre = AREA.representative_point()
    to_m = geometry.EqualArea(centre.x, centre.y)
    return to_m, geometry.polygonal(to_m(AREA))


def test_the_area_of_a_square_in_the_equal_area_plane(plane):
    _, area_m = plane
    # 0.01 deg of latitude is 1106 m at 25 S; of longitude, 1011 m.
    assert area_m.area / geometry.M2_PER_HA == pytest.approx(111.9, rel=0.01)


def test_a_feature_is_cut_to_the_area_and_one_outside_is_dropped(plane):
    to_m, area_m = plane
    west_half = box(-53.37, -24.87, -53.355, -24.86)
    outside = box(-53.30, -24.80, -53.29, -24.79)
    cuts = geometry.cut([feature(west_half, year=2010), feature(outside, year=2010)], area_m, to_m)
    assert len(cuts) == 1
    assert cuts[0].ha == pytest.approx(area_m.area / geometry.M2_PER_HA / 2, rel=0.01)


def test_overlapping_features_are_counted_once_in_the_register_total(plane):
    to_m, area_m = plane
    # Two CAR registrations over the same whole area.
    cuts = geometry.cut([feature(AREA, cod_imovel='a'), feature(AREA, cod_imovel='b')], area_m, to_m)
    whole = area_m.area / geometry.M2_PER_HA
    assert sum(c.ha for c in cuts) == pytest.approx(2 * whole, rel=1e-6)
    assert geometry.union_ha(cuts) == pytest.approx(whole, rel=1e-6)


def test_a_self_intersecting_ring_is_repaired_rather_than_lost(plane):
    to_m, area_m = plane
    # A bow tie over the area: two triangles meeting at the centre.
    x0, y0, x1, y1 = AREA.bounds
    bowtie = {'type': 'Polygon', 'coordinates': [[[x0, y0], [x1, y1], [x1, y0], [x0, y1], [x0, y0]]]}
    cuts = geometry.cut([{'geometry': bowtie, 'properties': {}}], area_m, to_m)
    assert len(cuts) == 1
    assert cuts[0].ha == pytest.approx(area_m.area / geometry.M2_PER_HA / 2, rel=0.02)


def test_prodes_years_fall_in_the_periods_of_the_two_cutoffs(plane):
    to_m, area_m = plane
    x0, y0, x1, y1 = AREA.bounds
    quarter = (x1 - x0) / 4
    strips = [box(x0 + i * quarter, y0, x0 + (i + 1) * quarter, y1) for i in range(4)]
    cuts = geometry.cut(
        [
            feature(strips[0], year=2008),
            feature(strips[1], year=2009),
            feature(strips[2], year=2021),
            feature(strips[3], year=2022),
        ],
        area_m,
        to_m,
    )
    periods = {p['id']: p['ha'] for p in geometry.prodes_periods(cuts)}
    each = area_m.area / geometry.M2_PER_HA / 4
    for pid in ('before_forest_code', 'forest_code_to_eudr', 'straddles_eudr', 'after_eudr'):
        assert periods[pid] == pytest.approx(each, rel=0.01)


def test_the_embargo_rows_carry_no_name_and_no_tax_number():
    row = sources.ibama_embargo_row(
        {
            'num_tad': '46784',
            'serie_tad': 'C',
            'municipio': 'Cascavel',
            'uf': 'PR',
            'nome_embargado': 'A PERSON',
            'cpf_cnpj_embargado': '00000000000',
            'nome_imovel': 'A FARM',
            'dat_embargo': 1051094400000,
            'tipo_area': 'Desmatamento',
            'num_processo': '02017001008200391',
            'qtd_area_embargada': 10.0,
        }
    )
    text = repr(row)
    assert 'A PERSON' not in text and '00000000000' not in text and 'A FARM' not in text
    assert row.ref == 'TAD 46784-C'
    assert row.date == '2003-04-23'
    icmbio = sources.icmbio_embargo_row({'numero_ai': '038303', 'serie': 'A', 'autuado': 'A PERSON', 'cpf_cnpj': '1'})
    assert 'A PERSON' not in repr(icmbio)


def test_a_car_row_names_its_status_and_type_in_words():
    row = sources.car_row(
        {
            'cod_imovel': 'PR-4104808-X',
            'status_imovel': 'PE',
            'tipo_imovel': 'IRU',
            'dat_criacao': '2019-08-08T16:46:57.869Z',
            'area': 14.78,
            'municipio': 'Cascavel',
            'uf': 'PR',
        }
    )
    assert (row.status, row.category, row.date, row.year) == ('pending', 'rural property', '2019-08-08', 2019)


def test_a_conservation_unit_date_is_read_from_day_month_year():
    row = sources.conservation_row({'cria_ano': '14-11-2024', 'grupo': 'Uso Sustentável', 'categoria': 'ARIE'})
    assert row.date == '2024-11-14'
    assert row.category == 'Uso Sustentável: ARIE'
    assert sources.conservation_row({'cria_ano': '2024'}).date == ''


def test_an_area_is_looked_up_in_every_state_its_box_meets():
    assert sources.states_for(AREA.bounds) == ['pr']
    # On the Paraná river, between Paraná and Mato Grosso do Sul.
    assert sources.states_for((-54.30, -24.10, -54.20, -23.95)) == ['ms', 'pr']
    assert sources.states_for((10.0, 45.0, 10.1, 45.1)) == []


def test_a_register_that_fails_is_reported_and_the_others_are_not_affected(plane):
    to_m, area_m = plane

    def down():
        raise sources.SourceError('https://example.invalid answered HTTP 503')

    entry, cuts = actions.read_register(
        'indigenous', 'Indigenous lands', 'FUNAI', [('Funai:tis_poligonais', down)],
        sources.indigenous_row, area_m, to_m,
    )
    assert entry['status'] == 'failed' and 'HTTP 503' in entry['note'] and cuts == []

    entry, cuts = actions.read_register(
        'indigenous', 'Indigenous lands', 'FUNAI',
        [('Funai:tis_poligonais', lambda: ([feature(AREA, terrai_codigo=1, terrai_nome='T')], False))],
        sources.indigenous_row, area_m, to_m,
    )
    assert entry['status'] == 'read'
    assert entry['n_features'] == 1 and entry['features'][0]['name'] == 'T'
    assert entry['overlap_ha'] == pytest.approx(area_m.area / geometry.M2_PER_HA, rel=1e-3)


def test_a_register_not_published_where_the_area_is_says_so(plane):
    to_m, area_m = plane
    entry, _ = actions.read_register(
        'deter', 'DETER alerts', 'INPE', [], sources.deter_row, area_m, to_m,
        not_covered='DETER monitors the Amazon and the Cerrado',
    )
    assert entry['status'] == 'not_covered'
    assert 'Amazon' in entry['note']


def test_a_truncated_reading_is_reported_as_a_lower_bound(plane):
    to_m, area_m = plane
    entry, _ = actions.read_register(
        'car', 'CAR', 'SFB', [('sicar:sicar_imoveis_pr', lambda: ([feature(AREA, cod_imovel='a')], True))],
        sources.car_row, area_m, to_m,
    )
    assert entry['status'] == 'read'
    assert 'lower bound' in entry['note']
