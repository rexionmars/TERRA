/*
Command terra classifies land cover over an area of interest from Sentinel-2
time series, and reports where that classification is wrong.

This package is the shell, not the work. It opens the window, embeds the built
frontend, and exposes the methods the interface calls; the analysis happens in
a Python sidecar spawned per run, and the results live in a local SQLite file.
Both are reached through package backend.

The shell is what makes the application local: there is no server to talk to,
so every method here runs on the user's machine against the user's files, and
the only network traffic is the sidecar reading imagery from the Planetary
Computer catalogue and a geocoding lookup.
*/
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

/*
The dependency manifest, compiled in.

A packaged application has no requirements.txt: the packager copies sidecar/,
areas/ and model/ and nothing else. Read from disk this would work in a
checkout and be absent in every release -- which is the same shape as the bug
that shipped a POWER cache needing a package nothing declared.

Embedded, the manifest is exactly the one this binary was built against, and
therefore the one whose pins match the model artifacts it ships beside.
*/
//go:embed requirements.txt
var requirementsTxt string

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "TERRA",
		Width:  420,
		Height: 280,
		// Splash-sized mins; RevealMainWindow raises these after boot.
		MinWidth:         360,
		MinHeight:        220,
		AlwaysOnTop:      true,
		BackgroundColour: &options.RGBA{R: 8, G: 7, B: 6, A: 1},
		Frameless:        true,
		AssetServer: &assetserver.Options{
			Assets: assets,
			/*
				Large binaries are fetched over HTTP, not returned through a
				bound method.

				Everything a bound method returns is marshalled to JSON and
				handed to the webview as a string, so a mesh has to be base64 to
				survive the trip -- and a grown stand is megabytes. On WKWebView
				that string is where "Maximum call stack size exceeded" came
				from: it is thrown inside the bridge, before any of this
				application's JavaScript runs, which is why it survived being
				checked everywhere outside the webview. Shrinking the payload
				moved the threshold and did not remove it.

				MIDDLEWARE, NOT `Handler`. `Handler` is only reached when Assets
				reports os.ErrNotExist, and this front end is a single-page app:
				its dev server and its embedded build both answer an unknown
				path with index.html rather than a miss. So a mesh request came
				back as the application's own HTML, and the loader failed with
				"JSON Parse error: Unrecognized token '<'" -- the '<' of
				<!doctype html>. Middleware runs ahead of Assets, so the route
				is decided here and everything else falls through untouched.
			*/
			Middleware: app.meshMiddleware,
		},
		OnStartup:  app.startup,
		OnDomReady: app.domReady,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "TERRA",
				Message: "Classificacao de cobertura de solo - Sentinel-2 / MapBiomas",
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
