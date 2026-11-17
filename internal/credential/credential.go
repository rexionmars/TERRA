/*
Package credential keeps the secrets TERRA holds for the user in the platform's
credential store: the macOS Keychain, the Windows Credential Manager, or the
Secret Service on Linux.

The one secret today is the NASA Earthdata token. It used to live in the
installation's settings file, readable by the user's account and kept out of
the backup, but in plain text; a credential store encrypts it and asks the
system before another program reads it.

Not every system has a store: a Linux machine with no Secret Service running
answers with an error. Callers fall back to the settings file there, and say
so, rather than lose the token.
*/
package credential

import (
	"errors"
	"runtime"
	"strings"

	"github.com/zalando/go-keyring"
)

// service is the name the store files TERRA's secrets under, and earthdata the
// account the token is kept as.
const (
	service   = "TERRA"
	earthdata = "earthdata-token"
)

// EarthdataToken is the token kept in the store, or "" when there is none.
// An error means the store could not be asked, not that it holds nothing.
func EarthdataToken() (string, error) {
	token, err := keyring.Get(service, earthdata)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(token), nil
}

// SetEarthdataToken keeps the token in the store; an empty one removes it.
func SetEarthdataToken(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		err := keyring.Delete(service, earthdata)
		if errors.Is(err, keyring.ErrNotFound) {
			return nil
		}
		return err
	}
	return keyring.Set(service, earthdata, token)
}

// StoreName is the platform's store as its users know it.
func StoreName() string {
	switch runtime.GOOS {
	case "darwin":
		return "the macOS Keychain"
	case "windows":
		return "the Windows Credential Manager"
	default:
		return "the Secret Service keyring"
	}
}
