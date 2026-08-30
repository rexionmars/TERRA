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

// UpdateProfile updates the display name.
func (a *App) UpdateProfile(displayName string) (*store.User, error) {
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
	updated, err := st.UpdateProfile(u.ID, displayName)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
}

// SetAvatar saves a profile photo from a browser data URI (data:image/...;base64,...).
func (a *App) SetAvatar(dataURI string) (*store.User, error) {
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
	updated, err := st.SetAvatarFromDataURI(u.ID, dataURI)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
}

// ClearAvatar removes the current user's profile photo.
func (a *App) ClearAvatar() (*store.User, error) {
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
	updated, err := st.ClearAvatar(u.ID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	a.mu.Lock()
	a.currentUser = updated
	a.mu.Unlock()
	return updated, nil
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
