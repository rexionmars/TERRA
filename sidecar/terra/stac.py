"""
The STAC catalogues imagery is read from, through one client.

Every imagery path finds its scenes through `search`, which retries the
transient failures a catalogue returns under load. The retry lives here rather
than in a product so that a collection read later inherits it: while the
catalogue was also read for elevation, each reader opened its own client, only
the Sentinel-2 path retried, and a transient 5xx aborted a terrain read while
leaving a classification to recover.

This module owns the search. What is done with the items it returns stays with
the product that asked: the band assets of a Sentinel-2 scene belong to the
imagery reader, not here.

ONE COLLECTION, MORE THAN ONE CATALOGUE. TERRA reads two collections, Sentinel-2
L2A and Sentinel-1 RTC, and each can be read from more than one catalogue
(SOURCES). The installation chooses with TERRA_SENTINEL2_SOURCE and
TERRA_SENTINEL1_SOURCE, which the shell sets from Settings. The Planetary
Computer is the default for both, because the shipped models and the radar
thresholds were measured on it.

Catalogues name the same things differently: Earth Search calls band B04 `red`
and states the MGRS tile as `grid:code`. Every product names assets and
properties as the Planetary Computer does, and `search` returns items already
renamed into those names, so which catalogue an item came from is known in this
module and nowhere else.

Signing differs too. The Planetary Computer signs hrefs with
`planetary_computer.sign_inplace` as the items arrive. Earth Search serves
public objects and needs nothing. NASA's archive answers a request carrying an
Earthdata token with a redirect to a signed address, and `href` resolves that
when an asset is opened, so the token is sent to Earthdata only.
"""

from __future__ import annotations

import os
import re
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from terra import protocol

SENTINEL2 = 'sentinel-2-l2a'
SENTINEL1 = 'sentinel-1-rtc'

PLANETARY_COMPUTER = 'planetary-computer'
EARTH_SEARCH = 'earth-search'
OPERA = 'opera'

# The variable that names the catalogue each collection is read from. The shell
# writes it from the installation's settings; one exported in a shell wins.
SOURCE_ENV = {
    SENTINEL2: 'TERRA_SENTINEL2_SOURCE',
    SENTINEL1: 'TERRA_SENTINEL1_SOURCE',
}
DEFAULT_SOURCE = PLANETARY_COMPUTER

EARTHDATA_TOKEN_ENV = 'EARTHDATA_TOKEN'

# The waits between attempts, in seconds; one more attempt is made than there
# are waits. Written as data rather than as a computed backoff so the schedule
# is visible, and so a test can shorten it without reaching into the loop.
RETRY_WAITS = (1, 2, 4)
# The waits used instead when the catalogue answered HTTP 429, too many
# requests. A catalogue that is limiting a client is not helped by a retry a
# second later; the Planetary Computer has answered 429 after a dozen token
# requests in a row, and recovers over minutes rather than seconds.
THROTTLE_WAITS = (15, 30, 60)
# Retries made inside each attempt, by the HTTP client, on 429 and 503. These
# are the ones that read the Retry-After header the catalogue sends with them,
# which the waits above cannot see.
HTTP_RETRIES = 3
# Connect and read timeouts, in seconds. Without one a catalogue that stops
# answering holds the run until the shell's inactivity watchdog ends it.
TIMEOUT = (15.0, 120.0)
# Items asked for per page. pystac_client's default of 10 turns a season of
# Sentinel-1 bursts into dozens of requests, each one a chance to be limited.
PAGE_SIZE = 100

# The property an item carries when its assets need `href` to be read.
SIGNING_PROPERTY = 'terra:signing'


class Unavailable(RuntimeError):
    """Every attempt at the catalogue failed."""


@dataclass(frozen=True)
class Source:
    """
    One catalogue serving one collection, and how its items are read.

    `assets` maps the Planetary Computer's name for an asset to this
    catalogue's; an asset not listed has the same name in both. `properties`
    derives, from an item, the Planetary Computer properties this catalogue
    states another way; a property the item already has is left as it is.
    """

    key: str
    title: str
    url: str
    collection: str
    signing: str = 'none'  # 'planetary-computer', 'earthdata' or 'none'
    assets: Mapping[str, str] = field(default_factory=dict)
    properties: Callable[[Any], dict[str, Any]] | None = None


def _earth_search_sentinel2(item: Any) -> dict[str, Any]:
    """
    The MGRS tile and the relative orbit, which Earth Search states otherwise.

    The tile is in `grid:code` ('MGRS-22JBT'). The relative orbit is not a
    property at all; it is the R field of the product's name (`..._R124_...`),
    as the Sentinel-2 product naming convention sets it out.
    """
    props = item.properties
    out: dict[str, Any] = {}
    code = str(props.get('grid:code') or '')
    if code.startswith('MGRS-'):
        out['s2:mgrs_tile'] = code[len('MGRS-'):]
    m = re.search(r'_R(\d{3})_', str(props.get('s2:product_uri') or ''))
    if m:
        out['sat:relative_orbit'] = int(m[1])
    return out


def _opera_sentinel1(item: Any) -> dict[str, Any]:
    """
    The relative orbit and the platform, from the OPERA product's name.

    CMR's items carry no `sat:` properties. The burst identifier in the name
    begins with the track, which is the relative orbit (`..._T061-130864-IW3_...`),
    and the sensor follows the acquisition times (`..._S1C_...`).
    """
    out: dict[str, Any] = {}
    m = re.search(r'_T(\d{3})-\d+-IW\d_', str(item.id))
    if m:
        out['sat:relative_orbit'] = int(m[1])
    m = re.search(r'_S1([A-D])_', str(item.id))
    if m:
        out['platform'] = f'SENTINEL-1{m[1]}'
    return out


SOURCES: dict[str, dict[str, Source]] = {
    SENTINEL2: {
        PLANETARY_COMPUTER: Source(
            key=PLANETARY_COMPUTER,
            title='Microsoft Planetary Computer',
            url='https://planetarycomputer.microsoft.com/api/stac/v1',
            collection='sentinel-2-l2a',
            signing='planetary-computer',
        ),
        # Collection 1, ESA's reprocessing of the archive under one processing
        # baseline, and the collection Element 84 maintains. Its digital
        # numbers are ESA's and its items state their baseline, which is what
        # sentinel2.boa_add_offset needs. The older `sentinel-2-l2a` there
        # carries `earthsearch:boa_offset_applied`: numbers changed from ESA's.
        EARTH_SEARCH: Source(
            key=EARTH_SEARCH,
            title='Element 84 Earth Search',
            url='https://earth-search.aws.element84.com/v1',
            collection='sentinel-2-c1-l2a',
            assets={
                'B02': 'blue',
                'B03': 'green',
                'B04': 'red',
                'B05': 'rededge1',
                'B06': 'rededge2',
                'B07': 'rededge3',
                'B08': 'nir',
                'B8A': 'nir08',
                'B11': 'swir16',
                'B12': 'swir22',
                'SCL': 'scl',
                'granule-metadata': 'granule_metadata',
                'rendered_preview': 'thumbnail',
            },
            properties=_earth_search_sentinel2,
        ),
    },
    SENTINEL1: {
        PLANETARY_COMPUTER: Source(
            key=PLANETARY_COMPUTER,
            title='Microsoft Planetary Computer',
            url='https://planetarycomputer.microsoft.com/api/stac/v1',
            collection='sentinel-1-rtc',
            signing='planetary-computer',
        ),
        # OPERA's radiometric terrain-corrected backscatter, at 30 m, served by
        # the Alaska Satellite Facility and listed through NASA's CMR. A
        # different processing chain from the Planetary Computer's: the radar
        # product holds a calibration of its own for it (radar/series.py).
        OPERA: Source(
            key=OPERA,
            title='NASA OPERA RTC-S1',
            url='https://cmr.earthdata.nasa.gov/stac/ASF',
            collection='OPERA_L2_RTC-S1_V1_1',
            signing='earthdata',
            assets={'vv': '0_VV', 'vh': '0_VH', 'mask': '0_mask'},
            properties=_opera_sentinel1,
        ),
    },
}

# Which catalogue each collection read in this process came from, for the
# result to record. A process answers one request, so this is that request's.
_used: dict[str, Source] = {}

# Earthdata addresses already resolved to a signed one. The radar reads passes
# on several threads, hence the lock.
_resolved: dict[str, str] = {}
_resolved_lock = threading.Lock()


def source(collection: str) -> Source:
    """
    The catalogue `collection` is read from in this installation.

    Raises protocol.Unavailable for a name no catalogue answers to, since the
    setting is the user's to correct.
    """
    env = SOURCE_ENV[collection]
    key = os.environ.get(env, '').strip() or DEFAULT_SOURCE
    choices = SOURCES[collection]
    if key not in choices:
        raise protocol.Unavailable(
            f'{env}={key!r} names no source of {collection}; '
            f'use one of: {", ".join(sorted(choices))}'
        )
    return choices[key]


def title(collection: str) -> str:
    """The name of the catalogue `collection` is read from, for progress lines."""
    return source(collection).title


def used() -> list[dict[str, str]]:
    """
    Where each collection searched in this process was read from.

    A result carries this so that a saved run says which catalogue, and which
    collection in it, its numbers come from.
    """
    return [
        {
            'collection': collection,
            'source': s.key,
            'title': s.title,
            'url': s.url,
            'catalogue_collection': s.collection,
        }
        for collection, s in sorted(_used.items())
    ]


def open_catalog(src: Source) -> Any:
    """
    A client for the catalogue, signing as it requires.

    pystac_client and planetary_computer are imported here rather than at the
    top of the module so that importing this module costs nothing: the registry
    resolves an action before knowing whether that action reads imagery at all.
    """
    import pystac_client
    from pystac_client.stac_api_io import StacApiIO
    from urllib3 import Retry

    # 429 and 503 are retried by the HTTP client, which waits as long as the
    # Retry-After header says. The search is a POST, which urllib3 does not
    # retry unless told to; a search changes nothing, so repeating it is safe.
    # raise_on_status=False hands the last answer back, so an attempt that ran
    # out of retries still reports its status code to `with_retries`.
    stac_io = StacApiIO(
        timeout=TIMEOUT,
        max_retries=Retry(
            total=HTTP_RETRIES,
            backoff_factor=2.0,
            status_forcelist=(429, 503),
            allowed_methods=None,
            respect_retry_after_header=True,
            raise_on_status=False,
        ),
    )
    modifier = None
    if src.signing == 'planetary-computer':
        import planetary_computer

        modifier = planetary_computer.sign_inplace
    return pystac_client.Client.open(src.url, modifier=modifier, stac_io=stac_io)


def search(
    collection: str,
    *,
    bbox: Any = None,
    datetime: str | None = None,
    query: dict[str, Any] | None = None,
) -> list[Any]:
    """
    Every item of `collection` matching the criteria given, in TERRA's names.

    The catalogue returns transient 502, 503 and 504 under load, and times out.
    The open, the search and the paging are all retried together, because the
    HTTP requests that page the result set are issued by the iteration below
    and not by the search call: retrying only the search would leave a partial
    page unrecovered.

    Raises `Unavailable` when every attempt failed. Returning an empty list
    instead would read at the call site as "no scenes for this area", which is
    a different answer and one a caller would act on.
    """
    src = source(collection)
    _used[collection] = src
    criteria: dict[str, Any] = {'collections': [src.collection], 'limit': PAGE_SIZE}
    if bbox is not None:
        criteria['bbox'] = list(bbox)
    if datetime is not None:
        criteria['datetime'] = datetime
    if query is not None:
        criteria['query'] = query

    items = with_retries(
        lambda: list(open_catalog(src).search(**criteria).items()),
        src.title,
    )
    return [_renamed(item, src) for item in items]


def _renamed(item: Any, src: Source) -> Any:
    """`item` with its assets and properties in the Planetary Computer's names."""
    if not src.assets and src.properties is None and src.signing != 'earthdata':
        return item
    if src.assets:
        terra_name = {theirs: ours for ours, theirs in src.assets.items()}
        item.assets = {terra_name.get(name, name): a for name, a in item.assets.items()}
    if src.properties is not None:
        for name, value in src.properties(item).items():
            item.properties.setdefault(name, value)
    if src.signing == 'earthdata':
        item.properties[SIGNING_PROPERTY] = 'earthdata'
    return item


def href(item: Any, asset: str) -> str:
    """
    The address to read `asset` of `item` from.

    For most catalogues that is the asset's own href, already signed where the
    catalogue signs. NASA's archive answers an authenticated request with a
    redirect to a signed address, and that address is what GDAL is given: GDAL
    would send the token to the storage behind the redirect as well, which
    refuses a request carrying two credentials.
    """
    url = str(item.assets[asset].href)
    if item.properties.get(SIGNING_PROPERTY) != 'earthdata':
        return url
    with _resolved_lock:
        known = _resolved.get(url)
    if known is not None:
        return known
    signed = with_retries(lambda: _earthdata_redirect(url), 'NASA Earthdata')
    with _resolved_lock:
        _resolved[url] = signed
    return signed


def _earthdata_redirect(url: str) -> str:
    """
    The signed address an authenticated request for `url` is redirected to.

    requests drops the Authorization header when a redirect leaves the host,
    so the token reaches Earthdata and not the storage. One byte is asked for,
    which is enough to be redirected and to learn that ranges are served.
    """
    import requests

    token = os.environ.get(EARTHDATA_TOKEN_ENV, '').strip()
    if not token:
        raise protocol.Unavailable(
            'Sentinel-1 from NASA OPERA needs a NASA Earthdata Login token. Set it '
            'in Settings > System, or choose the Planetary Computer as the '
            'Sentinel-1 source there.'
        )
    r = requests.get(
        url,
        headers={'Authorization': f'Bearer {token}', 'Range': 'bytes=0-0'},
        timeout=TIMEOUT,
    )
    if r.status_code in (401, 403):
        raise protocol.Unavailable(_earthdata_refusal(r))
    r.raise_for_status()
    return str(r.url)


def _earthdata_refusal(r: Any) -> str:
    """
    Why Earthdata refused a request, in words the user can act on.

    A valid token is still refused until its account has approved the archive
    that serves the file, and Earthdata says so in a JSON body that carries the
    page where approval is given. That page is the one thing the user needs.
    """
    try:
        body = r.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    reason = str(body.get('error_description') or '').strip()
    where = str(body.get('resolution_url') or '').strip()
    if 'EULA' in reason and where:
        return (
            'The Earthdata account has not yet approved the archive that serves '
            f'NASA OPERA radar files (HTTP {r.status_code}, {reason}). Sign in to '
            f'Earthdata and approve it at {where}, then run again.'
        )
    detail = f', {reason}' if reason else ''
    return (
        f'Earthdata refused the radar file request (HTTP {r.status_code}{detail}); '
        'the token may have expired. Create a new one at '
        'https://urs.earthdata.nasa.gov/profile and set it in Settings > System.'
    )


def _throttled(error: BaseException) -> bool:
    """Whether `error` is an HTTP 429 answer from a catalogue."""
    if getattr(error, 'status_code', None) == 429:
        return True
    response = getattr(error, 'response', None)
    return getattr(response, 'status_code', None) == 429


def with_retries(attempt: Callable[[], Any], what: str) -> Any:
    """
    `attempt()`, repeated on failure with the waits RETRY_WAITS sets out.

    A 429 waits THROTTLE_WAITS instead. protocol.Unavailable is raised at once,
    because what it reports (a missing or refused token) does not recover by
    asking again.
    """
    tries = len(RETRY_WAITS) + 1
    last_error: Exception | None = None
    for n in range(tries):
        try:
            return attempt()
        except protocol.Unavailable:
            raise
        except Exception as e:  # noqa: BLE001 - the service fails in many ways
            last_error = e
            if n < len(RETRY_WAITS):
                throttled = _throttled(e)
                wait = (THROTTLE_WAITS if throttled else RETRY_WAITS)[n]
                reason = 'is limiting requests' if throttled else 'is unavailable'
                protocol.emit_progress(
                    -1, f'{what} {reason}, retrying in {wait}s ({n + 1}/{tries})'
                )
                time.sleep(wait)

    if last_error is not None and _throttled(last_error):
        raise Unavailable(
            f'{what} is limiting requests from this computer (HTTP 429); wait a '
            'few minutes and run again, or choose another source in Settings'
        ) from last_error
    raise Unavailable(
        f'{what} is temporarily unavailable; please try again in a moment'
    ) from last_error
