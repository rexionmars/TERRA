package credential

import (
	"testing"

	"github.com/zalando/go-keyring"
)

// The tests run against go-keyring's in-memory store, never the real one: a
// test that wrote to the developer's Keychain would leave a secret behind on
// any failure between the write and the clean-up.
func TestAStoredTokenIsReadBackAndAnEmptyOneRemovesIt(t *testing.T) {
	keyring.MockInit()

	if got, err := EarthdataToken(); err != nil || got != "" {
		t.Fatalf("an empty store gave %q, %v", got, err)
	}
	if err := SetEarthdataToken(" tok "); err != nil {
		t.Fatal(err)
	}
	if got, _ := EarthdataToken(); got != "tok" {
		t.Fatalf("read back %q", got)
	}
	if err := SetEarthdataToken(""); err != nil {
		t.Fatal(err)
	}
	if got, _ := EarthdataToken(); got != "" {
		t.Fatalf("still holds %q after removal", got)
	}
	// Removing what is not there is not a failure.
	if err := SetEarthdataToken(""); err != nil {
		t.Fatal(err)
	}
}

func TestAStoreThatCannotBeAskedIsAnErrorNotAnEmptyAnswer(t *testing.T) {
	keyring.MockInitWithError(keyring.ErrUnsupportedPlatform)

	if _, err := EarthdataToken(); err == nil {
		t.Fatal("a store that failed read as one holding no token")
	}
	if err := SetEarthdataToken("tok"); err == nil {
		t.Fatal("a store that failed accepted the token")
	}
}
