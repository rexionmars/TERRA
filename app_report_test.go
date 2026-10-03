package main

import (
	"strings"
	"testing"
)

func TestReportFilename(t *testing.T) {
	cases := map[string]string{
		"Land cover of field 7":           "land_cover_of_field_7.pdf",
		"Registers / area 3 (2026-09-26)": "registers_area_3_2026-09-26.pdf",
		"   ":                             "terra_report.pdf",
		"Situação socioambiental":         "situa_o_socioambiental.pdf",
		"../../etc/passwd":                "etc_passwd.pdf",
	}
	for title, want := range cases {
		if got := reportFilename(title); got != want {
			t.Errorf("reportFilename(%q) = %q, want %q", title, got, want)
		}
	}
	long := reportFilename(strings.Repeat("a", 200))
	if len(long) != 84 {
		t.Errorf("a long title gave %d characters", len(long))
	}
}
