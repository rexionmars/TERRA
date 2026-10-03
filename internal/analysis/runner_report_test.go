package analysis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckReportDocumentRefusesWhatIsNotAnObject(t *testing.T) {
	for _, doc := range []string{"", "  ", "null", "[]", `"title"`, "{not json"} {
		if err := checkReportDocument(json.RawMessage(doc)); err == nil {
			t.Errorf("document %q accepted", doc)
		}
	}
	if err := checkReportDocument(json.RawMessage(` {"schema": 1} `)); err != nil {
		t.Errorf("an object was refused: %v", err)
	}
}

func TestParseReportPayload(t *testing.T) {
	res, err := parseReportPayload([]byte(`{"report": {"pdf_path": "/w/report.pdf", "bytes": 1234, "figures": 2}}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.PDFPath != "/w/report.pdf" || res.Bytes != 1234 || res.Figures != 2 {
		t.Errorf("parsed %+v", res)
	}
	if _, err := parseReportPayload([]byte(`{"report": {}}`)); err == nil {
		t.Error("a payload without a path was accepted")
	}
	if _, err := parseReportPayload([]byte(`{}`)); err == nil {
		t.Error("an empty payload was accepted")
	}
}

func TestReadReportPDFStaysInsideTheWorkDirectory(t *testing.T) {
	work := t.TempDir()
	inside := filepath.Join(work, "report.pdf")
	if err := os.WriteFile(inside, []byte("%PDF-1.7\n..."), 0o600); err != nil {
		t.Fatal(err)
	}
	data, err := readReportPDF(&reportSidecarResult{PDFPath: inside}, work)
	if err != nil || !strings.HasPrefix(string(data), "%PDF-") {
		t.Fatalf("inside: %v", err)
	}

	outside := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(outside, []byte("%PDF-1.7\n..."), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readReportPDF(&reportSidecarResult{PDFPath: outside}, work); err == nil {
		t.Error("a PDF outside the work directory was read")
	}

	notPDF := filepath.Join(work, "other.pdf")
	if err := os.WriteFile(notPDF, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readReportPDF(&reportSidecarResult{PDFPath: notPDF}, work); err == nil {
		t.Error("a file that is not a PDF was accepted")
	}
}
