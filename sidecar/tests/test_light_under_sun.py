"""Luz sob um sol medido, e não sob seis direções escolhidas para testar shader.

Estes testes não precisam do Helios nem do NASA POWER: o histograma de energia
de feixe é uma matriz, e é contra ela que esta camada trabalha. Fabricar o
histograma é o que permite exercitar casos que um registro real não isola --
todo o ano num zênite só, ou toda a energia rasante.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from terra.canopy import field as cf  # noqa: E402


@pytest.fixture
def slab():
    """Um dossel uniforme, cujo k é conhecido analiticamente.

    Slab cheio em vez de arquitetura: aqui o que se testa é a integração sobre
    o céu, e um meio homogêneo tem resposta fechada (k = G/cos z) contra a qual
    a integração pode ser conferida.
    """
    grid, meta = cf.row_field(spacing=1.0, lai=2.0, height=1.0,
                              row_width_frac=1.0, cell=0.05, z_top=1.0)
    return cf.canopy_of(grid, meta)


def _hist(elevation_deg, n_az=16, energy=1.0):
    """Um histograma com toda a energia numa elevação."""
    el_edges = np.arange(0.0, 91.0, 1.0)
    h = np.zeros((n_az, len(el_edges) - 1))
    idx = int(np.clip(elevation_deg, 0, 89))
    h[0, idx] = energy
    return h, el_edges


def test_overhead_beam_reproduces_the_analytic_coefficient(slab):
    """Toda a energia no zênite tem que dar k = G, que é 0,5 num meio aleatório.

    É a mesma verificação que o estudo E-architecture-vs-slab faz por fora, e
    ancorá-la aqui é o que impede a integração de derivar sem nada falhar.
    """
    h, edges = _hist(89.5)
    r = cf.light_under_sun(slab, h, edges)
    assert r["k_emergent"] == pytest.approx(cf.cv.G_LEAF, abs=0.02)


def test_a_low_sun_intercepts_more_than_a_high_one(slab):
    """Caminho óptico maior, mais folha atravessada. Se esta ordem inverter, a
    conversão de elevação para direção está trocada."""
    high = cf.light_under_sun(slab, *_hist(80.0))
    low = cf.light_under_sun(slab, *_hist(20.0))
    assert low["fapar"] > high["fapar"]
    assert low["k_emergent"] > high["k_emergent"]


def test_energy_weighting_is_what_distinguishes_this_from_reference_suns(slab):
    """Dois sóis com pesos diferentes dão respostas diferentes.

    É a diferença de fundo entre este cálculo e REFERENCE_SUNS, onde seis
    direções contam igual porque foram escolhidas para estressar um shader e
    não para descrever um céu.
    """
    el_edges = np.arange(0.0, 91.0, 1.0)
    mostly_high = np.zeros((16, 90))
    mostly_high[0, 80] = 9.0
    mostly_high[0, 20] = 1.0
    mostly_low = np.zeros((16, 90))
    mostly_low[0, 80] = 1.0
    mostly_low[0, 20] = 9.0
    a = cf.light_under_sun(slab, mostly_high, el_edges)
    b = cf.light_under_sun(slab, mostly_low, el_edges)
    assert b["fapar"] > a["fapar"]


def test_diffuse_raises_interception_because_it_arrives_from_everywhere(slab):
    """Um dossel iluminado só pelo feixe é iluminado por uma fração do dia."""
    beam_only = cf.light_under_sun(slab, *_hist(89.5))
    with_sky = cf.light_under_sun(slab, *_hist(89.5), dhi_share=0.5)
    assert with_sky["fapar"] > beam_only["fapar"]
    assert with_sky["diffuse_transmittance"] is not None
    # O difuso vem de todas as direções, inclusive rasantes, entao atravessa
    # mais folha que um feixe zenital.
    assert with_sky["diffuse_transmittance"] < with_sky["beam_transmittance"]


def test_the_hemisphere_weights_are_a_normalised_cosine_projection():
    """Os pesos somam 1, e bandas de elevação iguais pesam IGUAL.

    A segunda metade é contraintuitiva e foi escrita ao contrário na primeira
    versão deste teste, que exigia que a banda do zênite pesasse mais. Ela não
    pesa: o peso projetado de uma banda é sin²(e_alto) - sin²(e_baixo), e para
    bandas de 15 graus isso dá 0,067 tanto de 0 a 15 quanto de 75 a 90. A banda
    rasante é muito mais larga em ângulo sólido e cada direção nela é muito mais
    inclinada, e os dois efeitos se cancelam exatamente.

    Fixar isso importa porque o erro que ele pega é o oposto: um céu ponderado
    por ângulo sólido sem a projeção por cosseno entregaria energia rasante
    demais, e a diferença não apareceria em nenhum total.
    """
    dirs, w = cf._hemisphere()
    assert w.sum() == pytest.approx(1.0)
    assert len(dirs) == len(w)

    n_az, n_el = 8, 6
    bands = w.reshape(n_el, n_az).sum(axis=1)
    # Simétrico: a banda do zênite e a rasante pesam igual.
    assert bands[0] == pytest.approx(bands[-1])
    # E o máximo fica no MEIO, não numa das pontas. O ângulo sólido cresce para
    # o horizonte enquanto o cosseno decresce, e o produto tem pico perto de 45
    # graus. Uma versão anterior deste teste exigiu primeiro que o zênite fosse
    # o maior e depois que todos fossem iguais; as duas descreviam céus que não
    # existem.
    assert int(np.argmax(bands)) in (n_el // 2 - 1, n_el // 2)


def test_a_dark_record_is_refused_rather_than_divided_by(slab):
    el_edges = np.arange(0.0, 91.0, 1.0)
    with pytest.raises(ValueError, match="no energy"):
        cf.light_under_sun(slab, np.zeros((16, 90)), el_edges)


def test_the_fixed_k_error_is_reported_against_what_was_marched(slab):
    """O número que um usuário de modelo de cultura precisa.

    Não um segundo faPAR, mas o quanto o slab erra aqui -- que é a pergunta
    que ele tem.
    """
    r = cf.light_under_sun(slab, *_hist(89.5))
    assert r["fixed_k"] == cf.CROP_MODEL_K
    expected = 1.0 - np.exp(-cf.CROP_MODEL_K * r["lai"])
    assert r["fapar_fixed_k"] == pytest.approx(expected)
    # Num slab uniforme o k real é 0,5 e o fixo é 0,7, entao o fixo superestima.
    assert r["fixed_k_error_pct"] > 0


def test_row_orientation_reaches_the_march(slab):
    """A orientação tem que chegar na direção, e não ser aceita e ignorada.

    Um slab uniforme é isotrópico no plano, entao girar as fileiras nao pode
    mudar nada -- o que este teste fixa é que o parâmetro atravessa e é
    devolvido, para que a checagem da anisotropia tenha onde se apoiar.
    """
    a = cf.light_under_sun(slab, *_hist(30.0), row_azimuth_deg=0.0)
    b = cf.light_under_sun(slab, *_hist(30.0), row_azimuth_deg=90.0)
    assert a["row_azimuth_deg"] == 0.0
    assert b["row_azimuth_deg"] == 90.0
    assert a["fapar"] == pytest.approx(b["fapar"], abs=0.02)


def test_canopy_azimuth_is_mirrored_by_the_scene_in_typescript():
    """Uma convenção duplicada em duas linguagens.

    `sceneAzimuthFromCompass` em frontend/src/components/whiteboard/standScene.ts
    faz esta mesma aritmética em graus, para que a figura e o número sejam
    iluminados pelo mesmo sol. Não há runner de teste no frontend, então o par é
    fixado aqui: quem mudar esta fórmula tem o nome da gêmea no assert que
    falhar.

    Azimute solar é horário a partir do norte; o campo mede anti-horário a
    partir do próprio +x, porque um talhão não tem norte -- tem um módulo com
    dois eixos. O que junta os dois é a direção das linhas, que é agronomia.
    """
    from terra.canopy.field import _canopy_azimuth

    for compass, row in ((0.0, 0.0), (90.0, 0.0), (170.0, 30.0), (350.0, 0.0)):
        graus_ts = 90.0 - (compass - row)          # sceneAzimuthFromCompass
        assert np.isclose(_canopy_azimuth(compass, row), np.radians(graus_ts))

    # Norte no compasso é +y no campo; leste é +x. Se isto inverter, toda sombra
    # da cena aponta para o lado errado de forma inteiramente plausível.
    assert np.isclose(_canopy_azimuth(0.0), np.radians(90.0))
    assert np.isclose(_canopy_azimuth(90.0), 0.0)
