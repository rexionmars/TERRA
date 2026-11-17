# Responsible use

TERRA turns satellite imagery and public registers into maps and figures about a
piece of ground. Those results can be read as more than they are, and some of the
places it can be pointed at are the homes of people who did not ask to be
mapped. This page says what the results do not establish, where the risk of
misuse lies, and what the project commits to. [PRIVACY.md](../PRIVACY.md) covers
what the application stores and sends.

## Results that can be misread

Each product's limits are stated in the [README](../README.md#limitations) and
beside its result in the application. The ones most likely to be taken for a
finding:

| A result | Does not establish |
|---|---|
| An overlap with a public register | That anything was irregular. A clearing can be authorised and an embargo lifted after publication, and APP and legal-reserve polygons are not published by WFS and are not read. |
| A vegetation-health departure | A diagnosis. A later sowing, another crop or a fallow field departs from earlier seasons as a stressed one does. |
| A land-cover map | Field truth. The models emit a fixed legend of five classes, were fitted in western Paraná, and an area in another biome can return a confident and wrong answer; agreement is measured against MapBiomas, which is itself a map. |
| A canopy loss on the radar | A harvest. The thresholds are not calibrated against harvest records, and a lodged or desiccated canopy reads the same way. |
| Management zones | Why a part of a field differed. Soil, drainage, compaction or a past management line draw the same boundary. |
| A mineral class | An abundance. No unmixing is done, and over vegetated ground the identified area is a small part of the area asked about. |
| An area in hectares | A measured area. It is a count of pixels, uncorrected for classification error. |

A report built from these results carries the same limits. Using one as evidence
against a person, a community or a property owner, without the checks on the
ground those limits call for, is a misuse of the result.

## The mineral map and prospecting

Imaging spectroscopy is a recognised tool in mineral exploration. The clays,
micas and iron oxides that form around some ore bodies have absorption features
in the range EMIT measures, and geologists map them from orbit. The mineral map
is a map of that kind, so the risk that it helps someone look for ore is not
zero.

For the use that matters most where TERRA was made, illegal gold mining in the
Amazon, the risk is low, for three reasons:

- Gold itself has no absorption feature in the 0.4 to 2.5 µm range EMIT
  measures, and the illegal mining in the Amazon works mostly alluvial gold in
  river sediments, which is found by sampling the sediment, not by its spectrum.
- The map answers only where the ground is bare. At 60 m and with no unmixing,
  forest and water hide it, which over the Amazon is almost everywhere.
- The pits and tailings a map could show are already visible in ordinary
  true-colour imagery and in public monitoring such as Amazon Mining Watch and
  INPE's DETER.

The project will revisit this if the mineral map gains a capability these
reasons do not cover, such as unmixing or a finer sensor.

## Indigenous lands and peoples

The public-register overlap reads FUNAI's polygons of Indigenous lands
(`tis_poligonais`) and INPE's PRODES and DETER deforestation records, to say
whether an area meets them. TERRA reads no village or settlement location, and
holds none.

The project commits to the following, in the application and in any product
built on it:

- **No village or settlement locations are published.** A product that needs
  where people live inside an Indigenous land, or near one, gets it from the
  community or its representative organisation, with their consent, and does not
  publish it.
- **Isolated peoples are not located.** FUNAI restricts information on the
  presence of isolated and recently contacted peoples, as part of its policy of
  no contact. TERRA will not derive, display or export anything that would
  indicate where they are.
- **The CARE principles apply** to any product that crosses data about
  Indigenous communities, or about schools and children, with what TERRA
  computes: Collective benefit, Authority to control, Responsibility and Ethics
  (Global Indigenous Data Alliance, 2019). Such a product is designed with the
  people it describes, states who controls the data, and publishes nothing that
  identifies a community, a school or a child without consent.

## Content

TERRA hosts and distributes no content made by its users. Nothing a user draws,
runs or writes leaves their computer through the application, and there is no
place in it where users publish to each other.

What the application downloads to run is data from the public services listed in
PRIVACY.md, and model packages. A package from the project's catalogue
([rexionmars/TERRA-models](https://github.com/rexionmars/TERRA-models)) is listed
with the SHA-256 and size of its file and checked against them before it is
installed. A package imported from a file is the user's own; the application
warns before importing one that a model package is code it will run, since the
weights are stored as Python pickles.

## Interaction between users

The application has no channel between users: no messages, comments or shared
spaces. Discussion about the project happens in its GitHub issues, under GitHub's
Community Guidelines and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Reporting a misuse or a harm

Write to [joao_leonardi.melo@somosicev.com](mailto:joao_leonardi.melo@somosicev.com)
or open an issue at [github.com/rexionmars/TERRA/issues](https://github.com/rexionmars/TERRA/issues).
A report about a community or a person can be sent by email rather than in a
public issue.

## References

- Global Indigenous Data Alliance (2019). CARE Principles for Indigenous Data
  Governance. <https://www.gida-global.org/care>
