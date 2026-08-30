"""Idade do Helios que produz um LAI observado.

O ELO QUE FALTAVA, E EM QUE DIREÇÃO. A aplicação observa LAI: uma série de NDVI
do Sentinel-2 sobre a AOI, invertida por `lai_ndvi.py`. O Helios cresce no
sentido oposto -- por espécie e idade, no cronograma dele -- e não aceita "me dê
uma planta de LAI 2,4". Este módulo é a inversa que ele não oferece, lendo a
escada que `tools/gen_lai_ladder.py` gera.

    LAI = area_foliar_por_planta * plantas_por_m2

A escada guarda área por planta, que é propriedade da planta; a densidade é
escolha de quem semeia. Uma tabela serve para qualquer semeadura.

O QUE ESTE MÓDULO RECUSA, E POR QUÊ RECUSAR É O TRABALHO. Uma inversão que
sempre devolve um número é pior que uma que às vezes diz não, porque a resposta
errada é indistinguível da certa a jusante. Três recusas:

  fora do alcance   O LAI pedido é maior que a planta jamais atinge. Devolver a
                    idade máxima seria alegar um dossel que a espécie não faz.
  no platô          Passada `plateau_day` a área foliar não muda mais, então a
                    idade não é identificável a partir dela. A fenologia do EO
                    desempata -- SENESCENCE é tardio mesmo com a área do dia 40 --
                    e é por isso que `resolve` aceita uma dica de estágio.
  espécie ausente   A biblioteca não traz cana, café nem algodão. Uma escolha
                    silenciosa de espécie parecida seria inventar a arquitetura
                    que a simulação existe para medir.

A INTERPOLAÇÃO É LINEAR ENTRE DEGRAUS, e isso é adequado porque os degraus são
finos onde importa: no sorgo a escada anda 0,13 de LAI por dia entre os dias 20
e 40, então 0,1 de erro em LAI é 0,8 dia. Uma spline suavizaria uma curva cuja
resolução já é mais fina que a incerteza da entrada.

O LIMITE DE FUNDO, MEDIDO E NÃO SUPOSTO: O HELIOS NÃO MODELA COMPETIÇÃO.

`plantarchitecture` cresce a ontogenia de uma planta, não a resposta dela à
vizinhança. Verificado: soja aos 60 dias dá 1,402 m² isolada e 1,371 m² dentro
de um dossel de 24 plantas a 30 pl/m² -- razão 0,98, ou seja, a vizinhança não
muda nada. Cada planta cresce como se estivesse sozinha no campo.

A consequência aparece ao multiplicar pela densidade real de semeadura:

    espécie   LAI alcançável na densidade de campo    LAI real da cultura
    milho     4,7 - 7,5  (5-8 pl/m²)                  3 - 6      ok
    arroz     2,9 - 7,2  (100-250 pl/m²)              4 - 7      ok
    sorgo     3,8       (5 pl/m²)                     3 - 5      ok
    trigo     12,8 - 25,6 (200-400 pl/m²)             4 - 7      alto demais
    caupi     12,8 - 25,6 (10-20 pl/m²)               3 - 5      alto demais
    soja      37 - 75    (20-40 pl/m²)                4 - 7      alto demais
    feijão    35 - 59    (15-25 pl/m²)                3 - 5      alto demais

Onde a escada passa do LAI real, a inversão continua devolvendo um número --
uma idade jovem cuja área foliar bate -- mas a planta é juvenil onde o campo
tem uma planta madura e estiolada, com distribuição vertical e ângulos foliares
completamente outros. O número está certo e a arquitetura não, que é exatamente
o erro que esta simulação existe para não cometer.

`disagreement()` abaixo é o diagnóstico: a fenologia do EO dá uma idade
independente (dias desde o green-up), e quando as duas discordam muito é sinal
de que o modelo de planta isolada não se aplica àquela cultura naquela
semeadura. Não é opinião do módulo -- são dois números observáveis lado a lado.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

LADDER_PATH = Path(__file__).resolve().parent / "data" / "lai_ladder.json"

# Estágios em que simular um dossel faz sentido. Fora deles não há dossel para
# simular, e devolver um seria descrever folha onde a série diz que não há.
GROWING_STATES = ("greenup", "mature", "senescence")


class LadderError(RuntimeError):
    """A escada não pode responder, e a mensagem diz o que mudar."""


@lru_cache(maxsize=1)
def load(path: str | None = None) -> dict:
    p = Path(path) if path else LADDER_PATH
    if not p.is_file():
        raise LadderError(
            f"a escada LAI->idade não existe em {p}. Gere com: "
            f"python sidecar/tools/gen_lai_ladder.py"
        )
    return json.loads(p.read_text())


def species(path: str | None = None) -> list[str]:
    """As espécies que a escada cobre, ordenadas."""
    return sorted(load(path)["species"])


def leaf_area_for(lai: float, density: float) -> float:
    """A área foliar por planta que um LAI implica, dada a densidade."""
    if density <= 0:
        raise LadderError("a densidade tem que ser positiva")
    return float(lai) / float(density)


def resolve(lai: float, density: float, name: str, *, state: str | None = None,
            path: str | None = None) -> dict:
    """A idade que produz `lai` naquela densidade, ou o motivo de não haver uma.

    `state` é o estágio fenológico observado, quando houver. Ele não escolhe a
    idade -- a área foliar faz isso -- mas decide se o platô é resposta ou
    recusa: uma série em SENESCENCE com a área do platô é uma planta madura,
    não uma de quarenta dias, e a idade correta é desconhecida dentro do platô
    em vez de errada.
    """
    table = load(path)
    if name not in table["species"]:
        raise LadderError(
            f"{name!r} não está na escada. Cobertas: {', '.join(species(path))}"
        )
    if state is not None and state.lower() not in GROWING_STATES:
        raise LadderError(
            f"a série diz {state!r} nesta data, então não há dossel para simular"
        )

    entry = table["species"][name]
    steps = entry["steps"]
    days = np.array([s["day"] for s in steps], float)
    areas = np.array([s["leaf_area_m2"] for s in steps], float)
    heights = np.array([s["height_m"] for s in steps], float)

    target = leaf_area_for(lai, density)
    reachable = float(entry["max_leaf_area_m2"])

    if target > reachable:
        raise LadderError(
            f"LAI {lai:.2f} a {density:g} plantas/m² pede {target:.3f} m² por "
            f"planta, e {name} não passa de {reachable:.3f} m² "
            f"(LAI {reachable * density:.2f} nessa densidade). A série está no "
            f"regime saturado do NDVI, ou a densidade está subestimada."
        )

    plateau = entry.get("plateau_day")
    # Só o trecho crescente é invertível; o platô repete a mesma área e faria
    # a busca devolver a primeira idade que a atinge, que é a resposta certa
    # apenas quando a planta é de fato jovem.
    if plateau is not None:
        keep = days <= plateau
        days, areas, heights = days[keep], areas[keep], heights[keep]

    order = np.argsort(areas)
    day = float(np.interp(target, areas[order], days[order]))
    height = float(np.interp(target, areas[order], heights[order]))

    at_plateau = plateau is not None and target >= areas.max() * (1 - 1e-9)
    result = {
        "species": name,
        "lai": float(lai),
        "density": float(density),
        "leaf_area_m2": target,
        "day": day,
        "height_m": height,
        "plateau_day": plateau,
        "at_plateau": bool(at_plateau),
        "state": state,
    }

    if at_plateau:
        if state is not None and state.lower() != "greenup":
            # Madura ou senescendo com a área do platô: a idade não é
            # recuperável, e dizer isso é mais útil que fixar plateau_day.
            result["day"] = None
            result["day_at_least"] = plateau
            result["why"] = (
                f"a área foliar satura no dia {plateau} e a série diz {state}, "
                f"então a idade está acima disso e não é identificável pelo LAI"
            )
        else:
            result["why"] = (
                f"no limite do crescimento: a partir do dia {plateau} a área "
                f"foliar não muda, então esta é a idade mais nova compatível"
            )
    return result


def reachable_lai(name: str, density: float, path: str | None = None) -> float:
    """O maior LAI que esta espécie atinge naquela densidade.

    Comparar isto com o LAI que a cultura de fato alcança é o teste barato de
    se o modelo de planta isolada serve para a semeadura em questão: se a
    escada passa muito do real, a competição que o Helios não modela é grande
    o bastante para invalidar a arquitetura, ainda que a área foliar feche.
    """
    table = load(path)
    if name not in table["species"]:
        raise LadderError(f"{name!r} não está na escada")
    return float(table["species"][name]["max_leaf_area_m2"]) * float(density)


def disagreement(resolved_day: float | None, plateau_day: float | None,
                 days_since_greenup: float | None, season_days: float | None,
                 tolerance: float = 0.20) -> dict:
    """Compara o PROGRESSO do desenvolvimento, não os dias.

    POR QUE NÃO DIAS. Os dois relógios não andam no mesmo passo. O sorgo do
    Helios satura a área foliar no dia 40; uma safra de sorgo em campo leva
    perto de cem dias até o pico. Subtrair um do outro mistura duas coisas
    diferentes -- a diferença de ritmo dos relógios, que é uma propriedade do
    modelo, e a competição que o Helios não representa -- e o resultado cresce
    ao longo da estação parecendo um defeito onde há dois.

    Normalizar remove o ritmo e deixa a forma. Ambos viram fração percorrida:

        progresso do Helios  = idade / dia do platô
        progresso do campo   = dias desde o green-up / duração da estação

    Se as duas frações andam juntas, a planta isolada descreve a safra. Se a do
    Helios corre à frente, ele chega àquela área foliar cedo demais no ciclo --
    que é a assinatura da competição ausente, agora separada do ritmo.

    Devolve as duas frações sem escolher entre elas. Escolher esconderia
    justamente o que o leitor precisa ver.
    """
    have = (resolved_day is not None and plateau_day
            and days_since_greenup is not None and season_days)
    if not have:
        return {"comparable": False,
                "why": "falta a idade, o platô, o green-up ou a duração da estação"}

    # The four are not None past the guard above; mypy cannot see that
    # through the dict the guard returns.
    assert resolved_day is not None and plateau_day is not None
    assert days_since_greenup is not None and season_days is not None
    p_helios = float(resolved_day) / float(plateau_day)
    p_field = float(days_since_greenup) / float(season_days)
    delta = p_helios - p_field
    return {
        "comparable": True,
        "progress_helios": p_helios,
        "progress_field": p_field,
        "delta_progress": delta,
        "agrees": abs(delta) <= tolerance,
        "why": (
            "as duas progressões andam juntas, então a planta isolada descreve "
            "esta safra"
            if abs(delta) <= tolerance else
            f"o Helios está {abs(delta) * 100:.0f} pontos percentuais "
            f"{'à frente' if delta > 0 else 'atrás'} do ciclo observado nesta "
            f"área foliar; à frente é a assinatura da competição que ele não "
            f"modela"
        ),
    }


def resolve_series(lai, density, name, *, states=None, dates=None,
                   path: str | None = None) -> list[dict]:
    """`resolve` sobre uma série, guardando a recusa em vez de interrompê-la.

    Uma data que não pode ser resolvida não invalida as outras -- uma série
    cobre uma estação inteira e as pontas são solo nu por construção -- então
    cada entrada carrega ou uma idade ou o motivo de não ter.
    """
    lai = np.atleast_1d(np.asarray(lai, float))
    n = len(lai)
    states = list(states) if states is not None else [None] * n
    dates = list(dates) if dates is not None else [None] * n
    if not (len(states) == len(dates) == n):
        raise LadderError(
            f"{n} valores de LAI contra {len(states)} estados e {len(dates)} datas"
        )

    out = []
    for value, state, date in zip(lai, states, dates, strict=True):
        row: dict = {"date": date, "lai": float(value)}
        try:
            row.update(resolve(float(value), density, name, state=state, path=path))
        except LadderError as exc:
            row["error"] = str(exc)
        out.append(row)
    return out
