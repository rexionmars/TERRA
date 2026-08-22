package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "config"))
	s, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestRegisterLoginPrefsRuns(t *testing.T) {
	s := openTestStore(t)
	email := fmt.Sprintf("t%d@ex.com", os.Getpid())
	u, _, err := s.Register(email, "secret12", "Tester")
	if err != nil {
		t.Fatal(err)
	}
	if u.DisplayName != "Tester" {
		t.Fatal(u)
	}
	_, _, err = s.Login(email, "wrong")
	if err == nil {
		t.Fatal("expected bad login")
	}
	u2, tok, err := s.Login(email, "secret12")
	if err != nil {
		t.Fatal(err)
	}
	if tok == "" {
		t.Fatal("empty token")
	}
	p, err := s.GetPreferences(u2.ID)
	if err != nil {
		t.Fatal(err)
	}
	p.DefaultModel = "prithvi"
	if err := s.SavePreferences(*p); err != nil {
		t.Fatal(err)
	}
	_, err = s.SaveRun(InferenceRun{
		UserID: u2.ID, ModelKind: "spectral", PeriodStart: "2024-01-01", PeriodEnd: "2024-12-31",
		PolygonGeoJSON: "{}", Status: "ok", SummaryJSON: "{}", NDates: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	runs, err := s.ListRuns(u2.ID, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs=%v err=%v", runs, err)
	}
}

// Registering an address twice has to come back as ErrEmailTaken, because that
// sentinel is all the interface has to tell "pick another address" apart from
// "the database is broken". Nothing covered it while the check read the
// driver's message text, so a reworded message would have passed this package
// and only shown up as a raw SQLite string in the sign-up form.
func TestRegisterRejectsDuplicateEmail(t *testing.T) {
	s := openTestStore(t)
	email := fmt.Sprintf("dup%d@ex.com", os.Getpid())
	if _, _, err := s.Register(email, "secret12", "First"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Register(email, "secret34", "Second"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("second Register: err=%v, want ErrEmailTaken", err)
	}
	// The address is normalised before it reaches the INSERT, so a different
	// casing is the same row and has to reach the same sentinel.
	if _, _, err := s.Register(strings.ToUpper(email), "secret56", "Third"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("Register with upper-case address: err=%v, want ErrEmailTaken", err)
	}
	// The refused attempts must not have touched the row that exists.
	u, _, err := s.Login(email, "secret12")
	if err != nil {
		t.Fatal(err)
	}
	if u.DisplayName != "First" {
		t.Fatalf("display name after refused registrations = %q, want First", u.DisplayName)
	}
}

func TestLogoutAndGetRun(t *testing.T) {
	s := openTestStore(t)
	email := fmt.Sprintf("logout%d@ex.com", os.Getpid())
	_, tok, err := s.Register(email, "secret12", "Logout")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserFromSession(tok); err != nil {
		t.Fatal(err)
	}
	if err := s.Logout(tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserFromSession(tok); err == nil {
		t.Fatal("expected unauthorized after logout")
	}

	saved, err := s.SaveRun(InferenceRun{
		UserID: LocalUserID, ModelKind: "spectral", PeriodStart: "2023-01-01", PeriodEnd: "2023-06-30",
		PolygonGeoJSON: `{"type":"Polygon"}`, Status: "ok", SummaryJSON: `{"n":1}`, NDates: 3, Label: "guest",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetRun("", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Label != "guest" || got.UserID != LocalUserID || got.NDates != 3 {
		t.Fatalf("GetRun mismatch: %+v", got)
	}
	runs, err := s.ListRuns("", 5)
	if err != nil || len(runs) != 1 {
		t.Fatalf("guest ListRuns=%v err=%v", runs, err)
	}
}

func TestLocalUserExists(t *testing.T) {
	s := openTestStore(t)
	u, err := s.GetUser(LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != LocalUserEmail {
		t.Fatalf("local user email=%s", u.Email)
	}
}
