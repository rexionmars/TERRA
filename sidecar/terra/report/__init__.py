"""
The PDF report: a document the compositor assembled, laid out and written.

The frontend (frontend/src/lib/pdfReport.ts) decides what the report says --
which products, which fields, which figures, every number already formatted as
the compositor shows it. This slice validates that document, writes its
figures to files, and compiles template/report.typ with Typst into a PDF. It
computes no figure of its own, so a number in the PDF cannot disagree with the
same number on the screen.

Typst rather than LaTeX because it runs inside this interpreter: the `typst`
wheel carries the compiler, needs no network and no TeX installation, and
compiles a report in well under a second. The fonts are IBM Plex (SIL Open Font
License, fonts/LICENSE.txt), the family terra.sty sets the documentation in,
bundled so the PDF does not depend on what the machine has installed.
"""
