//go:build darwin

package pyenv

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

/*
What this application writes is byte for byte what macOS writes.

The value is a binary plist copied out of a directory excluded with
`tmutil addexclusion`, and the first version of it was one byte short of the
real thing -- a 31-byte trailer where the format has 32. tmutil reported that
directory excluded anyway, so a functional check alone would have passed the
defect through. The comparison is against the bytes, and tmutil's verdict is
kept beside it because agreeing with the format and being honoured by the tool
are two claims.
*/
func TestBackupExclusionMatchesWhatTmutilWrites(t *testing.T) {
	if _, err := exec.LookPath("tmutil"); err != nil {
		t.Skip("tmutil is not available")
	}
	dir := t.TempDir()

	ours := filepath.Join(dir, "ours")
	if err := os.MkdirAll(ours, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := excludeFromBackup(ours); err != nil {
		t.Fatalf("exclude: %v", err)
	}

	theirs := filepath.Join(dir, "theirs")
	if err := os.MkdirAll(theirs, 0o700); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("tmutil", "addexclusion", theirs).CombinedOutput(); err != nil {
		t.Skipf("tmutil addexclusion is unavailable here: %v: %s", err, out)
	}

	if a, b := readExcludeAttr(t, ours), readExcludeAttr(t, theirs); a != b {
		t.Errorf("attribute differs from the one macOS writes:\n ours   %s\n tmutil %s", a, b)
	}
	if out, err := exec.Command("tmutil", "isexcluded", ours).CombinedOutput(); err != nil {
		t.Fatalf("isexcluded: %v: %s", err, out)
	} else if !strings.Contains(string(out), "[Excluded]") {
		t.Errorf("tmutil does not consider it excluded: %s", out)
	}
}

// The managed environment of an installation that already has one gets the
// mark without being rebuilt, and an installation without one is not an error.
func TestEnsureExcludedFromBackupHandlesBothStates(t *testing.T) {
	dir := t.TempDir()
	EnsureExcludedFromBackup(dir) // No environment: nothing to do, nothing to say.

	env := ManagedEnvDir(dir)
	if err := os.MkdirAll(env, 0o700); err != nil {
		t.Fatal(err)
	}
	EnsureExcludedFromBackup(dir)
	if got := readExcludeAttr(t, env); got == "" {
		t.Error("an environment already on disk was not marked")
	}
}

func readExcludeAttr(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.Command("xattr", "-px", backupExcludeAttr, path).Output()
	if err != nil {
		return ""
	}
	return strings.Join(strings.Fields(string(out)), " ")
}
