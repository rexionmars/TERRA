"""
The research series, as the application runs it.

TWELVE ANALYSES PORTED, NOT REINTERPRETED. Each module here is one figure of the
published series, and the promise is narrow and testable: the numbers it returns
are the numbers the research produced. Every module writes the same source
tables the notebook wrote, so a port can be checked against
`lucertae/data/processed/figNN_source_*.csv` column by column rather than
believed.

PYTHON COMPUTES, THE SCREEN DRAWS -- which is the split `experiments/` already
states for this repository's own research figures: "Python computes and exports,
R draws. Nothing here writes into the app." The paper figure is 183 mm at 7 pt,
and `frontend/src/lib/figure.ts` records why that does not survive a screen:
7 pt is about 7.3 px in a 540 px panel, under the 9 px floor the interface holds
in twenty-one places. So these modules return tables, and the interface draws
them at its own scale.

WHAT A MODULE PROMISES. Three functions, and the separation is what makes the
port verifiable rather than plausible:

    read(conn, **kw)      talks to the store, returns raw frames
    analyse(frames)       returns {name: DataFrame}, the source tables
    describe()            the figure's identity: number, title, scope, caveats

`read` is the only part that changed shape. The notebooks streamed monthly CSVs
from a cache; here the same rows come from an indexed store. Everything after it
is the research's own code, moved rather than rewritten -- 79 percent of the
notebooks' lines were analysis and 3 percent were fetching.

THE CAVEATS TRAVEL WITH THE RESULT. Four of the twelve are corrections of an
earlier one: Fig. 6 corrects Fig. 5, Fig. 9 withdraws Fig. 8's causal reading,
Fig. 11 delimits Fig. 10, Fig. 12 demotes Fig. 10's headline to one robustness
test in three. A reader who sees Fig. 10 without Fig. 12 is reading a result the
series itself retired, so `describe()` carries that and the interface shows it.
"""
