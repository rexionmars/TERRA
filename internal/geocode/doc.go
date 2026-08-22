/*
Package geocode turns a place name into coordinates, through Nominatim.

The only outbound HTTP in this application that is not imagery. It exists so a
user can find their area by name instead of by dragging a map, and it is
deliberately the whole of what it does: no caching, no reverse lookup, no
session. A failure here costs the user a search box and nothing else.
*/
package geocode
