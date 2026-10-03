"""
The pdf_report action: a report document in, a PDF in the work directory out.

The PDF is written inside the work directory and its path returned. Where it
goes after that is the Go side's decision -- it asked the user -- so this
process never writes outside the directory it was given.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from terra import protocol
from terra.report import document

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / 'template'
FONTS = HERE / 'fonts'


def pdf_report(req: protocol.Request, work_dir: Path) -> None:
    try:
        import typst
    except ImportError as e:
        raise protocol.MissingDependency(
            'The PDF report needs the typst package, which this Python '
            'environment does not have. Build environment, under Settings > '
            'System, installs it with the rest of requirements.txt.') from e

    try:
        doc = document.validate(req.get('document'))
    except document.DocumentError as e:
        protocol.fail(f'the report document is malformed: {e}')

    build = work_dir / 'report'
    if build.exists():
        shutil.rmtree(build)
    shutil.copytree(TEMPLATE, build)
    try:
        n_figures = document.write_figures(doc, build)
    except document.DocumentError as e:
        protocol.fail(f'the report document is malformed: {e}')
    (build / 'document.json').write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')

    protocol.emit_progress(50, 'laying out the report')
    out = work_dir / 'report.pdf'
    try:
        # System fonts ignored: the PDF is set in the bundled fonts on every
        # machine, or the same document would lay out differently on two.
        typst.compile(
            str(build / 'report.typ'),
            output=str(out),
            root=str(build),
            font_paths=[str(FONTS)],
            ignore_system_fonts=True,
        )
    except Exception as e:  # typst raises its own error type, with the template line
        protocol.fail(f'the report could not be laid out: {e}')

    sys.stdout.write(json.dumps({'report': {
        'pdf_path': str(out),
        'bytes': out.stat().st_size,
        'figures': n_figures,
    }}))
    sys.stdout.flush()
