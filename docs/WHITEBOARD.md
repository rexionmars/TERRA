# Whiteboard — geometry and rendering

The whiteboard lifts an analysis off the map into a three-dimensional
surface. This document derives the geometry it uses and states the reasoning
behind each rendering decision, so that a change to one of them is made against
the constraint it was chosen under rather than against appearance alone.

Source of truth for what follows:
[`lib/boardLayout.ts`](../frontend/src/lib/boardLayout.ts),
[`lib/mapLayers.ts`](../frontend/src/lib/mapLayers.ts),
[`lib/geometry.ts`](../frontend/src/lib/geometry.ts),
[`components/whiteboard/boardScene.ts`](../frontend/src/components/whiteboard/boardScene.ts).

---

## 1. Why the surface exists

An analysis raster is georeferenced: it occupies a rectangle in longitude and
latitude, and the map draws it there. Two analyses of different areas therefore
cannot be drawn side by side, because their rectangles are separated by whatever
distance separates the two places — on the order of 10³ km for the study areas
this application is used on. A cartographic view is faithful to that separation
by construction, and faithfulness is the obstacle: comparison requires the two
rasters to be adjacent on screen, which is a statement no map can make without
lying about where they are.

The board resolves this by discarding the coordinate system rather than
distorting it. Rasters become objects in a Cartesian world with no claim to
geographic position, so adjacency on the board asserts nothing about adjacency
on the ground.

A second property follows from the third axis and is available immediately with
a single area: the layers a map can only stack by occlusion can be separated
along the board normal and read simultaneously.

---

## 2. From geographic extent to world units

Each layer arrives as an axis-aligned rectangle in degrees,

$$E = (\lambda_{\min},\ \varphi_{\min},\ \lambda_{\max},\ \varphi_{\max})$$

with λ longitude and φ latitude.

### 2.1 Degrees are not distance

On the sphere, a degree of latitude subtends a constant arc, while a degree of
longitude subtends an arc that shortens as the meridians converge. For a sphere
of radius $R$,

$$\Delta s_\varphi = R\,\Delta\varphi, \qquad
  \Delta s_\lambda = R\,\Delta\lambda\,\cos\varphi$$

so the ratio of ground distance to angular span differs between the two axes by
$\cos\varphi$. Normalising an extent without applying it draws the raster
stretched east–west by $1/\cos\varphi - 1$:

| Latitude | $\cos\varphi$ | East–west stretch if omitted |
|---|---|---|
| −4.77° (Teresina) | 0.9965 | 0.3 % |
| −25.40° (Pato Branco) | 0.9033 | 10.7 % |
| 60° | 0.5000 | 100 % |

The factor is `lonScaleAtLat` in
[`lib/geometry.ts`](../frontend/src/lib/geometry.ts), shared with the AOI
footprint thumbnail, which needs the same correction for the same reason.

The board evaluates it once, at the latitude of the union's centre:

$$k = \cos\!\left(\frac{\varphi_{\min}^{U} + \varphi_{\max}^{U}}{2}\right)$$

This is a local secant approximation, and its error is **first** order in the
extent's angular height. Expanding at the edge of a span $\Delta\varphi$
centred on $\varphi$,

$$\frac{\cos(\varphi \pm \Delta\varphi/2)}{\cos\varphi}
  \;\approx\; 1 \mp \frac{\Delta\varphi}{2}\tan\varphi
             - \frac{\Delta\varphi^{2}}{8}$$

so the relative scale error at the extent's edge is $\tfrac{1}{2}\Delta\varphi
\tan\varphi$. Measured against the exact ratio:

| $\varphi$ | $\Delta\varphi$ | Measured | $\tfrac{1}{2}\Delta\varphi\tan\varphi$ |
|---|---|---|---|
| −4.77° | 0.05° | 3.63 × 10⁻⁵ | 3.64 × 10⁻⁵ |
| −25.40° | 0.05° | 2.071 × 10⁻⁴ | 2.072 × 10⁻⁴ |
| −25.40° | 0.50° | 2.062 × 10⁻³ | 2.072 × 10⁻³ |
| 60° | 0.05° | 7.558 × 10⁻⁴ | 7.557 × 10⁻⁴ |

For a field-scale AOI this is small against the raster's own sampling: a
200 px raster spanning 0.05° has a pixel of 2.5 × 10⁻⁴ degrees, and a relative
error of 2.1 × 10⁻⁴ over that span displaces the edge by 0.04 px. It grows
linearly with extent height and with $\tan\varphi$, so it is not valid for a
continental extent or a polar one — neither of which this surface draws.

### 2.2 Normalisation against the union, not per layer

Let $U$ be the union of every visible layer's extent,

$$U = \left(\min_i \lambda_{\min}^{i},\ \min_i \varphi_{\min}^{i},\
              \max_i \lambda_{\max}^{i},\ \max_i \varphi_{\max}^{i}\right)$$

and let the scale be its longest side in ground-proportional units,

$$S = \max\!\big( (\lambda_{\max}^{U}-\lambda_{\min}^{U})\,k,\ \
                  \varphi_{\max}^{U}-\varphi_{\min}^{U} \big)$$

so that the union's longest side becomes one world unit and the board's scale is
independent of how large the area happens to be.

Each layer is then sized and **offset** against that common frame:

$$w_i = \frac{(\lambda_{\max}^{i}-\lambda_{\min}^{i})\,k}{S}, \qquad
  h_i = \frac{\varphi_{\max}^{i}-\varphi_{\min}^{i}}{S}$$

$$x_i = \frac{\left(\bar\lambda_i - \bar\lambda_U\right)k}{S}, \qquad
  z_i = -\,\frac{\bar\varphi_i - \bar\varphi_U}{S}$$

where $\bar\lambda$, $\bar\varphi$ denote extent centres. The negation of $z$
follows from the world being Y-up with the camera looking down: north is $-Z$.

**Why the union rather than each layer's own extent.** The obvious alternative —
normalise every layer into the same unit square — is wrong in a way that only
appears with layers of differing coverage. A classification and its confidence
raster share an extent exactly, so both methods agree and they register
perfectly; that registration is what makes the stack readable. A composition,
however, can cover a different window from the run it is shown with. Normalising
it alone would rescale a partial-coverage raster to fill the same square,
asserting that it covers ground it does not. Normalising once and offsetting
each preserves the true spatial relation between layers, which is the only
geographic fact the board still makes a claim about.

The transform is affine and identical for every layer, so relative position,
relative size and relative overlap are preserved exactly; only absolute
position, scale and orientation are discarded.

---

## 3. Camera

### 3.1 Fitting the bounding sphere

The camera must frame the whole stack. Fitting the *rectangle* would require
recomputing at every orbit angle, because a rectangle's projected extent varies
with viewing direction — and framing that changes while the user rotates reads
as the object moving rather than as the camera turning.

The bounding sphere is invariant under rotation about its centre, so once it
fits, it fits from every direction. For a sphere of radius $r$ viewed by a
perspective camera whose half-angle is $\theta$, the sphere is tangent to the
frustum when its centre lies at

$$d = \frac{r}{\sin\theta}$$

A perspective camera has two half-angles. Given a vertical field of view
$f_v$ and viewport aspect $a = W/H$,

$$f_h = 2\arctan\!\left(\tan\frac{f_v}{2}\cdot a\right)$$

and the binding constraint is the smaller of the two:

$$d = \frac{r}{\sin\!\big(\tfrac{1}{2}\min(f_v, f_h)\big)}$$

With $f_v = 45°$:

| Aspect $a$ | $f_h$ | Binding axis | $d/r$ |
|---|---|---|---|
| 1.78 (16:9) | 72.7° | vertical | 2.613 |
| 1.33 (4:3) | 57.8° | vertical | 2.613 |
| 1.00 | 45.0° | vertical | 2.613 |
| 0.75 (3:4) | 34.5° | horizontal | 3.371 |

Verification: the half-angle subtended by the sphere, $\arcsin(r/d)$, equals the
binding half-field to floating-point tolerance at both extremes — 22.50° at
$a = 1.78$ and 17.26° at $a = 0.75$ — confirming tangency rather than
approximate framing. The implementation multiplies $d$ by 1.12 so the object is
not flush against the frame edge.

The cost of using the sphere is empty margin at the angles where the rectangle
is narrowest, bounded by the ratio of the rectangle's diagonal to its projected
width. For a stack of near-square rasters that is at most $\sqrt2$.

### 3.2 Placement

The camera is placed on the sphere of radius $d$ about the target by azimuth
$\alpha$ and elevation $\epsilon$:

$$\mathbf{p} = d\,(\sin\alpha\cos\epsilon,\ \ \sin\epsilon,\ \ \cos\alpha\cos\epsilon)$$

with $\alpha = -36°$, $\epsilon = 53°$ at entry. The opening view is
deliberately not plan: a top-down camera reproduces the map the board replaced,
so entering there gives no indication that anything changed. The tilt is what
states that the surface has a third axis.

### 3.3 Constraints

The polar angle is clamped below $\pi/2$, so the camera never passes under the
board. From below, the planes are seen from behind and the stack order reverses
on screen, which reads as a rendering fault rather than as a viewpoint. The
upper limit is left open: descending to plan reproduces the map view exactly and
is a legitimate thing to want.

Zoom is bounded by the object rather than by constants, $d_{\min} = 0.35\,r$ and
$d_{\max} = 4\,d$.

On viewport resize the camera is pushed out if and only if the new aspect would
crop, i.e. when $\lVert\mathbf{p}\rVert < d(a')$, and is never pulled in.
Re-framing outright would discard the angle and zoom the user chose, so a window
resize would silently undo their work. The orbit target does not move, so the
stack remains centred in every case.

---

## 4. The stack

Layers are separated along $+Y$ in the order the shared table
([`lib/mapLayers.ts`](../frontend/src/lib/mapLayers.ts)) returns them:

$$y_i = i\,g$$

with $g = 0.1$ in world units — a tenth of the union's longest side. Spacing by
list index rather than by the layer's own ordering number keeps the separation
even however far apart those numbers happen to be.

The ordering numbers themselves are the map's z-indices, retained because they
already encode a decision: composition (350) below surface water (360) below the
classification (400) below confidence (450), so that a classification stays
readable over water and confidence reads over the classification.

**This is the property that pays for the third axis.** On a plane, that order
can only be expressed by occlusion, which is why the confidence raster is drawn
semi-transparent — so the classification shows through it. Separated along $Y$,
both are legible at once and the order is a thing that can be seen. The
*Keep prediction under confidence* control, which on the map toggles between two
compositing arrangements, becomes a statement about stack membership.

### 4.1 Transparency ordering

Transparent surfaces cannot rely on the depth buffer, because a fragment written
by a nearer transparent surface would reject a farther one that should still
contribute. The usual remedy is to sort by distance to the camera — but on a
turntable that distance ordering *inverts* as the camera passes the stack, so
layers would visibly swap places mid-orbit.

The board writes an explicit `renderOrder` from the layer index and disables
depth writes, so the compositing order is the layer order at every viewing
angle, independent of the camera.

---

## 5. Texture sampling

Class rasters are sampled with nearest-neighbour filtering and no mipmaps.

A classification raster is a map $\Omega \to C$ from pixels to a finite legend,
encoded as colour. Bilinear interpolation computes, for a sample point between
four texels,

$$c = \sum_{j} w_j\,c_j, \qquad \sum_j w_j = 1,\ w_j \ge 0$$

which is a convex combination of legend colours. The legend is a discrete set;
a convex combination of two of its members is in general **not** a member.
Interpolating therefore produces colours that correspond to no class, and the
legend stops describing the pixels — a boundary between classes 3 and 7 acquires
a fringe that reads as class 5 if the palette happens to place it between them.

This is the same rule as the `.overlay-crisp` treatment the map applies to the
same rasters. Continuous rasters — composites, confidence, water occurrence —
carry no legend and are filtered normally.

A consequence worth noting: nearest sampling removes the need for
power-of-two texture dimensions, since mipmapping is what requires them. The
rasters are 60–740 px on a side and non-power-of-two throughout.

---

## 6. Rendering decisions

**Unlit materials.** Any lighting model multiplies surface colour by a light
term, $c_{\text{out}} = c\,(\mathbf{n}\cdot\mathbf{l})$ or similar. These
rasters are data, not surfaces: the colour *is* the value. Shading them would
make the displayed colour depend on viewing geometry, and the legend would stop
matching the pixels — the same failure as interpolation, arriving by a different
route.

**On-demand rendering.** Frames are drawn on control change, on drag, on resize
and on texture load, not in a continuous loop. A desktop window redrawing an
unchanged scene at display rate spends power for no result. The orientation
gizmo's snap animation is the one motion not driven by the user's hand, and it
runs its own loop for as long as it lasts.

**Two passes, one buffer.** The scene and the orientation gizmo are separate
render passes into the same framebuffer, so automatic clearing is disabled and
the clear is explicit: leaving it on would wipe the scene before the gizmo drew,
leaving it off without clearing would accumulate every frame on the last.

**Device pixel ratio** is capped at 2. An uncapped ratio on a 3× display
renders nine times the pixels of a 1× canvas for a difference that is not
visible on a flat raster.

**Context loss** is handled with `preventDefault` on `webglcontextlost` and a
scene rebuild on restore. Without the `preventDefault` the context is never
restored and the surface is dead until the application restarts, which a window
that lives for hours and is backgrounded will eventually encounter.

---

## 7. Limits of the present implementation

- **One analysis.** The board holds the rasters currently on the map. Placing a
  second area beside the first — the case that motivates the surface — requires
  sourcing rasters from saved runs, and the composition scoping in
  [`lib/projectOverlays.ts`](../frontend/src/lib/projectOverlays.ts) currently
  filters out exactly the distant extents such a comparison needs.
- **No relief.** Planes are flat. A displaced surface needs elevation on the
  frontend, and the Copernicus DEM GLO-30 window fetched per AOI is consumed and
  discarded in the sidecar's working directory; only derived scalars survive
  into the payload.
- **Swipe compare does not apply.** It compares a raster against the basemap,
  and the board has no basemap by construction.
- **Smoothing parity is not yet closed.** The map applies a majority filter to
  the classification under a user control, inside the overlay component rather
  than in the shared table; the board draws the unfiltered raster. A board that
  disagrees with the map about where a class boundary lies is not a cosmetic
  difference.
