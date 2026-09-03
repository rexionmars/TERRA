"""
The one reader of the ONS open-data record.

ONS publishes through CKAN as whole files, one per dataset per period, and
serves no query interface: there is no per-plant or per-window endpoint to call.
That single fact decides the shape of this module. The unit that is fetched,
cached and carried as provenance is the FILE, never the question that will be
asked of it.

THIS MODULE ONLY INGESTS. Answering "this plant, this window" is store.py's
job and only store.py's. An earlier version answered it here too, by reading a
93 MB month to keep a day of it -- correct, and 195 times slower, and a second
implementation of the same question with its own window arithmetic. Two
implementations of one question drift: the exclusive-midnight rule was already
written twice, and a fix to one would have silently left the other wrong. The
store is a hard requirement of this slice precisely so that this path does not
have to exist.

    dados.ons.org.br/api/3/action/package_show?id=<dataset>

THE CACHE KEY IS NOT THE ONE terra/sun USES, AND THE DIFFERENCE IS THE POINT.
The POWER cache has no expiry by design: POWER reprocesses history, and a
stored series is kept so a figure benchmarked against it stays reproducible,
with the fetch date carried so a stale revision is at least visible. That trade
does not transfer here, because ONS does not revise quietly at the margin -- it
rewrites whole years in a batch. Read on 2026-09-02, the photovoltaic detail
catalogue showed every month of 2024-04..2024-12 rewritten on a single day in
2025-02, and every month of 2025-01..2026-03 rewritten across four days in
2026-04/05. A cache keyed on (dataset, period) alone would have served the
superseded revision of fourteen months, silently, for as long as it survived
on disk.

So the key carries the catalogue's `last_modified` as well, and a revision
invalidates the entry by not matching it. The cost is one catalogue call per
dataset per run to learn that timestamp. That is the right price: it is a few
kilobytes against files of hundreds of megabytes, and it buys the guarantee the
POWER cache can only warn about.

WHEN THE CATALOGUE CANNOT BE REACHED, cached files are still served, with
provenance saying the revision could not be verified. Refusing would make the
whole slice unusable offline in order to protect against a revision that
usually has not happened; serving without saying so is what this module exists
to prevent.

Named for the operator rather than for curtailment, because curtailment is one
of several records it publishes and the ones that will follow -- load,
dispatch, transmission -- come through the same transport.
"""

from __future__ import annotations

import json
import re
import shutil
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

CKAN = 'https://dados.ons.org.br/api/3/action'


# ONS returns 403 to a bare urllib user agent.
HEADERS = {'User-Agent': 'Mozilla/5.0 (geosense-terra)'}


# ONS writes ISO-8601 dates in local Brasilia time with no offset, and semicolon
# separated CSV with a comma decimal mark. Read wrong, the decimal mark turns
# every value into a string and the failure surfaces far from here.
#
# low_memory=False IS NOT AN OPTIMISATION. Chunked parsing infers a dtype per
# chunk, so a column that is empty early and numeric later comes back as
# object -- and with usecols, pandas' own mixed-dtype warning path indexes the
# full column list by a position the subset does not have, and raises
# IndexError from inside read_csv. The curtailment record hits both: its
# generation columns are blank on the cluster rows that open every file.
CSV_KWARGS = {'sep': ';', 'decimal': ',', 'encoding': 'utf-8',
              'low_memory': False}


# The datasets this slice reads, and what each one is the record OF. Held as a
# table for the same reason terra/registry.py holds one: a dataset name is the
# only thing that varies between two calls that are otherwise identical, and a
# name spelled in a caller is a name no test can check.
DATASETS = {
    'pv_curtailment_detail': {
        'package': 'restricao_coff_fotovoltaica_detail',
        'note': (
            'Half-hourly per-plant photovoltaic record with measured '
            'irradiance, estimated generation and verified generation. '
            'Begins 2024-04.'
        ),
    },
    'pv_curtailment': {
        'package': 'restricao_coff_fotovoltaica',
        'note': (
            'Half-hourly per-plant photovoltaic curtailment with the reason '
            'and origin codes, which the detail series does not carry.'
        ),
    },
    'wind_curtailment_detail': {
        'package': 'restricao_coff_eolica_detail',
        'note': (
            'The wind counterpart of pv_curtailment_detail, carrying measured '
            'wind speed in place of irradiance.'
        ),
    },
    'wind_curtailment': {
        'package': 'restricao_coff_eolica',
        'note': 'Per-plant wind curtailment with reason and origin codes.',
    },
}


# The measured-irradiance column of the detail series is a PLANE-OF-ARRAY
# reading, not GHI, and nothing in the record says so. It was established
# against NASA POWER over 394 plants: the ratio to modelled GHI rises with
# latitude (1.037 at 4 deg to 1.262 at 21 deg), peaks in winter rather than
# summer (1.284 in July against 1.084 in January), and is higher under clear
# sky (1.334) -- three signatures of a tilted plane and of nothing else.
# Compared against GHI it reads as a 14.8 percent low bias in POWER that does
# not exist. Stated here because the column name is what a caller sees.
IRRADIANCE_IS_POA = (
    'val_irradianciaverificado is measured in the plane of the array, not on '
    'the horizontal. Comparing it against GHI reports a bias that is the tilt.'
)


def ons_cache_dir(req):
    """
    Directory the ONS period files are cached in, or None if it cannot be made.

    Outside work_dir for the reason terra/sun/cache.py states: the Go runner
    creates a fresh temporary work_dir per run, so a cache under it is never
    read twice and the download is paid again every time. These files are far
    larger than a POWER series -- the photovoltaic detail record is about
    19 million rows -- so paying twice is worse here, not better.
    """
    raw = req.get('ons_cache_dir')
    path = Path(raw) if raw else Path.home() / '.cache' / 'geosense' / 'ons'
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


def _now():
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def catalogue(dataset: str, timeout: int = 60) -> pd.DataFrame:
    """
    The period files a dataset publishes, with the revision stamp of each.

    One row per period. `last_modified` is what makes a cached file verifiable
    and is the reason this call is made at all; a catalogue without it would
    not be worth fetching.

    DUPLICATE PERIODS ARE REAL AND ARE RESOLVED HERE. The photovoltaic detail
    catalogue carries two entries for 2024-09, one from 2024-10 and one from
    the 2025-02 rewrite. Both are live. The later revision wins, because the
    alternative is that which of two files a run reads depends on the order
    CKAN happened to return them in.
    """
    if dataset not in DATASETS:
        raise KeyError(
            f'unknown ONS dataset {dataset!r}; '
            f'known: {", ".join(sorted(DATASETS))}'
        )
    package = DATASETS[dataset]['package']
    payload = _open_catalogue(f'{CKAN}/package_show?id={package}', timeout)
    if not payload.get('success'):
        raise RuntimeError(f'ONS CKAN refused the package {package!r}')

    rows = []
    for res in payload['result']['resources']:
        if (res.get('format') or '').upper() != 'CSV':
            continue
        url = res['url']
        stamp = res.get('last_modified') or res.get('created') or ''
        rows.append({
            'url': url,
            'filename': url.rsplit('/', 1)[-1],
            'period': _period_of(url),
            'last_modified': stamp[:19],
        })
    if not rows:
        raise RuntimeError(f'ONS published no CSV resource for {package!r}')

    frame = pd.DataFrame(rows).sort_values('last_modified')
    # The later revision of a duplicated period wins; see the docstring.
    frame = frame.drop_duplicates('period', keep='last')
    return frame.sort_values('period').reset_index(drop=True)


def _open_catalogue(url: str, timeout: int) -> dict:
    """
    One CKAN call, as JSON.

    Separated from catalogue() so the decisions that function makes -- which
    revision of a duplicated period wins, what a filename's period is -- are
    reachable by a test without a network. They are the parts that were wrong.
    """
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as fh:
        return json.load(fh)


def _download(url: str, dest: Path, timeout: int) -> None:
    """
    One file streamed to `dest`, via a partial name, verified against its
    declared length.

    Streamed rather than read into memory: a month of the photovoltaic detail
    record is about 93 MB and the published span is thirty of them. Renamed only
    on completion, so an interrupted download is never read as a whole file by
    the next run.

    THE LENGTH CHECK IS NOT BELT AND BRACES. A connection that drops mid-body
    ends the read WITHOUT RAISING: copyfileobj returns normally, the partial
    file is renamed, and what lands on disk is a valid CSV that simply stops.
    One of thirty months of the photovoltaic record was fetched that way and
    sat unnoticed -- 60,817,408 bytes of 78,802,592, missing 22.8 percent, and
    the truncation fell exactly on a 1 MiB read boundary. It cost nothing at
    read time, parsed without error, and was found only when a database
    rejected the half row at its end. Every analysis over that month had been
    silently short for as long as the file existed.

    A server that declares no Content-Length cannot be checked and is accepted;
    that is a real case for a chunked response, and it is reported as unknown
    rather than as verified.
    """
    partial = dest.with_name(dest.name + '.partial')
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as fh:
            declared = fh.headers.get('Content-Length')
            with open(partial, 'wb') as out:
                shutil.copyfileobj(fh, out, length=1 << 20)
        written = partial.stat().st_size
        if declared is not None and written != int(declared):
            raise OSError(
                f'truncated download: got {written:,} bytes of the '
                f'{int(declared):,} the server declared for {url}')
        partial.replace(dest)
    except BaseException:
        try:
            partial.unlink()
        except OSError:
            pass
        raise


def _period_of(url: str) -> str:
    """
    The period a resource covers, as YYYY-MM or YYYY, from its filename.

    Both shapes are published: the curtailment records are monthly, the load
    and stored-energy records annual. Read from the filename because the CKAN
    entry carries no period field, only a free-text name that is not stable.
    """
    monthly = re.search(r'(\d{4})[_-](\d{2})(?!\d)', url)
    if monthly:
        return f'{monthly.group(1)}-{monthly.group(2)}'
    annual = re.search(r'(?<!\d)(20\d{2})(?!\d)', url)
    return annual.group(1) if annual else ''


def _stamp_path(path: Path) -> Path:
    return path.with_name(path.name + '.json')


def _cached_revision(path: Path):
    """
    The catalogue revision a cached file was fetched under, or None.

    None means unverifiable, not fresh. A file's modification time on this disk
    is when it was written here, which a copy or a restore changes, so it is
    never read as the revision.
    """
    try:
        return json.loads(_stamp_path(path).read_text()).get('last_modified')
    except Exception:
        return None


def fetch_period(dataset: str, row, cache_dir, retries: int = 4,
                 timeout: int = 900, progress=None):
    """
    One period file on disk, downloaded only if no current revision is cached.

    A cached file is current when its stored revision equals the one `row`
    carries from the catalogue. Not equal, or not recorded, means download:
    an unstamped file predates this module and cannot be vouched for.

    Streamed to a partial name and renamed on completion, so an interrupted
    download can never be read as a whole file by the next run. Returns
    (path, provenance).
    """
    def record(source, note, revision):
        return {
            'source': source,
            'dataset': dataset,
            'package': DATASETS[dataset]['package'],
            'period': row['period'],
            'file': row['filename'],
            'catalogue_revision': revision,
            'read_utc': _now(),
            'note': note,
        }

    wanted = row['last_modified']
    if cache_dir is None:
        raise RuntimeError(
            'no ONS cache directory is available, and these files are too '
            'large to fetch into memory; set ons_cache_dir'
        )
    dest = Path(cache_dir) / dataset / row['filename']
    dest.parent.mkdir(parents=True, exist_ok=True)

    have = _cached_revision(dest)
    if dest.exists() and dest.stat().st_size > 0 and have == wanted:
        return dest, record(
            'cache', 'Read from the on-disk ONS cache; its revision matches '
                     'the one the catalogue currently publishes.', have)

    superseded = dest.exists() and have is not None and have != wanted
    last = None
    for attempt in range(retries):
        try:
            _download(row['url'], dest, timeout)
            # Written after the file, so a stamp never exists for a file that
            # is not there; a missing stamp reads as unverifiable, not current.
            _stamp_path(dest).write_text(json.dumps({
                'last_modified': wanted, 'fetched_utc': _now(),
                'dataset': dataset, 'period': row['period'],
                'url': row['url'],
            }))
            return dest, record(
                'fetch',
                'Downloaded during this run because the cache held the '
                f'superseded revision {have}.' if superseded else
                'Downloaded from ONS during this run.', wanted)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            if progress:
                progress(f'retrying {row["filename"]}: {exc}')
    # A download that failed must not silently fall back to a revision the
    # catalogue has replaced. Serving the stale file is offered only when the
    # catalogue itself was unreachable, which is decided in read(), not here.
    raise RuntimeError(
        f'ONS download failed for {row["filename"]} after {retries} '
        f'attempts: {last}'
    )


def periods_covering(start: str, end: str, catalogue_frame) -> pd.DataFrame:
    """
    The published period files a window falls in.

    The window is given as YYYY-MM-DD and the record is published by month, so
    a window of one day still costs the month it is in. That asymmetry is the
    service's, not this module's, and it is why the cache is worth its disk.
    """
    lo, hi = str(start)[:7], str(end)[:7]
    period = catalogue_frame['period']
    monthly = period.str.len() == 7
    keep = ((monthly & (period >= lo) & (period <= hi))
            | (~monthly & (period >= lo[:4]) & (period <= hi[:4])))
    return catalogue_frame[keep].reset_index(drop=True)
