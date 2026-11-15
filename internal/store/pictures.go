package store

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

/*
THE PICTURES AN ACCOUNT CARRIES, of which there is one so far: the photo at the
foot of the rail.

Each is one file under avatars/, named for the user and the picture (<id>.png),
with its path, relative to the data directory, in a column of users, and each
reaches the WebView as a data URI on User. The backup and the storage report
walk avatars/ by that name (backup.go, storage.go), and a backup restored on
another machine finds the file from the relative path.

What differs from one picture to another, the file's name, its column, its cap,
is a rule in pictureRules; the writing, the clearing and the reading are the
same code for each.
*/

// pictureDir is the directory under the data directory that holds the pictures.
const pictureDir = "avatars"

// Picture names one of the pictures an account carries.
type Picture string

const (
	PictureAvatar Picture = "photo"
)

type pictureRule struct {
	// suffix follows the user's id in the file's name.
	suffix string
	// update writes the picture's path, or NULL, and the time of the change.
	update string
	// stored reads the picture's path off a user.
	stored func(*User) string
	// maxBytes caps the decoded file.
	maxBytes int
}

var pictureRules = map[Picture]pictureRule{
	PictureAvatar: {
		suffix:   "",
		update:   `UPDATE users SET avatar_path = ?, updated_at = ? WHERE id = ?`,
		stored:   func(u *User) string { return u.AvatarPath },
		maxBytes: 2_500_000,
	},
}

// pictureExtensions maps the media types a picture is accepted in to the
// extension its file is written with.
var pictureExtensions = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/jpg":  ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// pictureTypes maps a file's extension back to the media type it is sent as.
// JPEG is the default because files written before the extension was checked
// were JPEG.
var pictureTypes = map[string]string{
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
}

// SetPicture writes one of the user's pictures from a browser data URI
// (data:image/png;base64,...), replacing the one before it.
func (s *Store) SetPicture(userID string, p Picture, dataURI string) (*User, error) {
	rule, ok := pictureRules[p]
	if !ok || userID == "" {
		return nil, ErrInvalidInput
	}
	raw, ext, err := decodePicture(dataURI)
	if err != nil {
		return nil, err
	}
	if len(raw) > rule.maxBytes {
		return nil, ErrInvalidInput
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, pictureDir), 0o700); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", pictureDir, err)
	}
	// The file before may have another extension, so it is not overwritten.
	s.removePictureFiles(userID, rule)
	rel := filepath.Join(pictureDir, userID+rule.suffix+ext)
	if err := os.WriteFile(filepath.Join(s.dataDir, rel), raw, 0o600); err != nil {
		return nil, fmt.Errorf("write the %s: %w", p, err)
	}
	if _, err := s.db.Exec(rule.update, rel, nowISO(), userID); err != nil {
		return nil, fmt.Errorf("record the %s: %w", p, err)
	}
	return s.GetUser(userID)
}

// ClearPicture removes one of the user's pictures.
func (s *Store) ClearPicture(userID string, p Picture) (*User, error) {
	rule, ok := pictureRules[p]
	if !ok || userID == "" {
		return nil, ErrInvalidInput
	}
	u, err := s.GetUser(userID)
	if err != nil {
		return nil, err
	}
	// The stored path first, since a path written by an earlier build need
	// not follow the naming removePictureFiles looks for.
	if path := rule.stored(u); path != "" {
		_ = os.Remove(s.picturePath(path))
	}
	s.removePictureFiles(userID, rule)
	if _, err := s.db.Exec(rule.update, nil, nowISO(), userID); err != nil {
		return nil, fmt.Errorf("record the %s removed: %w", p, err)
	}
	return s.GetUser(userID)
}

// removePictureFiles removes the user's files of one picture, whatever their
// extension.
func (s *Store) removePictureFiles(userID string, rule pictureRule) {
	pattern := filepath.Join(s.dataDir, pictureDir, userID+rule.suffix+".*")
	matches, _ := filepath.Glob(pattern)
	for _, m := range matches {
		_ = os.Remove(m)
	}
}

func (s *Store) picturePath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(s.dataDir, path)
}

// hydratePictures fills in the data URI of each picture the user has.
func (s *Store) hydratePictures(u *User) {
	if u == nil {
		return
	}
	u.AvatarURI = s.pictureURI(u.AvatarPath)
}

// pictureURI reads a picture's file as a data URI, or returns "" when there is
// nothing to read. A file gone from disk shows the placeholder rather than
// failing the sign-in that asked for it.
func (s *Store) pictureURI(path string) string {
	if path == "" {
		return ""
	}
	b, err := os.ReadFile(s.picturePath(path))
	if err != nil || len(b) == 0 {
		return ""
	}
	mime, ok := pictureTypes[strings.ToLower(filepath.Ext(path))]
	if !ok {
		mime = "image/jpeg"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b)
}

// decodePicture reads a base64 data URI of an accepted image type, and returns
// its bytes and the extension its file is written with.
func decodePicture(dataURI string) ([]byte, string, error) {
	if !strings.HasPrefix(dataURI, "data:image/") {
		return nil, "", ErrInvalidInput
	}
	comma := strings.Index(dataURI, ",")
	if comma < 0 {
		return nil, "", ErrInvalidInput
	}
	meta := dataURI[len("data:"):comma] // image/png;base64
	if !strings.Contains(meta, "base64") {
		return nil, "", ErrInvalidInput
	}
	mime := strings.Split(meta, ";")[0]
	ext, ok := pictureExtensions[mime]
	if !ok {
		return nil, "", ErrInvalidInput
	}
	raw, err := base64.StdEncoding.DecodeString(dataURI[comma+1:])
	if err != nil || len(raw) == 0 {
		return nil, "", ErrInvalidInput
	}
	return raw, ext, nil
}
