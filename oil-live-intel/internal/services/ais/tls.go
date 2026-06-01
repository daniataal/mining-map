package ais

import (
	"errors"
	"strings"
)

// IsCertificateExpiredError reports whether err indicates an upstream AISStream cert expiry.
func IsCertificateExpiredError(err error) bool {
	for err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "certificate has expired") || strings.Contains(msg, "cert has expired") {
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}
