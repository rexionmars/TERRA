"""
The Planetary Computer catalogue, read through one client.

Three products read this catalogue: Sentinel-2 L2A for every imagery path,
Copernicus DEM GLO-30 for terrain and solar siting, and the four DEM products
the flood envelope compares. Before this module each opened its own client, and
the three were not equivalent. Only the Sentinel-2 path retried, so a transient
5xx from the service aborted a terrain run and a flood envelope while leaving a
classification to recover; and `solar.fetch_dem` read `items[0]` with no merge,
so an area crossing a one-degree tile boundary received terrain covering part
of itself. A caller could not tell from the call site which behaviour it had
reached.

This module owns the search. What is done with the items it returns stays with
the product that asked: the band assets of a Sentinel-2 scene and the tiles of
a DEM window are not the same subject and do not belong here.

Signing is `planetary_computer.sign_inplace` on the client, so hrefs come back
signed and no key is needed anywhere downstream.
"""

from __future__ import annotations

import time
from typing import Any

from terra import protocol

URL = 'https://planetarycomputer.microsoft.com/api/stac/v1'

# The waits between attempts, in seconds; one more attempt is made than there
# are waits. Written as data rather than as a computed backoff so the schedule
# is visible, and so a test can shorten it without reaching into the loop.
RETRY_WAITS = (1, 2, 4)


class Unavailable(RuntimeError):
    """Every attempt at the catalogue failed."""


def open_catalog(url: str = URL) -> Any:
    """
    A signed client for the catalogue.

    pystac_client and planetary_computer are imported here rather than at the
    top of the module so that importing this module costs nothing: the registry
    resolves an action before knowing whether that action reads imagery at all.
    """
    import planetary_computer
    import pystac_client

    return pystac_client.Client.open(url, modifier=planetary_computer.sign_inplace)


def search(
    collection: str,
    *,
    bbox: Any = None,
    intersects: Any = None,
    datetime: str | None = None,
    query: dict[str, Any] | None = None,
    url: str = URL,
) -> list[Any]:
    """
    Every item in `collection` matching the criteria given.

    The service returns transient 502, 503 and 504 under load, and times out.
    The open, the search and the paging are all retried together, because the
    HTTP requests that page the result set are issued by the iteration below
    and not by the search call: retrying only the search would leave a partial
    page unrecovered.

    Raises `Unavailable` when every attempt failed. Returning an empty list
    instead would read at the call site as "no scenes for this area", which is
    a different answer and one a caller would act on.
    """
    criteria: dict[str, Any] = {'collections': [collection]}
    if bbox is not None:
        criteria['bbox'] = list(bbox)
    if intersects is not None:
        criteria['intersects'] = intersects
    if datetime is not None:
        criteria['datetime'] = datetime
    if query is not None:
        criteria['query'] = query

    attempts = len(RETRY_WAITS) + 1
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return list(open_catalog(url).search(**criteria).items())
        except Exception as e:  # noqa: BLE001 - the service fails in many ways
            last_error = e
            if attempt < len(RETRY_WAITS):
                wait = RETRY_WAITS[attempt]
                protocol.emit_progress(
                    -1,
                    f'STAC unavailable, retrying in {wait}s '
                    f'({attempt + 1}/{attempts})',
                )
                time.sleep(wait)

    raise Unavailable(
        'the Planetary Computer STAC service is temporarily unavailable; '
        'please try again in a moment'
    ) from last_error
