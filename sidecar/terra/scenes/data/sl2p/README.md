# SL2P network coefficients

The weights, normalisation, output ranges and definition domains of ESA's SL2P
networks for Sentinel-2A and Sentinel-2B, as SNAP's biophysical processor
ships them. `terra/scenes/sl2p.py` reads them.

| | |
|---|---|
| Source | <https://github.com/senbox-org/s2tbx>, `s2tbx-biophysical/src/main/resources/auxdata/3_0/{S2A,S2B}` |
| Commit | `5563b1ce87101eae0118ede9ca9db5f070088fe1` (2021-12-22) |
| Licence | GPL-3.0, the licence of this repository |
| Algorithm | Weiss, M. and Baret, F. (2016), *S2ToolBox Level 2 products: LAI, FAPAR, FCOVER*, version 1.1, INRA |

The files are copied unchanged. The test cases SNAP publishes beside them are
not copied whole: `sidecar/tests/data/sl2p_snap_cases_*.csv` holds their first
200 rows, which `tests/test_sl2p.py` compares this implementation against.

To update, take the same paths at a newer commit, replace the files, and run
`pytest tests/test_sl2p.py`.
