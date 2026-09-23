"""
The contract the sidecar speaks over its three streams.

A JSON request arrives on stdin, progress objects are written to stderr one per
line while the work runs, the result is written to stdout as a single JSON
object, and a failure leaves a JSON error on stderr and a non-zero exit status.
The Go side reads all three; `internal/analysis/runner.go` tails stderr so a
failure can be reported as a reason rather than as an exit code.

This module owns that contract. `fail` is the only place the process exits, so
a product that cannot continue says why here rather than raising a traceback
that reaches the user as "sidecar failed: exit status 1".
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from typing import Any, NoReturn

Request = dict[str, Any]


def emit_progress(progress: int, msg: str) -> None:
    """Write one JSON progress object per line to stderr."""
    sys.stderr.write(json.dumps({'progress': progress, 'msg': msg}) + '\n')
    sys.stderr.flush()


def fail(msg: str) -> NoReturn:
    """
    Write an error to stderr and exit non-zero.

    NoReturn, not None. It ends in sys.exit, so nothing after a call to it runs
    -- and typed as returning None, every caller that used it as a guard was
    read by mypy as falling through, which reported union-attr errors on values
    the guard had just refused.
    """
    sys.stderr.write(json.dumps({'error': msg}) + '\n')
    sys.stderr.flush()
    sys.exit(1)


class MissingDependency(RuntimeError):
    """An optional package this path needs is not in this interpreter."""


def require_torch(product: str) -> None:
    """
    Fail with an explanation when PyTorch is absent.

    torch is deliberately outside requirements.txt -- it outweighs everything
    else the application ships -- so the models that need it are opt-in. A bare
    `import torch` raises ModuleNotFoundError, which leaves the process as a
    traceback and an exit status: the caller reported "sidecar failed: exit
    status 1" and the user had no way to learn that one optional package was
    the whole of the problem.

    Named here rather than inlined because two products need it, and a check
    that exists in one place is a check the other forgets.

    It RAISES rather than exits, because the modules that call it are product
    modules and a module that exits cannot be called by a test. terra/cli.py
    turns MissingDependency into the same message and the same exit status it
    used to produce here.
    """
    try:
        import torch  # noqa: F401
    except ImportError as e:
        raise MissingDependency(
            f'{product} needs PyTorch, which is not installed in this '
            f'environment. Install it there, or choose the Random Forest '
            f'model, which needs nothing further. '
            f'Settings > System reports what each interpreter has.') from e


# --- Request parameters ----------------------------------------------------
#
# ABSENCE SELECTS THE DEFAULT, NOT FALSINESS. `float(req.get(key) or default)`
# reads a deliberate 0 as an omission, because 0 is falsy in Python. It is
# silent and it is wrong wherever zero is a value the caller can mean -- a HAND
# threshold of 0 m is the drainage surface itself, a buffer of 0 m is a read of
# exactly the AOI -- and it has shipped: a rate of zero per year that a caller
# set was replaced by a nonzero default and moved every figure of that run by
# 5.78 percent, with nothing on screen saying so. Every numeric parameter is
# read through these two helpers so the pattern cannot come back one call site
# at a time.

def request_number[T](
    req: Request,
    key: str,
    default: T,
    cast: Callable[[Any], Any] = float,
) -> Any:
    """
    A numeric request parameter, defaulted only when the caller omitted it.

    The default is returned as given rather than cast, so a default of None
    stays None for the parameters whose absence is itself the signal, such as
    an unstated buffer, which the flood envelope then sizes from the AOI.
    """
    value = req.get(key)
    if value is None:
        return default
    return cast(value)


def request_positive[T](
    req: Request,
    key: str,
    default: T,
    cast: Callable[[Any], Any] = float,
    allow_zero: bool = False,
) -> Any:
    """
    A numeric request parameter that has to be positive, or the run fails.

    For quantities where zero is not a value but a broken request: a drainage
    area of zero makes every cell drainage and HAND zero everywhere, so the
    extent is the whole window at every threshold. Rejecting is the honest
    answer; substituting the default would report a figure the caller did not
    ask for under a parameter they did set.
    """
    value = request_number(req, key, default, cast)
    if value < 0 or (value == 0 and not allow_zero):
        fail(
            f"{key} must be "
            f"{'zero or greater' if allow_zero else 'greater than zero'}, "
            f"got {value}"
        )
    return value
