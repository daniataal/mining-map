package ais

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gorilla/websocket"
)

// BoundingBox is [[latMin, lonMin], [latMax, lonMax]] per AISStream API.
type BoundingBox [2][2]float64

type Subscription struct {
	APIKey       string
	BoundingBoxes []BoundingBox
}

// StreamHandler is called for each relevant parsed update.
type StreamHandler func(ctx context.Context, u *Update) error

func RunStream(ctx context.Context, sub Subscription, handler StreamHandler, insecureTLS bool) error {
	return runStream(ctx, sub, handler, insecureTLS)
}

// RunStreamWithTLSFallback dials with verify on first; on upstream cert expiry retries once
// with InsecureSkipVerify when autoFallback is true (mirrors Python maritime_ssl.py).
func RunStreamWithTLSFallback(
	ctx context.Context,
	sub Subscription,
	handler StreamHandler,
	insecureTLS bool,
	autoFallback bool,
) error {
	if insecureTLS {
		return runStream(ctx, sub, handler, true)
	}
	err := runStream(ctx, sub, handler, false)
	if err == nil || !autoFallback || !IsCertificateExpiredError(err) {
		return err
	}
	return runStream(ctx, sub, handler, true)
}

func runStream(ctx context.Context, sub Subscription, handler StreamHandler, insecureTLS bool) error {
	if sub.APIKey == "" {
		return fmt.Errorf("aisstream api key missing")
	}
	if len(sub.BoundingBoxes) == 0 {
		return fmt.Errorf("no bounding boxes for subscription")
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
		TLSClientConfig:  &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: insecureTLS}, //nolint:gosec // dev-only when env-gated
	}
	conn, _, err := dialer.DialContext(ctx, StreamURL, nil)
	if err != nil {
		return fmt.Errorf("aisstream connect: %w", err)
	}
	defer conn.Close()

	payload := map[string]any{
		"APIKey": sub.APIKey,
		"BoundingBoxes": sub.BoundingBoxes,
		"FilterMessageTypes": []string{
			"PositionReport",
			"StandardClassBPositionReport",
			"ExtendedClassBPositionReport",
			"ShipStaticData",
			"StaticDataReport",
		},
	}
	if err := conn.WriteJSON(payload); err != nil {
		return fmt.Errorf("aisstream subscribe: %w", err)
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("aisstream read: %w", err)
		}
		// skip non-json
		if len(data) == 0 || data[0] != '{' {
			continue
		}
		u, ok := ParseMessage(data)
		if !ok {
			continue
		}
		if err := handler(ctx, u); err != nil {
			return err
		}
	}
}

// BuildTerminalBoxes clusters terminal coordinates into AISStream bounding boxes.
func BuildTerminalBoxes(lats, lons []float64, bufferDeg float64) []BoundingBox {
	if len(lats) == 0 {
		return nil
	}
	minLat, maxLat := lats[0], lats[0]
	minLon, maxLon := lons[0], lons[0]
	for i := range lats {
		if lats[i] < minLat {
			minLat = lats[i]
		}
		if lats[i] > maxLat {
			maxLat = lats[i]
		}
		if lons[i] < minLon {
			minLon = lons[i]
		}
		if lons[i] > maxLon {
			maxLon = lons[i]
		}
	}
	minLat -= bufferDeg
	maxLat += bufferDeg
	minLon -= bufferDeg
	maxLon += bufferDeg
	// clamp
	if minLat < -90 {
		minLat = -90
	}
	if maxLat > 90 {
		maxLat = 90
	}
	if minLon < -180 {
		minLon = -180
	}
	if maxLon > 180 {
		maxLon = 180
	}
	return []BoundingBox{{{minLat, minLon}, {maxLat, maxLon}}}
}

// BoxesFromJSON decodes stored subscription JSON.
func BoxesFromJSON(raw []byte) ([]BoundingBox, error) {
	var boxes []BoundingBox
	if err := json.Unmarshal(raw, &boxes); err != nil {
		return nil, err
	}
	return boxes, nil
}
