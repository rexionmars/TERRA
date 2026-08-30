"""Qual planta o Helios deve crescer para a cobertura que o modelo classificou.

O ELO QUE FALTAVA ENTRE DUAS METADES QUE JÁ EXISTIAM. A aplicação classifica a
cobertura da AOI e sabe dizer "soja" em metade dos pixels; o Helios cresce trinta
espécies. Sem este mapa, quem lê uma AOI de soja recebe o padrão do editor -- que
é sorgo -- e a arquitetura simulada não tem relação nenhuma com a lavoura
observada. A espécie deixa de ser escolha e passa a ser consequência do dado.

RECUSAR É METADE DO TRABALHO, e a metade que importa mais aqui. Três das classes
mais comuns do Brasil não têm planta correspondente:

    Sugar Cane (20)              o plantarchitecture não traz cana
    Coffee (46)                  nem café
    Forest Plantation (9)        nem eucalipto

Escolher uma espécie parecida para essas seria inventar exatamente a arquitetura
que a simulação existe para medir, e o erro sairia como um número plausível. Elas
mapeiam para nada, e quem chamar recebe o motivo.

DUAS CLASSES SÃO AMBÍGUAS POR CONSTRUÇÃO e também não mapeiam:

    Other Temporary Crops (41)   é um balde: soja, milho, algodão, feijão
    Agriculture-Pasture Mosaic   é mistura declarada, não uma cultura

Para essas o dado não identifica uma planta, e a sugestão certa é nenhuma. O
leitor escolhe, sabendo que escolheu.

CONFIANÇA VEM JUNTO. Uma classe que cobre 8% da área é uma sugestão muito pior
que uma que cobre 80%, e a fração é o que diz qual das duas se está lendo.
"""
from __future__ import annotations

# Classe do MapBiomas -> espécie do plantarchitecture.
#
# Só entram as que têm correspondência real. A ausência de uma classe aqui não é
# lacuna a preencher: é a afirmação de que o Helios não cresce aquela planta.
CLASS_TO_SPECIES = {
    39: "soybean",
}

# Classes que são lavoura mas cuja espécie a biblioteca não traz. Separadas das
# desconhecidas porque a recusa é diferente: aqui o dado identifica a cultura e
# o simulador é que não a tem.
CROPS_WITHOUT_A_PLANT = {
    20: "cana-de-açúcar",
    46: "café",
    9: "eucalipto ou outra silvicultura",
}

# Lavoura, mas a classe não diz qual. Um balde e uma mistura.
AMBIGUOUS_CROP_CLASSES = {
    41: ("é um balde que reúne soja, milho, algodão e feijão, então não "
         "identifica uma planta"),
    21: ("é mistura declarada de agricultura com pastagem, não uma cultura"),
}


def suggest(class_stats) -> dict:
    """A espécie que a classificação sugere, ou por que não sugere nenhuma.

    `class_stats` é a lista que o `lulc` já produz: dicts com `class_id`,
    `name` e `pct`. A classe dominante decide, porque é a única leitura que a
    composição de uma AOI oferece sem supor onde dentro dela está a lavoura.

    Devolve sempre um dict com `species` (str ou None) e `why`, e nunca levanta:
    uma sugestão ausente é uma resposta, e o consumidor tem um padrão próprio.
    """
    rows = [r for r in (class_stats or []) if r.get("pct") is not None]
    if not rows:
        return {"species": None, "confidence": 0.0,
                "why": "a classificação não trouxe composição"}

    top = max(rows, key=lambda r: float(r["pct"]))
    cid = int(top.get("class_id", -1))
    pct = float(top["pct"])
    name = str(top.get("name", cid))
    common = {"class_id": cid, "class_name": name, "confidence": pct / 100.0}

    if cid in CLASS_TO_SPECIES:
        return {**common, "species": CLASS_TO_SPECIES[cid],
                "why": f"{name} cobre {pct:.0f}% da área"}

    if cid in CROPS_WITHOUT_A_PLANT:
        return {**common, "species": None,
                "why": (f"{name} cobre {pct:.0f}% da área, mas o "
                        f"plantarchitecture não traz {CROPS_WITHOUT_A_PLANT[cid]}; "
                        f"escolher uma planta parecida inventaria a arquitetura "
                        f"que a simulação existe para medir")}

    if cid in AMBIGUOUS_CROP_CLASSES:
        return {**common, "species": None,
                "why": f"{name} {AMBIGUOUS_CROP_CLASSES[cid]}"}

    return {**common, "species": None,
            "why": f"{name} cobre {pct:.0f}% da área e não é lavoura"}




