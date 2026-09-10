"""The keys the sidecar writes, against the fields Go reads them into.

Go decodes the sidecar's stdout with encoding/json, which ignores a key it has
no field for and leaves the field it does have at its zero value. Neither side
fails. So a key renamed on one side is data that silently stops arriving: the
Python function still computes it, the Go struct still declares it, and nothing
between them notices.

That happened. A refactor on 2026-08-29 (1000ccd) moved `class_spectra` into
the `lc_spectra` module and renamed the calls, and the rename reached the two
dict keys as well, which became 'lc_spectra.class_spectra' and
'lc_spectra.library_limit'. Every classification made after that day carried no
spectral response and no library comparison, and the separability, spectra and
library diagnostics said so on every run. The unit tests of the function passed
throughout, because they call the function; the Go tests passed, because they
round-trip Go's own struct. Neither looked at the one place the two meet.

This test reads both sides as source -- the payload dict's keys out of the
action's AST, the json tags out of the Go struct -- so it needs no imagery, no
model and no Go toolchain, and it runs in the sidecar's CI job.

Both directions are asserted. A key Go has no field for is the failure above.
A field no key fills is the same failure from the other side: a tag renamed in
Go, and a value that is always zero.

Each row pairs one action's payload with the struct it is decoded into. Only
the classification is covered so far; another action is covered by adding its
row.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
TYPES_GO = REPO / "internal" / "analysis" / "types.go"

# (Python file, function that builds the payload, a key only that payload has,
#  Go file, struct the payload is decoded into)
CONTRACTS = [
    (
        REPO / "sidecar" / "terra" / "landcover" / "actions.py",
        "predict",
        "class_stats",
        TYPES_GO,
        "sidecarResult",
    ),
]


def payload_keys(py_file: Path, function: str, marker: str) -> set[str]:
    """The string keys of the dict literal in `function` that contains `marker`."""
    tree = ast.parse(py_file.read_text(encoding="utf-8"))
    found: list[set[str]] = []
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name == function:
            for node in ast.walk(fn):
                if isinstance(node, ast.Dict):
                    keys = {
                        k.value
                        for k in node.keys
                        if isinstance(k, ast.Constant) and isinstance(k.value, str)
                    }
                    if marker in keys:
                        found.append(keys)
    assert len(found) == 1, (
        f"expected one payload dict with {marker!r} in {function}() of "
        f"{py_file.name}, found {len(found)}"
    )
    return found[0]


def struct_tags(go_file: Path, struct: str) -> set[str]:
    """The json names of the fields of `struct`, excluding `json:"-"`."""
    src = go_file.read_text(encoding="utf-8")
    m = re.search(rf"^type {re.escape(struct)} struct \{{\n(.*?)^\}}", src, re.S | re.M)
    assert m, f"struct {struct} not found in {go_file.name}"
    body = m.group(1)
    # An embedded struct would contribute its own fields, which this reader
    # does not follow. Refuse rather than under-report.
    for line in body.splitlines():
        code = line.split("//", 1)[0].strip()
        if code and "`" not in code and len(code.split()) == 1:
            pytest.fail(f"{struct} embeds {code}; extend struct_tags to follow it")
    tags = set(re.findall(r'json:"([^",]*)', body))
    tags.discard("-")
    return tags


@pytest.mark.parametrize(
    "py_file,function,marker,go_file,struct",
    CONTRACTS,
    ids=[f"{c[1]}->{c[4]}" for c in CONTRACTS],
)
def test_every_key_the_sidecar_writes_is_a_field_go_reads(
    py_file, function, marker, go_file, struct
):
    unread = payload_keys(py_file, function, marker) - struct_tags(go_file, struct)
    assert not unread, (
        f"{function}() writes {sorted(unread)}, which {struct} has no field for; "
        f"Go will drop them without an error"
    )


@pytest.mark.parametrize(
    "py_file,function,marker,go_file,struct",
    CONTRACTS,
    ids=[f"{c[1]}->{c[4]}" for c in CONTRACTS],
)
def test_every_field_go_reads_is_a_key_the_sidecar_writes(
    py_file, function, marker, go_file, struct
):
    unfilled = struct_tags(go_file, struct) - payload_keys(py_file, function, marker)
    assert not unfilled, (
        f"{struct} reads {sorted(unfilled)}, which {function}() never writes; "
        f"those fields will always be empty"
    )
