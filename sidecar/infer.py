#!/usr/bin/env python3
"""
The sidecar entry point, at the path the application runs.

`internal/analysis/runner.go` builds its command from `sidecar/infer.py` and
`scripts/package_release.sh` copies this tree into the bundle, so the name and
the location are part of the contract with the Go side. What the process does
is in `terra.cli`; this file exists to be that path.

Run as a script, so this file's own directory is already `sys.path[0]` and
`terra` imports without any path manipulation.
"""

from terra.cli import main

if __name__ == '__main__':
    main()
