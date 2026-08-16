package main

import "strings"

// AppVersion is the product SemVer without a "v" prefix.
// Override at link time: go build -ldflags "-X main.AppVersion=0.3.0"
var AppVersion = "0.3.0"

// GetAppVersion returns the embedded product version for the UI (What's New, About).
func (a *App) GetAppVersion() string {
	v := strings.TrimSpace(AppVersion)
	if v == "" {
		return "0.0.0-dev"
	}
	return strings.TrimPrefix(v, "v")
}
