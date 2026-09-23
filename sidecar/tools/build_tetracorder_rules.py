#!/usr/bin/env python3
"""
Build the mineral slice's rule file from a Tetracorder checkout.

Tetracorder (Clark et al., 2003, JGR 108(E12) 5131; Clark et al., 2024, PSJ
5:276) is two programs in one. A setup stage reads the expert-system command
file, finds each reference spectrum in the SPECPR libraries, converts every
continuum wavelength to a channel, removes the continuum from the reference,
locates its band minimum and integrates its area. An analysis stage then fits
each observed pixel against those prepared references. Only the second stage
depends on the pixel, so the first is done here, once, and its result is what
the sidecar ships: terra/mineral/data/tetracorder_emit.json.

The port follows the Fortran rather than the prose where the two differ, and
names the routine each step reproduces. The routines are in the checkout under
tetracorder5.27/ and tetracorder6.00/ (identical for everything used here) and
specpr/src.specpr/fcn40-42/:

    getifeat.r    feature syntax, importance codes, curved-continuum midpoints
    wtochbin.r    wavelength interval to channel interval
    bdmset.r      reference continuum removal, band minimum, feature type
    reflsetup.r   area weights, material disabling
    getnotfeat.r  which earlier material a NOT feature refers to
    getconstraints.r, applygtpconstraints.r

Usage:

    git clone https://github.com/PSI-edu/spectroscopy-tetracorder
    python sidecar/tools/build_tetracorder_rules.py /path/to/spectroscopy-tetracorder

The defaults select the configuration closest to the one that produced the
EMIT L2B mineral product: the emit_c channel set and 285-channel libraries
(s06emitc, r06emitc), the temperature and pressure window the EMIT pipeline
passes to cmd-setup-tetrun (-T -20 80 C -P .5 1.5 bar), and the t5.27e1 expert
system. The L2B V001 files record their own provenance (tetracorder5.27c.cmds,
cmd.lib.setup.t5.27d1, libraries s06emite/r06emite); t5.27d1 and the emit_e
libraries are not in the public repository, and t5.27e1 is the public release
nearest to them.

Measured, not assumed. On EMIT_L2A_RFL_001_20240830T135446_2424309_051 (a
256 x 256 instrument-pixel window, n = 65,536, Minas Gerais), against
EMIT_L2B_MIN_001 of the same acquisition, the class of the group 1 answer
agreed on 71.1% of the pixels both identified with t5.27e1 and on 30.9% with
t6.00a6. In t6.00a6 the bronzite 1 um continuum was moved to 0.760 um and its
2 um feature is disabled by the emit_c deleted channels, so the entry matches
the broad 1 um shape of dry vegetation and displaces goethite and hematite.
Group 2 agreed on 84.1% and 84.0%.

t5.27e1 carries no `list materials` blocks. The class of each entry is taken
from the entry of the --components-from expert system that uses the same
library record.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SIDECAR = Path(__file__).resolve().parents[1]
OUT_DIR = SIDECAR / 'terra' / 'mineral' / 'data'

# SPECPR v2: 1536-byte big-endian records, record 0 a label. A first record
# carries a 512-byte header and 256 channels; each continuation record carries
# a 4-byte flag word and 383 more. specpr/specpr-format-2,3/specpr-format-v2.txt
RECORD_BYTES = 1536

DELETED = -1.23e34  # the value Tetracorder writes into a deleted channel

# The groups whose winners the slice reports: 1 is the electronic absorptions
# of Fe2+ and Fe3+ from the ultraviolet to about 1.3 um, 2 the vibrational
# absorptions of 2.0 to 2.5 um. Group 0 is not reported on its own: its
# vegetation, water, snow and plastic entries compete inside every group that
# the setup file does not list after `nogroup0:` (tp1all.r, incgrp0).
REPORTED_GROUPS = (1, 2)

IMPORTANCE = {'O': 0, 'W': 1, 'D': 2, 'M': 3}  # getifeat.r, imch()

OPTION_ARITY = {
    'ct': (1, 2), 'lct': (1, 2), 'rct': (1, 2),
    'lct/rct>': (2, 2), 'rct/lct>': (2, 2),
    'rcbblc>': (2, 2), 'rcbblc<': (2, 2), 'lcbbrc>': (2, 2), 'lcbbrc<': (2, 2),
    'r*bd>': (2, 2),
}

THRESHOLD_KEYS = {
    'FIT>': 'fit', 'FITALL>': 'fitall', 'DEPTH>': 'depth',
    'DEPTHALL>': 'depthall', 'DEPTH-FIT>': 'depth_fit', 'FD>': 'fd',
    'FDALL>': 'fdall', 'FD-FIT>': 'fd_fit', 'FD-DEPTH>': 'fd_depth',
}


class SetupError(ValueError):
    """The command file says something this port does not implement."""


# SPECPR ---------------------------------------------------------------------


def read_specpr(path: Path, record: int) -> tuple[str, np.ndarray, int]:
    """Title, channel values and wavelength-record pointer of one spectrum."""
    with path.open('rb') as f:
        f.seek(record * RECORD_BYTES)
        head = f.read(RECORD_BYTES)
        (flags,) = struct.unpack('>i', head[:4])
        if flags & 1:
            raise SetupError(f'{path.name} record {record} is a continuation')
        if flags & 2:
            raise SetupError(f'{path.name} record {record} is text, not data')
        title = head[4:44].decode('latin1').rstrip()
        (nchan,) = struct.unpack('>i', head[80:84])
        (wave_record,) = struct.unpack('>i', head[100:104])
        values = list(struct.unpack('>256f', head[512:1536]))
        while len(values) < nchan:
            values += struct.unpack('>383f', f.read(RECORD_BYTES)[4:])
    return title, np.asarray(values[:nchan], dtype=np.float64), wave_record


# The command file -------------------------------------------------------------


def strip_comment(line: str) -> str:
    cut = line.find('\\#')
    return (line if cut < 0 else line[:cut]).rstrip()


def read_variables(*paths: Path) -> dict[str, str]:
    """`==[NAME] value` lines: the global thresholds and NOT references."""
    out: dict[str, str] = {}
    for path in paths:
        for raw in path.read_text(encoding='latin1').splitlines():
            m = re.match(r'^==\[(\w+)\]\s*(.*)$', strip_comment(raw))
            if m:
                out[m[1]] = m[2].strip()
    return out


def substitute(line: str, variables: dict[str, str]) -> str:
    def repl(m: re.Match) -> str:
        name = m[1]
        if name in ('sprlb06', 'splib06', 'DELETPTS'):
            return m[0]
        if name not in variables:
            raise SetupError(f'undefined variable [{name}]')
        return ' ' + variables[name] + ' '

    return re.sub(r'\[(\w+)\]', repl, line)


def parse_channel_list(text: str) -> set[int]:
    """`1t4 75t79 ... c` from DELETED.channels, as 1-based channel numbers."""
    body = text.split('c', 1)[0]
    out: set[int] = set()
    for tok in body.split():
        if 't' in tok:
            a, b = tok.split('t')
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(tok))
    return out


@dataclass
class RawEntry:
    kind: str
    number: int
    use: bool = True
    algorithm: str = ''
    ident: str = ''
    library: tuple[str, int] | None = None
    title: str = ''
    components: list[tuple[str, float | None]] = field(default_factory=list)
    features: list[list[str]] = field(default_factory=list)
    nots: list[list[str]] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    line: int = 0


def parse_setup(path: Path, variables: dict[str, str]) -> tuple[list[RawEntry], set[int]]:
    """Every entry in file order, and the groups that do not take in group 0."""
    entries: list[RawEntry] = []
    no_group0: set[int] = set()
    cur: RawEntry | None = None
    section = ''
    for lineno, raw in enumerate(path.read_text(encoding='latin1').splitlines(), 1):
        line = strip_comment(raw)
        s = line.strip()
        if not s:
            continue
        m = re.match(r'^nogroup0:\s*(.*)$', s)
        if m:
            no_group0 = {int(t) for t in m[1].split()}
            continue
        m = re.match(r'^(group|case)\s+(\d+)$', s)
        if m and not line.startswith((' ', '\t')):
            cur = RawEntry(kind=m[1], number=int(m[2]), line=lineno)
            entries.append(cur)
            section = ''
            continue
        if cur is None:
            continue
        if section == 'materials':
            if s == 'end_list_materials':
                section = ''
            else:
                # `name [abundance]`; some lines carry a qualifier such as
                # `biogenic` where the abundance would be.
                tok = s.split()
                try:
                    abundance = float(tok[1]) if len(tok) > 1 else None
                except ValueError:
                    abundance = None
                cur.components.append((tok[0], abundance))
            continue
        if s.startswith('use='):
            cur.use = s.split()[1] == 'yes'
        elif s.startswith('algorithm:'):
            cur.algorithm = s.split()[1]
        elif s.startswith('ID='):
            cur.ident = s[3:].strip()
        elif s == 'define library records':
            section = 'library'
        elif s == 'endlibraryrecords':
            section = 'title'
        elif s == 'list materials':
            section = 'materials'
        elif s == 'define features':
            section = 'features'
        elif s == 'define constraints':
            section = 'constraints'
        elif s.startswith('define output'):
            section = 'output'
        elif s.startswith('define actions'):
            section = 'actions'
        elif s in ('endfeatures', 'endconstraint', 'endoutput', 'endaction'):
            section = ''
        elif section == 'library':
            m = re.search(r'SMALL:\s*\[(\w+)\]\s+(\d+)', s)
            if m:
                cur.library = (m[1], int(m[2]))
        elif section == 'title':
            if s != '[DELETPTS]' and not s.startswith('identification_confidence'):
                cur.title = s
                section = ''
        elif section == 'features':
            tok = substitute(s, variables).split()
            if re.match(r'^n\d+a$', tok[0]):
                cur.nots.append(tok)
            elif re.match(r'^f\d+a$', tok[0]):
                cur.features.append(tok)
            elif cur.features:
                # A line without a label continues the last one.
                cur.features[-1] += tok
            else:
                raise SetupError(f'line {lineno}: option before any feature')
        elif section == 'constraints':
            cur.constraints.append(substitute(s, variables))
    return entries, no_group0


# Setup: reference-side computations -----------------------------------------


def wtochbin(waves: np.ndarray, w1: float, w2: float) -> tuple[int, int] | None:
    """
    Channel interval, 0-based inclusive, covering [w1, w2]. wtochbin.r.

    The first channel at or above w1, extended while channels stay at or below
    w2; when that leaves one channel lying outside the interval, the nearest
    neighbour of w1 is taken instead. None where w1 lies beyond the last
    channel, which disables the feature.
    """
    n = len(waves)
    if w2 < w1:
        raise SetupError(f'continuum interval reversed: {w1} {w2}')
    start = next((i for i in range(n) if w1 <= waves[i]), None)
    if start is None:
        return None
    ich1 = ich2 = start
    for j in range(start, n):
        if w2 < waves[j]:
            break
        ich2 = j
    if ich1 == ich2 and not (w1 <= waves[ich1] <= w2):
        if ich1 > 0 and abs(waves[ich1] - w1) > abs(waves[ich1 - 1] - w1):
            return ich1 - 1, ich1 - 1
        if ich1 < n - 1 and abs(waves[ich1] - w1) > abs(waves[ich1 + 1] - w1):
            return ich1 + 1, ich1 + 1
    return ich1, ich2


def bdmset(waves, spec, deleted, cl, cr):
    """
    Continuum-removed reference, band minimum channel and feature type.
    bdmset.r. Returns None on any condition the Fortran reports as an error,
    which disables the feature.
    """
    (cl1, cl2), (cr1, cr2) = cl, cr
    if cl1 > cl2 or cr1 > cr2 or cl2 + 1 > cr1 - 1:
        return None
    ok = ~deleted
    left = [i for i in range(cl1, cl2 + 1) if ok[i]]
    right = [i for i in range(cr1, cr2 + 1) if ok[i]]
    if not left or not right:
        return None
    avlc, avwlc = spec[left].mean(), waves[left].mean()
    avrc, avwrc = spec[right].mean(), waves[right].mean()
    if abs(avwrc - avwlc) < 1e-20:
        return None
    a = (avrc - avlc) / (avwrc - avwlc)
    b = avrc - a * avwrc
    removed = np.full(len(spec), np.nan)
    for i in range(cl1, cr2 + 1):
        contin = a * waves[i] + b
        if ok[i] and abs(contin) > 1e-20:
            removed[i] = spec[i] / contin
    il, ir = cl2 + 1, cr1 - 1
    band = removed[il:ir + 1]
    if np.isnan(band[0]):
        # The Fortran seeds its search with the first band channel whether or
        # not it is deleted; a deleted seed carries the sentinel -1.23e34,
        # which every later value exceeds, so the seed is the minimum.
        return None
    finite = np.where(np.isfinite(band))[0]
    minch = il + int(finite[np.argmin(band[finite])])
    maxch = il + int(finite[np.argmax(band[finite])])
    rmin, rmax = removed[minch], removed[maxch]
    if rmin < 0.0:
        return None
    ftype = -1 if (rmax - 1.0) > (1.0 - rmin) else 1
    return removed, minch, maxch, ftype


# Setup: parsing features, NOTs and constraints --------------------------------


def take_numbers(tok: list[str], i: int, lo: int, hi: int) -> tuple[list[float], int]:
    vals: list[float] = []
    while i < len(tok) and len(vals) < hi:
        try:
            vals.append(float(tok[i]))
        except ValueError:
            break
        i += 1
    if len(vals) < lo:
        raise SetupError(f'expected {lo} numbers at {tok[i - 1:i + 2]}')
    return vals, i


def merge_feature_lines(lines: list[list[str]]) -> list[list[str]]:
    """
    One token list per feature number, in feature-number order.

    getifeat.r sets `ifeat` from the label on every line, so a line reading
    `f2a  lct/rct> 0.9 1.1` adds an option to feature 2 wherever it appears --
    including, in t6.00a6 snow.slush.16 and water.low.chlorophyll-turquoise,
    before the line that defines feature 2. Grouping by label reproduces that;
    attaching each option line to the preceding definition would not.
    """
    defined: dict[int, list[str]] = {}
    extra: dict[int, list[str]] = {}
    for tok in lines:
        n = int(tok[0][1:-1])
        if len(tok) > 1 and re.match(r'^[DMOW][LC]w$', tok[1]):
            # A second definition of the same label (t6.00a6 group 14,
            # ohb_1.425_sulfate-alunite) overwrites the first, as the Fortran
            # arrays indexed by ifeat do.
            defined[n] = tok
        else:
            extra.setdefault(n, []).extend(tok[1:])
    missing = set(extra) - set(defined)
    if missing:
        raise SetupError(f'options for undefined features {sorted(missing)}')
    return [defined[n] + extra.get(n, []) for n in sorted(defined)]


def parse_feature(tok: list[str]) -> dict:
    kind = tok[1]
    m = re.match(r'^([DMOW])([LC])w$', kind)
    if not m:
        raise SetupError(f'feature type {kind!r} not implemented')
    nwaves = 4 if m[2] == 'L' else 8
    waves = [float(t) for t in tok[2:2 + nwaves]]
    out: dict = {
        'importance': m[1],
        'curved': m[2] == 'C',
        'waves': waves,
        'options': {},
        'weight_factor': 1.0,
    }
    i = 2 + nwaves
    while i < len(tok):
        key = tok[i]
        if key.startswith('weight*'):
            out['weight_factor'] = float(key.split('*', 1)[1])
            i += 1
            continue
        if key not in OPTION_ARITY:
            raise SetupError(f'feature option {key!r} not implemented')
        lo, hi = OPTION_ARITY[key]
        vals, i = take_numbers(tok, i + 1, lo, hi)
        out['options'][key] = vals
    return out


def parse_constraints(lines: list[str]) -> dict:
    out: dict = {'thresholds': {}, 'temperature_k': None, 'pressure_bar': None,
                 'fratio': [], 'class': None}
    for line in lines:
        body = line.split(':', 1)[1].strip() if line.startswith('constraint:') else line
        m = re.match(r'^temperature:?\s+([CK])\s+(.*)$', body)
        if m:
            vals = [float(v) for v in m[2].split()[:4]]
            out['temperature_k'] = [v + 273.15 if m[1] == 'C' else v for v in vals]
            continue
        m = re.match(r'^pressure:?\s+(bar|Bar|torr|Torr)\s+(.*)$', body)
        if m:
            vals = [float(v) for v in m[2].split()[:4]]
            scale = 1.0 if m[1].lower() == 'bar' else 1.0 / 750.0617
            out['pressure_bar'] = [v * scale for v in vals]
            continue
        m = re.match(r'^fratio:\s*(\d+)\s*/\s*(\d+)\s*=\s*(.*)$', body)
        if m:
            vals = [float(v) for v in m[3].split()[:4]]
            out['fratio'].append({'a': int(m[1]) - 1, 'b': int(m[2]) - 1, 'range': vals})
            continue
        if body.startswith('class'):
            raise SetupError('class constraints are not implemented')
        tok = body.replace('>', '> ').split()
        i = 0
        while i < len(tok):
            key = tok[i]
            if key not in THRESHOLD_KEYS:
                raise SetupError(f'constraint {key!r} not implemented in {line!r}')
            vals, i = take_numbers(tok, i + 1, 1, 2)
            # One number is a hard threshold: getconstraints.r leaves the second
            # at 0, and tp1mat.r's fuzzy branch then never fires.
            lo = vals[0]
            hi = vals[1] if len(vals) == 2 else vals[0]
            out['thresholds'][THRESHOLD_KEYS[key]] = [lo, hi]
    return out


def parse_not(tok: list[str]) -> dict:
    # n1a NOT [splib06] 7170 1 0.15a 0.5  (after substitution of the variable)
    if tok[1] != 'NOT':
        raise SetupError(f'NOT feature malformed: {tok}')
    lib = tok[2].strip('[]')
    record = int(tok[3])
    feature = int(tok[4]) - 1
    m = re.match(r'^([\d.]+)(a|r(\d+))$', tok[5])
    if not m:
        raise SetupError(f'NOT depth {tok[5]!r} not understood')
    relative = int(m[3]) - 1 if m[3] else None
    return {'library': (lib, record), 'feature': feature,
            'depth': float(m[1]), 'relative_to': relative, 'fit': float(tok[6])}


# Build ---------------------------------------------------------------------------


def component_class(name: str) -> str:
    """The reported class of one spectrally active component."""
    for cls, names in CLASS_COMPONENTS.items():
        if name in names:
            return cls
    return 'other'


# The classes the slice reports, chosen for the soils of Brazilian territory:
# the kaolinite-gibbsite-goethite-hematite assemblage of Oxisols and Ultisols,
# the 2:1 clays and micas of less weathered soils, carbonates and sulfates for
# the semi-arid northeast, and the two covers that suppress every mineral
# detection when present. Every other component is reported as `other`, with
# the name of the reference that matched.
CLASS_COMPONENTS: dict[str, tuple[str, ...]] = {
    'kaolinite': ('kaolinite', 'kaolinite_wxl', 'kaolinite_pxl', 'halloysite',
                  'dickite', 'nacrite'),
    'gibbsite': ('gibbsite',),
    'goethite': ('goethite', 'goethite_smallgrain'),
    'hematite': ('hematite', 'hematite_smallgrain'),
    'smectite': ('montmorillonite', 'nontronite', 'beidellite', 'smectite',
                 'saponite', 'hectorite'),
    'illite_muscovite': ('muscovite', 'illite', 'paragonite'),
    'chlorite': ('chlorite', 'clinochlore', 'thuringite', 'cookeite'),
    'calcite': ('calcite',),
    'dolomite': ('dolomite',),
    'alunite': ('alunite', 'alunite_hydrothermal', 'alunite_hydroth_pedog',
                'natroalunite'),
    'jarosite': ('jarosite',),
    'vegetation': ('vegetation_photosyn', 'vegetation_nonphotosyn'),
    'water': ('water_liquid',),
}


def entry_class(components: list[tuple[str, float | None]]) -> str:
    """The class of the component with the largest listed abundance."""
    if not components:
        return 'other'
    ranked = sorted(
        enumerate(components),
        key=lambda ic: (-(ic[1][1] if ic[1][1] is not None else 0.0), ic[0]),
    )
    return component_class(ranked[0][1][0])


def build(args: argparse.Namespace) -> dict:
    root = Path(args.tetracorder)
    cmds = root / 'tetracorder.cmds' / args.cmds
    setup_path = cmds / args.setup
    # Expert systems before 5.27e define their `==[NAME]` variables inside the
    # setup file; later ones moved them to VARIABLES/.
    var_files = [cmds / 'VARIABLES' / 'cmd.lib.setup.variables-default',
                 cmds / 'cmd.lib.setup.nots-ratios-small']
    variables = read_variables(*(p for p in [setup_path, *var_files] if p.exists()))
    entries, no_group0 = parse_setup(setup_path, variables)
    if args.components_from:
        # Components by library record, from an expert system that lists them.
        donor_path = root / 'tetracorder.cmds' / args.components_from
        donor_vars = read_variables(*(p for p in [
            donor_path, donor_path.parent / 'VARIABLES' / 'cmd.lib.setup.variables-default',
            donor_path.parent / 'cmd.lib.setup.nots-ratios-small'] if p.exists()))
        donor_entries, _ = parse_setup(donor_path, donor_vars)
        by_record = {}
        for d in donor_entries:
            if d.use and d.library and d.components:
                by_record.setdefault(d.library, d.components)
        for e in entries:
            if not e.components and e.library in by_record:
                e.components = list(by_record[e.library])

    libs = {
        'sprlb06': root / 'sl1' / 'usgs' / 'rlib06' / args.rlib,
        'splib06': root / 'sl1' / 'usgs' / 'library06.conv' / args.slib,
    }
    _, waves, _ = read_specpr(libs['splib06'], args.wave_record)
    _, fwhm, _ = read_specpr(libs['splib06'], args.fwhm_record)
    nchan = len(waves)
    deleted_1b = parse_channel_list((cmds / 'DELETED.channels' / f'delete_{args.dataset}').read_text())
    # threshholdmin / threshholdmax of the dataset: cubecorder.r deletes, per
    # pixel and per channel, any value outside the range before the analysis.
    data_range = [None, None]
    dataset_file = cmds / 'DATASETS' / args.dataset
    if dataset_file.exists():
        for line in dataset_file.read_text().splitlines():
            m = re.match(r'^threshhold(min|max)=\s*(\S+)', line)
            if m:
                data_range[0 if m[1] == 'min' else 1] = float(m[2])
    deleted = np.zeros(nchan, dtype=bool)
    deleted[[c - 1 for c in deleted_1b if c <= nchan]] = True

    t_lo, t_hi = args.temperature_c[0] + 273.15, args.temperature_c[1] + 273.15
    p_lo, p_hi = args.pressure_bar

    used = [e for e in entries if e.use]
    spectra: dict[tuple[str, int], np.ndarray] = {}
    titles: dict[tuple[str, int], str] = {}
    prepared: list[dict | None] = []
    notes: list[str] = []

    for idx, e in enumerate(used):
        prepared.append(None)
        if e.algorithm != 'tricorder-primary' or e.library is None:
            continue
        cons = parse_constraints(e.constraints)
        tk, pb = cons['temperature_k'], cons['pressure_bar']
        if tk and ((t_hi < tk[0] and tk[0] > -1e-5) or (t_lo > tk[3] and tk[3] > -1e-5)):
            continue
        if pb and ((p_hi < pb[0] and pb[0] > -1e-5) or (p_lo > pb[3] and pb[3] > -1e-5)):
            continue
        key = e.library
        if key not in spectra:
            title, spec, wrec = read_specpr(libs[key[0]], key[1])
            if len(spec) != nchan:
                raise SetupError(f'{key} has {len(spec)} channels, expected {nchan}')
            spectra[key], titles[key] = spec, title
        spec = spectra[key].copy()
        spec[deleted] = np.nan
        spec[spec <= DELETED / 10] = np.nan

        features: list[dict] = []
        disabled_material = False
        for tok in merge_feature_lines(e.features):
            f = parse_feature(tok)
            imp = f['importance']
            w = f['waves']
            pairs = [(w[j], w[j + 1]) for j in range(0, len(w), 2)]
            chans = [wtochbin(waves, a, b) for a, b in pairs]
            enabled = all(c is not None for c in chans)
            rec: dict = {'importance': imp, 'curved': f['curved'], 'waves': w,
                         'enabled': False}
            if enabled:
                if f['curved']:
                    cl, cr = chans[1], chans[2]  # getifeat.r: central 4 channels
                else:
                    cl, cr = chans[0], chans[1]
                res = bdmset(waves, np.nan_to_num(spec, nan=DELETED), deleted | np.isnan(spec), cl, cr)
                if res is not None:
                    removed, minch, maxch, ftype = res
                    il, ir = cl[1] + 1, cr[0] - 1
                    band = removed[il:ir + 1]
                    area = float(np.nansum(np.abs(1.0 - band)))
                    if area > 0.0 and np.isfinite(area):
                        # bandmp.r skips a continuum channel where the reference
                        # is deleted, so the observed average uses the same set.
                        usable = np.isfinite(removed)
                        rec.update({
                            'enabled': True,
                            'left': [i for i in range(cl[0], cl[1] + 1) if usable[i]],
                            'right': [i for i in range(cr[0], cr[1] + 1) if usable[i]],
                            'band': [il, ir],
                            'minch': minch if ftype == 1 else maxch,
                            'type': ftype,
                            'reference': [None if not np.isfinite(v) else round(float(v), 7) for v in band],
                            'area': area * f['weight_factor'] if imp != 'W' else 0.0,
                        })
                        if f['curved']:
                            # The outer intervals sit outside the reference's
                            # continuum-removed range, where bandmpcv.r reads the
                            # reference array as 0 rather than deleted.
                            (o1, o2), (o3, o4) = chans[0], chans[3]
                            rec['outer_left'] = [i for i in range(o1, o2 + 1) if not deleted[i]]
                            rec['outer_right'] = [i for i in range(o3, o4 + 1) if not deleted[i]]
                            rec['curve_waves'] = [(a + b) / 2.0 for a, b in pairs]
            opts = f['options']
            rec['ct'] = opts.get('ct')
            rec['lct'] = opts.get('lct')
            rec['rct'] = opts.get('rct')
            for k_src, k_dst in (('lct/rct>', 'lct_rct'), ('rct/lct>', 'rct_lct'),
                                 ('rcbblc>', 'rcbblc_gt'), ('rcbblc<', 'rcbblc_lt'),
                                 ('lcbbrc>', 'lcbbrc_gt'), ('lcbbrc<', 'lcbbrc_lt'),
                                 ('r*bd>', 'rbd')):
                rec[k_dst] = opts.get(k_src)
            if not rec['enabled'] and imp in ('M', 'W'):
                # A disabled must-have disables the material (getifeat.r); a
                # disabled weak feature has zero depth on every pixel, which
                # tp1mat.r treats as a missing required feature.
                disabled_material = True
            features.append(rec)

        areas = [f['area'] for f in features if f['enabled'] and f['importance'] != 'W']
        total = sum(areas)
        if disabled_material or not areas or total <= 0.0:
            continue
        for f in features:
            f['weight'] = (f['area'] / total) if f['enabled'] else 0.0

        prepared[idx] = {
            'raw_index': idx,
            'id': e.ident,
            'kind': e.kind,
            'group': e.number,
            'title': e.title,
            'library': list(key),
            'library_title': titles[key],
            'components': [[n, a] for n, a in e.components],
            'class': entry_class(e.components),
            'features': features,
            'thresholds': cons['thresholds'],
            'fratio': cons['fratio'],
            'nots_raw': [parse_not(t) for t in e.nots],
            'line': e.line,
        }

    # A NOT names a library record; the material it reads is the last enabled
    # material before this one that uses that record (getnotfeat.r walks
    # 1..imat-1 and keeps overwriting on each match).
    def resolve_not(idx: int, spec: dict) -> int | None:
        found = None
        for j in range(idx):
            p = prepared[j]
            if p is not None and tuple(p['library']) == tuple(spec['library']):
                found = j
        return found

    competitors = {i for i, p in enumerate(prepared)
                   if p is not None and p['kind'] == 'group'
                   and (p['group'] in REPORTED_GROUPS or p['group'] == 0)}
    needed = set(competitors)
    frontier = list(competitors)
    while frontier:
        i = frontier.pop()
        p = prepared[i]
        assert p is not None
        for spec in p['nots_raw']:
            j = resolve_not(i, spec)
            if j is None:
                continue
            if j not in needed:
                needed.add(j)
                frontier.append(j)

    order = sorted(needed)
    position = {raw: pos for pos, raw in enumerate(order)}
    out_entries = []
    dropped_nots = 0
    for raw in order:
        p = dict(prepared[raw])  # type: ignore[arg-type]
        nots = []
        for spec in p.pop('nots_raw'):
            j = resolve_not(raw, spec)
            if j is None:
                dropped_nots += 1
                continue
            target = prepared[j]
            assert target is not None
            if spec['feature'] >= len(target['features']):
                raise SetupError(f"{p['id']}: NOT feature {spec['feature'] + 1} beyond {target['id']}")
            nots.append({'entry': position[j], 'feature': spec['feature'],
                         'depth': spec['depth'], 'relative_to': spec['relative_to'],
                         'fit': spec['fit']})
        p['nots'] = nots
        p['competes_in'] = (
            [p['group']] if p['kind'] == 'group' and p['group'] in REPORTED_GROUPS
            else [g for g in REPORTED_GROUPS if g not in no_group0]
            if p['kind'] == 'group' and p['group'] == 0 else []
        )
        out_entries.append(p)
    if dropped_nots:
        notes.append(f'{dropped_nots} NOT features refer to a disabled material and never fire')

    def sha256(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    records = sorted({tuple(p['library']) for p in out_entries})
    return {
        'rules': {
            'source': {
                'expert_system': f'{args.cmds}/{args.setup}',
                'components_from': args.components_from,
                'setup_sha256': sha256(setup_path),
                'libraries': {k: {'file': v.name, 'sha256': sha256(v)} for k, v in libs.items()},
                'dataset': args.dataset,
                'temperature_c': list(args.temperature_c),
                'pressure_bar': list(args.pressure_bar),
                'repository': 'https://github.com/PSI-edu/spectroscopy-tetracorder',
            },
            'wavelengths_um': [round(float(v), 7) for v in waves],
            'fwhm_um': [round(float(v), 7) for v in fwhm],
            'deleted_channels': sorted(int(i) for i in np.where(deleted)[0]),
            'data_range': data_range,
            'reported_groups': list(REPORTED_GROUPS),
            'classes': list(CLASS_COMPONENTS) + ['other'],
            'entries': out_entries,
            'notes': notes,
        },
        'spectra': {
            'records': [f'{lib}:{rec}' for lib, rec in records],
            'values': np.stack([spectra[r] for r in records]).astype(np.float32),
        },
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('tetracorder', help='path to a spectroscopy-tetracorder checkout')
    ap.add_argument('--cmds', default='tetracorder5.27e.cmds')
    ap.add_argument('--setup', default='cmd.lib.setup.t5.27e1')
    ap.add_argument('--components-from', default='tetracorder6.00a.cmds/cmd.lib.setup.t6.00a6',
                    help="setup file whose `list materials` give each record's class; '' for none")
    ap.add_argument('--rlib', default='r06emitc')
    ap.add_argument('--slib', default='s06emitc')
    ap.add_argument('--wave-record', type=int, default=6)
    ap.add_argument('--fwhm-record', type=int, default=12)
    ap.add_argument('--dataset', default='emit_c')
    ap.add_argument('--temperature-c', type=float, nargs=2, default=(-20.0, 80.0))
    ap.add_argument('--pressure-bar', type=float, nargs=2, default=(0.5, 1.5))
    ap.add_argument('--out', type=Path, default=OUT_DIR)
    ap.add_argument('--name', default='tetracorder_emit')
    args = ap.parse_args(argv)

    built = build(args)
    args.out.mkdir(parents=True, exist_ok=True)
    rules_path = args.out / f'{args.name}.json'
    rules_path.write_text(json.dumps(built['rules'], separators=(',', ':')) + '\n')
    np.savez_compressed(
        args.out / f'{args.name}_spectra.npz',
        records=np.array(built['spectra']['records']),
        values=built['spectra']['values'],
    )
    entries = built['rules']['entries']
    for g in REPORTED_GROUPS:
        n = sum(1 for e in entries if g in e['competes_in'])
        print(f'group {g}: {n} competing entries')
    print(f'{len(entries)} entries written to {rules_path}')
    for note in built['rules']['notes']:
        print(f'note: {note}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
