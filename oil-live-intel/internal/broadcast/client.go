package broadcast

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/mining-map/oil-live-intel/internal/config"
)

// Post sends an event to the API WebSocket hub via internal broadcast.
func Post(cfg config.Config, eventType string, data map[string]any) {
	if cfg.InternalBroadcastKey == "" || cfg.APIBaseURL == "" {
		return
	}
	body, _ := json.Marshal(map[string]any{"type": eventType, "data": data})
	url := strings.TrimRight(cfg.APIBaseURL, "/") + "/api/oil-live/internal/broadcast"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Oil-Intel-Internal", cfg.InternalBroadcastKey)
	client := &http.Client{Timeout: 3 * time.Second}
	_, _ = client.Do(req)
}
