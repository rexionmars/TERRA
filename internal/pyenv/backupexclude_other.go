//go:build !darwin

package pyenv

// excludeFromBackup has nothing to do off macOS: Time Machine is the backup
// this marks a directory against, and neither Windows nor Linux reads the
// attribute it writes.
func excludeFromBackup(string) error { return nil }

// EnsureExcludedFromBackup is the no-op half of the pair. See the darwin file.
func EnsureExcludedFromBackup(string) {}
