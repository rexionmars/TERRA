package analysis

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RenderPDFReport lays out a report document and returns the PDF's bytes.
// The work directory goes when the call returns; the caller writes the bytes
// where the user chose.
func (r *Runner) RenderPDFReport(ctx context.Context, document json.RawMessage) ([]byte, error) {
	if _, err := os.Stat(r.sidecar); err != nil {
		return nil, fmt.Errorf("sidecar not found at %s", r.sidecar)
	}
	if err := checkReportDocument(document); err != nil {
		return nil, err
	}
	workDir, err := os.MkdirTemp("", "terra-report-")
	if err != nil {
		return nil, fmt.Errorf("failed to create work dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	reqBytes, err := json.Marshal(map[string]any{
		"action":   "pdf_report",
		"document": document,
		"work_dir": workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode request: %w", err)
	}
	raw, err := r.runSidecarJSON(ctx, reqBytes)
	if err != nil {
		return nil, err
	}
	res, err := parseReportPayload([]byte(raw))
	if err != nil {
		return nil, err
	}
	return readReportPDF(res, workDir)
}

// checkReportDocument refuses what is not a JSON object before a process is
// started for it. The document's shape is the sidecar's to check
// (terra/report/document.py); this only stops a call that sends nothing.
func checkReportDocument(document json.RawMessage) error {
	trimmed := bytes.TrimSpace(document)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("no report document provided")
	}
	if !json.Valid(trimmed) {
		return errors.New("the report document is not valid JSON")
	}
	return nil
}

func parseReportPayload(raw []byte) (*reportSidecarResult, error) {
	var wrapped struct {
		Report *reportSidecarResult `json:"report"`
	}
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to parse PDF report result: %w", err)
	}
	if wrapped.Report == nil || wrapped.Report.PDFPath == "" {
		return nil, errors.New("sidecar returned no PDF report")
	}
	return wrapped.Report, nil
}

// readReportPDF reads the PDF the sidecar wrote, and only from inside the
// work directory: the path comes from another process, and this function is
// what hands its bytes to a file the user named.
func readReportPDF(res *reportSidecarResult, workDir string) ([]byte, error) {
	root, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		return nil, err
	}
	path, err := filepath.EvalSymlinks(res.PDFPath)
	if err != nil {
		return nil, fmt.Errorf("the PDF report was not written: %w", err)
	}
	if rel, err := filepath.Rel(root, path); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("the PDF report was written outside its work directory: %s", res.PDFPath)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		return nil, errors.New("the PDF report is not a PDF")
	}
	return data, nil
}
