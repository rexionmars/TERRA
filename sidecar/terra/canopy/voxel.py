"""
Leaf-area density on a voxel grid, and Beer-Lambert along a marched ray.

MIRRORED from the numerical-studies repository, kept in its original wording for
the reason canopy.py states:

    TERRA-Simulation @ 0334784
    notebooks/vmango-replicacao/ambiente.py

TWO ENGINES, NOT ONE. `canopy.py` beside this file represents a crown as an
ellipsoid of uniform density and intersects it analytically; this represents it
as a grid filled by explicit leaves and marches through it. The extinction law
is deliberately the SAME on both sides -- Beer-Lambert with a projection
coefficient over the optical path -- so that a difference between them is
attributable to where the density came from and to nothing else.

The orchard is periodic: the grid covers one spacing module and a ray leaving
one side re-enters the opposite one. That is an infinite orchard without
replicating a single tree.

WHAT WAS LEFT BEHIND. The origin opens with `leaves_of`, which reads growth
units in the shape `vmango.py` produces. That module is a didactic
reimplementation whose own docstring says none of its numbers are comparable
with the paper it follows, and nothing here depends on it -- so the leaf cloud
now arrives from `helios_bridge.leaf_cloud` instead, which is measured against
Helios's own leaf area.

WHAT IS AND IS NOT VERIFIED. In the origin this module's limit cases are
`print()` calls in a notebook rather than assertions any script enforces, and
one of them disagrees with the figure the handoff quotes. See
sidecar/tests/test_canopy_voxel.py, which measures them rather than inheriting
them.

Nothing here imports anything beyond numpy.
"""

import numpy as np

G_LEAF = 0.5
PAR_FRACTION = 0.5
PAR_UMOL_PER_W = 4.57


# ---------------------------------------------------------------------------
# Voxelização
# ---------------------------------------------------------------------------

class Canopy:
    """Densidade de área foliar num módulo periódico do pomar.

    `spacing` é o lado do módulo quadrado. As folhas entram por resto da
    divisão: uma árvore mais larga que o espaçamento simplesmente devolve área
    ao módulo pelo lado oposto, que é o que acontece num pomar fechado.
    """

    def __init__(self, pos, area, spacing, cell=0.15, z_max=None):
        self.spacing = float(spacing)
        self.cell = float(cell)
        self.n_xy = max(int(np.ceil(spacing / cell)), 1)
        z_top = float(z_max if z_max is not None
                      else (pos[:, 2].max() + cell if len(pos) else cell))
        self.n_z = max(int(np.ceil(z_top / cell)), 1)
        self.z_top = self.n_z * cell

        self.grid = np.zeros((self.n_xy, self.n_xy, self.n_z))
        if len(pos):
            ix = (np.mod(pos[:, 0], spacing) / cell).astype(int) % self.n_xy
            iy = (np.mod(pos[:, 1], spacing) / cell).astype(int) % self.n_xy
            iz = np.clip((pos[:, 2] / cell).astype(int), 0, self.n_z - 1)
            np.add.at(self.grid, (ix, iy, iz), area)
        self.grid /= cell ** 3          # m2 de folha por m3 -> densidade

        self.leaf_area = float(area.sum()) if len(area) else 0.0
        self.lai_ground = self.leaf_area / (spacing ** 2)

    def transmittance(self, pos, direction, max_path=25.0, step_frac=0.5):
        """Transmitância do ponto até sair do dossel, na direção dada. (N,)

        Marcha a passo fixo pela grade, somando densidade x passo. O ponto de
        partida é meio passo à frente: um ponto amostrado dentro do meio não
        deve ser sombreado pela sua própria célula inteira.

        `step_frac` é o passo em frações do lado da célula. Com passo igual à
        célula a marcha reproduz Beer-Lambert num meio homogêneo com erro de
        até 1,7% em incidência oblíqua, porque a fila de células amostradas não
        é uniforme ao longo do raio; com meia célula o erro cai abaixo de 0,5%.
        """
        d = np.asarray(direction, float)
        d = d / np.linalg.norm(d)
        if d[2] <= 1e-6:
            return np.zeros(len(pos))       # sol no horizonte ou abaixo

        step = self.cell * step_frac
        n_steps = int(min(max_path, (self.z_top + step) / d[2]) / step) + 1
        acc = np.zeros(len(pos))
        alive = np.ones(len(pos), bool)

        for k in range(n_steps):
            t = (k + 0.5) * step
            q = pos + d * t
            alive &= q[:, 2] < self.z_top
            if not alive.any():
                break
            ix = (np.mod(q[alive, 0], self.spacing) / self.cell).astype(int) % self.n_xy
            iy = (np.mod(q[alive, 1], self.spacing) / self.cell).astype(int) % self.n_xy
            iz = np.clip((q[alive, 2] / self.cell).astype(int), 0, self.n_z - 1)
            acc[alive] += self.grid[ix, iy, iz] * step

        return np.exp(-G_LEAF * acc)

    def ground_shadow(self, direction, n=90):
        """Fração de radiação direta que alcança o solo, por ponto do módulo.

        Mesma marcha, partindo do chão. Serve à figura de sombra projetada.
        """
        gx = (np.arange(n) + 0.5) / n * self.spacing
        X, Y = np.meshgrid(gx, gx, indexing="ij")
        pts = np.stack([X.ravel(), Y.ravel(), np.zeros(X.size)], axis=1)
        return self.transmittance(pts, direction).reshape(n, n)


# ---------------------------------------------------------------------------
# Céu e sol
# ---------------------------------------------------------------------------

def sky_directions(n_zenith=6, n_azimuth=8):
    """Hemisfério em ângulo sólido uniforme. Mesma convenção do E7.

    w_j = 2cos(z_j)/K, de modo que soma(w) = 1 e soma(w/cos) = 2, exatamente.
    """
    mu = (np.arange(n_zenith) + 0.5) / n_zenith
    azi = (np.arange(n_azimuth) + 0.5) * 2.0 * np.pi / n_azimuth
    m, a = np.meshgrid(mu, azi, indexing="ij")
    m, a = m.ravel(), a.ravel()
    s = np.sqrt(1.0 - m ** 2)
    dirs = np.stack([s * np.sin(a), s * np.cos(a), m], axis=1)
    return dirs, m, 2.0 * m / m.size


def bin_sun(zenith_deg, azimuth_deg, dni, n_zen=6, n_azi=12):
    """Agrupa as posições solares do ano em direções representativas.

    Marchar pela grade em cada uma das ~4500 horas seria desperdício: o que a
    marcha enxerga é a DIREÇÃO, e muitas horas repetem direção quase igual. A
    transmitância é então calculada uma vez por direção representativa, e cada
    hora usa a da sua célula.

    O que NÃO se agrupa é a integração temporal. A resposta fotossintética
    satura, de modo que somar a energia da célula e aplicar a hipérbole ao
    total achataria justamente o efeito que se quer medir. Por isso devolve-se
    também o índice de célula de cada hora, e a assimilação é somada hora a
    hora em `annual_assimilation`.

    Devolve direções (K,3), cos do zênite (K,), o índice de célula por hora
    iluminada (H,) e a máscara das horas iluminadas.
    """
    lit = (zenith_deg < 89.0) & (dni >= 0)
    z, a, e = zenith_deg[lit], azimuth_deg[lit], np.maximum(dni[lit], 1e-9)

    iz = np.clip((np.cos(np.radians(z)) * n_zen).astype(int), 0, n_zen - 1)
    ia = np.clip((a % 360.0) / 360.0 * n_azi, 0, n_azi - 1e-9).astype(int)
    key = iz * n_azi + ia
    uniq, inverse = np.unique(key, return_inverse=True)

    dirs, cosz = [], []
    for k in uniq:
        m = key == k
        w = e[m]
        # Direção média ponderada pela DNI: a célula é representada pelo lugar
        # de onde vem a sua energia, não pelo seu centro geométrico.
        zc = np.average(np.radians(z[m]), weights=w)
        ac = np.average(np.radians(a[m]), weights=w)
        dirs.append([np.sin(zc) * np.sin(ac), np.sin(zc) * np.cos(ac), np.cos(zc)])
        cosz.append(np.cos(zc))

    return np.array(dirs), np.array(cosz), inverse, lit


# ---------------------------------------------------------------------------
# Radiação absorvida e assimilação
# ---------------------------------------------------------------------------

def transmittance_matrix(canopy, pos, dirs):
    """Transmitância por folha e direção. (N,K)."""
    tau = np.empty((len(pos), len(dirs)))
    for j, d in enumerate(dirs):
        tau[:, j] = canopy.transmittance(pos, d)
    return tau


def diffuse_unit(tau_sky, sky_cos, sky_w):
    """Absorvido por área foliar e por W/m2 de DHI. (N,).

    Sem dossel vale 1: soma(w/cos) = 2 e G = 0,5. É o mesmo caso-limite que o
    E7 verifica contra valor analítico.
    """
    return G_LEAF * (tau_sky * (sky_w / sky_cos)[None, :]).sum(axis=1)


def assimilation(par_umol, alpha=0.05, amax=12.0):
    """Hipérbole retangular por área foliar. `amax=None` remove a saturação."""
    if amax is None:
        return alpha * par_umol
    return alpha * par_umol * amax / (alpha * par_umol + amax)


def to_par(w_per_m2):
    return w_per_m2 * PAR_FRACTION * PAR_UMOL_PER_W


def annual_assimilation(canopy, tau_beam, bin_of_hour, unit_diff,
                        dni, dhi, alpha=0.05, amax=12.0):
    """Assimilação anual em gC por m2 de SOLO, e absorvido em MJ/m2 de solo.

    Integra hora a hora, agrupando as horas que compartilham direção solar --
    a transmitância é a mesma dentro do grupo, a irradiância não.
    """
    lai = canopy.lai_ground
    total_a = 0.0
    total_q = 0.0

    for k in range(tau_beam.shape[1]):
        h = bin_of_hour == k
        if not h.any():
            continue
        # (N, H_k): folhas x horas desta direção.
        i_leaf = (G_LEAF * tau_beam[:, k][:, None] * dni[h][None, :]
                  + unit_diff[:, None] * dhi[h][None, :])
        total_a += assimilation(to_par(i_leaf), alpha, amax).mean(axis=0).sum()
        total_q += i_leaf.mean(axis=0).sum()

    gc = total_a * lai * 3600.0 * 12.011e-6
    mj = total_q * lai * 3600.0 / 1e6
    return gc, mj
