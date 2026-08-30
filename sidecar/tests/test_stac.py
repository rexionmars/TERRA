"""
The one catalogue client: what it retries, and what it refuses to hide.

Before this module the retry lived inside the Sentinel-2 listing, so terrain
and flood reads had none. These tests hold the behaviour in the place all three
now share it.
"""

from __future__ import annotations

import pytest

from terra import stac


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


def opener(*outcomes):
    """An open_catalog that yields each outcome in turn, raising the exceptions."""
    remaining = list(outcomes)

    def open_catalog(url=stac.URL):
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
        "bbox": [-53.5, -25.0, -53.4, -24.9],
        "datetime": "2023-01-01/2023-03-01",
        "query": {"eo:cloud_cover": {"lt": 30.0}},
    }]


def test_criteria_the_caller_omitted_are_not_sent(monkeypatch):
    """
    A DEM search states `intersects` and nothing else. Sending bbox=None or
    datetime=None would be a filter the caller never asked for.
    """
    calls = []
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([], calls)))

    stac.search("cop-dem-glo-30", intersects={"type": "Polygon", "coordinates": []})

    assert calls == [{
        "collections": ["cop-dem-glo-30"],
        "intersects": {"type": "Polygon", "coordinates": []},
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

    def open_catalog(url=stac.URL):
        attempts.append(url)
        raise RuntimeError("503 Service Unavailable")

    monkeypatch.setattr(stac, "open_catalog", open_catalog)

    with pytest.raises(stac.Unavailable):
        stac.search("sentinel-2-l2a")

    assert len(attempts) == len(stac.RETRY_WAITS) + 1


def test_an_empty_catalogue_answer_is_an_empty_list(monkeypatch):
    """No tile covers the area is a fact, not a failure."""
    monkeypatch.setattr(stac, "open_catalog", opener(FakeCatalog([], [])))

    assert stac.search("cop-dem-glo-30", intersects={"type": "Polygon"}) == []


def test_the_caller_can_point_at_another_endpoint(monkeypatch):
    seen = []

    def open_catalog(url=stac.URL):
        seen.append(url)
        return FakeCatalog([], [])

    monkeypatch.setattr(stac, "open_catalog", open_catalog)

    stac.search("sentinel-2-l2a", url="https://example.invalid/stac/v1")

    assert seen == ["https://example.invalid/stac/v1"]
