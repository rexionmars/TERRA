"""
Analytic light interception over an orchard of ellipsoidal crowns.

MIRRORED from the numerical-studies repository, and deliberately kept in its
original wording:

    TERRA-Simulation @ 0334784
    studies/E7-canopy-light-interception/canopy.py

WHY THE TEXT IS NOT TRANSLATED. The prose here is not commentary on code, it is
the derivation: the radiation convention, why uniform-in-volume equals
uniform-in-leaf-area, and what each limit case proves. Re-expressing a
derivation in another language is rewriting an argument, and a shift in meaning
would not be visible to any test. The equivalence that IS checked is numeric --
sidecar/tests/test_canopy.py asserts the same limit cases the origin asserts,
so a copy that drifted would fail rather than merely read differently.

WHAT THIS IS FOR. `path_lengths` is a closed-form ray-ellipsoid intersection and
is what the annual-energy job integrates over; the four schemes are the ladder
that measures what a coarser canopy model costs. The interactive shading in the
front end is a different question and does not come through here -- see the
handoff's section 6.

Nothing here imports anything beyond numpy, which the sidecar already pins.
"""

import numpy as np

G_LEAF = 0.5           # coeficiente de projeção, distribuição esférica
PAR_FRACTION = 0.5     # fração PAR da irradiância de onda curta
PAR_UMOL_PER_W = 4.57  # umol fóton / J, no intervalo PAR


# ---------------------------------------------------------------------------
# Geometria
# ---------------------------------------------------------------------------

class Orchard:
    """Pomar em grade regular, copas elipsoidais de revolução.

    Linhas ao longo de y (norte-sul); `row_m` separa linhas em x (leste-oeste)
    e `tree_m` separa árvores dentro da linha.

    `lai_crown` é área foliar da copa dividida pela sua projeção horizontal,
    que é a grandeza que um levantamento de campo mede. A densidade de área
    foliar no volume sai daí e é uniforme -- ver limite 3 do protocolo.
    """

    def __init__(self, row_m=8.0, tree_m=5.0, radius_m=2.5, semi_height_m=1.75,
                 centre_z_m=2.5, lai_crown=4.0):
        self.row_m = row_m
        self.tree_m = tree_m
        self.a = radius_m
        self.b = semi_height_m
        self.cz = centre_z_m
        self.lai_crown = lai_crown

        self.leaf_area = lai_crown * np.pi * radius_m ** 2   # m2 por árvore
        volume = (4.0 / 3.0) * np.pi * radius_m ** 2 * semi_height_m
        self.u = self.leaf_area / volume                     # m2 folha / m3
        self.ground_per_tree = row_m * tree_m
        self.lai_ground = self.leaf_area / self.ground_per_tree
        self.cover = min(np.pi * radius_m ** 2 / self.ground_per_tree, 1.0)

    def centres(self, half=2):
        """Centros do bloco (2*half+1)^2 em torno da árvore amostrada.

        A árvore amostrada é a de índice central, na origem. O bloco existe
        porque a sombra que chega à copa central vem das vizinhas; recortar em
        uma única árvore é o esquema S3, não uma aproximação de S4.
        """
        k = np.arange(-half, half + 1)
        gx, gy = np.meshgrid(k * self.row_m, k * self.tree_m, indexing="ij")
        return np.stack([gx.ravel(), gy.ravel(), np.full(gx.size, self.cz)], axis=1)

    def sample_points(self, n, rng):
        """Pontos uniformes no volume da copa central.

        Uniforme no volume equivale a uniforme na área foliar porque a
        densidade é uniforme. Sorteio na esfera unitária por rejeição e
        depois escala -- escalar um sorteio uniforme no cubo não daria
        uniforme no elipsoide.
        """
        out = np.empty((n, 3))
        filled = 0
        while filled < n:
            q = rng.uniform(-1.0, 1.0, size=(2 * (n - filled) + 32, 3))
            q = q[np.einsum("ij,ij->i", q, q) <= 1.0]
            take = min(len(q), n - filled)
            out[filled:filled + take] = q[:take]
            filled += take
        out *= np.array([self.a, self.a, self.b])
        out[:, 2] += self.cz
        return out


def path_lengths(origins, direction, centres, a, b):
    """Comprimento percorrido por cada raio dentro de cada elipsoide.

    origins (N,3), direction (3,) unitário, centres (M,3)  ->  (N,M) em metros.

    Só conta o segmento à frente do ponto. Um ponto dentro da própria copa tem
    a raiz de entrada negativa, que é recortada em zero: o que sobra é o
    caminho do ponto até a saída, ou seja, o auto-sombreamento.
    """
    scale = np.array([a, a, b])
    e = direction / scale
    q = (origins[:, None, :] - centres[None, :, :]) / scale

    qa = float(e @ e)
    qb = 2.0 * (q @ e)
    qc = np.einsum("nmk,nmk->nm", q, q) - 1.0

    disc = qb * qb - 4.0 * qa * qc
    hit = disc > 0.0
    root = np.sqrt(np.where(hit, disc, 0.0))
    t_in = np.maximum((-qb - root) / (2.0 * qa), 0.0)
    t_out = np.maximum((-qb + root) / (2.0 * qa), 0.0)
    return np.where(hit, t_out - t_in, 0.0)


# ---------------------------------------------------------------------------
# Céu
# ---------------------------------------------------------------------------

def sky_directions(n_zenith=9, n_azimuth=12):
    """Discretização do hemisfério em ângulo sólido uniforme.

    Retorna dirs (K,3) unitários, cos_z (K,) e w (K,), onde w é a fração da
    DHI que a direção traz, sob céu isotrópico.

    A escolha de uniformizar em cos(z), e não em sen^2(z), é numérica e não
    estética. O absorvido por área foliar carrega 1/cos(z) -- converte
    irradiância horizontal em normal ao feixe -- e em sen^2(z) o integrando
    fica singular no horizonte: com 9 anéis, a soma que deve dar 2 dava 1,80,
    e o difuso saía 10% baixo em TODOS os esquemas de uma vez, o que é
    justamente o erro que uma comparação entre esquemas não revelaria.

    Em ângulo sólido uniforme as duas normalizações fecham exatamente, por
    construção: w_j = 2cos(z_j)/K, logo soma(w) = 1 e soma(w/cos) = 2.
    """
    mu = (np.arange(n_zenith) + 0.5) / n_zenith          # cos(z), ponto médio
    azi = (np.arange(n_azimuth) + 0.5) * 2.0 * np.pi / n_azimuth

    m, a = np.meshgrid(mu, azi, indexing="ij")
    m, a = m.ravel(), a.ravel()
    s = np.sqrt(1.0 - m ** 2)
    dirs = np.stack([s * np.sin(a), s * np.cos(a), m], axis=1)
    w = 2.0 * m / m.size
    return dirs, m, w


def sun_vector(zenith_deg, azimuth_deg):
    """Vetor unitário do ponto PARA o sol. x leste, y norte, azimute do norte."""
    z = np.radians(zenith_deg)
    a = np.radians(azimuth_deg)
    return np.stack([np.sin(z) * np.sin(a), np.sin(z) * np.cos(a), np.cos(z)], axis=-1)


# ---------------------------------------------------------------------------
# Fotossíntese
# ---------------------------------------------------------------------------

def assimilation(par_umol, alpha=0.05, amax=12.0):
    """Hipérbole retangular, por unidade de área foliar. umol CO2 m-2 s-1.

    `amax=None` remove a saturação e torna a resposta linear. É o controle
    declarado no protocolo: sem saturação, o degrau de distribuição entre
    esquemas tem de desaparecer, porque só o total absorvido pode diferir.
    """
    if amax is None:
        return alpha * par_umol
    return alpha * par_umol * amax / (alpha * par_umol + amax)


def to_par(w_per_m2):
    return w_per_m2 * PAR_FRACTION * PAR_UMOL_PER_W


# ---------------------------------------------------------------------------
# Transmitâncias
# ---------------------------------------------------------------------------

def diffuse_transmittance(orch, points, sky_dirs, half=2, own_only=False):
    """Transmitância difusa por ponto e direção de céu. (N,K).

    Não depende da posição do sol, portanto é calculada uma vez por geometria
    e reusada em todas as horas do ano. É o que torna a varredura viável.
    """
    centres = orch.centres(half=half)
    if own_only:
        centres = centres[len(centres) // 2:len(centres) // 2 + 1]

    tau = np.empty((len(points), len(sky_dirs)))
    for j, d in enumerate(sky_dirs):
        L = path_lengths(points, d, centres, orch.a, orch.b).sum(axis=1)
        tau[:, j] = np.exp(-G_LEAF * orch.u * L)
    return tau


def beam_transmittance(orch, points, sun_dirs, half=2, own_only=False):
    """Transmitância do feixe por ponto e posição solar. (N,H)."""
    centres = orch.centres(half=half)
    if own_only:
        centres = centres[len(centres) // 2:len(centres) // 2 + 1]

    tau = np.empty((len(points), len(sun_dirs)))
    for h, d in enumerate(sun_dirs):
        L = path_lengths(points, d, centres, orch.a, orch.b).sum(axis=1)
        tau[:, h] = np.exp(-G_LEAF * orch.u * L)
    return tau


# ---------------------------------------------------------------------------
# Os quatro esquemas
# ---------------------------------------------------------------------------
#
# Todos devolvem assimilação por área de terreno, umol CO2 m-2(solo) s-1, num
# vetor por hora. A área foliar por área de terreno é `lai_ground` nos quatro.

def scheme_s1_bigleaf(orch, dni, dhi, cos_sun, sky_cos, sky_w, alpha, amax):
    """Big-leaf: Beer-Lambert para o total, irradiância MÉDIA por folha.

    É o que um modelo de cultura faz quando converte fAPAR em assimilação com
    uma resposta única. Toda a estrutura do dossel entra só pelo LAI.
    """
    lai = orch.lai_ground
    lit = cos_sun > 0.0

    abs_beam = np.where(lit, dni * cos_sun * (1.0 - np.exp(
        -G_LEAF * lai / np.where(lit, cos_sun, 1.0))), 0.0)
    frac_diff = float((sky_w * (1.0 - np.exp(-G_LEAF * lai / sky_cos))).sum())
    abs_total = abs_beam + dhi * frac_diff          # W m-2 de solo

    par_mean = to_par(abs_total / lai)              # por unidade de área foliar
    return assimilation(par_mean, alpha, amax) * lai, abs_total


def scheme_s2_layers(orch, dni, dhi, cos_sun, sky_cos, sky_w, alpha, amax,
                     n_layers=40):
    """Dossel homogêneo resolvido em profundidade de LAI.

    Mesma geometria implícita do S1; a diferença é que a resposta saturante é
    aplicada camada a camada, e não à média.
    """
    lai = orch.lai_ground
    edges = (np.arange(n_layers) + 0.5) / n_layers * lai      # (L,)
    dl = lai / n_layers
    lit = cos_sun > 0.0

    # (L,H) feixe e (L,) difuso: por unidade de área foliar.
    kb = G_LEAF / np.where(lit, cos_sun, 1.0)
    i_beam = G_LEAF * dni[None, :] * np.exp(-edges[:, None] * kb[None, :])
    i_beam = np.where(lit[None, :], i_beam, 0.0)

    tau_d = np.exp(-G_LEAF * edges[:, None] / sky_cos[None, :])       # (L,K)
    i_diff_unit = (tau_d * (sky_w / sky_cos)[None, :]).sum(axis=1)    # (L,)
    i_diff = G_LEAF * dhi[None, :] * i_diff_unit[:, None]             # (L,H)

    a = assimilation(to_par(i_beam + i_diff), alpha, amax)
    absorbed = ((i_beam + i_diff) * dl).sum(axis=0)
    return a.sum(axis=0) * dl, absorbed


def scheme_traced(orch, tau_beam, tau_diff, dni, dhi, cos_sun,
                  sky_cos, sky_w, alpha, amax):
    """S3 e S4: idênticos exceto pelas transmitâncias que recebem.

    S3 recebe transmitâncias calculadas só contra a própria copa; S4, contra o
    bloco de vizinhas. Nenhuma outra diferença -- que é a condição para o
    degrau S3->S4 medir sombreamento entre árvores e mais nada.
    """
    lit = cos_sun > 0.0
    i_beam = G_LEAF * tau_beam * np.where(lit, dni, 0.0)[None, :]      # (N,H)
    unit_diff = G_LEAF * (tau_diff * (sky_w / sky_cos)[None, :]).sum(axis=1)
    i_diff = unit_diff[:, None] * dhi[None, :]                          # (N,H)

    i_leaf = i_beam + i_diff
    a = assimilation(to_par(i_leaf), alpha, amax)
    return a.mean(axis=0) * orch.lai_ground, i_leaf.mean(axis=0) * orch.lai_ground


def redistribute(absorbed_total, lai, alpha, amax):
    """Esquema intermediário: total absorvido de um esquema, distribuição do S1.

    Serve à decomposição do protocolo. A diferença entre um esquema e o seu
    redistribuído é atribuível só à distribuição da luz pela área foliar; a
    diferença entre dois redistribuídos, só ao total absorvido.
    """
    return assimilation(to_par(absorbed_total / lai), alpha, amax) * lai


# ---------------------------------------------------------------------------
# Verificações internas
# ---------------------------------------------------------------------------

def self_check(tol=2e-3):
    """Os dois casos-limite da convenção de radiação, e o caminho ótico.

    Falha aqui invalida tudo que vem depois, e é barata o bastante para rodar
    no início do notebook em vez de ficar num teste que ninguém executa.
    """
    out = {}

    # 1. Céu isotrópico sem dossel: absorvido por área foliar = DHI.
    _, cz, w = sky_directions()
    got = G_LEAF * float((w / cz).sum())
    out["difuso_sem_dossel"] = (got, 1.0, abs(got - 1.0) < tol)

    # 2. Dossel homogêneo, feixe: a integral em profundidade tem de reproduzir
    #    Beer-Lambert  DNI*cos(z)*(1 - exp(-G*LAI/cos z)).
    lai, cosz, n = 3.0, 0.8, 4000
    ell = (np.arange(n) + 0.5) / n * lai
    integral = (G_LEAF * np.exp(-G_LEAF * ell / cosz)).sum() * (lai / n)
    exact = cosz * (1.0 - np.exp(-G_LEAF * lai / cosz))
    out["beer_lambert"] = (integral, exact, abs(integral - exact) < tol)

    # 3. Caminho ótico: raio vertical pelo centro de uma esfera de raio r
    #    percorre 2r; um raio que passa fora não intercepta.
    c = np.array([[0.0, 0.0, 10.0]])
    up = np.array([0.0, 0.0, 1.0])
    through = float(path_lengths(np.array([[0.0, 0.0, 0.0]]), up, c, 2.0, 2.0)[0, 0])
    beside = float(path_lengths(np.array([[9.0, 0.0, 0.0]]), up, c, 2.0, 2.0)[0, 0])
    out["corda_central"] = (through, 4.0, abs(through - 4.0) < tol)
    out["raio_externo"] = (beside, 0.0, beside == 0.0)

    # 4. Ponto no centro da copa: metade da corda, que é o auto-sombreamento.
    inside = float(path_lengths(np.array([[0.0, 0.0, 10.0]]), up, c, 2.0, 2.0)[0, 0])
    out["auto_sombreamento"] = (inside, 2.0, abs(inside - 2.0) < tol)

    return out


if __name__ == "__main__":
    for k, (got, want, ok) in self_check().items():
        print(f"{'ok ' if ok else 'FALHA'} {k:22s} {got:.6f}  esperado {want:.6f}")
