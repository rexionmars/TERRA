"""
Helios -> TERRA. Pulls a grown scene out of Helios into numpy arrays.

MIRRORED from the numerical-studies repository, kept in its original wording for
the reason canopy.py states:

    TERRA-Simulation @ 0334784
    tools/helios_bridge.py

TWO CONSUMERS, WHICH IS WHY THERE ARE TWO OUTPUTS. `leaf_cloud` feeds the canopy
engines next to this file -- numpy, no GPU. `write_gltf` feeds three.js in the
Wails webview. Helios enters only as an architecture generator; nothing here
touches its radiation plug-in, and so nothing here needs a GPU.

THE CONTRACT, WHICH IS WHY THERE IS NO IMPORT. This module never imports
pyhelios. Helios arrives as an object the caller passes in, and the duck typing
is the interface -- so it is written down here, because a docstring is what
replaces an import you can read:

    ctx  .getAllUUIDs()                     -> sequence of primitive ids
         .getAllPrimitiveVertices()         -> (flat xyz, start offsets)
         .getAllPrimitiveAreas()            -> one area per primitive
         .getAllPrimitiveNormals()          -> flat xyz, one normal each
         .getPrimitiveData(uuid, "object_label")
                                            -> shoot | petiole | leaf |
                                               fruit | peduncle
    pa   .getPlantLeafArea(plant_id)        -> leaf area, for self_check

Two consequences follow from there being no import. The bridge is not a
derivative work of Helios, which keeps the GPL-2/GPL-3 boundary intact as long
as whoever builds `ctx` runs inside the sidecar process. And the whole module is
exercisable without Helios installed and without a GPU, by anything that
satisfies the five methods above -- which is what sidecar/tests/
test_helios_bridge.py does.

`import struct` was dropped on the way in because the origin never used it. It is
back: `write_glb` packs the GLB container's little-endian headers with it.
"""

import base64
import json
import struct
from pathlib import Path

import numpy as np

# Cores por órgão, usadas no glTF. Não são físicas -- são para a cena.
ORGAN_COLOR = {
    "leaf": (0.24, 0.48, 0.18),
    "petiole": (0.32, 0.42, 0.20),
    "shoot": (0.35, 0.26, 0.16),
    "fruit": (0.62, 0.30, 0.22),
    "peduncle": (0.34, 0.40, 0.22),
}


def extract(ctx, organ_uuids=None):
    """Cena do Helios em arrays. Devolve dict por órgão.

    `getAllPrimitiveVertices` devolve (flat, offsets): as coordenadas de todas
    as primitivas concatenadas, e o índice de início de cada uma. Primitiva com
    3 vértices é triângulo; com 4, é patch, e sai triangulada em duas.

    DE ONDE VEM O RÓTULO. Originalmente de `getPrimitiveData(u, "object_label")`,
    uma string gravada em cada primitiva. Versões atuais do Helios não gravam
    dado nenhum na primitiva -- `listPrimitiveData` devolve lista vazia -- e
    expõem os órgãos como conjuntos de objetos, via `getPlantLeafObjectIDs` e
    companhia, que ficam em PlantArchitecture e não no contexto. Como este módulo
    não importa Helios e não conhece `pa`, quem chama passa o mapeamento pronto
    em `organ_uuids` ({órgão: uuids}); `helios_grow.leaf_cloud` o constrói.

    Sem o mapeamento, o caminho antigo continua valendo, para que qualquer
    contexto que ainda grave `object_label` -- e os dublês nos testes, que
    gravam -- siga funcionando sem alteração.
    """
    uuids = list(ctx.getAllUUIDs())
    flat, offsets = ctx.getAllPrimitiveVertices()
    flat = np.asarray(flat, dtype=np.float32)
    offsets = np.asarray(offsets, dtype=np.int64)
    areas = np.asarray(ctx.getAllPrimitiveAreas(), dtype=np.float64)
    normals = np.asarray(ctx.getAllPrimitiveNormals(), dtype=np.float32).reshape(-1, 3)

    if not (len(uuids) == len(offsets) - 1 == len(areas) == len(normals)):
        raise RuntimeError(
            f"desalinhamento: {len(uuids)} uuids, {len(offsets)-1} offsets, "
            f"{len(areas)} áreas, {len(normals)} normais")

    if organ_uuids is None:
        labels = [ctx.getPrimitiveData(u, "object_label") for u in uuids]
    else:
        # Invertido para um rótulo por uuid, na mesma ordem de `uuids`. O que
        # não estiver em órgão nenhum vira "other" em vez de sumir: uma
        # primitiva descartada aqui não reaparece a jusante, e o self_check
        # abaixo compara área de folha, então perda em outro órgão passaria.
        by_uuid = {}
        for organ, ids in organ_uuids.items():
            for u in ids:
                by_uuid[u] = organ
        labels = [by_uuid.get(u, "other") for u in uuids]

    out = {}
    for i, (_uuid, lab) in enumerate(zip(uuids, labels, strict=True)):
        v = flat[offsets[i]:offsets[i + 1]].reshape(-1, 3)
        d = out.setdefault(lab, {"tris": [], "centroids": [], "areas": [],
                                 "normals": []})
        if len(v) == 3:
            d["tris"].append(v)
        elif len(v) == 4:
            d["tris"].append(v[[0, 1, 2]])
            d["tris"].append(v[[0, 2, 3]])
        else:
            continue                      # tipo não suportado; ignorado
        d["centroids"].append(v.mean(axis=0))
        d["areas"].append(areas[i])
        d["normals"].append(normals[i])

    for d in out.values():
        d["tris"] = np.asarray(d["tris"], dtype=np.float32)
        d["centroids"] = np.asarray(d["centroids"], dtype=np.float64)
        d["areas"] = np.asarray(d["areas"], dtype=np.float64)
        d["normals"] = np.asarray(d["normals"], dtype=np.float64)
    return out


def leaf_cloud(scene, organs=("leaf",)):
    """Centróides e áreas das folhas, no formato que `canopy_voxel.Canopy` espera.

    Uma folha do Helios pode vir como várias primitivas; cada uma entra com a
    sua própria área. A soma é a área foliar da cena, e é ela que precisa
    fechar com `getPlantLeafArea` -- verificado em `self_check`.
    """
    pos = np.concatenate([scene[o]["centroids"] for o in organs if o in scene])
    area = np.concatenate([scene[o]["areas"] for o in organs if o in scene])
    return pos, area


# ---------------------------------------------------------------------------
# glTF
# ---------------------------------------------------------------------------

def write_gltf(scene, path, organs=None):
    """Escreve um .gltf auto-contido (buffer embutido em base64).

    Um nó por órgão, para que o three.js possa ligar e desligar folha, lenho e
    fruto separadamente sem reprocessar a malha.

    O buffer vai embutido e não como .bin externo porque o consumidor é um
    webview lendo de um diretório de trabalho do sidecar: um arquivo só evita
    resolver caminho relativo do outro lado.
    """
    organs = organs or [o for o in scene if len(scene[o]["tris"])]
    blobs, meshes, nodes, accessors, views = [], [], [], [], []
    offset = 0

    for oi, organ in enumerate(organs):
        tris = scene[organ]["tris"]
        if not len(tris):
            continue
        verts = tris.reshape(-1, 3).astype(np.float32)
        idx = np.arange(len(verts), dtype=np.uint32)

        vb, ib = verts.tobytes(), idx.tobytes()
        # glTF exige alinhamento de 4 bytes por bufferView.
        for data, target, comp, typ, count, mn, mx in (
                (vb, 34962, 5126, "VEC3", len(verts),
                 verts.min(axis=0).tolist(), verts.max(axis=0).tolist()),
                (ib, 34963, 5125, "SCALAR", len(idx), None, None)):
            pad = (-len(data)) % 4
            views.append({"buffer": 0, "byteOffset": offset,
                          "byteLength": len(data), "target": target})
            acc = {"bufferView": len(views) - 1, "componentType": comp,
                   "count": count, "type": typ}
            if mn is not None:
                acc["min"], acc["max"] = mn, mx
            accessors.append(acc)
            blobs.append(data + b"\0" * pad)
            offset += len(data) + pad

        meshes.append({"name": organ, "primitives": [{
            "attributes": {"POSITION": len(accessors) - 2},
            "indices": len(accessors) - 1, "material": oi}]})
        nodes.append({"mesh": len(meshes) - 1, "name": organ})

    buf = b"".join(blobs)
    gltf = {
        "asset": {"version": "2.0", "generator": "TERRA helios_bridge"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes,
        "materials": [{"name": o, "pbrMetallicRoughness": {
            "baseColorFactor": list(ORGAN_COLOR.get(o, (0.5, 0.5, 0.5))) + [1.0],
            "metallicFactor": 0.0, "roughnessFactor": 0.85},
            "doubleSided": True} for o in organs],
        "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(buf),
                     "uri": "data:application/octet-stream;base64,"
                            + base64.b64encode(buf).decode()}],
    }
    Path(path).write_text(json.dumps(gltf))
    return {"path": str(path), "bytes": Path(path).stat().st_size,
            "organs": organs,
            "triangles": int(sum(len(scene[o]["tris"]) for o in organs))}


def write_glb(scene, path, organs=None):
    """Escreve um .glb -- mesma cena, buffer binário em vez de base64 embutido.

    POR QUE ISSO EXISTE AO LADO DE write_gltf. Um .gltf carrega o buffer como
    data URI, o que é base64: 21 MB de geometria viram 28 MB de arquivo. Quando
    o Go faz base64 do arquivo inteiro para atravessar a ponte do webview, essa
    string chega a 37 MB, e o parser dentro do webview estoura a pilha antes de
    terminar -- "Maximum call stack size exceeded", que não diz nada sobre
    dossel. O .glb põe o buffer num chunk binário depois do JSON, então o
    arquivo é do tamanho da geometria e só há um base64 no caminho, o da ponte.

    OS VÉRTICES SÃO INDEXADOS AQUI, e não em write_gltf. Helios entrega
    triângulos soltos, então cada vértice compartilhado é reescrito uma vez por
    triângulo que o toca. Deduplicar por posição corta a maior parte disso sem
    mudar a malha: os índices reconstroem exatamente os mesmos triângulos.
    """
    organs = organs or [o for o in scene if len(scene[o]["tris"])]
    blobs, meshes, nodes, accessors, views = [], [], [], [], []
    offset = 0

    for oi, organ in enumerate(organs):
        tris = scene[organ]["tris"]
        if not len(tris):
            continue
        flat = tris.reshape(-1, 3).astype(np.float32)
        # `unique` sobre a view de bytes: agrupa vértices bit a bit idênticos,
        # que é o que "mesmo vértice" significa para uma malha vinda de um
        # gerador -- não há tolerância a aplicar nem casas a arredondar.
        verts, idx = np.unique(flat, axis=0, return_inverse=True)
        verts = verts.astype(np.float32)
        idx = idx.astype(np.uint32).ravel()

        vb, ib = verts.tobytes(), idx.tobytes()
        for data, target, comp, typ, count, mn, mx in (
                (vb, 34962, 5126, "VEC3", len(verts),
                 verts.min(axis=0).tolist(), verts.max(axis=0).tolist()),
                (ib, 34963, 5125, "SCALAR", len(idx), None, None)):
            pad = (-len(data)) % 4
            views.append({"buffer": 0, "byteOffset": offset,
                          "byteLength": len(data), "target": target})
            acc = {"bufferView": len(views) - 1, "componentType": comp,
                   "count": count, "type": typ}
            if mn is not None:
                acc["min"], acc["max"] = mn, mx
            accessors.append(acc)
            blobs.append(data + b"\0" * pad)
            offset += len(data) + pad

        meshes.append({"name": organ, "primitives": [{
            "attributes": {"POSITION": len(accessors) - 2},
            "indices": len(accessors) - 1, "material": oi}]})
        nodes.append({"mesh": len(meshes) - 1, "name": organ})

    buf = b"".join(blobs)
    gltf = {
        "asset": {"version": "2.0", "generator": "TERRA helios_bridge"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes,
        "materials": [{"name": o, "pbrMetallicRoughness": {
            "baseColorFactor": list(ORGAN_COLOR.get(o, (0.5, 0.5, 0.5))) + [1.0],
            "metallicFactor": 0.0, "roughnessFactor": 0.85},
            "doubleSided": True} for o in organs],
        "accessors": accessors, "bufferViews": views,
        # Sem uri: o buffer é o chunk BIN que vem logo abaixo.
        "buffers": [{"byteLength": len(buf)}],
    }

    # Container GLB: cabeçalho de 12 bytes, depois chunks de (tamanho, tipo,
    # dados). Ambos os chunks são preenchidos até 4 bytes -- o JSON com espaços
    # e o binário com zeros, como a especificação exige.
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    bin_bytes = buf + b"\0" * ((-len(buf)) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += b"glTF" + struct.pack("<II", 2, total)
    out += struct.pack("<I", len(json_bytes)) + b"JSON" + json_bytes
    out += struct.pack("<I", len(bin_bytes)) + b"BIN\0" + bin_bytes
    Path(path).write_bytes(bytes(out))

    return {"path": str(path), "bytes": Path(path).stat().st_size,
            "organs": organs,
            "triangles": int(sum(len(scene[o]["tris"]) for o in organs))}


# ---------------------------------------------------------------------------
# Verificação
# ---------------------------------------------------------------------------

def self_check(ctx, pa, plant_id, tol=1e-3):
    """A área foliar extraída tem de bater com a que o Helios reporta.

    É a única checagem que importa nesta ponte: se a extração perder ou duplicar
    primitivas, tudo que vier depois -- radiação, energia, cena -- estará errado
    com aparência normal.
    """
    scene = extract(ctx)
    _, area = leaf_cloud(scene)
    dito = pa.getPlantLeafArea(plant_id)
    rel = abs(area.sum() - dito) / max(dito, 1e-12)
    return {"area_extraida": float(area.sum()), "area_helios": float(dito),
            "erro_relativo": float(rel), "ok": rel < tol}
