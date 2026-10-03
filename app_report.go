package main

import (
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// The PDF report: the compositor's PDF report node sends its document here
// (frontend/src/lib/pdfReport.ts), the sidecar lays it out, and the user
// chooses where it goes. A direct call rather than a job: a report is not a
// product run over an area, and it should not wait behind one in the queue.

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// reportFilename is the name the save dialog proposes: the title, reduced to
// characters every filesystem accepts.
func reportFilename(title string) string {
	name := strings.Trim(unsafeFilename.ReplaceAllString(strings.ToLower(title), "_"), "_.")
	if name == "" {
		name = "terra_report"
	}
	if len(name) > 80 {
		name = strings.TrimRight(name[:80], "_.")
	}
	return name + ".pdf"
}

// ExportPDFReport lays out a report document and saves the PDF where the user
// chooses. The layout runs first, so a document the sidecar refuses fails
// before a dialog is shown for it. Returns the path written, or an empty
// string when the user cancels.
func (a *App) ExportPDFReport(document string, title string) (string, error) {
	runner := a.currentRunner()
	if runner == nil {
		return "", errors.New("runner not initialized")
	}
	pdf, err := runner.RenderPDFReport(a.ctx, json.RawMessage(document))
	if err != nil {
		return "", err
	}
	dest, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export PDF report",
		DefaultFilename: reportFilename(title),
		Filters: []wruntime.FileFilter{
			{DisplayName: "PDF document", Pattern: "*.pdf"},
		},
	})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(dest), ".pdf") {
		dest += ".pdf"
	}
	if err := os.WriteFile(dest, pdf, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}
