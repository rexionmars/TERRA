package research

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// analysisTablesPath is the TypeScript mirror of researchTableColumns.
const analysisTablesPath = "../../frontend/src/lib/analysisTables.ts"

// awaitingFrontendMirror lists CSVs written by the Go exporter that the
// TypeScript side has not defined yet.
//
// Temporary by construction: the check below fails as soon as a listed name
// appears in analysisTables.ts, with the instruction to delete the entry. An
// entry cannot therefore be left behind once the mirror lands, and the set
// cannot be used to silence a genuine drift, because a name in it that is
// present on both sides is an error rather than a pass.
var awaitingFrontendMirror = map[string]bool{}

// awaitingFrontendColumnMirror lists tables both sides define but whose column
// list the exporter has changed ahead of the TypeScript mirror. The value is
// the exact column list the TypeScript file is still expected to carry.
//
// Pinning the stale list rather than skipping the table is what keeps this from
// being a mute switch: the check below fails when TypeScript has caught up,
// with the instruction to delete the entry, and it fails just as loudly when
// the TypeScript columns are neither the pinned list nor the Go list, which is
// what a drift that nobody recorded looks like.
var awaitingFrontendColumnMirror = map[string][]string{}

var (
	csvNameRe = regexp.MustCompile(`"([a-z0-9_]+\.csv)"`)
	// Column keys as analysisTables.ts spells them: num("k") for a numeric
	// column, { key: "k" } or { key: "k", swatch: true } otherwise.
	columnKeyRe = regexp.MustCompile(`num\("([^"]+)"\)|key:\s*"([^"]+)"`)
)

// parseAnalysisTables extracts each table's ordered column keys from the
// TypeScript source, keyed by CSV name.
//
// The column array is delimited by scanning bracket depth from the first "["
// after the CSV name rather than by a regular expression. A greedy expression
// anchored on "])" reads several consecutive table definitions as one, which is
// the defect that made an earlier ad-hoc version of this check report three
// solar tables as a single table with the columns of all three.
func parseAnalysisTables(src string) (map[string][]string, error) {
	out := map[string][]string{}
	for _, loc := range csvNameRe.FindAllStringSubmatchIndex(src, -1) {
		name := src[loc[2]:loc[3]]
		if _, dup := out[name]; dup {
			return nil, fmt.Errorf("%s appears more than once in %s", name, analysisTablesPath)
		}
		rest := src[loc[1]:]
		open := strings.Index(rest, "[")
		if open < 0 {
			return nil, fmt.Errorf("no column array after %s", name)
		}
		depth := 0
		end := -1
		for i := open; i < len(rest); i++ {
			switch rest[i] {
			case '[':
				depth++
			case ']':
				depth--
				if depth == 0 {
					end = i
				}
			}
			if end >= 0 {
				break
			}
		}
		if end < 0 {
			return nil, fmt.Errorf("unterminated column array after %s", name)
		}
		cols := []string{}
		for _, m := range columnKeyRe.FindAllStringSubmatch(rest[open:end], -1) {
			if m[1] != "" {
				cols = append(cols, m[1])
			} else {
				cols = append(cols, m[2])
			}
		}
		out[name] = cols
	}
	return out, nil
}

// TestResearchTableParity is the check the repository did not have: the CSVs the
// research pack writes and the tables the analysis view shows must be the same
// tables, with the same columns in the same order. Without it a table added to
// one side alone produces an exported CSV that disagrees with the figure on
// screen, and nothing reports it.
func TestResearchTableParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(analysisTablesPath))
	if err != nil {
		t.Fatalf("read %s: %v", analysisTablesPath, err)
	}
	ts, err := parseAnalysisTables(string(raw))
	if err != nil {
		t.Fatalf("parse %s: %v", analysisTablesPath, err)
	}
	if len(ts) == 0 {
		t.Fatalf("no table definitions found in %s; the parser no longer matches the file", analysisTablesPath)
	}

	goNames := make([]string, 0, len(researchTableColumns))
	for name := range researchTableColumns {
		goNames = append(goNames, name)
	}
	sort.Strings(goNames)

	for _, name := range goNames {
		goCols := researchTableColumns[name]
		tsCols, inTS := ts[name]
		if !inTS {
			if awaitingFrontendMirror[name] {
				continue
			}
			t.Errorf("%s is written by export_research.go but not defined in %s", name, analysisTablesPath)
			continue
		}
		if awaitingFrontendMirror[name] {
			t.Errorf("%s is now defined in %s: remove it from awaitingFrontendMirror", name, analysisTablesPath)
		}
		goJoined := strings.Join(goCols, ",")
		tsJoined := strings.Join(tsCols, ",")
		stale, pending := awaitingFrontendColumnMirror[name]
		if goJoined == tsJoined {
			if pending {
				t.Errorf("%s columns now match in %s: remove it from awaitingFrontendColumnMirror",
					name, analysisTablesPath)
			}
			continue
		}
		if pending && strings.Join(stale, ",") == tsJoined {
			t.Logf("%s: %s still carries the recorded previous columns; mirror %v",
				name, analysisTablesPath, goCols)
			continue
		}
		t.Errorf("%s columns differ\n  export_research.go: %v\n  %s: %v",
			name, goCols, analysisTablesPath, tsCols)
	}

	tsNames := make([]string, 0, len(ts))
	for name := range ts {
		tsNames = append(tsNames, name)
	}
	sort.Strings(tsNames)
	for _, name := range tsNames {
		if _, ok := researchTableColumns[name]; !ok {
			t.Errorf("%s is defined in %s but never written by export_research.go", name, analysisTablesPath)
		}
	}
}
