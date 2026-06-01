package migrations

import "embed"

// SQL files applied in lexical order by the db package.
//
//go:embed *.sql
var SQL embed.FS
