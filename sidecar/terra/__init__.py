"""
The TERRA sidecar: the products the desktop application asks for by name.

Reached as a subprocess, never as a library. `sidecar/infer.py` is the entry
point the Go side runs; everything it does is in `terra.cli`.
"""
