"""
The crop, grown from what the satellite measured, and lit by its own sun.

Four steps: an NDVI series gives leaf area by inverting Beer-Lambert, leaf area
gives plant age against the known growth of the species, age drives the growth,
and the stand is lit by the hourly sun of its own location. The reading at the
end is the fraction of light the canopy intercepts.

It reads terra.sun for that sun and takes the species the classification
suggested as data in the request, not by importing the classifier: a product
that needs another product's output takes it as a value.

Several modules here are mirrored from the numerical-studies repository and
kept in their original wording, so that a difference between the two is a
difference in the code rather than in how it was described.
"""
