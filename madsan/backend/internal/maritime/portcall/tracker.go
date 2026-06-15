package portcall

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
	"github.com/madsan/intelligence/internal/maritime/geofence"
)

const outsideCloseHours = 2.0

type Tracker struct {
	pool  *pgxpool.Pool
	index *geofence.Index
	state map[int64]*visitState
}

type visitState struct {
	Inside         bool
	Asset          *geofence.Asset
	VisitID        uuid.UUID
	VesselID       uuid.UUID
	Arrival        time.Time
	LastInside     time.Time
	LastOutside    time.Time
	DraftIn        float64
	DraftOut       float64
	HasDraftIn     bool
	HasDraftOut    bool
	DestinationIn  string
	DestinationOut string
	VesselName     string
	TankerClass    string
}

func NewTracker(pool *pgxpool.Pool, index *geofence.Index) *Tracker {
	return &Tracker{pool: pool, index: index, state: make(map[int64]*visitState)}
}

func (t *Tracker) HandlePosition(ctx context.Context, vesselID uuid.UUID, u Position, tankerClass string) error {
	asset := t.index.Match(u.Lat, u.Lon)
	st, ok := t.state[u.MMSI]
	if !ok {
		st = &visitState{VesselID: vesselID}
		t.state[u.MMSI] = st
	}
	if vesselID != uuid.Nil {
		st.VesselID = vesselID
	}
	st.VesselName = u.Name
	st.TankerClass = tankerClass
	if u.Destination != "" {
		st.DestinationOut = u.Destination
	}

	now := u.Timestamp
	if asset != nil {
		st.LastInside = now
		if !st.Inside {
			st.Inside = true
			st.Asset = asset
			st.Arrival = now
			st.DestinationIn = u.Destination
			if u.HasDraft {
				st.DraftIn = u.DraftM
				st.HasDraftIn = true
			}
			id, err := t.openVisit(ctx, u, asset, st)
			if err != nil {
				return err
			}
			st.VisitID = id
		}
		if u.HasDraft {
			st.DraftOut = u.DraftM
			st.HasDraftOut = true
		}
		return nil
	}

	if st.Inside {
		if st.LastOutside.IsZero() {
			st.LastOutside = now
		}
		if now.Sub(st.LastOutside).Hours() >= outsideCloseHours {
			if err := t.closeVisit(ctx, u.MMSI, st); err != nil {
				return err
			}
			delete(t.state, u.MMSI)
		}
	}
	return nil
}

func (t *Tracker) openVisit(ctx context.Context, u Position, asset *geofence.Asset, st *visitState) (uuid.UUID, error) {
	id := uuid.New()
	mmsi := strconv.FormatInt(u.MMSI, 10)
	var vesselID any
	if st.VesselID != uuid.Nil {
		vesselID = st.VesselID
	}
	_, err := t.pool.Exec(ctx, `
		INSERT INTO port_call_visits (
			id, vessel_id, mmsi, asset_id, arrival_ts, draft_in_m, destination_in, status, event_type
		) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8)
	`, id, vesselID, mmsi, asset.ID, st.Arrival,
		nullableFloat(st.HasDraftIn, st.DraftIn), st.DestinationIn, EventTerminalUnknown)
	return id, err
}

func (t *Tracker) closeVisit(ctx context.Context, mmsi int64, st *visitState) error {
	if st.VisitID == uuid.Nil || st.Asset == nil {
		return nil
	}
	departure := st.LastOutside
	if departure.IsZero() {
		departure = time.Now().UTC()
	}
	durationH := departure.Sub(st.Arrival).Hours()
	draftIn, draftOut := st.DraftIn, st.DraftOut
	hasDraft := st.HasDraftIn && st.HasDraftOut
	eventType := ClassifyEvent(draftIn, draftOut, hasDraft)
	family := geofence.InferProductFamily(st.Asset.Products, st.TankerClass)
	draftDelta := draftOut - draftIn
	conf := scorePortCall(durationH, draftDelta, st.TankerClass, family, st.TankerClass)

	evidence := buildEvidence(st, durationH, draftIn, draftOut, eventType, family, st.Asset.Name)
	evJSON, _ := json.Marshal(evidence)
	metaJSON, _ := json.Marshal(map[string]any{"source": "live_ais", "asset_id": st.Asset.ID.String()})

	_, err := t.pool.Exec(ctx, `
		UPDATE port_call_visits SET
			departure_ts = $2, duration_hours = $3, draft_out_m = $4, draft_delta_m = $5,
			destination_out = $6, event_type = $7, commodity_family = $8,
			status = 'closed', confidence_score = $9, evidence = $10, metadata = $11, updated_at = now()
		WHERE id = $1
	`, st.VisitID, departure, durationH,
		nullableFloat(st.HasDraftOut, draftOut), nullableFloat(hasDraft, draftDelta),
		st.DestinationOut, eventType, family, conf, evJSON, metaJSON)
	if err != nil {
		return err
	}

	mmsiStr := strconv.FormatInt(mmsi, 10)
	if st.VesselID != uuid.Nil {
		if err := intelligence.PersistPortCall(ctx, t.pool, st.VesselID, st.VisitID, st.Asset.ID, eventType, family, conf, evidence); err != nil {
			return err
		}
		if err := upsertVoyageLeg(ctx, t.pool, st, eventType, family, conf, mmsiStr); err != nil {
			return err
		}
	}
	return nil
}

func upsertVoyageLeg(ctx context.Context, pool *pgxpool.Pool, st *visitState, eventType, family string, conf float64, mmsi string) error {
	loadPort := st.Asset.Name
	loadCountry := st.Asset.Country
	dischargePort := ""
	dischargeCountry := ""
	switch eventType {
	case EventPossibleLoading:
		// load at this terminal; discharge unknown until next leg
	case EventPossibleUnloading:
		dischargePort = st.Asset.Name
		dischargeCountry = st.Asset.Country
		loadPort = ""
		loadCountry = ""
	default:
		loadPort = st.Asset.Name
	}
	meta, _ := json.Marshal(map[string]any{
		"port_call_visit_id": st.VisitID.String(),
		"event_type":         eventType,
		"source":             "live_ais",
	})
	_, err := pool.Exec(ctx, `
		INSERT INTO voyages (
			vessel_id, mmsi, load_port_name, load_country,
			discharge_port_name, discharge_country, commodity_family,
			started_at, ended_at, confidence_score, tier, metadata
		) VALUES (
			$1, $2, NULLIF($3,''), NULLIF($4,''),
			NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
			$8, $9, $10, 'observed', $11
		)
	`, st.VesselID, mmsi, loadPort, loadCountry, dischargePort, dischargeCountry, family,
		st.Arrival, st.LastOutside, conf, meta)
	return err
}

func buildEvidence(st *visitState, durationH, draftIn, draftOut float64, eventType, family, assetName string) []string {
	out := []string{
		fmt.Sprintf("Vessel inside %s geofence", assetName),
		fmt.Sprintf("Stay duration: %.1f hours", durationH),
		"Inferred from public AIS — not a confirmed private transaction",
	}
	if st.HasDraftIn && st.HasDraftOut {
		out = append(out, fmt.Sprintf("Draft changed from %.1fm to %.1fm", draftIn, draftOut))
	}
	if st.TankerClass != "" && st.TankerClass != "unknown" {
		out = append(out, fmt.Sprintf("Vessel classified as %s tanker", st.TankerClass))
	}
	if family != "" {
		out = append(out, fmt.Sprintf("Terminal product family: %s", family))
	}
	out = append(out, fmt.Sprintf("Event classification: %s", eventType))
	return out
}

func scorePortCall(durationH, draftDelta float64, tankerClass, family, tclass string) float64 {
	conf := 45.0
	if durationH >= 2 {
		conf += 15
	}
	if durationH >= 6 {
		conf += 10
	}
	if abs(draftDelta) >= 1 {
		conf += 15
	}
	if tankerClass != "" && tankerClass != "unknown" {
		conf += 10
	}
	if family != "" && family != "petroleum" {
		conf += 5
	}
	if conf > 95 {
		return 95
	}
	return conf
}

func CloseStaleOpenVisits(ctx context.Context, pool *pgxpool.Pool, index *geofence.Index) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT pc.id, pc.mmsi, pc.asset_id, pc.arrival_ts, pc.draft_in_m, pc.destination_in, pc.vessel_id
		FROM port_call_visits pc
		WHERE pc.status = 'open' AND pc.arrival_ts < now() - interval '48 hours'
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	tr := NewTracker(pool, index)
	closed := 0
	for rows.Next() {
		var id, assetID, vesselID uuid.UUID
		var mmsi string
		var arrival time.Time
		var draftIn *float64
		var destIn *string
		if err := rows.Scan(&id, &mmsi, &assetID, &arrival, &draftIn, &destIn, &vesselID); err != nil {
			return closed, err
		}
		asset := index.ByID(assetID)
		if asset == nil {
			continue
		}
		mmsiInt, _ := strconv.ParseInt(mmsi, 10, 64)
		st := &visitState{
			Inside: true, VisitID: id, Asset: asset, Arrival: arrival,
			LastOutside: time.Now().UTC(), VesselID: vesselID,
		}
		if draftIn != nil {
			st.DraftIn = *draftIn
			st.HasDraftIn = true
			st.DraftOut = *draftIn
			st.HasDraftOut = true
		}
		if destIn != nil {
			st.DestinationIn = *destIn
		}
		if err := tr.closeVisit(ctx, mmsiInt, st); err == nil {
			closed++
		}
	}
	return closed, rows.Err()
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
