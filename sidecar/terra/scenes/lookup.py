"""
Finding one acquisition by the id the caller names.

The catalogue is queried for the period and filtered down to the scene asked
for; when the cloud filter the caller set excluded it, the query is repeated
without one. Both queries pass monthly_best=False, because a monthly-best list
holds one scene per month and the id asked for is usually not the one it kept.
"""

from __future__ import annotations

from terra.imagery import sentinel2


class SceneNotFound(LookupError):
    """No acquisition over this area in this period carries that id."""


def find(polygon, start, end, scene_id, *, tiles=None, max_cloud=100.0,
         note=None):
    """
    The product carrying `scene_id`, or SceneNotFound.

    THE FALLBACK IS THE CLOUD FILTER AND NOTHING ELSE. Both queries already ask
    for every scene rather than the monthly best, so the only thing that can
    have excluded a named scene is the cloud threshold the caller set. The
    comment this replaced said the monthly-best list may have dropped it, which
    stopped being true when the first query started passing monthly_best=False.

    Raises rather than exits, and reports the retry through `note` rather than
    a stream, because the caller owns both.
    """
    def matching(products):
        for product in products:
            if (product.get('id') or '') == scene_id:
                return product
        return None

    product = matching(sentinel2.list_stac_products(
        polygon, start, end, tile_list=tiles, max_cloud=max_cloud,
        monthly_best=False,
    ))
    if product is not None:
        return product

    if max_cloud >= 100.0:
        raise SceneNotFound(f'scene not found: {scene_id}')

    if note:
        note(f'{scene_id} is not under {max_cloud:g}% cloud; asking again '
             f'without the filter')
    product = matching(sentinel2.list_stac_products(
        polygon, start, end, tile_list=tiles, max_cloud=100.0,
        monthly_best=False,
    ))
    if product is None:
        raise SceneNotFound(f'scene not found: {scene_id}')
    return product
