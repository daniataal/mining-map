package api

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/madsan/intelligence/internal/maritime"
	"github.com/madsan/intelligence/internal/realtime"
)

// startAISDeltaListener LISTENs for vessel_delta NOTIFY payloads from cmd/ais-ingest
// and pushes them to connected WebSocket clients.
func (s *Server) startAISDeltaListener(ctx context.Context) {
	if s.cfg.DatabaseURL == "" || s.hub == nil {
		return
	}
	go func() {
		backoff := 2 * time.Second
		for {
			if ctx.Err() != nil {
				return
			}
			if err := s.listenVesselDeltasOnce(ctx); err != nil && ctx.Err() == nil {
				s.log.Warn().Err(err).Dur("retry_in", backoff).Msg("vessel delta listener disconnected")
				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}
				if backoff < 30*time.Second {
					backoff *= 2
				}
				continue
			}
			backoff = 2 * time.Second
		}
	}()
}

func (s *Server) listenVesselDeltasOnce(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, s.cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer conn.Close(context.WithoutCancel(ctx))

	if _, err := conn.Exec(ctx, "LISTEN "+realtime.VesselDeltaChannel); err != nil {
		return err
	}
	s.log.Info().Str("channel", realtime.VesselDeltaChannel).Msg("vessel delta listener started")

	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if n == nil || n.Payload == "" {
			continue
		}
		var d maritime.VesselDelta
		if json.Unmarshal([]byte(n.Payload), &d) != nil || d.MMSI == "" {
			continue
		}
		maritime.SanitizeVesselDelta(&d)
		s.hub.PublishVesselDelta(d)
	}
}
