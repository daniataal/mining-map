package shipvault

import (
	"encoding/json"
	"fmt"
	"strings"
)

// SessionFields holds parsed Firebase session JSON from DevTools.
type SessionFields struct {
	IDToken      string
	RefreshToken string
	ExpiresIn    string
}

// ParseSessionJSON parses SHIPVAULT_SESSION_JSON or bootstrap sessionJson bodies.
func ParseSessionJSON(raw string) (SessionFields, error) {
	sess, err := parseFirebaseSession(raw)
	if err != nil {
		return SessionFields{}, err
	}
	return SessionFields{
		IDToken:      sess.IDToken,
		RefreshToken: sess.RefreshToken,
		ExpiresIn:    sess.ExpiresIn,
	}, nil
}

// ParseBootstrapBody extracts a refresh token from bootstrap JSON fields.
func ParseBootstrapBody(refreshToken, sessionJSON string) (string, error) {
	if rt := strings.TrimSpace(refreshToken); rt != "" {
		return rt, nil
	}
	if strings.TrimSpace(sessionJSON) == "" {
		return "", fmt.Errorf("refreshToken or sessionJson required")
	}
	sess, err := ParseSessionJSON(sessionJSON)
	if err != nil {
		return "", err
	}
	if sess.RefreshToken == "" {
		return "", fmt.Errorf("sessionJson missing refreshToken")
	}
	return sess.RefreshToken, nil
}

// MarshalSessionJSON encodes session fields for tests.
func MarshalSessionJSON(sess SessionFields) (string, error) {
	b, err := json.Marshal(map[string]string{
		"idToken":      sess.IDToken,
		"refreshToken": sess.RefreshToken,
		"expiresIn":    sess.ExpiresIn,
	})
	if err != nil {
		return "", err
	}
	return string(b), nil
}
