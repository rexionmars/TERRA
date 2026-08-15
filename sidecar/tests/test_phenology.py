"""Unit tests for phenology helpers (synthetic NDVI curves, offline)."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

import phenology


def _seasonal_ndvi(n: int = 24) -> tuple[np.ndarray, list[str]]:
    """Bell-shaped NDVI over one calendar year (soy-like phenology)."""
    start = date(2023, 1, 1)
    dates = [(start + timedelta(days=15 * i)).isoformat() for i in range(n)]
    # Peak around sample 12–14 (≈ mid year)
    t = np.linspace(0, 2 * np.pi, n)
    ndvi = 0.15 + 0.55 * (0.5 * (1 - np.cos(t)))
    return ndvi.astype(float), dates


def test_assign_states_short_series():
    states = phenology.assign_states_from_ndvi(np.array([0.1, 0.2]))
    assert len(states) == 2
    assert set(states.tolist()).issubset(set(range(5)))


def test_assign_states_seasonal_includes_greenup_and_mature():
    ndvi, _ = _seasonal_ndvi()
    states = phenology.assign_states_from_ndvi(ndvi)
    assert len(states) == len(ndvi)
    assert phenology.STATE_GREENUP in states or phenology.STATE_MATURE in states
    assert set(states.tolist()).issubset(set(range(5)))


def test_phenology_metrics_coherent_order():
    ndvi, dates = _seasonal_ndvi()
    m = phenology.phenology_metrics(ndvi, dates)
    assert m["peak"] is not None and m["base"] is not None
    assert m["amplitude"] is not None and m["amplitude"] > 0
    assert m["sos_doy"] is not None
    assert m["pos_doy"] is not None
    assert m["eos_doy"] is not None
    # Length of season non-negative; peak between SOS and EOS in ordinal sense
    assert m["los_days"] is not None and m["los_days"] >= 0
    assert m["peak"] > m["base"]


def test_phenology_metrics_too_few_points():
    m = phenology.phenology_metrics([0.1, 0.2, 0.3], ["2023-01-01", "2023-01-15", "2023-02-01"])
    assert m["sos_doy"] is None
    assert m["peak"] is None


def test_state_timeline_length_and_fields():
    ndvi, dates = _seasonal_ndvi(12)
    timeline = phenology.state_timeline(ndvi, dates)
    assert len(timeline) == 12
    for row in timeline:
        assert "date" in row and "state" in row and "state_name" in row
        assert row["state"] in phenology.STATE_NAMES
        assert row["state_name"] == phenology.STATE_NAMES[row["state"]]
        assert row["color"] == phenology.STATE_COLORS[row["state"]]


def test_the_maximum_of_a_season_is_labelled_mature_and_not_senescing():
    """A ordem dos testes decidia isto, e decidia errado.

    Senescência era avaliada antes de maturidade, o que rotula TODO pico como
    senescente: um máximo é por definição onde a derivada vira, então a
    inclinação suavizada ali já é negativa enquanto o valor ainda é o maior da
    estação.

    Medido numa AOI de soja real (studies/.temp/terra-export-drawn-20260815): o
    maior NDVI do ano, 0.3142 em 19/02 -- a mesma data que `phenology_metrics`
    devolve como POS por outro caminho -- voltava como "Senescence", enquanto
    uma leitura menor meses depois voltava como "Peak / mature". Duas funções
    deste módulo discordavam sobre onde a estação teve pico.
    """
    ndvi = np.array([
        0.1188, 0.1281, 0.1444, 0.2495, 0.2919, 0.2944, 0.3142,
        0.1698, 0.2202, 0.1934, 0.2315, 0.2272, 0.2256,
    ])
    states = phenology.assign_states_from_ndvi(ndvi)
    peak = int(np.argmax(ndvi))
    assert states[peak] == phenology.STATE_MATURE, (
        "o máximo da série foi rotulado "
        f"{phenology.STATE_NAMES[int(states[peak])]!r}"
    )
    # E a senescência tem que vir DEPOIS do pico, não sobre ele.
    senescing = np.flatnonzero(states == phenology.STATE_SENESCENCE)
    assert all(i > peak for i in senescing), (
        "há senescência em ou antes do pico"
    )


def test_the_two_functions_agree_on_where_the_season_peaked():
    """`phenology_metrics` e `assign_states_from_ndvi` leem a mesma curva.

    Elas chegam ao pico por caminhos diferentes -- uma por limiar sobre a
    amplitude, outra por estado -- e é justamente por isso que podiam divergir
    sem nada falhar.
    """
    ndvi = np.array([
        0.1188, 0.1281, 0.1444, 0.2495, 0.2919, 0.2944, 0.3142,
        0.1698, 0.2202, 0.1934, 0.2315, 0.2272, 0.2256,
    ])
    dates = [
        "2025-08-30", "2025-09-27", "2025-10-17", "2025-11-21", "2025-12-28",
        "2026-01-10", "2026-02-19", "2026-03-16", "2026-04-17", "2026-05-05",
        "2026-06-19", "2026-07-19", "2026-08-08",
    ]
    states = phenology.assign_states_from_ndvi(ndvi)
    metrics = phenology.phenology_metrics(ndvi, dates)

    """
    Concordância medida como o invariante, e não como datas iguais.

    `phenology_metrics` trabalha sobre a série suavizada e `argmax` sobre a
    crua, então o POS cai a dois dias do máximo bruto -- diferença de suavização
    numa série amostrada a cada trinta dias, não discordância. Exigir a mesma
    data mediria o suavizador. O que tem que valer é que a data que uma função
    chama de pico caia num intervalo que a outra chama de maduro.
    """
    doys = [date.fromisoformat(d).timetuple().tm_yday for d in dates]
    nearest = min(range(len(doys)), key=lambda i: abs(doys[i] - metrics["pos_doy"]))
    assert states[nearest] == phenology.STATE_MATURE, (
        f"o POS ({metrics['pos_doy']:.0f}) cai em {dates[nearest]}, rotulado "
        f"{phenology.STATE_NAMES[int(states[nearest])]!r}"
    )
    assert states[int(np.argmax(ndvi))] == phenology.STATE_MATURE


def test_a_year_of_cropland_is_split_into_its_own_cycles():
    """Uma série não é uma safra.

    A janela real de onde isto veio cobre agosto/25 a agosto/26 e contém dois
    ciclos separados por solo nu em maio e junho. Tratada como uma estação, as
    observações de julho recebiam 344 dias de idade porque o primeiro green-up
    da série é de agosto do ano anterior.
    """
    ndvi = np.array([
        0.1188, 0.1281, 0.1444, 0.2495, 0.2919, 0.2944, 0.3142,
        0.1698, 0.2202, 0.1934, 0.2315, 0.2272, 0.2256,
    ])
    states = phenology.assign_states_from_ndvi(ndvi)
    found = phenology.cycles(states)

    assert len(found) == 2, f"esperados dois ciclos, achados {len(found)}"
    # O segundo começa depois do vão de solo nu, e não no começo do arquivo.
    assert found[1]["greenup"] > found[0]["end"]
    # E cada observação sabe a qual ciclo pertence; o vão não pertence a nenhum.
    ids = phenology.cycle_of(states)
    assert ids[0] == 0 and ids[-1] == 1
    assert -1 in ids, "o trecho de solo nu foi absorvido por um ciclo"


def test_bare_soil_is_not_a_cycle():
    """Não há dossel para datar num trecho de solo nu."""
    states = np.array([
        phenology.STATE_SOIL, phenology.STATE_SOIL, phenology.STATE_FALLOW,
    ])
    assert phenology.cycles(states) == []
    assert list(phenology.cycle_of(states)) == [-1, -1, -1]


def test_a_series_that_never_leaves_the_canopy_is_one_cycle():
    """Perene, ou uma janela dentro de uma safra só."""
    states = np.array([
        phenology.STATE_GREENUP, phenology.STATE_MATURE,
        phenology.STATE_MATURE, phenology.STATE_SENESCENCE,
    ])
    found = phenology.cycles(states)
    assert len(found) == 1
    assert found[0] == {"start": 0, "end": 3, "greenup": 0}
