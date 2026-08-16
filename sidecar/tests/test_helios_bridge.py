"""
The Helios bridge, exercised without Helios installed and without a GPU.

WHY THAT IS POSSIBLE. `helios_bridge` never imports pyhelios -- the scene
arrives as an object satisfying five methods, and the module's docstring writes
that contract down. So anything satisfying those five methods drives the whole
module, and `FakeContext` below is the contract made executable. If someone
adds an `import pyhelios` to the bridge, these tests stop running rather than
quietly start requiring a 3D toolkit in CI.

THE INVARIANT THAT MATTERS. Extracted leaf area must equal the leaf area Helios
reports for the plant. Everything downstream -- radiation, annual energy, the
glTF the webview draws -- is scaled by it, and a bridge that dropped or
duplicated primitives would produce numbers that look entirely normal and are
wrong by whatever fraction it lost. That is the one check the origin's own
`self_check` makes, and it is testable here at no cost.
"""

from __future__ import annotations

import base64
import json

import numpy as np
import pytest

import helios_bridge


# ---------------------------------------------------------------------------
# The contract, made executable
# ---------------------------------------------------------------------------

class FakeContext:
    """
    A Helios context as far as the bridge is concerned: the five methods the
    module docstring names, and nothing else.

    Primitives are given as (label, vertices). Three vertices is a triangle and
    four is a patch, which the bridge triangulates into two -- so the scene
    below deliberately contains both, plus one primitive of an unsupported
    shape, because silently skipping those is behaviour worth pinning.
    """

    def __init__(self, primitives):
        self._labels = [label for label, _, _ in primitives]
        self._verts = [np.asarray(v, dtype=np.float32) for _, v, _ in primitives]
        # Area is per primitive and comes from Helios, not from the geometry --
        # the bridge trusts it rather than deriving it, so the fake states it
        # independently of the vertices, as Helios does.
        self._areas = [float(a) for _, _, a in primitives]
        self._normals = [(0.0, 0.0, 1.0)] * len(self._verts)

    def getAllUUIDs(self):
        return list(range(len(self._verts)))

    def getAllPrimitiveVertices(self):
        flat = np.concatenate([v.reshape(-1) for v in self._verts])
        offsets = np.cumsum([0] + [v.size for v in self._verts])
        return flat, offsets

    def getAllPrimitiveAreas(self):
        return list(self._areas)

    def getAllPrimitiveNormals(self):
        return np.asarray(self._normals, dtype=np.float32).reshape(-1)

    def getPrimitiveData(self, uuid, key):
        assert key == "object_label", f"bridge asked for unexpected key {key!r}"
        return self._labels[uuid]


class FakePlantArchitecture:
    def __init__(self, leaf_area):
        self._leaf_area = leaf_area

    def getPlantLeafArea(self, plant_id):
        return self._leaf_area


TRI = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
QUAD = [(0.0, 0.0, 1.0), (1.0, 0.0, 1.0), (1.0, 1.0, 1.0), (0.0, 1.0, 1.0)]

LEAF_TRI_AREA = 0.9
LEAF_QUAD_AREA = 1.2
FRUIT_AREA = 0.4
LEAF_AREA = LEAF_TRI_AREA + LEAF_QUAD_AREA


@pytest.fixture
def scene_context():
    """Two leaves (one triangle, one patch), a shoot, and a fruit."""
    return FakeContext([
        ("leaf", TRI, LEAF_TRI_AREA),
        ("leaf", QUAD, LEAF_QUAD_AREA),
        ("shoot", TRI, 0.3),
        ("fruit", QUAD, FRUIT_AREA),
    ])


# ---------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------

def test_extract_groups_primitives_by_organ(scene_context):
    scene = helios_bridge.extract(scene_context)
    assert set(scene) == {"leaf", "shoot", "fruit"}


def test_patches_are_triangulated_and_triangles_are_not(scene_context):
    """
    A four-vertex patch becomes two triangles; a three-vertex primitive stays
    one. The leaf group holds one of each, so it must come out with three.
    """
    scene = helios_bridge.extract(scene_context)
    assert scene["leaf"]["tris"].shape == (3, 3, 3)
    assert scene["shoot"]["tris"].shape == (1, 3, 3)
    assert scene["fruit"]["tris"].shape == (2, 3, 3)


def test_area_stays_per_primitive_after_triangulation(scene_context):
    """
    Triangulating a patch doubles its triangles but must NOT double its area --
    the area is recorded once per source primitive, as Helios reported it.

    This is exactly the failure mode the leaf-area invariant exists to catch,
    and the arithmetic is off by 2x at the point where it is easiest to write.
    """
    scene = helios_bridge.extract(scene_context)
    assert len(scene["leaf"]["areas"]) == 2, "one area per source primitive, not per triangle"
    np.testing.assert_allclose(scene["leaf"]["areas"], [LEAF_TRI_AREA, LEAF_QUAD_AREA])


def test_centroid_is_the_mean_of_the_source_vertices(scene_context):
    """
    Density placement uses the centroid, so it has to come from the primitive
    as given -- not from the triangles it was split into, which would weight
    the shared edge twice.
    """
    scene = helios_bridge.extract(scene_context)
    np.testing.assert_allclose(scene["leaf"]["centroids"][0], np.mean(TRI, axis=0))
    np.testing.assert_allclose(scene["leaf"]["centroids"][1], np.mean(QUAD, axis=0))


def test_unsupported_primitive_shape_is_skipped_not_counted():
    """
    A primitive that is neither triangle nor patch is dropped. Pinned because
    it is silent: nothing raises, and the leaf area simply comes out short.
    """
    ctx = FakeContext([("leaf", TRI, 0.9),
                       ("leaf", [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)], 0.5)])
    scene = helios_bridge.extract(ctx)
    assert scene["leaf"]["tris"].shape == (1, 3, 3)
    assert len(scene["leaf"]["areas"]) == 1
    assert scene["leaf"]["areas"].sum() == 0.9, "the dropped primitive took its area with it"


def test_misaligned_arrays_raise_rather_than_produce_a_scene():
    """
    If the four parallel arrays disagree in length, the bridge refuses. Failing
    loudly here is the whole point -- zipping them anyway would silently pair
    each primitive with another one's area.
    """
    ctx = FakeContext([("leaf", TRI, 0.9), ("leaf", QUAD, 1.2)])
    ctx._areas = ctx._areas[:1]
    with pytest.raises(RuntimeError, match="desalinhamento"):
        helios_bridge.extract(ctx)


# ---------------------------------------------------------------------------
# leaf_cloud, and the invariant
# ---------------------------------------------------------------------------

def test_leaf_cloud_returns_only_leaves(scene_context):
    scene = helios_bridge.extract(scene_context)
    pos, area = helios_bridge.leaf_cloud(scene)
    assert pos.shape == (2, 3)
    np.testing.assert_allclose(area.sum(), LEAF_AREA)


def test_leaf_cloud_can_be_asked_for_other_organs(scene_context):
    """Fruit interception is a question the same machinery answers."""
    scene = helios_bridge.extract(scene_context)
    _, area = helios_bridge.leaf_cloud(scene, organs=("leaf", "fruit"))
    np.testing.assert_allclose(area.sum(), LEAF_AREA + FRUIT_AREA)


def test_leaf_cloud_output_is_what_the_voxel_canopy_accepts(scene_context):
    """
    The bridge exists to feed `canopy_voxel.Canopy`, so the shapes have to line
    up: (N,3) positions and (N,) areas. Asserting it against the real consumer
    rather than against a description of it.
    """
    import canopy_voxel

    scene = helios_bridge.extract(scene_context)
    pos, area = helios_bridge.leaf_cloud(scene)
    canopy = canopy_voxel.Canopy(pos, area, spacing=2.0, cell=0.25)
    np.testing.assert_allclose(canopy.leaf_area, area.sum())


def test_self_check_confirms_the_extracted_area_matches_helios(scene_context):
    """
    The invariant, stated the way the origin states it: the leaf area the
    bridge pulls out equals the leaf area Helios reports for the plant.
    """
    pa = FakePlantArchitecture(LEAF_AREA)
    result = helios_bridge.self_check(scene_context, pa, plant_id=0)

    assert bool(result["ok"]) is True
    np.testing.assert_allclose(result["area_extraida"], LEAF_AREA)
    assert result["erro_relativo"] < 1e-12


def test_self_check_fails_when_the_bridge_loses_a_primitive(scene_context):
    """
    The check has to be able to fail, which is not automatic: a tolerance set
    loosely enough would pass a bridge that dropped a whole leaf. Helios here
    reports more area than the scene contains, as it would if extraction had
    skipped one.
    """
    missing = 0.9
    pa = FakePlantArchitecture(LEAF_AREA + missing)
    result = helios_bridge.self_check(scene_context, pa, plant_id=0)

    assert bool(result["ok"]) is False
    assert result["erro_relativo"] == pytest.approx(missing / (LEAF_AREA + missing))


def test_self_check_ok_field_is_a_numpy_bool_and_will_not_serialise():
    """
    A defect carried over from the origin, pinned rather than patched: `ok` is
    `rel < tol` on a numpy scalar, so it is np.bool_, and json.dumps refuses it.
    The three numeric fields beside it are each wrapped in `float()`, so the
    author was thinking about the JSON boundary and missed this one.

    It matters at exactly one place, which does not exist yet: whoever adds the
    sidecar action that runs this check will serialise its result to Go, and
    will get a TypeError naming a type that does not appear in the source line.
    Casting `bool(...)` at that boundary is the fix; changing the mirror is not,
    because the mirror's job is to be the origin.

    If this test starts failing because `ok` became a real bool, the fix landed
    upstream -- delete the test.
    """
    import json

    pa = FakePlantArchitecture(LEAF_AREA)
    ctx = FakeContext([("leaf", TRI, LEAF_TRI_AREA), ("leaf", QUAD, LEAF_QUAD_AREA)])
    result = helios_bridge.self_check(ctx, pa, plant_id=0)

    assert isinstance(result["ok"], np.bool_)
    with pytest.raises(TypeError):
        json.dumps(result)
    # The rest of the payload is fine, so the cast is all that is needed.
    json.dumps({k: v for k, v in result.items() if k != "ok"})


# ---------------------------------------------------------------------------
# glTF
# ---------------------------------------------------------------------------

def test_gltf_is_self_contained_and_parses(scene_context, tmp_path):
    """
    The webview reads this file from a sidecar working directory, so it must
    carry its buffer inline -- an external .bin would be a second path for the
    other side to resolve.
    """
    scene = helios_bridge.extract(scene_context)
    path = tmp_path / "scene.gltf"
    info = helios_bridge.write_gltf(scene, path)

    gltf = json.loads(path.read_text())
    assert gltf["asset"]["version"] == "2.0"
    assert len(gltf["buffers"]) == 1
    uri = gltf["buffers"][0]["uri"]
    assert uri.startswith("data:application/octet-stream;base64,")

    payload = base64.b64decode(uri.split(",", 1)[1])
    assert len(payload) == gltf["buffers"][0]["byteLength"]
    assert info["bytes"] == path.stat().st_size
    assert info["triangles"] == 6


def test_gltf_gives_each_organ_its_own_node(scene_context, tmp_path):
    """
    One node per organ, so three.js can toggle leaves, wood and fruit without
    reprocessing the mesh. That is the reason the split exists at all.
    """
    scene = helios_bridge.extract(scene_context)
    helios_bridge.write_gltf(scene, tmp_path / "scene.gltf")
    gltf = json.loads((tmp_path / "scene.gltf").read_text())

    assert [n["name"] for n in gltf["nodes"]] == [m["name"] for m in gltf["meshes"]]
    assert set(n["name"] for n in gltf["nodes"]) == {"leaf", "shoot", "fruit"}
    assert len(gltf["materials"]) == len(gltf["nodes"])


def test_gltf_accessors_describe_the_geometry_they_point_at(scene_context, tmp_path):
    """
    Counts and bounds have to match the buffer, or the viewer draws garbage
    without erroring. glTF requires min/max on the POSITION accessor.
    """
    scene = helios_bridge.extract(scene_context)
    helios_bridge.write_gltf(scene, tmp_path / "scene.gltf")
    gltf = json.loads((tmp_path / "scene.gltf").read_text())

    for mesh in gltf["meshes"]:
        primitive = mesh["primitives"][0]
        position = gltf["accessors"][primitive["attributes"]["POSITION"]]
        indices = gltf["accessors"][primitive["indices"]]

        assert position["type"] == "VEC3" and position["componentType"] == 5126
        assert indices["type"] == "SCALAR" and indices["componentType"] == 5125
        assert position["count"] == indices["count"]
        assert position["count"] % 3 == 0, "vertices must come in whole triangles"
        assert len(position["min"]) == 3 and len(position["max"]) == 3

    # Byte offsets must stay 4-byte aligned; glTF requires it and a viewer that
    # enforces it would reject the file outright.
    for view in gltf["bufferViews"]:
        assert view["byteOffset"] % 4 == 0


def test_gltf_can_be_restricted_to_chosen_organs(scene_context, tmp_path):
    scene = helios_bridge.extract(scene_context)
    info = helios_bridge.write_gltf(scene, tmp_path / "leaves.gltf", organs=["leaf"])
    gltf = json.loads((tmp_path / "leaves.gltf").read_text())

    assert info["organs"] == ["leaf"]
    assert info["triangles"] == 3
    assert [n["name"] for n in gltf["nodes"]] == ["leaf"]
