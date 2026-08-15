"""A inversão LAI -> idade, e sobretudo as recusas.

Uma inversão que sempre devolve um número é pior que uma que às vezes diz não:
a resposta errada é indistinguível da certa a jusante, e o consumidor é um
gerador de geometria que vai desenhar seja lá o que for entregue. Por isso a
maior parte destes testes exercita o caminho da recusa.

Nenhum precisa do Helios: a escada é um arquivo de dados, e é contra ele que
esta camada trabalha.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import lai_to_age as l2a  # noqa: E402


@pytest.fixture
def ladder(tmp_path):
    """Uma escada mínima com um platô explícito, escrita em disco.

    Fabricada e não a real, para que estes testes descrevam o comportamento da
    inversão e não os números de uma espécie que o upstream pode reparametrizar.
    """
    path = tmp_path / "ladder.json"
    path.write_text(json.dumps({
        "species": {
            "testcrop": {
                "steps": [
                    {"day": 10, "leaf_area_m2": 0.10, "height_m": 0.20},
                    {"day": 20, "leaf_area_m2": 0.30, "height_m": 0.50},
                    {"day": 30, "leaf_area_m2": 0.50, "height_m": 0.90},
                    {"day": 40, "leaf_area_m2": 0.50, "height_m": 0.90},
                ],
                "plateau_day": 30,
                "max_leaf_area_m2": 0.50,
                "max_height_m": 0.90,
            }
        }
    }))
    l2a.load.cache_clear()
    yield str(path)
    l2a.load.cache_clear()


def test_resolves_within_the_growing_stretch(ladder):
    # LAI 2 a 5 pl/m2 = 0.4 m2/planta, entre os degraus de 20 e 30 dias.
    r = l2a.resolve(2.0, 5.0, "testcrop", path=ladder)
    assert r["leaf_area_m2"] == pytest.approx(0.4)
    assert 20 < r["day"] < 30
    # Interpolação linear: 0.4 esta na metade entre 0.30 e 0.50.
    assert r["day"] == pytest.approx(25.0)
    assert r["height_m"] == pytest.approx(0.70)


def test_density_is_what_turns_area_into_lai(ladder):
    """A mesma área foliar é um LAI diferente em cada semeadura.

    É por isso que a escada guarda área por planta: uma tabela de LAI seria uma
    tabela sobre uma densidade só.
    """
    dense = l2a.resolve(2.0, 10.0, "testcrop", path=ladder)
    sparse = l2a.resolve(2.0, 5.0, "testcrop", path=ladder)
    assert dense["leaf_area_m2"] < sparse["leaf_area_m2"]
    assert dense["day"] < sparse["day"]


def test_refuses_a_lai_the_plant_never_reaches(ladder):
    with pytest.raises(l2a.LadderError, match="não passa de"):
        l2a.resolve(10.0, 5.0, "testcrop", path=ladder)


def test_refuses_an_unknown_species(ladder):
    """Escolher uma espécie parecida em silêncio inventaria a arquitetura que
    a simulação existe para medir."""
    with pytest.raises(l2a.LadderError, match="não está na escada"):
        l2a.resolve(1.0, 5.0, "sugarcane", path=ladder)


@pytest.mark.parametrize("state", ["soil", "fallow"])
def test_refuses_where_the_series_says_there_is_no_canopy(ladder, state):
    with pytest.raises(l2a.LadderError, match="não há dossel"):
        l2a.resolve(1.0, 5.0, "testcrop", state=state, path=ladder)


def test_at_the_plateau_a_mature_series_gets_a_lower_bound_not_an_age(ladder):
    """Passado o platô a área foliar não identifica mais uma idade.

    Devolver `plateau_day` seria afirmar que a planta tem exatamente aquela
    idade, quando tudo o que se sabe é que tem pelo menos aquilo.
    """
    r = l2a.resolve(2.5, 5.0, "testcrop", state="senescence", path=ladder)
    assert r["at_plateau"] is True
    assert r["day"] is None
    assert r["day_at_least"] == 30
    assert "não é identificável" in r["why"]


def test_at_the_plateau_a_greenup_series_gets_the_youngest_compatible_age(ladder):
    r = l2a.resolve(2.5, 5.0, "testcrop", state="greenup", path=ladder)
    assert r["at_plateau"] is True
    assert r["day"] == pytest.approx(30.0)


def test_reachable_lai_scales_with_density(ladder):
    assert l2a.reachable_lai("testcrop", 5.0, path=ladder) == pytest.approx(2.5)
    assert l2a.reachable_lai("testcrop", 20.0, path=ladder) == pytest.approx(10.0)


def test_a_series_keeps_going_past_a_date_it_cannot_resolve(ladder):
    """As pontas de uma série são solo nu por construção, então uma data
    irresolúvel não pode invalidar a estação inteira."""
    rows = l2a.resolve_series(
        [0.5, 2.0, 99.0], 5.0, "testcrop",
        states=["greenup", "mature", "mature"],
        dates=["2024-01-01", "2024-02-01", "2024-03-01"],
        path=ladder,
    )
    assert len(rows) == 3
    assert "error" not in rows[0] and "error" not in rows[1]
    assert "error" in rows[2] and "não passa de" in rows[2]["error"]
    # A data acompanha a linha, resolvida ou não, senão o consumidor não sabe
    # qual observação foi recusada.
    assert [r["date"] for r in rows] == ["2024-01-01", "2024-02-01", "2024-03-01"]


def test_disagreement_reports_both_ages_without_choosing(ladder):
    """O diagnóstico do modelo de planta isolada.

    O Helios não modela competição -- medido: soja isolada 1.402 m2, em dossel
    a 30 pl/m2 1.371 m2, razão 0.98 -- então em plantio adensado a área foliar
    é atingida cedo demais. As duas idades lado a lado mostram isso.
    """
    ok = l2a.disagreement(28.0, 30.0)
    assert ok["agrees"] is True

    bad = l2a.disagreement(12.0, 70.0)
    assert bad["agrees"] is False
    assert bad["delta_days"] == pytest.approx(-58.0)
    assert "competição" in bad["why"]
    # Ambos preservados: escolher um esconderia o que o leitor precisa ver.
    assert bad["day_from_leaf_area"] == 12.0
    assert bad["day_from_phenology"] == 70.0


def test_disagreement_says_so_when_it_cannot_compare(ladder):
    assert l2a.disagreement(None, 30.0)["comparable"] is False
    assert l2a.disagreement(20.0, None)["comparable"] is False
