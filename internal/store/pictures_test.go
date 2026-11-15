package store

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func pictureDataURI(mime string, body []byte) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(body)
}

func registerPictureUser(t *testing.T, s *Store) *User {
	t.Helper()
	u, _, err := s.Register("someone@example.com", "hunter22", "Someone")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func pictureFiles(t *testing.T, s *Store) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(s.dataDir, pictureDir))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// A new photo replaces the old one even when it comes in another format, so
// the directory never holds two photos for one user.
func TestANewPhotoReplacesTheOldOneInAnotherFormat(t *testing.T) {
	s := openStoreIn(t, t.TempDir())
	u := registerPictureUser(t, s)

	if _, err := s.SetPicture(u.ID, PictureAvatar, pictureDataURI("image/png", []byte("first"))); err != nil {
		t.Fatal(err)
	}
	got, err := s.SetPicture(u.ID, PictureAvatar, pictureDataURI("image/jpeg", []byte("second")))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(pictureDir, u.ID+".jpg"); got.AvatarPath != want {
		t.Errorf("photo path %q, want %q", got.AvatarPath, want)
	}
	if got.AvatarURI != pictureDataURI("image/jpeg", []byte("second")) {
		t.Errorf("photo URI is %.40q", got.AvatarURI)
	}
	if files := pictureFiles(t, s); len(files) != 1 {
		t.Errorf("files after replacing the photo: %v, want one", files)
	}

	cleared, err := s.ClearPicture(u.ID, PictureAvatar)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.AvatarPath != "" || cleared.AvatarURI != "" {
		t.Errorf("the photo is still there after clearing: path %q", cleared.AvatarPath)
	}
	if files := pictureFiles(t, s); len(files) != 0 {
		t.Errorf("files after clearing the photo: %v, want none", files)
	}
}

// A picture over its cap, or in a type the store does not keep, is refused
// before anything is written, so the one already there stays.
func TestARefusedPhotoLeavesTheOldOne(t *testing.T) {
	s := openStoreIn(t, t.TempDir())
	u := registerPictureUser(t, s)
	small := pictureDataURI("image/png", []byte("photo"))
	if _, err := s.SetPicture(u.ID, PictureAvatar, small); err != nil {
		t.Fatal(err)
	}

	large := make([]byte, pictureRules[PictureAvatar].maxBytes+1)
	for _, refused := range []string{
		pictureDataURI("image/png", large),
		pictureDataURI("text/plain", []byte("not a picture")),
	} {
		if _, err := s.SetPicture(u.ID, PictureAvatar, refused); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("refused photo: err %v, want ErrInvalidInput", err)
		}
	}
	got, err := s.GetUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.AvatarURI != small {
		t.Errorf("the photo before the refused ones is gone")
	}
}
