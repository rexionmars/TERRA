/*
Package research writes the export that accompanies a published result.

One ZIP holding the figures, the CSV tables behind them, and the parameters the
run was made with, so a number in a paper can be traced back to the run that
produced it. That is the whole package.

The tables it writes are the tables the interface shows. Nothing enforces that
by construction -- they are built twice, once here and once in TypeScript -- so
export_parity_test.go compares the two and fails when a column is added on one
side alone.
*/
package research
