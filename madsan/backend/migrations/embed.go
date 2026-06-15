package migrations

import "embed"

// FS contains golang-migrate SQL files.
//
//go:embed *.up.sql
var FS embed.FS
