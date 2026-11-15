package main

import (
	"errors"

	"geosense-infer/internal/store"
)

// Who is using the application: registration, sign-in, the profile, and the
// preferences that follow a user rather than an installation.

func (a *App) setSession(u *store.User, token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.currentUser = u
	a.sessionToken = token
}

func (a *App) clearSession() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.currentUser = nil
	a.sessionToken = ""
}

// Register creates a local account and starts a session.
func (a *App) Register(email, password, displayName string) (*store.User, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	u, token, err := st.Register(email, password, displayName)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.setSession(u, token)
	return u, nil
}

// Login authenticates and starts a session.
func (a *App) Login(email, password string) (*store.User, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	u, token, err := st.Login(email, password)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.setSession(u, token)
	return u, nil
}

// Logout ends the current session.
func (a *App) Logout() error {
	st := a.currentStore()
	if st == nil {
		a.clearSession()
		return nil
	}
	a.mu.RLock()
	token := a.sessionToken
	a.mu.RUnlock()
	_ = st.Logout(token)
	a.clearSession()
	return nil
}

// CurrentUser returns the logged-in user, or nil.
func (a *App) CurrentUser() *store.User {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.currentUser
}

// changeUser applies a change to the signed-in user's record, and keeps the
// session's copy as the store returns it.
func (a *App) changeUser(change func(st *store.Store, userID string) (*store.User, error)) (*store.User, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	a.mu.RLock()
	u := a.currentUser
	a.mu.RUnlock()
	if u == nil {
		return nil, store.ErrUnauthorized
	}
	updated, err := change(st, u.ID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
}

// UpdateProfile updates the display name.
func (a *App) UpdateProfile(displayName string) (*store.User, error) {
	return a.changeUser(func(st *store.Store, id string) (*store.User, error) {
		return st.UpdateProfile(id, displayName)
	})
}

// setPicture and clearPicture bind one picture of the account; see
// internal/store/pictures.go.
func (a *App) setPicture(p store.Picture, dataURI string) (*store.User, error) {
	return a.changeUser(func(st *store.Store, id string) (*store.User, error) {
		return st.SetPicture(id, p, dataURI)
	})
}

func (a *App) clearPicture(p store.Picture) (*store.User, error) {
	return a.changeUser(func(st *store.Store, id string) (*store.User, error) {
		return st.ClearPicture(id, p)
	})
}

// SetAvatar saves a profile photo from a browser data URI (data:image/...;base64,...).
func (a *App) SetAvatar(dataURI string) (*store.User, error) {
	return a.setPicture(store.PictureAvatar, dataURI)
}

// ClearAvatar removes the current user's profile photo.
func (a *App) ClearAvatar() (*store.User, error) {
	return a.clearPicture(store.PictureAvatar)
}

// SetCover saves the picture on the profile's banner, from a browser data URI.
func (a *App) SetCover(dataURI string) (*store.User, error) {
	return a.setPicture(store.PictureCover, dataURI)
}

// ClearCover removes the picture on the profile's banner, which goes back to
// the scenes.
func (a *App) ClearCover() (*store.User, error) {
	return a.clearPicture(store.PictureCover)
}

// SetBadge saves the badge of the user's institution, from a browser data URI.
// It may be an SVG.
func (a *App) SetBadge(dataURI string) (*store.User, error) {
	return a.setPicture(store.PictureBadge, dataURI)
}

// ClearBadge removes the badge of the user's institution.
func (a *App) ClearBadge() (*store.User, error) {
	return a.clearPicture(store.PictureBadge)
}

// GetPreferences returns preferences for the logged-in user (or local guest).
func (a *App) GetPreferences() (*store.Preferences, error) {
	st, err := a.requireStore()
	if err != nil {
		return nil, err
	}
	return st.GetPreferences(a.effectiveUserID())
}

// SavePreferences persists preferences for the logged-in user (or local guest).
func (a *App) SavePreferences(prefs store.Preferences) error {
	st, err := a.requireStore()
	if err != nil {
		return err
	}
	prefs.UserID = a.effectiveUserID()
	return st.SavePreferences(prefs)
}

func mapStoreErr(err error) error {
	switch {
	case errors.Is(err, store.ErrEmailTaken):
		return errors.New("email already registered")
	case errors.Is(err, store.ErrInvalidCreds):
		return errors.New("invalid email or password")
	case errors.Is(err, store.ErrUnauthorized):
		return errors.New("not authenticated")
	case errors.Is(err, store.ErrInvalidInput):
		return errors.New("invalid input")
	case errors.Is(err, store.ErrNotFound):
		return errors.New("not found")
	default:
		return err
	}
}
