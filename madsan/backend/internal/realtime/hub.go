package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/vmihailenco/msgpack/v5"

	"github.com/madsan/intelligence/internal/maritime"
)

type ViewportSub struct {
	BBox   [4]float64 `json:"bbox"`
	Zoom   float64    `json:"zoom"`
	Layers []string   `json:"layers"`
}

type wsFrame struct {
	payload []byte
	typ     int
}

// viewportSnapshotDebounce coalesces pan/zoom sub updates into one DB gap-fill
// snapshot after the viewport settles (avoids chunky per-moveend queries).
const viewportSnapshotDebounce = 2 * time.Second

type client struct {
	conn       *websocket.Conn
	sub        ViewportSub
	send       chan wsFrame
	useMsgpack bool

	mu                sync.Mutex
	snapshotReady     bool
	viewportSnapTimer *time.Timer
}

// snapshotFallbackAfter is how long without a live delta before periodic viewport
// snapshots resume (safety net when NOTIFY/listener is down).
const snapshotFallbackAfter = 45 * time.Second

// liveSnapshotLimit caps vessels per viewport WS snapshot (additive live overlay; tiles cover the rest).
const liveSnapshotLimit = 2000

type Hub struct {
	log        zerolog.Logger
	pool       *pgxpool.Pool
	clients    map[*client]bool
	register   chan *client
	unregister chan *client
	mu         sync.RWMutex
	deltaMu    sync.RWMutex
	lastDeltaAt time.Time
}

func NewHub(log zerolog.Logger) *Hub {
	return &Hub{
		log:        log,
		clients:    make(map[*client]bool),
		register:   make(chan *client),
		unregister: make(chan *client),
	}
}

func (h *Hub) SetPool(pool *pgxpool.Pool) {
	h.pool = pool
}

func (h *Hub) Run() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				c.stopViewportSnapTimer()
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
		case <-ticker.C:
			h.pushHeartbeat()
			h.refreshSnapshots()
		}
	}
}

func (h *Hub) pushHeartbeat() {
	payload := map[string]string{"type": "heartbeat", "ts": time.Now().UTC().Format(time.RFC3339)}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		h.sendTo(c, payload)
	}
}

// refreshSnapshots re-sends viewport vessel snapshots when live deltas have
// stalled (e.g. ais-ingest disconnected). Skipped while deltas are flowing so
// clients can dead-reckon smoothly without full-state replace jitter.
func (h *Hub) refreshSnapshots() {
	if h.pool == nil || !h.deltasStalled() {
		return
	}
	h.mu.RLock()
	subs := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		if c.sub.BBox[2] > c.sub.BBox[0] && c.sub.BBox[3] > c.sub.BBox[1] {
			subs = append(subs, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range subs {
		h.sendSnapshot(c, c.sub)
	}
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	useMsgpack := r.URL.Query().Get("format") == "msgpack"
	c := &client{conn: conn, send: make(chan wsFrame, 256), useMsgpack: useMsgpack}
	h.register <- c
	go c.writePump()
	go c.readPump(h)
}

func (c *client) marshal(v any) (wsFrame, error) {
	if c.useMsgpack {
		b, err := msgpack.Marshal(v)
		if err != nil {
			return wsFrame{}, err
		}
		return wsFrame{payload: b, typ: websocket.BinaryMessage}, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return wsFrame{}, err
	}
	return wsFrame{payload: b, typ: websocket.TextMessage}, nil
}

func (h *Hub) sendTo(c *client, v any) {
	f, err := c.marshal(v)
	if err != nil {
		return
	}
	select {
	case c.send <- f:
	default:
	}
}

func (c *client) readPump(h *Hub) {
	defer func() {
		h.unregister <- c
		c.conn.Close()
	}()
	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var sub ViewportSub
		if json.Unmarshal(msg, &sub) == nil {
			h.onViewportSub(c, sub)
		}
	}
}

func (c *client) stopViewportSnapTimer() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.viewportSnapTimer != nil {
		c.viewportSnapTimer.Stop()
		c.viewportSnapTimer = nil
	}
}

// onViewportSub updates the client bbox filter for live deltas. The first sub
// bootstraps from DB; later subs debounce a gap-fill snapshot so panning does
// not query Postgres on every moveend while stationary vessels still appear.
func (h *Hub) onViewportSub(c *client, sub ViewportSub) {
	c.sub = sub

	c.mu.Lock()
	if !c.snapshotReady {
		c.snapshotReady = true
		c.mu.Unlock()
		h.sendSnapshot(c, sub)
		return
	}
	if c.viewportSnapTimer != nil {
		c.viewportSnapTimer.Stop()
	}
	c.viewportSnapTimer = time.AfterFunc(viewportSnapshotDebounce, func() {
		c.mu.Lock()
		c.viewportSnapTimer = nil
		bbox := c.sub.BBox
		c.mu.Unlock()
		if bbox[2] > bbox[0] && bbox[3] > bbox[1] {
			h.sendSnapshot(c, c.sub)
		}
	})
	c.mu.Unlock()
}

func (h *Hub) sendSnapshot(c *client, sub ViewportSub) {
	vessels := []maritime.VesselDelta{}
	if h.pool != nil && sub.BBox[2] > sub.BBox[0] && sub.BBox[3] > sub.BBox[1] {
		if snap, err := maritime.SnapshotLive(context.Background(), h.pool, sub.BBox, liveSnapshotLimit); err == nil {
			vessels = snap
		}
	}
	h.sendTo(c, map[string]any{
		"type":    "snapshot",
		"vessels": vessels,
		"ts":      time.Now().UTC().Format(time.RFC3339),
		"source":  "madsan_vessels",
	})
}

func (c *client) writePump() {
	for f := range c.send {
		if err := c.conn.WriteMessage(f.typ, f.payload); err != nil {
			return
		}
	}
}

func (h *Hub) PublishVesselDelta(d maritime.VesselDelta) {
	h.deltaMu.Lock()
	h.lastDeltaAt = time.Now()
	h.deltaMu.Unlock()

	payload := map[string]any{"type": "delta", "entity": "vessel", "data": d}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.sub.BBox[2] <= c.sub.BBox[0] || !maritime.InBBox(d.Lat, d.Lon, c.sub.BBox) {
			continue
		}
		h.sendTo(c, payload)
	}
}

func (h *Hub) deltasStalled() bool {
	h.deltaMu.RLock()
	defer h.deltaMu.RUnlock()
	if h.lastDeltaAt.IsZero() {
		return true
	}
	return time.Since(h.lastDeltaAt) >= snapshotFallbackAfter
}
