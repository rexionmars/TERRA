import L from "leaflet"
import "leaflet-draw"

// Compatibility patch for leaflet-draw 1.0.4 on Leaflet 1.9.x / Wails WKWebView.
//
// Bugs this addresses:
// 1) After the 3rd vertex, dash guides stop redrawing (mousemove still fires but
//    _drawGuide is never reached after _clearGuides). Replaced with a rubber-band
//    L.Polyline updated before tooltip code.
// 2) Finish/Undo toolbar clicks still deliver mouseup/pointer events to the
//    map (leaflet-draw only stops mousedown/click), which adds a spurious
//    vertex under the button.
// 3) Legacy retina drag-threshold / PointerEvent touch synthesis issues.

window.L_NO_TOUCH = true

const browser = (L as unknown as { Browser?: { touch?: boolean } }).Browser
if (browser) {
  browser.touch = false
}

function eventFromToolbar(e: { originalEvent?: Event; target?: EventTarget | null }): boolean {
  const oe = (e.originalEvent ?? e) as Event & { target?: EventTarget | null }
  const t = (oe.target ?? e.target) as Element | null
  if (!t || typeof (t as Element).closest !== "function") return false
  return !!(t as Element).closest(
    ".leaflet-draw-actions, .leaflet-draw-toolbar, .leaflet-control-zoom, .leaflet-control-layers"
  )
}

type DrawHandler = {
  _markers?: L.Marker[]
  _finishIgnoreUntil?: number
  _shapeIsValid?: () => boolean
  _fireCreatedEvent?: () => void
  disable?: () => void
  enable?: () => void
  options?: {
    allowIntersection?: boolean
    repeatMode?: boolean
    maxPoints?: number
    guidelineDistance?: number
    maxGuideLineLength?: number
  }
  _poly?: {
    _defaultShape?: () => L.LatLng[]
    getLatLngs: () => L.LatLng[]
    newLatLngIntersects: (latlng: L.LatLng) => boolean
  }
  _showErrorTooltip?: () => void
  addVertex?: (latlng: L.LatLng) => void
  _enableNewMarkers?: () => void
  _mouseDownOrigin?: L.Point | null
  _finishShape?: () => void
  completeShape?: () => void
  type?: string
  _map?: L.Map
  _guidesContainer?: HTMLElement
  _overlayPane?: HTMLElement
  _currentLatLng?: L.LatLng
}

type RubberHandler = DrawHandler & {
  _rubberBand?: L.Polyline
  _clearGuides?: () => void
  _updateTooltip?: (latlng?: L.LatLng) => void
  _mouseMarker?: L.Marker
}

type DrawPolylineCtor = {
  prototype: DrawHandler & {
    _calculateFinishDistance?: (potentialLatLng: L.LatLng) => number
    _onTouch?: (e: L.LeafletEvent) => void
    _onMouseDown?: (e: L.LeafletEvent) => void
    _onMouseUp?: (e: L.LeafletEvent) => void
    _onMouseMove?: (e: L.LeafletEvent) => void
    _endPoint?: (clientX: number, clientY: number, e: L.LeafletEvent) => void
    _finishShape?: () => void
    completeShape?: () => void
    addVertex?: (latlng: L.LatLng) => void
    _drawGuide?: (...args: never[]) => void
    _updateGuide?: (newPos?: L.Point) => void
    _clearGuides?: () => void
  }
}

type DrawPolygonCtor = {
  prototype: DrawHandler & {
    _updateFinishHandler?: () => void
  }
}

const LAny = L as unknown as {
  Draw?: { Polyline?: DrawPolylineCtor; Polygon?: DrawPolygonCtor }
  Toolbar?: {
    prototype: {
      _createButton?: (options: {
        className?: string
        container: HTMLElement
        title?: string
        text?: string
        callback: (...args: unknown[]) => void
        context: unknown
      }) => HTMLElement
      _detectIOS?: () => boolean
    }
  }
  DomUtil: typeof L.DomUtil
  DomEvent: typeof L.DomEvent
  point: typeof L.point
}

const LDraw = LAny.Draw

if (LDraw?.Polyline?.prototype) {
  const proto = LDraw.Polyline.prototype

  proto._calculateFinishDistance = function (): number {
    return Infinity
  }

  proto._onTouch = function (): void {}

  const originalMouseDown = proto._onMouseDown
  proto._onMouseDown = function (this: DrawHandler, e: L.LeafletEvent): void {
    if (eventFromToolbar(e as never)) return
    if (this._finishIgnoreUntil && Date.now() < this._finishIgnoreUntil) return
    if (typeof originalMouseDown === "function") {
      originalMouseDown.call(this, e)
    }
  }

  const originalMouseUp = proto._onMouseUp
  proto._onMouseUp = function (this: DrawHandler, e: L.LeafletEvent): void {
    if (eventFromToolbar(e as never)) {
      this._mouseDownOrigin = null
      return
    }
    if (typeof originalMouseUp === "function") {
      originalMouseUp.call(this, e)
    }
  }

  proto._endPoint = function (
    this: DrawHandler,
    _clientX: number,
    _clientY: number,
    e: L.LeafletEvent
  ): void {
    if (!this._mouseDownOrigin) return
    if (eventFromToolbar(e as never)) {
      this._mouseDownOrigin = null
      this._enableNewMarkers?.()
      return
    }
    if (this._finishIgnoreUntil && Date.now() < this._finishIgnoreUntil) {
      this._mouseDownOrigin = null
      return
    }

    const latlng = (e as L.LeafletMouseEvent).latlng
    // Do not gate on drag distance: after ≥3 vertices the filled shape makes
    // mousedown/mouseup deltas routinely exceed leaflet-draw's 9*dpr limit.
    if (latlng) {
      this.addVertex?.(latlng)
    }
    this._enableNewMarkers?.()
    this._mouseDownOrigin = null
  }

  const armFinishGuard = (handler: DrawHandler) => {
    handler._finishIgnoreUntil = Date.now() + 400
    handler._mouseDownOrigin = null
  }

  const ensureRubberBand = (handler: RubberHandler) => {
    if (handler._rubberBand || !handler._map) return
    handler._rubberBand = L.polyline([], {
      // Not the accent, and it does not follow the chassis: this line is drawn
      // over imagery, so it answers to the terrain the way the AOI outlines in
      // lib/aoiStyle.ts do. See docs/DESIGN.md, "Scientific ramps are out of
      // scope".
      color: "#d8944a",
      weight: 2,
      opacity: 0.95,
      dashArray: "6 6",
      interactive: false,
      pane: "markerPane",
      className: "geosense-draw-rubberband",
    })
    handler._rubberBand.addTo(handler._map)
  }

  const clearRubberBand = (handler: RubberHandler) => {
    if (handler._rubberBand && handler._map) {
      handler._map.removeLayer(handler._rubberBand)
      handler._rubberBand = undefined
    }
  }

  const updateRubberBand = (handler: RubberHandler, cursor: L.LatLng) => {
    const markers = handler._markers
    if (!markers || markers.length === 0) {
      handler._rubberBand?.setLatLngs([])
      return
    }
    ensureRubberBand(handler)
    const last = markers[markers.length - 1].getLatLng()
    handler._rubberBand?.setLatLngs([last, cursor])
  }

  proto._onMouseMove = function (this: RubberHandler, e: L.LeafletEvent): void {
    try {
      const oe = (e as L.LeafletMouseEvent).originalEvent
      if (!oe || !this._map) return
      const newPos = this._map.mouseEventToLayerPoint(oe)
      const latlng = this._map.layerPointToLatLng(newPos)
      this._currentLatLng = latlng

      // Guide first so a tooltip failure cannot blank the rubber-band.
      updateRubberBand(this, latlng)
      this._clearGuides?.()

      try {
        this._updateTooltip?.(latlng)
      } catch {
        /* tooltip measurement must not kill the draw preview */
      }

      this._mouseMarker?.setLatLng(latlng)
      L.DomEvent.preventDefault(oe)
    } catch {
      /* ignore transient WKWebView pointer quirks */
    }
  }

  // Disable legacy dash guides (replaced by rubber-band polyline).
  proto._drawGuide = function (): void {}

  const originalFinish = proto._finishShape
  proto._finishShape = function (this: RubberHandler): void {
    if (this._finishIgnoreUntil && Date.now() < this._finishIgnoreUntil) {
      return
    }
    clearRubberBand(this)
    armFinishGuard(this)
    if (typeof originalFinish === "function") {
      originalFinish.call(this)
    }
  }

  const originalComplete = proto.completeShape
  proto.completeShape = function (this: RubberHandler): void {
    clearRubberBand(this)
    armFinishGuard(this)
    if (typeof originalComplete === "function") {
      originalComplete.call(this)
    }
  }
}

if (LDraw?.Polygon?.prototype) {
  LDraw.Polygon.prototype._updateFinishHandler = function (this: DrawHandler): void {
    const markers = this._markers
    if (!markers) return

    // Click first vertex to close (defer so the creating click cannot fire it).
    if (markers.length === 1) {
      const marker = markers[0]
      const finish = this._finishShape
      if (finish) {
        window.setTimeout(() => {
          marker.on("click", finish, this)
        }, 100)
      }
    }
    // Intentionally omit dblclick → finish (WKWebView/trackpad false positives).
  }
}

// Stop pointer/mouseup from falling through Finish/Undo/Cancel onto the map.
if (LAny.Toolbar?.prototype?._createButton) {
  LAny.Toolbar.prototype._createButton = function (options) {
    const link = L.DomUtil.create("a", options.className || "", options.container)
    const sr = L.DomUtil.create("span", "sr-only", options.container)

    link.href = "#"
    link.appendChild(sr)

    if (options.title) {
      link.title = options.title
      sr.innerHTML = options.title
    }
    if (options.text) {
      link.innerHTML = options.text
      sr.innerHTML = options.text
    }

    const buttonEvent = this._detectIOS?.() ? "touchstart" : "click"
    const stop = L.DomEvent.stopPropagation
    const prevent = L.DomEvent.preventDefault

    L.DomEvent.on(link, "click", stop)
      .on(link, "mousedown", stop)
      .on(link, "mouseup", stop)
      .on(link, "dblclick", stop)
      .on(link, "touchstart", stop)
      .on(link, "touchend", stop)
      .on(link, "pointerdown", stop)
      .on(link, "pointerup", stop)
      .on(link, "pointercancel", stop)
      .on(link, "click", prevent)
      .on(link, buttonEvent, options.callback, options.context)

    return link
  }
}

export {}
