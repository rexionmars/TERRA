"""Que planta crescer para a cobertura classificada, e quando não crescer nenhuma.

A metade que importa aqui é a recusa. Escolher uma espécie parecida para uma
cana ou um café produziria um número plausível a partir de uma arquitetura
inventada, que é exatamente o erro que esta simulação existe para não cometer.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from terra.canopy import species as cs  # noqa: E402


def stats(*rows):
    return [{"class_id": c, "name": n, "pct": p} for c, n, p in rows]


def test_soybean_is_suggested_from_the_dominant_class():
    """A AOI real contra a qual isto foi construído."""
    got = cs.suggest(stats((39, "Soybean", 50.45),
                           (21, "Agriculture-Pasture Mosaic", 42.06),
                           (41, "Other Temporary Crops", 3.36)))
    assert got["species"] == "soybean"
    assert got["confidence"] == pytest.approx(0.5045)
    assert "50%" in got["why"]


def test_a_crop_the_library_does_not_grow_is_refused_by_name():
    """Cana, café e silvicultura são lavoura e não têm planta.

    A recusa nomeia a cultura em vez de dizer apenas que não há espécie: o
    leitor precisa saber que o dado identificou a lavoura e o simulador é que
    não a tem.
    """
    for cid, name, word in [(20, "Sugar Cane", "cana"),
                            (46, "Coffee", "café"),
                            (9, "Forest Plantation", "eucalipto")]:
        got = cs.suggest(stats((cid, name, 70.0)))
        assert got["species"] is None
        assert word in got["why"]
        # E a fração continua reportada: a recusa não apaga o que foi medido.
        assert got["confidence"] == pytest.approx(0.7)


def test_the_catch_all_crop_classes_identify_no_plant():
    bucket = cs.suggest(stats((41, "Other Temporary Crops", 54.0)))
    assert bucket["species"] is None
    assert "balde" in bucket["why"]

    mosaic = cs.suggest(stats((21, "Agriculture-Pasture Mosaic", 50.0)))
    assert mosaic["species"] is None
    assert "mistura" in mosaic["why"]


def test_non_crop_cover_suggests_nothing():
    got = cs.suggest(stats((24, "Urban Area", 80.0)))
    assert got["species"] is None
    assert "não é lavoura" in got["why"]


def test_an_empty_classification_answers_rather_than_raising():
    """Uma sugestão ausente é resposta; o consumidor tem padrão próprio."""
    for empty in (None, [], [{"class_id": 39, "name": "Soybean"}]):
        got = cs.suggest(empty)
        assert got["species"] is None
        assert got["why"]


def test_the_mosaic_is_not_crop_for_the_purpose_of_masking():
    """A decisão que faz a máscara valer alguma coisa.

    O mosaico agricultura-pastagem é mistura declarada. Incluí-lo devolve para
    dentro da média exatamente a diluição que mascarar existe para tirar: na AOI
    medida, soja cobria 50% e mosaico 42%, então com ele a máscara pegaria 92%
    da área e a média ficaria praticamente onde estava.
    """
    from terra import mapbiomas as mb_source
    assert 21 not in mb_source.CROP_CLASSES
    assert 39 in mb_source.CROP_CLASSES


def test_crop_mask_selects_only_crop_pixels():
    import numpy as np

    from terra import mapbiomas as mb_source

    m = np.array([
        [39, 21, -1],   # soja, mosaico, sem predição
        [41, 15, 20],   # temporárias, pastagem, cana
        [24, 46, 3],    # urbano, café, floresta
    ])
    got = mb_source.crop_mask(m)
    assert got.sum() == 4
    assert got[0, 0] and got[1, 0] and got[1, 2] and got[2, 1]
    # -1 é o que classify_from_features escreve onde não houve predição, e não
    # pode entrar por acidente.
    assert not got[0, 2]
    assert not got[1, 1] and not got[2, 0] and not got[2, 2]


def test_an_aoi_with_no_cropland_masks_nothing():
    """Uma resposta, não uma falha: nem toda AOI tem lavoura."""
    import numpy as np

    from terra import mapbiomas as mb_source

    assert not mb_source.crop_mask(np.array([[15, 24], [3, 33]])).any()
