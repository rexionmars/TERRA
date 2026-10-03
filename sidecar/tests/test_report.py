"""The PDF report: the document's shape, its figures, and one compiled PDF."""

from __future__ import annotations

import base64
import copy
import json
import struct
import zlib
from pathlib import Path

import pytest

from terra.report import actions, document


def png(width: int = 4, height: int = 3) -> bytes:
    """A small RGB PNG, written by hand so the test needs no imaging library."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    raw = b''.join(b'\x00' + bytes([40, 120, 60]) * width for _ in range(height))
    return (document.PNG_SIGNATURE
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw))
            + chunk(b'IEND', b''))


def uri(data: bytes) -> str:
    return document.PNG_PREFIX + base64.b64encode(data).decode()


# Every section the template draws, once, so a template that fails on any of
# them fails here.
DOC = {
    'schema': 1,
    'meta': {
        'title': 'Land cover of field 7',
        'subtitle': 'Sentinel-2, 2025-09-27 to 2026-09-19',
        'number': 'TERRA-RA-2026-001',
        'revision': 'A',
        'issued': '2026-09-26',
        'status': 'draft',
        'owner': 'UTFPR',
        'recipient': '',
        'author': 'J. Leonardi',
        'approver': '',
        'app_version': '0.6.0',
        'generated_at': '2026-09-26T23:40:00Z',
    },
    'question': 'How much of the field is under an annual crop this season?',
    'scope': 'Yield and field boundaries are not assessed.',
    'summary': ['Soybean covers 99.98% of the classified area (152.7 ha).'],
    'provenance': [{'label': 'Area', 'value': 'field 7, 152.7 ha'}],
    'method': [{
        'product': 'Classification',
        'subtitle': 'Land cover with Random Forest',
        'source': 'sidecar/terra/landcover',
        'sections': [{'title': 'Model', 'lines': ['Random forest, 300 trees'], 'note': 'A note.'}],
    }],
    'figures': [{
        'title': 'Predicted class.',
        'caption': 'One colour per class.',
        'uri': uri(png()),
        'aspect': 4 / 3,
        'legend': [{'label': 'Soybean', 'color': '#f5b3c8'}],
        'pixelated': True,
        'source': 'Sentinel-2 L2A, 2025-09-27 to 2026-09-19 (run e699f536)',
        'map': {
            'graticule': {
                'lon': [{'at': 0.29, 'label': '55°43′30″W'}, {'at': 0.68, 'label': '55°43′00″W'}],
                'lat': [{'at': 0.4, 'label': '12°08′30″S'}],
            },
            'ground_width_m': 2296.0,
            'scale_bar': {'fraction': 0.22, 'ticks': ['0', '250', '500 m']},
            'crs': 'Geographic coordinates, datum WGS 84 (EPSG:4326)',
        },
    }],
    'series': [{
        'title': 'NDVI through the season.',
        'caption': 'Clear observations.',
        'x_label': 'Date',
        'y_label': 'NDVI',
        'x_range': [0, 100],
        'y_range': [0, 1],
        'x_ticks': [{'at': 0, 'label': 'Oct'}, {'at': 100, 'label': 'Jan'}],
        'y_ticks': [{'at': 0, 'label': '0.0'}, {'at': 1, 'label': '1.0'}],
        'points': [{'x': 0, 'y': 0.2}, {'x': 50, 'y': 0.9}, {'x': 100, 'y': 0.4}],
        'marks': [{'x': 50, 'label': 'peak'}],
    }],
    'tables': [{
        'title': 'Area by class.',
        'caption': '',
        'columns': [{'label': 'Class'}, {'label': 'Area (ha)', 'align': 'right'}],
        'rows': [['Soybean', '152.7']],
    }],
    'limitations': [{'label': 'Confidence', 'text': 'A confidence of 0.67 is not 67% accuracy.'}],
    'runs': [{'id': 'e699f536', 'kind': 'classification', 'period': '2025-09-27 to 2026-09-19', 'created': '2026-09-26'}],
    'references': ['Otsu, N. (1979). A threshold selection method.'],
}


def test_the_full_document_is_accepted():
    assert document.validate(copy.deepcopy(DOC))['meta']['title']


@pytest.mark.parametrize('mutate,path', [
    (lambda d: d.update(schema=2), 'document.schema'),
    (lambda d: d['meta'].update(title='  '), 'meta.title'),
    (lambda d: d['meta'].update(status='final'), 'meta.status'),
    (lambda d: d['figures'][0].update(uri='data:image/jpeg;base64,AAAA'), 'figures[0].uri'),
    (lambda d: d['figures'][0]['map']['scale_bar'].update(fraction=1.5), 'figures[0].map.scale_bar.fraction'),
    (lambda d: d['figures'][0]['map']['scale_bar'].update(ticks=['0', '500 m']), 'figures[0].map.scale_bar.ticks'),
    (lambda d: d['figures'][0]['map']['graticule']['lon'][0].update(at=1.2), 'figures[0].map.graticule.lon[0].at'),
    (lambda d: d['figures'][0].update(aspect=0), 'figures[0].aspect'),
    (lambda d: d['series'][0].update(x_range=[5, 5]), 'series[0].x_range'),
    (lambda d: d['tables'][0]['rows'].append(['only one cell']), 'tables[0].rows[1]'),
    (lambda d: d['tables'][0]['rows'].append(['Soybean', 152.7]), 'tables[0].rows[1][1]'),
    (lambda d: d['summary'].append(3), 'summary[1]'),
])
def test_a_bad_field_is_named_by_its_path(mutate, path):
    doc = copy.deepcopy(DOC)
    mutate(doc)
    with pytest.raises(document.DocumentError, match=path.replace('[', r'\[').replace(']', r'\]')):
        document.validate(doc)


def test_figures_are_written_as_files_and_leave_the_document(tmp_path):
    doc = copy.deepcopy(DOC)
    assert document.write_figures(doc, tmp_path) == 1
    f = doc['figures'][0]
    assert 'uri' not in f and f['file'] == 'figure-1.png'
    assert (tmp_path / 'figure-1.png').read_bytes() == png()


def test_a_data_uri_that_is_not_a_png_is_refused(tmp_path):
    doc = copy.deepcopy(DOC)
    doc['figures'][0]['uri'] = document.PNG_PREFIX + base64.b64encode(b'GIF89a...').decode()
    with pytest.raises(document.DocumentError, match='does not hold a PNG'):
        document.write_figures(doc, tmp_path)


def test_the_report_compiles_to_a_pdf(tmp_path, capsys):
    pytest.importorskip('typst')
    actions.pdf_report({'document': copy.deepcopy(DOC)}, tmp_path)
    out = json.loads(capsys.readouterr().out)['report']
    pdf = tmp_path / 'report.pdf'
    assert out['pdf_path'] == str(pdf)
    assert out['figures'] == 1
    assert out['bytes'] == pdf.stat().st_size
    assert pdf.read_bytes().startswith(b'%PDF-')


def test_a_released_report_without_optional_sections_compiles(tmp_path, capsys):
    pytest.importorskip('typst')
    doc = {'schema': 1, 'meta': {'title': 'Registers under area 3', 'status': 'released'}}
    actions.pdf_report({'document': doc}, tmp_path)
    assert json.loads(capsys.readouterr().out)['report']['figures'] == 0
    assert (tmp_path / 'report.pdf').read_bytes().startswith(b'%PDF-')


# Written by frontend/src/lib/pdfReport.test.ts from the builder the PDF report
# node uses. The vitest test fails when the builder stops producing it; these
# fail when this side stops accepting it.
FRONTEND_DOCUMENT = Path(__file__).parent / 'data' / 'pdf_report_document.json'


def test_the_frontend_document_is_accepted():
    doc = json.loads(FRONTEND_DOCUMENT.read_text(encoding='utf-8'))
    assert document.validate(doc)['schema'] == document.SCHEMA


def test_the_frontend_document_compiles(tmp_path, capsys):
    pytest.importorskip('typst')
    doc = json.loads(FRONTEND_DOCUMENT.read_text(encoding='utf-8'))
    actions.pdf_report({'document': doc}, tmp_path)
    assert json.loads(capsys.readouterr().out)['report']['figures'] == len(doc['figures'])
