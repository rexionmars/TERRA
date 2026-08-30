"""
The sun as a shared service: where it was, and what the record says arrived.

Read by three products that have nothing else in common -- the photovoltaic
chain, the wind screening and the canopy simulation, which lights a stand with
the hourly sun of its own location. It therefore sits below all three rather
than inside any one of them, and it imports nothing from the rest of terra.

This file is deliberately empty of code. A convenience re-export here would
make importing one submodule execute the others, so a heavy import written at
the top of any of them would reach every consumer of the package. The two heavy
dependencies in it -- pvlib in position.prepare_hourly and scipy in
record.linear_trend -- are deferred inside those function bodies today; the
empty __init__ is what keeps that property from depending on where a future
import happens to be written.
"""
