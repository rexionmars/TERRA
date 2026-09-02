"""
Overland routing: where rain goes over an AOI, how deep, and when.

A different question from the one `envelope` answers. The envelope asks how much
of a HAND extent is terrain and how much is the choice of DEM; it is static, and
it never moves water. This puts a rainfall rate on every cell and lets the
terrain organise the flow, so it can answer what an hour of rain does to a
valley.

It shares the terrain chain rather than repeating it. `terra.terrain.hand`
already fills depressions with an epsilon gradient, because HAND needs that;
this module takes the filled surface and adds only the hydraulics.

WHAT WAS HERE AND IS NOT. A second mode routed a breach hydrograph entering
through the AOI's own drainage, and it is gone. Not because the hydraulics
failed -- they are the same equations either way -- but because nothing here
could reliably decide WHERE a channel enters a drawn polygon. Two heuristics
were tried. Ranking boundary cells by accumulated flow finds the OUTLET, which
carries every cell upstream of it. Ranking by how far the water then travels
inside finds the outlet too on a short AOI, where the outward reach is the
longer one. A breach whose inlet is placed on the outlet reports depths that
are arithmetic rather than flood.

It can come back, and the physics below is ready for it, on one condition: the
inlet arrives as a COORDINATE the caller gives, not as a guess this module
makes. Rainfall needs no such point, which is why it is what remains.

THE SCHEME, AND WHY EACH PIECE IS THERE.

Audusse hydrostatic reconstruction, which makes the scheme well balanced: a
motionless lake over irregular bed stays motionless. Without it the bed source
term and the pressure flux do not cancel and the model manufactures currents on
every slope, which on mountain terrain swamps the signal entirely.
`lake_at_rest_residual` measures it rather than asserting it, and the action
refuses to report a run whose residual is not at machine noise.

HLL rather than Rusanov. Rusanov is the more dissipative of the two and smears
the steep front that is the whole character of a flood wave.

Semi-implicit Manning friction, because an explicit treatment diverges as the
depth tends to zero at the wetting front.

THREE THINGS THAT LOOK LIKE DETAIL AND ARE NOT. Each was a defect measured on a
prototype, and each is silent -- the run completes, the numbers look plausible,
and they are wrong.

  Depressions must be filled before routing. A 30 m DEM resampled into a valley
  carries spurious closed sinks along the channel; a shallow water solver takes
  them literally, water runs in and stops. Measured on a raw bed: 99.94 Mm3 in,
  99.94 Mm3 still standing after three hours, the outflow row never wetting.

  Every boundary is free outflow, and none is a wall. A reach that runs south
  and swings west leaves its box through the WEST edge; with west set as a wall
  the whole flood banked against it and the domain filled like a tank.

  Outflow is ONE-WAY. A ghost cell that copies its neighbour copies the
  momentum too, so wherever the flow at an edge points inward the ghost supplies
  water from nothing and keeps supplying it -- measured at 24,000% of what was
  put in. The ghost is dried where the flow points inward, and only there,
  because a blanket dry rim would drain a lake at rest.

WHAT THIS IS NOT. Clear water over a fixed bed, depth-averaged, with one lumped
Manning n. Real floods carry sediment, entrain their bed and are not Newtonian;
n absorbs all of that and is a calibration parameter, not a roughness
measurement. The terrain is whatever the DEM was.
"""

from __future__ import annotations

import numpy as np

G = 9.81

# Below this a cell is dry. Not a tuning knob: it is the depth at which q/h
# stops being a velocity, and both the flux and the timestep read it.
HMIN = 0.02

# Manning n per reach type. Defaults only; the request overrides them. The
# spread is what matters more than any single value -- a debris-laden upper
# reach and a lower river differ by more than the uncertainty on either.
MANNING_DEFAULT = 0.05

# CFL for the explicit update. 0.4 rather than the stable 0.9 because the
# wetting front on steep ground is where this scheme is least comfortable.
CFL = 0.4

# Above this inward velocity an outflow ghost is treated as dry, so it cannot
# feed the domain. Chosen between the two scales it has to separate: the
# well-balanced scheme's residual on a lake at rest is around 1e-14 m/s, and the
# slowest flow this product reports is of order 0.1 m/s.
INWARD_MS = 1e-4

def sweep(h, qn, qt, z, axis, dx):
    """HLL fluxes with Audusse reconstruction along `axis`.

    Returns per-cell updates (dh, dqn, dqt) already divided by dx, with the
    well-balancing source folded into dqn.
    """
    hs = np.maximum(h, 0.0)
    un = np.where(hs > HMIN, qn / np.maximum(hs, HMIN), 0.0)
    ut = np.where(hs > HMIN, qt / np.maximum(hs, HMIN), 0.0)

    hR = np.roll(hs, -1, axis)
    unR = np.roll(un, -1, axis)
    utR = np.roll(ut, -1, axis)
    zL, zR = z, np.roll(z, -1, axis)
    zI = np.maximum(zL, zR)

    # Reconstruct each side's depth against the higher of the two beds.
    hLs = np.maximum(hs + zL - zI, 0.0)
    hRs = np.maximum(hR + zR - zI, 0.0)
    cL, cR = np.sqrt(G * hLs), np.sqrt(G * hRs)

    sL = np.minimum(np.minimum(un - cL, unR - cR), 0.0)
    sR = np.maximum(np.maximum(un + cL, unR + cR), 0.0)

    qLs, qRs = hLs * un, hRs * unR
    FnL = qLs * un + 0.5 * G * hLs ** 2
    FnR = qRs * unR + 0.5 * G * hRs ** 2

    den = np.where(sR - sL > 1e-12, sR - sL, 1.0)
    Fh = (sR * qLs - sL * qRs + sL * sR * (hRs - hLs)) / den
    Fn = (sR * FnL - sL * FnR + sL * sR * (qRs - qLs)) / den
    Ft = (sR * qLs * ut - sL * qRs * utR
          + sL * sR * (hRs * utR - hLs * ut)) / den

    dh = (Fh - np.roll(Fh, 1, axis)) / dx
    dqn = (Fn - np.roll(Fn, 1, axis)) / dx
    dqt = (Ft - np.roll(Ft, 1, axis)) / dx

    # Well-balancing source. For a lake at rest hLs == hRs at every interface,
    # so this cancels the pressure flux difference exactly and no current is
    # created. That identity is what `lake_at_rest_residual` checks.
    src = 0.5 * G * (hLs ** 2 - np.roll(hRs, 1, axis) ** 2) / dx
    return dh, dqn - src, dqt


def step(h, qx, qy, z, dx, dy, dt, n_manning):
    """One split step on a domain padded with one ring of ghost cells.

    The padding is what makes the boundary a boundary. `sweep` differences with
    np.roll, which wraps, so on a bare array the domain is a torus and nothing
    ever leaves it. Ghosts copy depth, momentum and bed outward, which is free
    outflow and also keeps the reconstruction well balanced at the edge: a
    motionless lake sees no gradient across it.

    """
    hp = np.pad(h, 1, mode="edge")
    qxp = np.pad(qx, 1, mode="edge")
    qyp = np.pad(qy, 1, mode="edge")
    zp = np.pad(z, 1, mode="edge")

    # OUTFLOW IS ONE-WAY.
    #
    # A ghost that copies its neighbour copies the momentum too, so wherever the
    # flow at an edge points inward the ghost supplies water from nothing and
    # keeps supplying it. Measured before this: boundary inflow of 24,000% of
    # what the inlet delivered, on a domain whose edges simply sloped inward.
    # Clamping the normal component so it can only leave makes the edge an
    # outlet rather than an unlimited reservoir. Depth is still copied, which is
    # what keeps a lake at rest at rest.
    # Clamping the ghost's momentum is not enough on its own: the interior cell
    # keeps its own inward momentum and the interface still carries mass in. A
    # DRY ghost carries nothing, so wherever the flow at an edge points inward
    # the ghost is emptied as well as stilled.
    #
    # Only where it points inward. At rest the normal momentum is zero, the
    # ghost keeps its copied depth and bed, and the lake stays a lake -- which
    # is the property the C-property test checks and which a blanket dry rim
    # would destroy.
    # The test is on VELOCITY and against a threshold, not on momentum against
    # zero. A motionless lake is not exactly motionless: the well-balanced
    # scheme holds it to about 1e-14 m/s, which is above zero, and a bare `> 0`
    # read that noise as inflow, dried the rim and drained the lake -- the
    # C-property test caught it immediately. INWARD_MS sits far above that noise
    # and far below anything a flood does.
    uy = qyp / np.maximum(hp, HMIN)
    ux = qxp / np.maximum(hp, HMIN)
    for ghost, inner, sign in ((0, 1, +1.0), (-1, -2, -1.0)):
        inward = sign * uy[inner, :] > INWARD_MS
        qyp[ghost, inward] = 0.0
        hp[ghost, inward] = 0.0
    for ghost, inner, sign in ((0, 1, +1.0), (-1, -2, -1.0)):
        inward = sign * ux[:, inner] > INWARD_MS
        qxp[inward, ghost] = 0.0
        hp[inward, ghost] = 0.0

    dh_x, dqx_x, dqy_x = sweep(hp, qxp, qyp, zp, 1, dx)
    dh_y, dqy_y, dqx_y = sweep(hp, qyp, qxp, zp, 0, dy)
    core = (slice(1, -1), slice(1, -1))

    raw = h - dt * (dh_x[core] + dh_y[core])
    # The clip is not free. Where the update drives a cell below zero, raising
    # it to zero CREATES mass, and on a wetting front that happens constantly.
    # It is small and it is not nothing, so it is returned rather than absorbed:
    # a balance that hides its own source term is not a balance.
    clipped = float(np.sum(np.where(raw < 0.0, -raw, 0.0)))
    h_new = np.maximum(raw, 0.0)
    qx_new = qx - dt * (dqx_x[core] + dqx_y[core])
    qy_new = qy - dt * (dqy_x[core] + dqy_y[core])

    dry = h_new <= HMIN
    qx_new[dry] = 0.0
    qy_new[dry] = 0.0
    # Semi-implicit: q <- q / (1 + dt g n^2 |u| / h^(4/3)).
    hh = np.maximum(h_new, HMIN)
    speed = np.hypot(qx_new, qy_new) / hh
    fr = G * n_manning ** 2 * speed / hh ** (4.0 / 3.0)
    return h_new, qx_new / (1.0 + dt * fr), qy_new / (1.0 + dt * fr), clipped


def timestep(h, qx, qy, dx, dy, cfl=CFL, cap_s=2.0):
    hh = np.maximum(h, HMIN)
    c = np.sqrt(G * hh)
    m = max(float((np.abs(qx) / hh + c).max()) / dx,
            float((np.abs(qy) / hh + c).max()) / dy, 1e-6)
    return min(cfl / m, cap_s)


def lake_at_rest_residual(z, dx, dy, steps=120):
    """Largest spurious speed a motionless lake develops over `steps` steps.

    The C-property check. A well-balanced scheme returns machine noise here; a
    scheme whose source term does not cancel its pressure flux returns a real
    number, and every depth it later reports is that error plus the flow.
    """
    level = float(np.percentile(z, 25))
    h = np.maximum(level - z, 0.0)
    qx = np.zeros_like(h)
    qy = np.zeros_like(h)
    for _ in range(steps):
        dt = timestep(h, qx, qy, dx, dy)
        h, qx, qy, _ = step(h, qx, qy, z, dx, dy, dt, 0.0)
    wet = h > HMIN
    if not wet.any():
        return 0.0
    return float((np.hypot(qx, qy)[wet] / np.maximum(h[wet], HMIN)).max())


def route(z_filled, dx, dy, *, minutes=60.0, rain_mm_h=None,
          rain_minutes=None, manning=MANNING_DEFAULT, snapshots=0, progress=None):
    """Route rainfall over `z_filled` and return the fields it leaves behind.

    `z_filled` is the depression-filled surface from terra.terrain.hand, which
    computes it for HAND. Neither the D8 graph nor the accumulation is needed
    any more: both existed only to find a breach inlet.
    """
    if not rain_mm_h:
        raise ValueError("rain_mm_h is required: the rainfall rate in mm/h")
    ny, nx = z_filled.shape
    cell = dx * dy
    t_end = float(minutes) * 60.0

    h = np.zeros((ny, nx))
    qx = np.zeros_like(h)
    qy = np.zeros_like(h)
    peak_h = np.zeros_like(h)
    peak_speed = np.zeros_like(h)
    arrival = np.full((ny, nx), np.nan)

    rain_s = float(rain_minutes or minutes) * 60.0
    rain_rate = float(rain_mm_h) / 1000.0 / 3600.0     # m/s of depth

    volume_in = 0.0
    volume_out = 0.0
    volume_clipped = 0.0
    t = 0.0
    nstep = 0
    frames = []
    frame_t = []
    snap_every = t_end / snapshots if snapshots else None
    next_snap = 0.0

    while t < t_end:
        dt = min(timestep(h, qx, qy, dx, dy), t_end - t)
        if dt <= 0:
            break
        # THE BALANCE IS MEASURED, NOT DIFFERENCED.
        #
        # In a conservative scheme every interior flux appears twice with
        # opposite sign, so the mass the domain loses across one solver step IS
        # what crossed its boundary, once the positivity clip is taken back out.
        # Nothing needs instrumenting inside `sweep` for that.
        #
        # The earlier version differenced the requested inflow against what was
        # standing at the end, which is not a balance at all when the inlet is a
        # specified-depth boundary: that condition WRITES the depth rather than
        # adding to it, so the mass it moves is whatever the interior left there,
        # in either direction. It reported inflows of -779 Mm3 and outflows of
        # 145% of input, both of which are the accounting and not the flow.
        mass_before = float(h.sum())
        h, qx, qy, clipped = step(h, qx, qy, z_filled, dx, dy, dt, manning)
        volume_clipped += clipped * cell
        volume_out += (mass_before - float(h.sum()) + clipped) * cell

        if t <= rain_s:
            h += dt * rain_rate
            volume_in += dt * rain_rate * h.size * cell

        t += dt
        nstep += 1
        wet = h > HMIN
        newly = wet & np.isnan(arrival)
        arrival[newly] = t
        peak_h = np.maximum(peak_h, h)
        peak_speed = np.maximum(
            peak_speed, np.where(wet, np.hypot(qx, qy) / np.maximum(h, HMIN), 0.0))

        if snap_every and t >= next_snap:
            frames.append(h.astype(np.float32))
            frame_t.append(t)
            next_snap += snap_every
        if progress and nstep % 500 == 0:
            progress(f"routing: t={t / 60:.0f} of {minutes:.0f} min")

    stored = float(h.sum()) * cell
    return {
        "peak_depth_m": peak_h,
        "peak_speed_ms": peak_speed,
        "arrival_s": arrival,
        "final_depth_m": h,
        "frames": np.array(frames) if frames else np.zeros((0, ny, nx), np.float32),
        "frame_times_s": np.array(frame_t),
        "steps": nstep,
        "volume_in_m3": volume_in,
        "volume_stored_m3": stored,
        # Measured across the boundary step by step, not differenced: in a
        # conservative scheme the mass the domain loses over one step IS what
        # crossed its edge, once the positivity clip is taken back out. A domain
        # that stores everything it was given never reached an outlet, and its
        # depths are a filling level rather than a routed wave.
        "volume_out_m3": volume_out,
        # What the positivity clip at the wetting front invented. Small on a
        # healthy run, and the first place to look when the balance does not
        # close. Reported because a balance that hides its own source term is
        # not a balance.
        "volume_clipped_m3": volume_clipped,
    }


def depth_rgba(depth, dmax, inside=None):
    """Depth as an RGBA overlay: transparent where dry or outside the AOI.

    The shallow end stays clearly blue rather than fading to white. A ramp that
    starts near white disappears into pale terrain and the margin of the flood
    reads as no flood at all, which is the one part of the extent a reader most
    needs to see.
    """
    h, w = depth.shape
    out = np.zeros((h, w, 4), np.uint8)
    wet = depth > HMIN
    if inside is not None:
        wet &= inside
    if not wet.any():
        return out
    f = np.clip(depth / max(dmax, 1e-6), 0.0, 1.0)
    out[..., 0] = np.where(wet, (255 * (0.42 - 0.38 * f)).astype(np.uint8), 0)
    out[..., 1] = np.where(wet, (255 * (0.68 - 0.47 * f)).astype(np.uint8), 0)
    out[..., 2] = np.where(wet, (255 * (0.93 - 0.34 * f)).astype(np.uint8), 0)
    out[..., 3] = np.where(wet, (90 + 165 * f).astype(np.uint8), 0)
    return out
