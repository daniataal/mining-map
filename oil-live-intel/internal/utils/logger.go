package utils

import (
	"os"
	"time"

	"github.com/rs/zerolog"
)

func NewLogger() zerolog.Logger {
	zerolog.TimeFieldFormat = time.RFC3339
	return zerolog.New(os.Stdout).With().Timestamp().Logger()
}
