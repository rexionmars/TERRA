"""
The public registers, and how each is asked for the features under a box.

Two protocols serve them. The INPE, SFB, FUNAI and MMA registers are GeoServer
WFS 2.0 endpoints that answer GeoJSON; the embargoes are an ArcGIS
FeatureServer at IBAMA. Every request asks for the features whose geometry
meets the area's bounding box, and the exact intersection is taken here: a box
is one URL parameter every server honours, while a polygon filter is a vendor
extension some of them refuse.

Each register is a `Source`: where it is, which layer, and how one of its
features becomes a row. Only the attributes a row needs are kept. The embargo
layers also publish the name and the CPF/CNPJ of whoever was embargoed; they
are dropped at the reader, so they are never written to disk or shown.

Endpoints and layer names were read from each server's GetCapabilities on
2026-09-26. A layer renamed upstream is reported as that register failing, not
as the area having no overlap with it.
"""

from __future__ import annotations

import ssl
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

import requests
from requests.adapters import HTTPAdapter

Bbox = tuple[float, float, float, float]  # lon_min, lat_min, lon_max, lat_max

TERRABRASILIS = 'https://terrabrasilis.dpi.inpe.br/geoserver/ows'
SICAR = 'https://geoserver.car.gov.br/geoserver/sicar/wfs'
FUNAI = 'https://geoserver.funai.gov.br/geoserver/Funai/ows'
MMA = 'https://geoservicos.inde.gov.br/geoserver/MMA/ows'
IBAMA_ARCGIS = 'https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases'

# FUNAI's server answers 403 to a request that names no client; any name will
# do, and this one says what is asking.
USER_AGENT = 'TERRA/1.0 (socio-environmental overlap)'
TIMEOUT_S = 90
# Features asked for per page, and the most read from one register. A cap
# reached is reported with the register, since the rows past it are unread.
PAGE = 2000
MAX_FEATURES = 20000

# PRODES yearly deforestation, one layer per biome, by the name
# prodes-brasil-nb:biomas_brasil gives the biome.
PRODES_LAYERS: dict[str, str] = {
    'Amazônia': 'prodes-amazon-nb:yearly_deforestation_biome',
    'Cerrado': 'prodes-cerrado-nb:yearly_deforestation',
    'Caatinga': 'prodes-caatinga-nb:yearly_deforestation',
    'Mata Atlântica': 'prodes-mata-atlantica-nb:yearly_deforestation',
    'Pampa': 'prodes-pampa-nb:yearly_deforestation',
    'Pantanal': 'prodes-pantanal-nb:yearly_deforestation',
}
BIOME_LAYER = 'prodes-brasil-nb:biomas_brasil'
# DETER monitors two biomes; elsewhere it is not an absence of alerts.
DETER_LAYERS: dict[str, str] = {
    'Amazônia': 'deter-amz:deter_amz',
    'Cerrado': 'deter-cerrado-nb:deter_cerrado',
}
FUNAI_LAYER = 'Funai:tis_poligonais'
# The March 2026 CNUC release. MMA also serves a corrected copy of it,
# cnuc_2026_03_atualizado, whose attribute names were loaded as the values of
# columns n1..n32 (read on 2026-09-26): its features carry no name, category or
# code, so it is not the layer read.
CNUC_LAYER = 'MMA:cnuc_2026_03'
IBAMA_EMBARGO = 'adm_embargos_ibama_a'
ICMBIO_EMBARGO = 'adm_embargo_icmbio_a'

# The bounding box of each state, from the IBGE state meshes (API v3 malhas,
# intermediate quality), read on 2026-09-26. SICAR publishes one layer per
# state; an area is looked up in the layers of every state whose box it meets,
# so a border area reads both sides.
STATE_BOXES: dict[str, Bbox] = {
    'ac': (-73.990, -11.146, -66.627, -7.112),
    'al': (-38.238, -10.499, -35.153, -8.821),
    'am': (-73.802, -9.818, -56.098, 2.244),
    'ap': (-54.875, -1.236, -49.876, 4.509),
    'ba': (-46.577, -18.337, -37.341, -8.533),
    'ce': (-41.414, -7.846, -37.253, -2.784),
    'df': (-48.282, -16.050, -47.309, -15.502),
    'es': (-41.875, -21.301, -39.668, -17.894),
    'go': (-53.248, -19.498, -45.907, -12.395),
    'ma': (-48.755, -10.251, -41.797, -1.052),
    'mg': (-51.046, -22.923, -39.857, -14.247),
    'ms': (-58.166, -24.068, -50.924, -17.171),
    'mt': (-61.628, -18.042, -50.225, -7.352),
    'pa': (-58.896, -9.841, -46.063, 2.591),
    'pb': (-38.765, -8.303, -34.793, -6.028),
    'pe': (-41.358, -9.483, -32.408, -3.845),
    'pi': (-46.028, -10.929, -40.370, -2.757),
    'pr': (-54.619, -26.717, -48.023, -22.516),
    'rj': (-44.889, -23.368, -40.961, -20.766),
    'rn': (-38.582, -6.975, -34.968, -4.831),
    'ro': (-66.810, -13.693, -59.779, -7.976),
    'rr': (-64.822, -1.579, -58.895, 5.272),
    'rs': (-57.594, -33.744, -49.703, -27.084),
    'sc': (-53.837, -29.355, -48.374, -25.977),
    'se': (-38.238, -11.562, -36.396, -9.515),
    'sp': (-53.108, -25.309, -44.166, -19.780),
    'to': (-50.742, -13.468, -45.699, -5.168),
}

CAR_STATUS = {'AT': 'active', 'PE': 'pending', 'SU': 'suspended', 'CA': 'cancelled'}
CAR_TYPE = {
    'IRU': 'rural property',
    'AST': 'agrarian reform settlement',
    'PCT': 'traditional peoples and communities',
}


class SourceError(RuntimeError):
    """A register that could not be read: a server down, a layer renamed."""


@dataclass
class Row:
    """
    One feature of a register, as the product reports it.

    `ref` identifies the feature in its register (a CAR code, an embargo term,
    a CNUC code), so a reader can look it up at the source.
    """

    ref: str
    name: str
    date: str
    year: int
    category: str
    status: str
    detail: str
    feature_ha: float | None


def boxes_meet(a: Bbox, b: Bbox) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def states_for(bbox: Bbox) -> list[str]:
    """The states whose box the area's box meets, in alphabetical order."""
    return [uf for uf, box in STATE_BOXES.items() if boxes_meet(bbox, box)]


def session():
    """One HTTP session for every register, under the client name FUNAI asks for."""
    s = requests.Session()
    s.headers['User-Agent'] = USER_AGENT
    s.mount(SICAR_HOST, _StaticRSAAdapter())
    return s


# SICAR's server negotiates one cipher suite, AES256-GCM-SHA384, whose key
# exchange is static RSA. Python's default list leaves out every suite without
# forward secrecy, so the handshake fails where curl, on OpenSSL's own default
# list, succeeds. The suite is added for that host alone; the certificate is
# verified as for every other host.
SICAR_HOST = 'https://geoserver.car.gov.br/'
SICAR_CIPHERS = (
    'ECDH+AESGCM:ECDH+CHACHA20:ECDH+AES:DHE+AES:!aNULL:!eNULL:!aDSS:!SHA1:!AESCCM:'
    'AES256-GCM-SHA384'
)


def _static_rsa_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.set_ciphers(SICAR_CIPHERS)
    return ctx


class _StaticRSAAdapter(HTTPAdapter):
    """An HTTPS adapter whose TLS context also offers SICAR's one suite."""

    def init_poolmanager(self, *args, **kwargs):
        kwargs['ssl_context'] = _static_rsa_context()
        return super().init_poolmanager(*args, **kwargs)

    def proxy_manager_for(self, *args, **kwargs):
        kwargs['ssl_context'] = _static_rsa_context()
        return super().proxy_manager_for(*args, **kwargs)


def _get_json(session, url: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        r = session.get(url, params=params, timeout=TIMEOUT_S)
    except requests.RequestException as e:
        raise SourceError(f'{url} did not answer ({type(e).__name__})') from e
    if r.status_code != 200:
        raise SourceError(f'{url} answered HTTP {r.status_code}')
    try:
        body = r.json()
    except ValueError as e:
        # GeoServer reports a bad layer name as an XML exception with status 200.
        raise SourceError(f'{url} answered something other than JSON: {r.text[:160]!r}') from e
    if isinstance(body, dict) and 'error' in body:
        raise SourceError(f'{url} answered an error: {body["error"]}')
    return body


def wfs_features(
    session,
    url: str,
    layer: str,
    bbox: Bbox,
    properties: list[str] | None = None,
    sort_by: str | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """
    Every feature of a WFS layer whose geometry meets `bbox`, page by page.

    Returns the features and whether MAX_FEATURES stopped the reading. The box
    is sent with the lat/lon axis order EPSG:4326 has under its URN, and the
    features are asked for under the short name, which GeoServer answers in
    lon/lat.

    A page past the first needs an order to be taken from. GeoServer supplies
    one from the primary key where the layer has one; FUNAI's has none and
    refuses the request, so its layer is read with `sort_by` named.
    """
    lon0, lat0, lon1, lat1 = bbox
    out: list[dict[str, Any]] = []
    start = 0
    while True:
        params: dict[str, Any] = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetFeature',
            'typeNames': layer,
            'outputFormat': 'application/json',
            'srsName': 'EPSG:4326',
            'bbox': f'{lat0},{lon0},{lat1},{lon1},urn:ogc:def:crs:EPSG::4326',
            'count': PAGE,
        }
        if start:
            params['startIndex'] = start
        if sort_by:
            params['sortBy'] = sort_by
        if properties is not None:
            params['propertyName'] = ','.join(properties)
        body = _get_json(session, url, params)
        page = body.get('features') or []
        out.extend(page)
        if len(page) < PAGE:
            return out, False
        if len(out) >= MAX_FEATURES:
            return out, True
        start += PAGE


def arcgis_features(session, service: str, bbox: Bbox) -> tuple[list[dict[str, Any]], bool]:
    """Every feature of an ArcGIS FeatureServer layer meeting `bbox`, page by page."""
    url = f'{IBAMA_ARCGIS}/{service}/FeatureServer/0/query'
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        body = _get_json(
            session,
            url,
            {
                'where': '1=1',
                'geometry': ','.join(f'{v}' for v in bbox),
                'geometryType': 'esriGeometryEnvelope',
                'inSR': 4326,
                'spatialRel': 'esriSpatialRelIntersects',
                'outFields': '*',
                'outSR': 4326,
                'orderByFields': 'objectid',
                'resultOffset': offset,
                'resultRecordCount': PAGE,
                'f': 'geojson',
            },
        )
        page = body.get('features') or []
        out.extend(page)
        more = bool(body.get('exceededTransferLimit') or (body.get('properties') or {}).get('exceededTransferLimit'))
        if not more or not page:
            return out, False
        if len(out) >= MAX_FEATURES:
            return out, True
        offset += len(page)


def biomes_under(session, bbox: Bbox) -> list[str]:
    """The biomes whose limits meet the box; attributes only, not the outlines."""
    feats, _ = wfs_features(session, TERRABRASILIS, BIOME_LAYER, bbox, properties=['bioma'])
    return sorted({str(f['properties'].get('bioma')) for f in feats if f.get('properties')})


# --- Rows ------------------------------------------------------------------


def _text(v: Any) -> str:
    return '' if v is None else str(v).strip()


def _number(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x


def _epoch_ms(v: Any) -> str:
    """An ArcGIS date (milliseconds since 1970, UTC) as YYYY-MM-DD, or ''."""
    x = _number(v)
    if x is None:
        return ''
    return datetime.fromtimestamp(x / 1000, tz=UTC).date().isoformat()


def _dmy(v: Any) -> str:
    """'14-11-2024' or '14/11/2024' as 2024-11-14, or '' where it is neither."""
    s = _text(v).replace('/', '-')
    parts = s.split('-')
    if len(parts) == 3 and len(parts[2]) == 4:
        try:
            return date(int(parts[2]), int(parts[1]), int(parts[0])).isoformat()
        except ValueError:
            return ''
    return ''


def _km2_to_ha(v: Any) -> float | None:
    x = _number(v)
    return None if x is None else x * 100.0


def prodes_row(p: dict[str, Any]) -> Row:
    year = int(_number(p.get('year')) or 0)
    return Row(
        ref=_text(p.get('uuid') or p.get('fid')),
        name=f'PRODES {year}' if year else 'PRODES',
        date=_text(p.get('image_date')),
        year=year,
        category=_text(p.get('main_class')).lower(),
        status='',
        detail=' '.join(x for x in (_text(p.get('satellite')), _text(p.get('sensor'))) if x),
        feature_ha=_km2_to_ha(p.get('area_km')),
    )


def deter_row(p: dict[str, Any]) -> Row:
    d = _text(p.get('view_date'))
    return Row(
        ref=_text(p.get('gid')),
        name=_text(p.get('classname')),
        date=d,
        year=int(d[:4]) if d[:4].isdigit() else 0,
        category=_text(p.get('classname')).lower(),
        status='',
        detail=' '.join(x for x in (_text(p.get('satellite')), _text(p.get('sensor'))) if x),
        feature_ha=_km2_to_ha(p.get('areatotalkm') if p.get('areatotalkm') is not None else p.get('areamunkm')),
    )


def car_row(p: dict[str, Any]) -> Row:
    created = _text(p.get('dat_criacao'))[:10]
    return Row(
        ref=_text(p.get('cod_imovel')),
        name=f'{_text(p.get("municipio"))} ({_text(p.get("uf"))})',
        date=created,
        year=int(created[:4]) if created[:4].isdigit() else 0,
        category=CAR_TYPE.get(_text(p.get('tipo_imovel')), _text(p.get('tipo_imovel'))),
        status=CAR_STATUS.get(_text(p.get('status_imovel')), _text(p.get('status_imovel'))),
        detail=_text(p.get('condicao')),
        feature_ha=_number(p.get('area')),
    )


def ibama_embargo_row(p: dict[str, Any]) -> Row:
    # nome_embargado, cpf_cnpj_embargado and nome_imovel are not read.
    d = _epoch_ms(p.get('dat_embargo'))
    term = '-'.join(x for x in (_text(p.get('num_tad')), _text(p.get('serie_tad'))) if x)
    return Row(
        ref=f'TAD {term}' if term else _text(p.get('seq_tad')),
        name=f'{_text(p.get("municipio"))} ({_text(p.get("uf"))})',
        date=d,
        year=int(d[:4]) if d else 0,
        category=_text(p.get('tipo_area')).lower(),
        status='',
        detail=f'process {_text(p.get("num_processo"))}' if _text(p.get('num_processo')) else '',
        feature_ha=_number(p.get('qtd_area_embargada')),
    )


def icmbio_embargo_row(p: dict[str, Any]) -> Row:
    # autuado and cpf_cnpj are not read.
    d = _epoch_ms(p.get('data_auto'))
    notice = '-'.join(x for x in (_text(p.get('numero_ai')), _text(p.get('serie'))) if x)
    return Row(
        ref=f'AI {notice}' if notice else _text(p.get('vw_pk')),
        name=_text(p.get('nome_uc')),
        date=d,
        year=int(d[:4]) if d else 0,
        category=_text(p.get('tipo_infra')),
        status=_text(p.get('julgamento')),
        detail=f'process {_text(p.get("nr_process"))}' if _text(p.get('nr_process')) else '',
        feature_ha=None,
    )


def indigenous_row(p: dict[str, Any]) -> Row:
    return Row(
        ref=_text(p.get('terrai_codigo')),
        name=_text(p.get('terrai_nome')),
        date='',
        year=0,
        category=_text(p.get('modalidade_ti')),
        status=_text(p.get('fase_ti')),
        detail=_text(p.get('etnia_nome')),
        feature_ha=_number(p.get('superficie_perimetro_ha')),
    )


def conservation_row(p: dict[str, Any]) -> Row:
    created = _dmy(p.get('cria_ano'))
    group = _text(p.get('grupo'))
    category = _text(p.get('categoria'))
    return Row(
        ref=_text(p.get('cd_cnuc')),
        name=_text(p.get('nome_uc')),
        date=created,
        year=int(created[:4]) if created else 0,
        category=f'{group}: {category}' if group and category else group or category,
        status=_text(p.get('situacao')),
        detail=_text(p.get('esfera')).lower(),
        feature_ha=_number(p.get('ha_total')),
    )


@dataclass(frozen=True)
class Source:
    """One register: its id in the payload, its title, and how rows are made."""

    id: str
    title: str
    publisher: str
    row: Callable[[dict[str, Any]], Row]
