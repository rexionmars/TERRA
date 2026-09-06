//go:build darwin

package pyenv

import (
	"encoding/hex"
	"os"

	"golang.org/x/sys/unix"
)

/*
The bytes macOS writes to mark an item excluded from Time Machine.

A binary property list holding the single string "com.apple.backupd", which is
what NSURLIsExcludedFromBackupKey and `tmutil addexclusion` both leave behind.
Read back from a directory excluded with that command and reproduced verbatim,
because the value is a constant: encoding one constant through a plist writer
would be more code and more ways to be wrong.

AS HEX, AND THE FIRST ATTEMPT SHOWS WHY. Written out as a byte array by hand it
came to 60 bytes against the 61 macOS writes -- a plist trailer is 32 bytes and
that one had 31, miscounted in the run of zeros. tmutil still reported the
directory excluded, so the error would have shipped. A hex string is checkable
against `xattr -px` by looking at it, which is how the two are kept the same.
*/
const backupExcludeHex = "62706c69737430305f1011636f6d2e6170706c652e6261636b7570" +
	"6408000000000000010100000000000000010000000000000000000000000000001c"

// Decoded once. A constant that cannot be decoded is a programming error and
// there is no run-time answer to it, so this is the one place a panic is the
// honest report -- it fires on the first build that changes the string.
var backupExcludeValue = mustDecodeHex(backupExcludeHex)

func mustDecodeHex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic("pyenv: backup exclusion value is not hex: " + err.Error())
	}
	return b
}

const backupExcludeAttr = "com.apple.metadata:com_apple_backup_excludeItem"

/*
excludeFromBackup marks a path as not worth copying to Time Machine.

Apple's guidance is not a preference here: "Any file that can be re-created or
downloaded must be excluded from the backup." This environment is rebuilt from
the requirements manifest the binary embeds, and it was measured at 1.9 GB on
one installation -- copied in full to every backup, of a thing the application
can make again from a text file.

The environment stays in Application Support rather than moving to Caches,
which would exclude it as a side effect. Apple's own description of Caches is
that an app "should never rely on the existence of cache files", and every
analysis this program runs relies on this one; a purge under disk pressure
would leave a working installation unable to run anything until it rebuilt over
the network. Excluding it from backup is the part of the cache treatment that
applies; being discardable is the part that does not.
*/
func excludeFromBackup(path string) error {
	return unix.Setxattr(path, backupExcludeAttr, backupExcludeValue, 0)
}

/*
EnsureExcludedFromBackup marks an environment that is already on disk.

The build path marks what it creates, which covers every environment made from
here on and none of the ones already built -- and those are the large ones, the
ones that have been copied to every backup since they were made. Called at
startup, where it is one system call against a directory that is usually
already marked.

Silent on failure and on absence. There is nothing for the user to do about
either, and an installation with no managed environment is the normal state for
someone running against their own interpreter.
*/
func EnsureExcludedFromBackup(dataDir string) {
	dir := ManagedEnvDir(dataDir)
	if _, err := os.Stat(dir); err != nil {
		return
	}
	_ = excludeFromBackup(dir)
}
