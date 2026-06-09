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

	"github.com/madsan/intelligence/internal/maritime"
)

type ViewportSub struct {
	BBox   [4]float64 `json:"bbox"`
	Zoom   float64    `json:"zoom"`
	Layers []string   `json:"layers"`
}

type client struct {
	conn *websocket.Conn
	sub  ViewportSub
	send chan []byte
}

type Hub struct {
	log        zerolog.Logger
	pool       *pgxpool.Pool
	clients    map[*client]bool
	register   chan *client
	unregister chan *client
	broadcast  chan []byte
	mu         sync.RWMutex
}

func NewHub(log zerolog.Logger) *Hub {
	return &Hub{
		log:        log,
		clients:    make(map[*client]bool),
		register:   make(chan *client),
		unregister: make(chan *client),
		broadcast:  make(chan []byte, 256),
	}
}

func (h *Hub) SetPool(pool *pgxpool.Pool) {
	h.pool = pool
}

func (h *Hub) Run() {
	ticker := time.NewTicker(30 * time.Second)
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
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
		case msg := <-h.broadcast:
			h.mu.RLock()
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
				}
			}
			h.mu.RUnlock()
		case <-ticker.C:
			h.pushHeartbeat()
		}
	}
}

func (h *Hub) pushHeartbeat() {
	b, _ := json.Marshal(map[string]string{"type": "heartbeat", "ts": time.Now().UTC().Format(time.RFC3339)})
	h.broadcast <- b
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &client{conn: conn, send: make(chan []byte, 64)}
	h.register <- c
	go c.writePump()
	go c.readPump(h)
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
			c.sub = sub
			h.sendSnapshot(c, sub)
		}
	}
}

func (h *Hub) sendSnapshot(c *client, sub ViewportSub) {
	vessels := []maritime.VesselDelta{}
	if h.pool != nil && sub.BBox[2] > sub.BBox[0] && sub.BBox[3] > sub.BBox[1] {
		if snap, err := maritime.Snapshot(context.Background(), h.pool, sub.BBox, 200); err == nil {
			vessels = snap
		}
	}
	snap, _ := json.Marshal(map[string]any{
		"type":    "snapshot",
		"vessels": vessels,
		"ts":      time.Now().UTC().Format(time.RFC3339),
		"source":  "madsan_vessels",
	})
	select {
	case c.send <- snap:
	default:
	}
}

func (c *client) writePump() {
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (h *Hub) PublishVesselDelta(d maritime.VesselDelta) {
	b, err := json.Marshal(map[string]any{"type": "delta", "entity": "vessel", "data": d})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.sub.BBox[2] <= c.sub.BBox[0] || !maritime.InBBox(d.Lat, d.Lon, c.sub.BBox) {
			continue
		}
		select {
		case c.send <- b:
		default:
		}
	}
}
