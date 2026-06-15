package equasis

import "errors"

// ErrNotFound means Equasis returned no ship for the IMO.
var ErrNotFound = errors.New("equasis: ship not found")
