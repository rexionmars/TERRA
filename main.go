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
