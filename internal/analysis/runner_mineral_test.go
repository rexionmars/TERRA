package analysis

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The sidecar names each group's class map by path; the map reaches the
// webview only as a data URI, so a payload whose PNG cannot be read keeps its
// tables and loses nothing but the picture.
func TestParseMineralPayloadLoadsEachClassMap(t *testing.T) {
	dir := t.TempDir()
	pngPath := filepath.Join(dir, "mineral_group2.png")
	f, err := os.Create(pngPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()

	raw := `{"mineral": {"expert_system": "x", "groups": [
		{"group": 1, "class_png": "` + filepath.Join(dir, "missing.png") + `", "classes": null},
		{"group": 2, "class_png": "` + pngPath + `", "entries": [{"id": "kaolwxl", "cells": 3}]}
	]}}`
	res, err := parseMineralPayload([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if res.Groups[0].ClassURI != "" {
		t.Error("a missing PNG produced a data URI")
	}
	if res.Groups[0].Classes == nil || res.Scenes == nil || res.Notes == nil {
		t.Error("absent lists were not normalised to empty ones")
	}
	if !strings.HasPrefix(res.Groups[1].ClassURI, "data:image/png;base64,") {
		t.Errorf("class URI = %.40q", res.Groups[1].ClassURI)
	}
	if res.Groups[1].Entries[0].ID != "kaolwxl" {
		t.Error("the reference table did not bind")
	}
}

func TestParseMineralPayloadRefusesAnEmptyResult(t *testing.T) {
	if _, err := parseMineralPayload([]byte(`{"water": {}}`)); err == nil {
		t.Fatal("a payload without a mineral block was accepted")
	}
}
