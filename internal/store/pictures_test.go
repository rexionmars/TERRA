package store

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

// The photo, the cover and the badge are three files, and taking one away
// leaves the other two: the photo's pattern, <id>.*, must not reach
// <id>-cover.jpg.
func TestRemovingOnePictureLeavesTheOthers(t *testing.T) {
	s := openStoreIn(t, t.TempDir())
	u := registerPictureUser(t, s)

	png := []byte("\x89PNG\r\n\x1a\nphoto")
	jpeg := []byte("\xff\xd8\xff cover")
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)
	for _, step := range []struct {
		p   Picture
		uri string
	}{
		{PictureAvatar, pictureDataURI("image/png", png)},
		{PictureCover, pictureDataURI("image/jpeg", jpeg)},
		{PictureBadge, pictureDataURI("image/svg+xml", svg)},
	} {
		if _, err := s.SetPicture(u.ID, step.p, step.uri); err != nil {
			t.Fatalf("set the %s: %v", step.p, err)
		}
	}

	got, err := s.GetUser(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.AvatarURI != pictureDataURI("image/png", png) {
		t.Errorf("photo URI is %.40q", got.AvatarURI)
	}
	if got.CoverURI != pictureDataURI("image/jpeg", jpeg) {
		t.Errorf("cover URI is %.40q", got.CoverURI)
	}
	if got.BadgeURI != pictureDataURI("image/svg+xml", svg) {
		t.Errorf("badge URI is %.40q", got.BadgeURI)
	}
	if n := len(pictureFiles(t, s)); n != 3 {
		t.Fatalf("%d picture files after setting three, want 3", n)
	}

	after, err := s.ClearPicture(u.ID, PictureAvatar)
	if err != nil {
		t.Fatal(err)
	}
	if after.AvatarURI != "" || after.AvatarPath != "" {
		t.Errorf("the photo is still there: path %q", after.AvatarPath)
	}
	if after.CoverURI == "" || after.BadgeURI == "" {
		t.Errorf("removing the photo took the cover or the badge with it")
	}
	files := pictureFiles(t, s)
	if len(files) != 2 {
		t.Fatalf("files after removing the photo: %v, want the cover and the badge", files)
	}
	for _, f := range files {
		if !strings.HasPrefix(f, u.ID+"-") {
			t.Errorf("%s is left, and is not the cover or the badge", f)
		}
	}
}

// A new cover replaces the old one even when it comes in another format, so
// the directory never holds two covers for one user.
func TestANewCoverReplacesTheOldOneInAnotherFormat(t *testing.T) {
	s := openStoreIn(t, t.TempDir())
	u := registerPictureUser(t, s)

	if _, err := s.SetPicture(u.ID, PictureCover, pictureDataURI("image/png", []byte("first"))); err != nil {
		t.Fatal(err)
	}
	got, err := s.SetPicture(u.ID, PictureCover, pictureDataURI("image/jpeg", []byte("second")))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(pictureDir, u.ID+"-cover.jpg"); got.CoverPath != want {
		t.Errorf("cover path %q, want %q", got.CoverPath, want)
	}
	if files := pictureFiles(t, s); len(files) != 1 {
		t.Errorf("files after replacing the cover: %v, want one", files)
	}
}

// A badge may be an SVG, since that is how many institutions publish their
// logo. A photo or a cover may not, and neither may anything that is not an
// image.
func TestOnlyTheBadgeAcceptsAnSVG(t *testing.T) {
	s := openStoreIn(t, t.TempDir())
	u := registerPictureUser(t, s)
	svg := pictureDataURI("image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))

	if _, err := s.SetPicture(u.ID, PictureBadge, svg); err != nil {
		t.Errorf("badge as SVG refused: %v", err)
	}
	for _, p := range []Picture{PictureAvatar, PictureCover} {
		if _, err := s.SetPicture(u.ID, p, svg); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%s as SVG: err %v, want ErrInvalidInput", p, err)
		}
	}
	text := pictureDataURI("text/plain", []byte("not a picture"))
	if _, err := s.SetPicture(u.ID, PictureBadge, text); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("badge as text: err %v, want ErrInvalidInput", err)
	}
}
