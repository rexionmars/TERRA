"""
Socio-environmental overlap: how much of an area falls on each public register
that credit, buyers and the law read, in hectares, as the registers stood when
they were read.

The registers, and who publishes them:

- PRODES yearly deforestation, per biome (INPE, TerraBrasilis WFS). The year of
  each polygon places it against two cutoffs: 22 July 2008, the date the Forest
  Code (Law 12.651/2012, art. 3, IV) uses to separate a consolidated rural area
  from later clearing, and 31 December 2020, the cutoff date of the European
  Union deforestation regulation (Regulation (EU) 2023/1115, art. 2(13)).
- DETER alerts (INPE, TerraBrasilis WFS), over the Amazon and the Cerrado only.
- CAR/SICAR property registrations (SFB, SICAR GeoServer), per state.
- Embargoes by IBAMA and by ICMBio (IBAMA ArcGIS FeatureServer).
- Indigenous lands (FUNAI GeoServer).
- Conservation units of every sphere (CNUC, MMA GeoServer at INDE).

AN OVERLAP IS NOT A FINDING OF IRREGULARITY. A PRODES polygon can hold an
authorised clearing, an embargo can be lifted after the layer was published, a
conservation unit of sustainable use admits farming, and CAR registrations
overlap one another routinely. The product states where the area meets each
register and when the register was read; what that means for a given field is
for someone who can read the field's documents.

WHAT IS NOT READ. The APP and legal-reserve polygons of each CAR registration
are not published by WFS; SICAR serves them per municipality behind a form,
and the property boundary is all this product has of a registration.
"""
