# Handoff — sessão de 9–10/08/2026

Contexto para retomar em outra conversa. Escrito para ser lido de cima para
baixo por quem não acompanhou a sessão.

**Repositórios envolvidos**

| Caminho | O que é |
|---|---|
| `~/estudos/UTFPr/TERRA-Simulation` | os estudos numéricos (este repo) |
| `~/estudos/UTFPr/geosense/geosense-infer` | a aplicação TERRA (Go + Wails + sidecar Python) |

---

## 1. O estado em uma tela

Trabalhamos em três frentes que convergiram:

1. **Linha de pesquisa** para o mestrado/doutorado — documento com 7 propostas
2. **Experimentos numéricos** sobre uma AOI real exportada do TERRA
3. **Auditoria** das features solares do TERRA em produção

O fio condutor: a AOI exportada é um **conjunto habitacional urbano em
Teresina/PI**, e a pergunta do usuário é se painéis solares ali teriam boa
efetividade. Isso expôs que a cadeia do TERRA é de **usina em terreno**, não de
**telhado**, e as duas medem coisas diferentes.

---

## 2. Entregáveis

### Linha de pesquisa — `docs/linha-pesquisa/`

| Arquivo | Conteúdo |
|---|---|
| `linha-de-pesquisa.tex` + `.pdf` | 12 páginas, compila limpo. 6 eixos, **7 propostas** com pergunta/hipótese/método/dados/falseamento |
| `referencias.bib` | 30 referências |
| `topicos-avancados-solar-ml.md` | 10 camadas técnicas, do material à decisão |
| `skills-para-cientista.md` | skills de Claude Code para trabalho científico |

**Recomendação registrada:** núcleo em **P2** (cobertura condicional de
intervalos em regimes de rampa) + **P4** (decompor o ganho da física por
ablação) + **P3** (previsibilidade e valor do curtailment no SIN), unidas pela
pergunta *"o que a estrutura conhecida do problema físico oferece a um modelo
estatístico que os dados sozinhos não oferecem?"*.

**Pendência:** referências de 2025–26 precisam de volume/página/DOI conferidos
no editor antes de citar. Vários DOIs foram montados a partir de metadados de
busca.

### Estudo — `studies/E-raster-resource-spatialisation/`

Cinco artefatos sobre a mesma AOI:

| Arquivo | O que responde |
|---|---|
| `E-raster.ipynb` | vale encaixado sintético a −25,4° — mede efeito de relevo onde ele existe |
| `E-raster-real.ipynb` | a AOI como **terreno** — mede o mesmo onde o relevo é suave |
| `E-rooftop.ipynb` | a AOI como **bairro** — telhado, não chão |
| `E-3d.ipynb` | modelo 3D em Plotly com ray-casting |
| `aoi-3d.html` | a mesma análise como página web |

Mais `E5-surrogate-validity-detection/` (detecção de perda de validade de
substituto).

**Página publicada:** https://claude.ai/code/artifact/9fad5e0f-c7f6-4c93-a1c8-5cdc0c94cdb8

---

## 3. Os números finais da AOI

Conjunto habitacional em Teresina/PI (−4,7734, −42,5749), AOI de 693 × 488 m.

| | Valor |
|---|---|
| Edificações na AOI | **519** (mais 495 no entorno, só sombreiam) |
| Capacidade instalável | **4464 kWp** |
| Geração | **6881 MWh/ano** |
| Rendimento | **1541 kWh/kWp** (93,5% do ideal de 1648) |
| Irradiação | 2143 kWh/m²/ano |
| Temperatura média | 32 °C |
| Fração difusa | 0,40 |

**Resposta à pergunta original: sim, o bairro é bom candidato para GD.** A folga
tem explicação local — a 4,8° do equador a curva de inclinação é quase plana e a
diferença norte/sul fica em ~3%. O mesmo bairro no Paraná teria dispersão maior.

**A regra "inclinação = latitude" não se aplica aqui:** pediria 5°, abaixo do
mínimo construtivo de ~10° para escoamento de água.

### Procedência dos dados

| Camada | Fonte | Natureza |
|---|---|---|
| AOI | export do TERRA (só `aoi.geojson`) | — |
| Contornos | **Overture Maps** (OSM + Google Open Buildings) | medido |
| Altura | GHSL ANBH 2018, ~100 m | medido, agregado |
| Relevo | Copernicus GLO-30 via OpenTopography (doi:10.5069/G9028PQB) | medido |
| Meteorologia | NASA POWER horário 2023 | medido |
| Inclinação/forma do telhado | tipologia (2 águas, 20°) | **suposto** |
| Fração aproveitável | 55% | **suposto** |
| Sombreamento | ray-casting exato (Rust) | calculado |

---

## 4. Cinco erros encontrados, e o que cada um ensina

Ordenados por quanto custaram.

### 4.1 Cobertura do OpenStreetMap — fator 6×

O OSM registrava **43** edificações no bairro; existem **~520**. As 42 mapeadas
estavam todas numa faixa de 60 m na borda norte; 87% da AOI estava vazia no dado.

**Como foi detectado:** o usuário mostrou a imagem de satélite (Esri, via TERRA).
Nada no fluxo acusava — o modelo rodava, os números eram coerentes entre si, as
verificações internas passavam.

**A assimetria que torna a falha invisível:** a **capacidade** muda por 6×; o
**rendimento por kWp** não muda (1546 → 1541), porque é propriedade do sítio e
não da contagem.

**Correção:** `fetch_buildings_overture.py`, via duckdb sobre
`s3://overturemaps-us-west-2/release/2026-07-22.0/theme=buildings/type=building/*`.
Das 1037 baixadas, 871 vêm do Google Open Buildings.

**Lição:** para AOI em região com mapeamento colaborativo irregular, confrontar
a fonte vetorial com imagem de satélite é etapa obrigatória, não conferência.

### 4.2 Sombreamento: telhado ≠ relevo — ~6% em energia

A aproximação de sombreamento descartava vizinhos com `dz <= 0` (mais baixos que
o ponto). **Correto para relevo** — de onde a rotina veio — e **errado para
telhado**: no telhado o observador está no topo do obstáculo, e a casa vizinha de
mesma altura ainda barra o sol rasante.

Medido contra ray-casting exato: erro mediano +2,2 pp, **p95 17,9 pp**,
superestimação de **+5,7%** em energia. A aproximação julgava 84 de 86 águas sem
sombra; o ray-casting encontrou sombra real em 53.

Naquele sítio, uma casa de 3,7 m a 8 m bloqueia o sol até 24,8°, e o sol abaixo
disso carrega ~22% do DNI anual.

**O SVF calculado dava 1,000** — céu totalmente aberto — nas mesmas águas onde
18% do DNI era barrado.

**Correção:** `build_3d_data.py` passou a usar o ray-caster como motor.

### 4.3 NASA POWER e hora solar local — meu erro, não do TERRA

O produto horário do POWER estampa em **hora solar local** por padrão. Lido como
UTC, o total anual fica correto mas a energia migra para a manhã, e telhados a
leste rendem ~2× os de oeste.

**O TERRA já trata isso corretamente** — passa `time-standard=UTC` na URL.
Verificado:

```
time-standard=UTC : corr(GHI, cos z) = 0.967   ← o TERRA
time-standard=LST : corr(GHI, cos z) = 0.550   ← o que eu fiz (omiti)
```

E o TERRA ainda trata o offset de meia hora (`HOUR_LABEL_OFFSET_MIN`), porque o
POWER rotula o fluxo médio pela hora inicial.

### 4.4 Janela de referência engolindo o evento (E5)

No experimento de detecção, a degradação começava antes do fim da janela que
calibra o limiar — o detector era proibido de disparar antes de o erro estourar.
Corrigido com `DEGRADATION_START_YEARS` e verificação executável.

### 4.5 Assimetria leste/oeste do modelo de Erbs — **em aberto**

O rendimento por água dá **leste 1765 vs oeste 1293 kWh/kWp** (36% de diferença).
Investigado:

- **GHI** manhã 16% maior que a tarde — **real** (convecção vespertina no Piauí)
- **DNI decomposto** manhã 153% maior — **artefato do Erbs**

`kt` de 0,71 pela manhã contra 0,44 à tarde vira fração direta de 0,76 contra
~0,45, porque a relação de Erbs é fortemente não-linear. Erbs é ajustado para
médias, não para o ciclo diurno de sítio convectivo.

**O que isso invalida:** só a comparação **por água isolada**. A média das duas
águas de uma casa continua correta (leste+oeste = 1529, norte+sul = 1566, batem),
e o agregado do bairro também.

**Correção pendente:** testar DIRINT/DISC em vez de Erbs, ou usar **PVGIS**, que
entrega DNI/DHI medidos por satélite geoestacionário sem decomposição.

---

## 5. Auditoria do TERRA — `geosense-infer/sidecar/`

Li `solar.py` (878 linhas), as partes densas de `energy.py` (1956), `wind.py`
(1152) e o lado Go.

### O que está correto e é mais rigoroso do que os experimentos

- **Perez (1990)** para transposição — contra o isotrópico que usei
- **`time-standard=UTC`** explícito, com offset de meia hora
- **Convenção de aspecto** verificada numericamente nas 4 direções: correta. E
  trata célula plana como `NaN`, não como 0° (que leria como voltada ao norte)
- **Horn (1981)** para declividade/aspecto, **Faiman** para temperatura,
  **IAM ASHRAE**, sweep de tilt 0–45° a 0,5°
- **Três PRs distintos** (modelado / derivado / aplicado) com proveniência.
  `_require_resolved` rejeita float nu na fronteira de cada produto
- **`loss_waterfall`** documenta cada limite no ponto onde ocorre, incluindo o
  viés de altura do vento (`u1` de Faiman calibrado a altura de módulo, cadeia
  entrega WS2M)
- **`FLAT_PLACEMENT_BIAS_PCT`** mede o custo da apresentação: 1476,20 contra
  1474,73 kWh/kWp/ano = 0,10%, conservador
- **`wind.py`** usa expoente de cisalhamento **bulk** e não horário, com a razão
  declarada: o horário amplifica as horas noturnas estáveis e infla o fator de
  capacidade sem justificativa física
- **Go não recomputa física** — orquestra, persiste, exporta.
  `export_parity_test.go` impede divergência Go ↔ TypeScript com mecanismo
  anti-silenciamento

### As lacunas confirmadas

**1. SVF ausente no difuso.** `shading_loss_fraction` remove só o feixe;
`beam_fraction` documenta: *"Shading removes beam energy only"*.

Medido no `E-raster.ipynb`: **−2,82%** em vale encaixado, **−0,04%** em planície.
O sombreamento de feixe, que é a parte cara de calcular, muda a mediana em
**−0,003%**.

> O horizonte já é calculado. Ignorar o SVF é pagar o custo caro (traçar o
> horizonte) e colher só o efeito pequeno (o feixe).

**Recomendação:** implementar o SVF **com um critério de quando se aplica** — o
próprio horizonte fornece o limiar. Aplicá-lo incondicionalmente gasta cálculo
onde o efeito é ruído.

**2. IAM difuso ausente.** Já declarado no passo 4 do waterfall como
simplificação conhecida. Registrado no README como estudo pendente.

**3. Sem tratamento de caso urbano/telhado.** Zero menções a `roof`, `building`
ou edificação em `solar.py` e `energy.py`. A cadeia é usina em terreno — GCR,
densidade por hectare, tracking.

> Aplicar a cadeia de usina a uma AOI urbana mede **o chão, não os telhados**.
> Sobre a AOI de Teresina ela dá SVF de 0,999 e conclui "sem sombreamento" —
> acertaria por acidente, porque o DEM não vê casa nenhuma.

### Não li

`infer.py`, `lulc.py`, `composite.py`, `prithvi.py`, o frontend, e o grosso de
`app.go`.

---

## 6. Achados sobre disponibilidade de dados

Relevantes para a premissa de que o catálogo precisa ser resolvido antes da
simulação.

### Não há LiDAR nem DSM de alta resolução para o Brasil

Catálogo do OpenTopography consultado para a AOI: `{"Datasets": []}`. A altura
**por casa** não se resolve com dado aberto — exige drone ou dado comercial. A
altura **do bairro** já temos (GHSL).

### A escolha do DEM não move o resultado

Quatro produtos sobre a mesma AOI (COP30, NASADEM, SRTMGL1, COP90): declividade
mediana varia de 1,27° a 2,08° — **48%** em termos relativos. Mas o efeito no
rendimento é de **1 kWh/kWp**. O que limita é a geometria das edificações, não a
resolução do terreno.

### Imagem de satélite pública para Teresina para em ~1,19 m/px

Esri World Imagery: z17 é o máximo real; z18+ retorna placeholder cinza. Isso dá
**44 pixels por casa** (casa mediana de 63 m² ≈ 7,9 m de lado).

Para distinguir 2 águas de 4 águas seria preciso ver cumeeira e espigões — ~20 px
por lado, ou **≈0,4 m/px**.

> **Reconstruir geometria de telhado por visão computacional nesta AOI, com
> imagem pública, não é possível.** Não é limitação de algoritmo, é de amostragem.

E o contorno não ajuda: testei a razão área/bounding-box das 519 casas — duas e
quatro águas cabem igualmente num retângulo.

---

## 7. Pendências, em ordem

1. **Revogar a chave do OpenTopography** (`140cc396…`) — foi exposta em texto no
   chat. Gerar outra em portal.opentopography.org → MyOpenTopo → API Key.
   Ela **não** está em nenhum arquivo do repo (verificado com grep); entra por
   `OPENTOPOGRAPHY_API_KEY`.
2. **Corrigir a decomposição direta/difusa** — testar DIRINT/DISC ou PVGIS contra
   Erbs. É o item 4.5, e afeta a leitura por água.
3. **Conferir DOIs** das referências de 2025–26 antes de citar.
4. **Escolher a linha de pesquisa** entre as sete. A skill
   `scientific-problem-selection` (Fischbach & Walsh, *Cell* 2024) foi instalada
   exatamente para isso.
5. **Experimento sobre forma do telhado** — três caminhos discutidos e não
   decididos: (a) quanto custa errar 2 águas vs 4 águas, (b) curva de resolução
   (qual m/px é o requisito), (c) tentar extrair o extraível de 1,19 m/px.
   O usuário pediu para pausar aqui e "formar melhor".

---

## 8. Convenções desta sessão

- **Experimentos rápidos** vão em notebook Jupyter gerado por um
  `build_notebook*.py` — editar o `.py`, nunca o `.ipynb`. Relatório em Markdown,
  não LaTeX/R.
- **Venv** em `.venv/` na raiz; kernel Jupyter registrado como `terra-sim`. O
  Python do sistema não tem as dependências.
- **Fusão de stacks por competência:** Rust para geometria e ray-casting
  (`raycaster/`, 102 M raios em 101 s), Python para cadeia solar e análise,
  Plotly para figura no notebook.
- Cada estudo declara **critério de falseamento antes de rodar** e verifica
  **condições de interpretabilidade** executáveis (ex.: "horizonte máximo < 15°
  significa sem cenário para medir, não sem efeito").

### Memórias gravadas

Em `~/.claude/projects/-Users-rexionmars-estudos-UTFPr-TERRA-Simulation/memory/`:

- `terra-svf-prioridade.md`
- `cobertura-osm-vs-overture.md`
- `sombreamento-telhado-vs-relevo.md`
- `nasa-power-hora-solar-local.md`
- `terra-simulation-formato-experimentos.md`

---

## 9. Reproduzir o estudo do zero

```sh
cd studies/E-raster-resource-spatialisation

export OPENTOPOGRAPHY_API_KEY=...          # opcional; sem ela cai no AWS

../../.venv/bin/python fetch_data.py               # DEM + NASA POWER
../../.venv/bin/python fetch_buildings_overture.py  # contornos
../../.venv/bin/python fetch_heights.py             # altura GHSL

cd raycaster && cargo build --release && cd ..      # ray-caster
../../.venv/bin/python build_3d_data.py             # cadeia solar -> aoi3d.json

../../.venv/bin/python build_notebook_3d.py
jupyter nbconvert --execute --inplace \
  --ExecutePreprocessor.kernel_name=terra-sim E-3d.ipynb
```

Validação do sombreamento: `../../.venv/bin/python validate_shading.py`
(o binário Rust é validado por 7 testes de geometria conhecida antes de uso).
