package analysis

/*
The PDF report (sidecar/terra/report): a document the compositor assembled,
laid out by Typst.

Go does not read the document. It is built in TypeScript (lib/pdfReport.ts)
from what the compositor evaluated -- the class areas after the graph's
filters, the per-field rows, the figures as drawn -- and checked by the
sidecar, which is the side that lays it out. Go carries it across as JSON and
writes the PDF where the user chose.
*/

// reportSidecarResult is what the pdf_report action writes, under "report".
type reportSidecarResult struct {
	// The PDF, inside the work directory the request named.
	PDFPath string `json:"pdf_path"`
	Bytes   int64  `json:"bytes"`
	Figures int    `json:"figures"`
}
