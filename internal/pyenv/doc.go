/*
Package pyenv answers whether anything can be run at all.

The application is useless without a Python interpreter that can import
rasterio, and the machines it runs on rarely have one by accident. So this
package finds the interpreters present, inspects one by running sidecar/doctor.py
against it and reporting which packages are missing, builds a managed virtual
environment when the user asks for one, and records the choice in a settings
file beside the database.

It is deliberately separate from the package that runs analyses. That one asks
"produce this result"; this one asks "is there anything here that could". The
screen it serves is the one a user meets when the answer is no, which is the
worst moment to be reading an error written for the other question.
*/
package pyenv
