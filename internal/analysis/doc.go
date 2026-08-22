/*
Package analysis runs the products this application offers and carries their
shapes.

Every one of them is computed in Python. What lives here is the boundary to it:
Runner spawns sidecar/infer.py, writes one JSON request on its stdin, reads one
JSON reply from stdout, and turns the progress lines it writes to stderr into
events the interface can show. Nothing in this package computes a number.

The types beside it are that boundary's vocabulary in both directions -- the
request an analysis is asked with and the result it comes back as -- which is
why they are in the same package rather than in one of their own. Splitting
them would leave a package of structs named after no subject, and put the wire
contract on the far side of an import from the code that holds it.

They are split across files by product (types_energy.go, types_wind.go,
types_canopy.go) purely so a reader can open the one they are after. A file
boundary carries no meaning inside a Go package.

The frontend mirrors these structs by hand in src/lib/types.ts, and
frontend/scripts/check-types.ts fails when the two sets of JSON field names
drift apart.
*/
package analysis
