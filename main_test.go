package main

import (
	"os"
	"testing"

	"github.com/zalando/go-keyring"
)

// TestMain points the credential store at go-keyring's in-memory one for the
// whole package. The Earthdata token is read through it on every run, and a
// test that reached the real store would read, or write, the developer's own
// Keychain.
func TestMain(m *testing.M) {
	keyring.MockInit()
	os.Exit(m.Run())
}
