package portcall

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/services/ais"
	"github.com/mining-map/oil-live-intel/internal/services/confidence"
	"github.com/mining-map/oil-live-intel/internal/services/geofence"
	"github.com/mining-map/oil-live-intel/internal/services/intel"
	"github.com/mining-map/oil-live-intel/internal/services/volume"
)

const outsideCloseHours = 2.0

// Tracker maintains per-MMSI visit state.
type Tracker struct {
	pool  *pgxpool.Pool
	index *geofence.Index
	state map[int64]*visitState
}

type visitState struct {
	Inside           bool
	Terminal         *geofence.Terminal
	PortCallID       uuid.UUID
	Arrival          time.Time
	LastInside       time.Time
	LastOutside      time.Time
	DraftIn          float64
	DraftOut         float64
	HasDraftIn       bool
	HasDraftOut      bool
	DestinationIn    string
	DestinationOut   string
	VesselName       string
	TankerClass      string
	CrudeCapable     bool
	ProductTanker    bool
	DeadweightTons   float64
	MaxDraftM        float64
}

// NewTracker creates a port-call tracker.
func NewTracker(pool *pgxpool.Pool, index *geofence.Index) *Tracker {
	return &Tracker{pool: pool, index: index, state: make(map[int64]*visitState)}
}

// HandlePosition processes one AIS update after vessel row is upserted.
func (t *Tracker) HandlePosition(ctx context.Context, u *ais.Update, tankerClass string, crude, product bool, dwt, maxDraft float64) (*intel.CardResult, error) {
	term := t.index.Match(u.Lat, u.Lon)
	st, ok := t.state[u.MMSI]
	if !ok {
		st = &visitState{}
		t.state[u.MMSI] = st
	}
	st.VesselName = u.Name
	st.TankerClass = tankerClass
	st.CrudeCapable = crude
	st.ProductTanker = product
	st.DeadweightTons = dwt
	st.MaxDraftM = maxDraft
	if u.Destination != "" {
		st.DestinationOut = u.Destination
	}

	now := u.Timestamp
	if term != nil {
		st.LastInside = now
		if !st.Inside {
			st.Inside = true
			st.Terminal = term
			st.Arrival = now
			st.DestinationIn = u.Destination
			if u.HasDraft {
				st.DraftIn = u.DraftM
				st.HasDraftIn = true
			}
			id, err := t.openPortCall(ctx, u, term, st)
			if err != nil {
				return nil, err
			}
			st.PortCallID = id
		}
		if u.HasDraft {
			st.DraftOut = u.DraftM
			st.HasDraftOut = true
		}
		return nil, nil
	}

	// outside
	if st.Inside {
		if st.LastOutside.IsZero() {
			st.LastOutside = now
		}
		hours := now.Sub(st.LastOutside).Hours()
		if hours >= outsideCloseHours {
			card, err := t.closePortCall(ctx, u.MMSI, st)
			delete(t.state, u.MMSI)
			return card, err
		}
	}
	return nil, nil
}

func (t *Tracker) openPortCall(ctx context.Context, u *ais.Update, term *geofence.Terminal, st *visitState) (uuid.UUID, error) {
	id := uuid.New()
	_, err := t.pool.Exec(ctx, `
		INSERT INTO oil_port_calls (id, mmsi, vessel_name, terminal_id, arrival_ts, draft_in, destination_in, status, event_type)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'open','terminal_visit_unknown')
	`, id, u.MMSI, u.Name, term.ID, st.Arrival, nullableFloat(st.HasDraftIn, st.DraftIn), st.DestinationIn)
	return id, err
}

func (t *Tracker) closePortCall(ctx context.Context, mmsi int64, st *visitState) (*intel.CardResult, error) {
	if st.PortCallID == uuid.Nil || st.Terminal == nil {
		return nil, nil
	}
	departure := st.LastOutside
	if departure.IsZero() {
		departure = time.Now().UTC()
	}
	durationH := departure.Sub(st.Arrival).Hours()
	draftIn, draftOut := st.DraftIn, st.DraftOut
	hasDraft := st.HasDraftIn && st.HasDraftOut
	eventType := ClassifyEvent(draftIn, draftOut, hasDraft)
	family := geofence.InferProductFamily(st.Terminal.Products, st.TankerClass)
	draftDelta := draftOut - draftIn
	estVol, hasVol := volume.EstimateBarrels(st.DeadweightTons, draftDelta, st.MaxDraftM)

	matchProduct := family == "crude_oil" && st.CrudeCapable || family == "refined_products" && st.ProductTanker
	conf := confidence.ScorePortCall(confidence.Input{
		InsideTerminal:          true,
		DurationHours:           durationH,
		DraftDeltaAbs:           abs(draftDelta),
		KnownTanker:             st.TankerClass != "" && st.TankerClass != "unknown",
		DestinationKnown:        st.DestinationOut != "" || st.DestinationIn != "",
		MatchingProductTerminal: matchProduct,
	})

	evidence := buildEvidence(st, durationH, draftIn, draftOut, eventType, family)
	evJSON, _ := json.Marshal(evidence)
	metaJSON, _ := json.Marshal(map[string]any{"source": "live_ais"})

	_, err := t.pool.Exec(ctx, `
		UPDATE oil_port_calls SET
			departure_ts=$2, duration_hours=$3, draft_out=$4, draft_delta=$5,
			destination_out=$6, event_type=$7, product_family_inferred=$8,
			estimated_volume_barrels=$9, confidence=$10, status='closed', evidence=$11,
			metadata=$12, updated_at=now()
		WHERE id=$1
	`, st.PortCallID, departure, durationH,
		nullableFloat(st.HasDraftOut, draftOut), draftDelta,
		st.DestinationOut, eventType, family,
		nullableFloat(hasVol, estVol), conf, evJSON, metaJSON)
	if err != nil {
		return nil, err
	}

	return intel.Generate(ctx, t.pool, intel.GenerateInput{
		PortCallID:      st.PortCallID,
		Terminal:        st.Terminal,
		MMSI:            mmsi,
		VesselName:      st.VesselName,
		EventType:       eventType,
		ProductFamily:   family,
		DurationHours:   durationH,
		DraftIn:         draftIn,
		DraftOut:        draftOut,
		HasDraft:        hasDraft,
		EstBarrels:      estVol,
		HasVolume:       hasVol,
		Confidence:      conf,
		Evidence:        evidence,
	})
}

func buildEvidence(st *visitState, durationH, draftIn, draftOut float64, eventType, family string) []string {
	out := []string{
		"Vessel stopped inside terminal geometry",
		fmt.Sprintf("Stay duration: %.1f hours", durationH),
		"Inferred from public AIS — not a confirmed private transaction",
	}
	if st.HasDraftIn && st.HasDraftOut {
		out = append(out, fmt.Sprintf("Draft changed from %.1fm to %.1fm", draftIn, draftOut))
	}
	if st.TankerClass != "" {
		out = append(out, fmt.Sprintf("Vessel classified as %s tanker", st.TankerClass))
	}
	if family != "" {
		out = append(out, fmt.Sprintf("Terminal product family: %s", family))
	}
	out = append(out, fmt.Sprintf("Event classification: %s", eventType))
	return out
}

func nullableFloat(ok bool, v float64) any {
	if !ok {
		return nil
	}
	return v
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// CloseStaleOpenCalls closes DB rows open > 48h without recent inside signal.
func CloseStaleOpenCalls(ctx context.Context, pool *pgxpool.Pool, index *geofence.Index) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, pc.terminal_id, pc.arrival_ts, pc.draft_in, pc.destination_in,
			v.name, v.tanker_class, v.crude_capable, v.product_tanker, v.deadweight_tons, v.max_draft_m
		FROM oil_port_calls pc
		LEFT JOIN oil_vessels v ON v.mmsi = pc.mmsi
		WHERE pc.status='open' AND pc.arrival_ts < now() - interval '48 hours'
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	tr := NewTracker(pool, index)
	closed := 0
	for rows.Next() {
		var id, tid uuid.UUID
		var mmsi int64
		var arrival time.Time
		var vessel, tclass, destIn *string
		var draftIn, dwt, maxDraft *float64
		var crude, product *bool
		if err := rows.Scan(&id, &mmsi, &tid, &arrival, &draftIn, &destIn, &vessel, &tclass, &crude, &product, &dwt, &maxDraft); err != nil {
			return closed, err
		}
		term := index.ByID(tid)
		if term == nil {
			continue
		}
		st := &visitState{
			Inside: true, PortCallID: id, Terminal: term, Arrival: arrival,
			LastOutside: time.Now().UTC(), VesselName: strPtr(vessel),
			TankerClass: strPtr(tclass), CrudeCapable: boolPtr(crude), ProductTanker: boolPtr(product),
		}
		if draftIn != nil {
			st.DraftIn = *draftIn
			st.HasDraftIn = true
			st.DraftOut = *draftIn
			st.HasDraftOut = true
		}
		if dwt != nil {
			st.DeadweightTons = *dwt
		}
		if maxDraft != nil {
			st.MaxDraftM = *maxDraft
		}
		if destIn != nil {
			st.DestinationIn = *destIn
		}
		if _, err := tr.closePortCall(ctx, mmsi, st); err == nil {
			closed++
		}
	}
	return closed, rows.Err()
}

func strPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func boolPtr(b *bool) bool {
	return b != nil && *b
}
