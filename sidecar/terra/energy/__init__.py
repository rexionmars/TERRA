"""
The energy products: what a collector at this place would receive and yield.

Two of them, and they share nothing but a location. The photovoltaic chain is
benchmarked against the Global Solar Atlas; the wind screening is benchmarked
against nothing, states so in its own docstring, and its every turbine-level
figure is an indication rather than a study. A shared directory is not a claim
of shared validation, and neither module reads the other.

Empty of code on purpose: a re-export here would make importing one module
execute the other, and the two do not have the same dependencies.
"""
