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
	/*
		Before wails.Run, because the menu is built during it. See
		editmenu_darwin.go -- on every platform but macOS this does nothing.
	*/
	trimEditMenu()

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
		/*
			NOT FRAMELESS, and the reason is measured rather than aesthetic.

			While this window was frameless it degraded compositing for every
			other window sharing its space. Safari running the WebGL aquarium
			benchmark measured 60fps constantly on any other space and 27-41fps
			on the one this window occupied -- a different application, slowed
			by this one being present.

			The cause is in Wails' own window construction. WailsContext.m only
			adds NSWindowStyleMaskTitled when the window is NOT frameless, so a
			frameless window here is borderless, and macOS composites a
			borderless window off the path it uses for titled ones.

			None of it was visible from inside the page, which is what made it
			expensive to find: the scene submitted 9 draw calls and 72 triangles
			and cost 0.0ms a frame, the pointer handlers cost 0.0ms, and the web
			content and GPU processes sat at 2.8% and 0.1% while a
			requestAnimationFrame that drew nothing was delivered at 11Hz.
			Everything was waiting, and nothing in the application was the
			reason.

			The look is kept by TitleBar below. TitleBarHiddenInset gives a
			titled window with a transparent, title-less bar and full-size
			content -- the traffic lights inset over the application's own
			header, which is what the frameless window was being used for. The
			custom drag regions are unaffected: --wails-draggable is handled in
			the JavaScript runtime and does not depend on the style mask.
		*/
		Frameless: false,
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
			/*
				Hidden, not hidden-inset. The two differ by one field --
				UseToolbar -- and the toolbar is what pushes the traffic lights
				in from the corner, right and down, past the 4.5rem the header
				reserves for them. That reservation is the standard position,
				so the standard position is what to ask for rather than a new
				number guessed to match an offset macOS controls.

				Both keep NSWindowStyleMaskTitled, which is the part that
				matters for compositing -- see Frameless above.
			*/
			TitleBar:   mac.TitleBarHidden(),
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
