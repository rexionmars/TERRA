# Privacy

TERRA is a desktop application. It runs on your computer, and there is no TERRA
server: the project that makes TERRA receives nothing from the application. What
TERRA keeps stays on your computer, and what it sends goes from your computer to
the public data services listed below, only when you use a feature that needs
one.

This page was written from the source code. A change to what TERRA stores or
sends changes this page in the same commit.

## What TERRA keeps on your computer

Everything below is in TERRA's data directory: `~/Library/Application
Support/terra` on macOS, `%AppData%\terra` on Windows and `~/.config/terra` on
Linux. The directory and the settings file in it can be read by your user
account only.

| What | Where | Notes |
|---|---|---|
| Local accounts: email, display name, password, sessions | `geosense.db` (SQLite) | Accounts are optional; a local guest needs none. The password is stored as a bcrypt hash, never as text. |
| Profile picture, cover and institution badge | Beside the database | Only those you add. |
| Preferences, projects, areas of interest, saved runs and workflows | `geosense.db`, with each run's maps and tables beside it | Areas are the polygons you draw, import or choose. |
| Settings of the installation | `config.json` | The Python interpreter and the imagery source chosen. |
| NASA Earthdata token | The system's credential store: the macOS Keychain, the Windows Credential Manager or the Linux Secret Service | Kept in `config.json` only on a system with no credential store, and the Settings screen says which. It is never shown back, never written to a run and never sent to the Python process in the request. |
| The Python environment TERRA builds | `python-env` | Excluded from Time Machine. |

**Backups.** Settings › Data writes a backup file where you choose. It carries
the database and the runs' files, without password hashes and session tokens,
and it does not include `config.json` or the Earthdata token. It leaves your
computer only if you move it.

**Deleting.** Projects, areas and runs are deleted from the application. There
is no command that deletes an account; deleting the data directory removes
everything TERRA keeps, and the Earthdata token is removed with Clear in
Settings › System.

## What leaves your computer, and to whom

Each request below is made by your computer, so the service also sees your IP
address and the time of the request, as with any request on the internet. Each
service's own terms and privacy policy apply to what it receives.

| Service | Hosts | When | What it receives |
|---|---|---|---|
| Satellite imagery catalogue, Sentinel-2 and Sentinel-1 | Microsoft Planetary Computer: `planetarycomputer.microsoft.com` and its storage at `*.blob.core.windows.net`. Element 84 Earth Search, if chosen: `earth-search.aws.element84.com` and its storage at `*.s3.us-west-2.amazonaws.com`. NASA OPERA, if chosen for Sentinel-1: `cmr.earthdata.nasa.gov`, `cumulus.asf.earthdatacloud.nasa.gov`, and the storage it redirects to at `*.cloudfront.net` | A run that reads imagery: classification, water, fields, vegetation health, zones, trajectory, radar, composites | The bounding box of the area and the period; then the parts of the image files that cover the area. NASA also receives the Earthdata token. |
| NASA Earthdata, EMIT | `cmr.earthdata.nasa.gov`, `opendap.earthdata.nasa.gov`, `data.lpdaac.earthdatacloud.nasa.gov`, `urs.earthdata.nasa.gov` | The mineral map, and saving a token | The bounding box of the area, the period and the Earthdata token. |
| MapBiomas | `storage.googleapis.com` | A classification over an area in Brazil | The part of the land-cover map that covers the area. |
| ESA Climate Change Initiative, biomass | `dap.ceda.ac.uk` | The biomass map | The map tiles that cover the area. |
| INPE Brazil Data Cube, CBERS-4A | `data.inpe.br` | Listing or drawing a CBERS-4A composition | The bounding box of the area and the period; then the parts of each scene's image file that cover the area, read coarsely for every scene listed and at full resolution for the one drawn. |
| Brazilian public registers | `geoserver.car.gov.br`, `geoserver.funai.gov.br`, `terrabrasilis.dpi.inpe.br`, `pamgia.ibama.gov.br`, `geoservicos.inde.gov.br` | The public-register overlap | The bounding box of the area. |
| IBGE boundaries | `servicodados.ibge.gov.br` | Choosing a state or municipality as an area | A request for the list of states or municipalities, and the code of the boundary chosen. |
| Place search | `nominatim.openstreetmap.org` | Searching for a place on the map | The text typed. |
| Basemaps | EOX: `tiles.maps.eox.at`. Esri, if chosen: `server.arcgisonline.com`, `services.arcgisonline.com`. The recent Sentinel-2 mosaic, if switched on: `planetarycomputer.microsoft.com` | Looking at the map | The map tiles on screen, which show the region and the zoom being looked at. With Esri's imagery, also the centre of the map, to ask the date of the picture there. |
| Relief | `elevation-tiles-prod.s3.amazonaws.com` | Relief switched on | The elevation tiles on screen. |
| Model catalogue and packages | `raw.githubusercontent.com`, `github.com` | Opening Models, installing a model, the first field delineation | Nothing beyond the request for the file. |
| Python packages | `pypi.org`, `files.pythonhosted.org` | Building or repairing the Python environment, installing an optional component | The names and versions of the packages. |

Links on the Help, Feedback, User guide, Sponsor and source buttons open in your
web browser. TERRA hands the address to the browser and sends nothing itself.

## What TERRA does not do

- It sends no telemetry, usage statistics or crash reports. The source contains
  no analytics or reporting code of any kind.
- It has no online account and no server of its own. A local account exists only
  in the database on your computer.
- It does not read or upload files you have not chosen. A KML, GeoJSON or
  project file is read when you open it.
- It does not keep the personal data some public registers publish. The IBAMA
  and ICMBio embargo layers carry the name and the CPF or CNPJ of whoever was
  embargoed, and the name of the property; those fields are dropped as the
  register is read, so they are never written to disk or shown.

## Personal data and the law

TERRA's developer receives no personal data from the application, and so is not
a controller of what TERRA keeps on your computer. If you use TERRA on
information about other people, you decide what it holds and where it goes, and
the data protection law that applies to you, such as Brazil's LGPD (Lei
13.709/2018), applies to that use.

Areas of interest are locations. An area drawn around someone's property, or a
report that names its owner, is personal data in your hands; see
[docs/RESPONSIBLE_USE.md](docs/RESPONSIBLE_USE.md) for what the application's
results do and do not establish.

## Contact

Questions about this page: [joao_leonardi.melo@somosicev.com](mailto:joao_leonardi.melo@somosicev.com),
or an issue at [github.com/rexionmars/TERRA/issues](https://github.com/rexionmars/TERRA/issues).
