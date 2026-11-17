"""
The one catalogue client: what it retries, and what it refuses to hide, and
which catalogue it reads.

The retry began inside the Sentinel-2 listing, where a reader of any other
collection could not reach it. These tests hold the behaviour in the one search
every catalogue read now goes through. The tests of a second catalogue hold
that its items reach the products in the names the products read.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from terra import protocol, stac


class FakeSearch:
    """The object pystac_client returns: items() pages the result set."""

    def __init__(self, items, fail_on_paging=None):
        self._items = items
        self._fail_on_paging = fail_on_paging

    def items(self):
        if self._fail_on_paging is not None:
            raise self._fail_on_paging
        return iter(self._items)


class FakeCatalog:
    def __init__(self, items, calls, fail_on_paging=None):
        self._items = items
        self._calls = calls
        self._fail_on_paging = fail_on_paging

    def search(self, **criteria):
        self._calls.append(criteria)
        return FakeSearch(self._items, self._fail_on_paging)


@pytest.fixture(autouse=True)
def instant_retries(monkeypatch):
    """The schedule is data, so a test shortens it without touching the loop."""
    monkeypatch.setattr(stac, "RETRY_WAITS", (0, 0, 0))
    monkeypatch.setattr(stac, "THROTTLE_WAITS", (0, 0, 0))


@pytest.fixture(autouse=True)
def default_sources(monkeypatch):
    """Each test starts from the installation default and a fresh process."""
    for env in stac.SOURCE_ENV.values():
        monkeypatch.delenv(env, raising=False)
    monkeypatch.delenv(stac.EARTHDATA_TOKEN_ENV, raising=False)
    monkeypatch.setattr(stac, "_used", {})
    monkeypatch.setattr(stac, "_resolved", {})


def opener(*outcomes):
    """An open_catalog that yields each outcome in turn, raising the exceptions."""
    remaining = list(outcomes)

    def open_catalog(src):
        outcome = remaining.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return open_catalog


def test_a_search_that_succeeds_passes_its_criteria_through(monkeypatch):
    calls = []
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog(["a", "b"], calls)))

    items = stac.search(
        "sentinel-2-l2a",
        bbox=(-53.5, -25.0, -53.4, -24.9),
        datetime="2023-01-01/2023-03-01",
        query={"eo:cloud_cover": {"lt": 30.0}},
    )

    assert items == ["a", "b"]
    assert calls == [{
        "collections": ["sentinel-2-l2a"],
        "limit": stac.PAGE_SIZE,
        "bbox": [-53.5, -25.0, -53.4, -24.9],
        "datetime": "2023-01-01/2023-03-01",
        "query": {"eo:cloud_cover": {"lt": 30.0}},
    }]


def test_criteria_the_caller_omitted_are_not_sent(monkeypatch):
    """
    A search that states a bounding box and nothing else sends nothing else.
    Sending datetime=None or query=None would be a filter the caller never
    asked for.
    """
    calls = []
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([], calls)))

    stac.search("sentinel-2-l2a", bbox=(-53.5, -25.0, -53.4, -24.9))

    assert calls == [{
        "collections": ["sentinel-2-l2a"],
        "limit": stac.PAGE_SIZE,
        "bbox": [-53.5, -25.0, -53.4, -24.9],
    }]


def test_a_transient_failure_is_retried_and_the_items_still_arrive(monkeypatch):
    calls = []
    monkeypatch.setattr(stac, "open_catalog", opener(
        RuntimeError("503 Service Unavailable"),
        RuntimeError("504 Gateway Timeout"),
        FakeCatalog(["scene"], calls),
    ))

    assert stac.search("sentinel-2-l2a") == ["scene"]
    assert len(calls) == 1


def test_a_failure_while_paging_is_retried_too(monkeypatch):
    """
    The HTTP requests that page a result set are issued by iterating items(),
    not by search(). Retrying only the search would leave a half-read page.
    """
    calls = []
    monkeypatch.setattr(stac, "open_catalog", opener(
        FakeCatalog([], calls, fail_on_paging=RuntimeError("502 Bad Gateway")),
        FakeCatalog(["scene"], calls),
    ))

    assert stac.search("sentinel-2-l2a") == ["scene"]
    assert len(calls) == 2


def test_exhausting_every_attempt_raises_rather_than_returning_nothing(monkeypatch):
    """
    An empty list at the call site reads as "no scenes over this area", which
    is a different answer and one the caller would report to the user.
    """
    monkeypatch.setattr(stac, "open_catalog", opener(
        *[RuntimeError("503 Service Unavailable")] * (len(stac.RETRY_WAITS) + 1)
    ))

    with pytest.raises(stac.Unavailable) as raised:
        stac.search("sentinel-2-l2a")

    assert "temporarily unavailable" in str(raised.value)
    assert isinstance(raised.value.__cause__, RuntimeError)


def test_the_number_of_attempts_is_one_more_than_the_number_of_waits(monkeypatch):
    attempts = []

    def open_catalog(src):
        attempts.append(src)
        raise RuntimeError("503 Service Unavailable")

    monkeypatch.setattr(stac, "open_catalog", open_catalog)

    with pytest.raises(stac.Unavailable):
        stac.search("sentinel-2-l2a")

    assert len(attempts) == len(stac.RETRY_WAITS) + 1


def test_an_empty_catalogue_answer_is_an_empty_list(monkeypatch):
    """No tile covers the area is a fact, not a failure."""
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([], [])))

    assert stac.search("sentinel-2-l2a", bbox=(-53.5, -25.0, -53.4, -24.9)) == []




# Which catalogue -------------------------------------------------------------


def asset(href):
    return SimpleNamespace(href=href)


def earth_search_item():
    """An Earth Search Collection 1 item, in the shape its API returns."""
    base = "https://e84.example/sentinel-2-c1-l2a/22/J/BT/2025/7/S2C_T22JBT_20250728T134336_L2A"
    return SimpleNamespace(
        id="S2C_T22JBT_20250728T134336_L2A",
        assets={
            "red": asset(f"{base}/B04.tif"),
            "nir": asset(f"{base}/B08.tif"),
            "scl": asset(f"{base}/SCL.tif"),
            "thumbnail": asset(f"{base}/L2A_PVI.jpg"),
            "granule_metadata": asset(f"{base}/metadata.xml"),
            "visual": asset(f"{base}/TCI.tif"),
        },
        properties={
            "datetime": "2025-07-28T13:43:36Z",
            "grid:code": "MGRS-22JBT",
            "s2:product_uri": "S2C_MSIL2A_20250728T134231_N0511_R124_T22JBT_20250728T182816.SAFE",
            "s2:processing_baseline": "05.11",
        },
    )


def opera_item():
    """A NASA OPERA RTC-S1 burst, in the shape CMR's STAC API returns."""
    name = "OPERA_L2_RTC-S1_T061-130864-IW3_20250911T221536Z_20250928T155930Z_S1C_30_v1.0"
    base = f"https://cumulus.example/OPERA/OPERA_L2_RTC-S1/{name}/{name}"
    return SimpleNamespace(
        id=name,
        assets={
            "0_VV": asset(f"{base}_VV.tif"),
            "0_VH": asset(f"{base}_VH.tif"),
            "0_mask": asset(f"{base}_mask.tif"),
        },
        properties={"datetime": "2025-09-11T22:15:36.000Z"},
    )


def test_the_planetary_computer_is_read_when_nothing_is_chosen():
    assert stac.source(stac.SENTINEL2).key == stac.PLANETARY_COMPUTER
    assert stac.source(stac.SENTINEL1).key == stac.PLANETARY_COMPUTER


def test_the_environment_chooses_the_catalogue_and_its_collection(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL2_SOURCE", "earth-search")
    opened = []
    calls = []

    def open_catalog(src):
        opened.append(src)
        return FakeCatalog([], calls)

    monkeypatch.setattr(stac, "open_catalog", open_catalog)

    stac.search(stac.SENTINEL2, bbox=(-53.5, -25.0, -53.4, -24.9))

    assert [s.key for s in opened] == ["earth-search"]
    assert opened[0].url == "https://earth-search.aws.element84.com/v1"
    assert calls[0]["collections"] == ["sentinel-2-c1-l2a"]


def test_a_source_no_catalogue_answers_to_is_refused_with_the_choices(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL1_SOURCE", "copernicus")

    with pytest.raises(protocol.Unavailable) as raised:
        stac.source(stac.SENTINEL1)

    assert "TERRA_SENTINEL1_SOURCE" in str(raised.value)
    assert "opera" in str(raised.value)
    assert "planetary-computer" in str(raised.value)


def test_earth_search_items_reach_the_products_in_planetary_computer_names(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL2_SOURCE", "earth-search")
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([earth_search_item()], [])))

    [item] = stac.search(stac.SENTINEL2)

    assert item.assets["B04"].href.endswith("/B04.tif")
    assert item.assets["B08"].href.endswith("/B08.tif")
    assert item.assets["SCL"].href.endswith("/SCL.tif")
    assert item.assets["rendered_preview"].href.endswith("/L2A_PVI.jpg")
    assert item.assets["granule-metadata"].href.endswith("/metadata.xml")
    # An asset with no counterpart keeps its own name.
    assert "visual" in item.assets
    assert item.properties["s2:mgrs_tile"] == "22JBT"
    assert item.properties["sat:relative_orbit"] == 124
    # Nothing to sign, so the href is read as it is.
    assert stac.href(item, "B04") == item.assets["B04"].href


def test_a_property_the_item_states_is_not_replaced_by_a_derived_one(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL2_SOURCE", "earth-search")
    stated = earth_search_item()
    stated.properties["sat:relative_orbit"] = 7
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([stated], [])))

    [item] = stac.search(stac.SENTINEL2)

    assert item.properties["sat:relative_orbit"] == 7


def test_opera_bursts_reach_the_radar_in_planetary_computer_names(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL1_SOURCE", "opera")
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([opera_item()], [])))

    [item] = stac.search(stac.SENTINEL1)

    assert set(item.assets) == {"vv", "vh", "mask"}
    assert item.properties["sat:relative_orbit"] == 61
    assert item.properties["platform"] == "SENTINEL-1C"
    assert item.properties[stac.SIGNING_PROPERTY] == "earthdata"


def test_an_earthdata_asset_is_read_from_its_signed_address_resolved_once(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL1_SOURCE", "opera")
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([opera_item()], [])))
    asked = []

    def redirect(url):
        asked.append(url)
        return url.replace("https://cumulus.example/", "https://bucket.example/") + "?X-Amz-Signature=s"

    monkeypatch.setattr(stac, "_earthdata_redirect", redirect)
    [item] = stac.search(stac.SENTINEL1)

    first = stac.href(item, "vv")
    again = stac.href(item, "vv")

    assert first == again
    assert first.startswith("https://bucket.example/") and "X-Amz-Signature" in first
    assert asked == [item.assets["vv"].href]


def test_an_earthdata_read_without_a_token_says_where_to_set_one():
    with pytest.raises(protocol.Unavailable) as raised:
        stac._earthdata_redirect("https://cumulus.example/burst_VV.tif")

    assert "Earthdata" in str(raised.value)
    assert "Settings" in str(raised.value)


def test_the_result_records_which_catalogue_each_collection_came_from(monkeypatch):
    monkeypatch.setenv("TERRA_SENTINEL2_SOURCE", "earth-search")
    monkeypatch.setattr(stac, "open_catalog", opener(
        FakeCatalog([], []), FakeCatalog([], [])
    ))

    stac.search(stac.SENTINEL2)
    stac.search(stac.SENTINEL1)

    assert stac.used() == [
        {
            "collection": "sentinel-1-rtc",
            "source": "planetary-computer",
            "title": "Microsoft Planetary Computer",
            "url": "https://planetarycomputer.microsoft.com/api/stac/v1",
            "catalogue_collection": "sentinel-1-rtc",
        },
        {
            "collection": "sentinel-2-l2a",
            "source": "earth-search",
            "title": "Element 84 Earth Search",
            "url": "https://earth-search.aws.element84.com/v1",
            "catalogue_collection": "sentinel-2-c1-l2a",
        },
    ]


# Too many requests -------------------------------------------------------------


class Throttled(Exception):
    """What pystac_client raises for an answer it did not expect: APIError, with the status."""

    def __init__(self):
        super().__init__("429 Too Many Requests")
        self.status_code = 429


def test_a_429_waits_the_throttle_schedule_rather_than_the_short_one(monkeypatch):
    monkeypatch.setattr(stac, "RETRY_WAITS", (1, 2, 3))
    monkeypatch.setattr(stac, "THROTTLE_WAITS", (40, 50, 60))
    waits = []
    monkeypatch.setattr(stac.time, "sleep", waits.append)
    monkeypatch.setattr(stac, "open_catalog", opener(
        Throttled(), RuntimeError("503 Service Unavailable"), FakeCatalog(["scene"], [])
    ))

    assert stac.search(stac.SENTINEL2) == ["scene"]
    assert waits == [40, 2]


def test_a_catalogue_that_keeps_answering_429_is_reported_as_limiting(monkeypatch):
    monkeypatch.setattr(stac, "open_catalog", opener(
        *[Throttled()] * (len(stac.RETRY_WAITS) + 1)
    ))

    with pytest.raises(stac.Unavailable) as raised:
        stac.search(stac.SENTINEL2)

    assert "limiting requests" in str(raised.value)
    assert "Microsoft Planetary Computer" in str(raised.value)


class LocalCatalogue(BaseHTTPRequestHandler):
    """
    A STAC API on the loopback interface that answers its first search with
    429 and a Retry-After, then with an empty result. Offline, and the real
    client and HTTP stack in between.
    """

    searches: list[str] = []

    def log_message(self, *args):
        pass

    def _send(self, status, body, headers=()):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        root = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._send(200, {
            "type": "Catalog",
            "id": "local",
            "description": "test",
            "stac_version": "1.0.0",
            "conformsTo": [
                "https://api.stacspec.org/v1.0.0/core",
                "https://api.stacspec.org/v1.0.0/item-search",
            ],
            "links": [
                {"rel": "self", "href": root},
                {"rel": "root", "href": root},
                {"rel": "search", "href": f"{root}/search", "method": "POST",
                 "type": "application/geo+json"},
            ],
        })

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.searches.append(self.path)
        if len(self.searches) == 1:
            self._send(429, {"code": "TooManyRequests"}, [("Retry-After", "7")])
        else:
            self._send(200, {"type": "FeatureCollection", "features": [], "links": []})


def test_the_http_client_waits_as_long_as_retry_after_says(monkeypatch):
    LocalCatalogue.searches = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), LocalCatalogue)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        local = stac.Source(
            key="local",
            title="Local catalogue",
            url=f"http://127.0.0.1:{server.server_address[1]}",
            collection="sentinel-2-l2a",
        )
        monkeypatch.setitem(stac.SOURCES[stac.SENTINEL2], "local", local)
        monkeypatch.setenv("TERRA_SENTINEL2_SOURCE", "local")
        slept = []
        # urllib3 sleeps through the time module; recording the call is how
        # the test sees the wait without spending it.
        monkeypatch.setattr(time, "sleep", slept.append)

        assert stac.search(stac.SENTINEL2) == []
    finally:
        server.shutdown()

    assert len(LocalCatalogue.searches) == 2
    assert 7.0 in slept


class Refusal:
    """The parts of a requests.Response an Earthdata refusal is read from."""

    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not JSON")
        return self._body


def test_an_unapproved_archive_names_the_page_where_it_is_approved():
    message = stac._earthdata_refusal(Refusal(403, {
        "error": "invalid_token",
        "status_code": 403,
        "error_description": "EULA Acceptance Failure",
        "resolution_url": "https://urs.earthdata.nasa.gov/approve_app?client_id=abc",
    }))

    assert "https://urs.earthdata.nasa.gov/approve_app?client_id=abc" in message
    assert "expired" not in message


def test_any_other_refusal_points_at_a_new_token():
    message = stac._earthdata_refusal(Refusal(401, None))

    assert "HTTP 401" in message
    assert "urs.earthdata.nasa.gov/profile" in message
