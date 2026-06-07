package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type WorkspaceEntity struct {
	ID               string          `json:"id"`
	WorkspaceID      string          `json:"workspace_id"`
	EntityType       string          `json:"entity_type"`
	RefKind          string          `json:"ref_kind"`
	RefID            *string         `json:"ref_id,omitempty"`
	DisplayName      string          `json:"display_name"`
	Lat              float64         `json:"lat"`
	Lng              float64         `json:"lng"`
	DealSignal       string          `json:"deal_signal"`
	DdStage          string          `json:"dd_stage"`
	InDdQueue        bool            `json:"in_dd_queue"`
	PackedIntoPackID *string         `json:"packed_into_pack_id,omitempty"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type BrokerDealPack struct {
	ID                   string          `json:"id"`
	WorkspaceID          string          `json:"workspace_id"`
	UserID               string          `json:"user_id"`
	Name                 string          `json:"name"`
	MapLat               *float64        `json:"map_lat,omitempty"`
	MapLng               *float64        `json:"map_lng,omitempty"`
	Status               string          `json:"status"`
	Journal              json.RawMessage `json:"journal"`
	Transport            json.RawMessage `json:"transport"`
	Economics            json.RawMessage `json:"economics"`
	ConstituentEntityIDs []string        `json:"constituent_entity_ids"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
}

type DealPackFollowup struct {
	ID              string     `json:"id"`
	PackID          string     `json:"pack_id"`
	RemindAt        time.Time  `json:"remind_at"`
	Title           string     `json:"title"`
	Message         string     `json:"message,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	DeliveryChannel string     `json:"delivery_channel"`
	CreatedAt       time.Time  `json:"created_at"`
}

func scanWorkspaceEntity(row pgx.Row) (WorkspaceEntity, error) {
	var e WorkspaceEntity
	var refID, packedID *string
	var meta []byte
	err := row.Scan(
		&e.ID, &e.WorkspaceID, &e.EntityType, &e.RefKind, &refID,
		&e.DisplayName, &e.Lat, &e.Lng, &e.DealSignal, &e.DdStage, &e.InDdQueue,
		&packedID, &meta, &e.CreatedAt, &e.UpdatedAt,
	)
	e.RefID = refID
	e.PackedIntoPackID = packedID
	e.Metadata = brokerJSONOrEmpty(meta)
	return e, err
}

func scanBrokerDealPack(row pgx.Row) (BrokerDealPack, error) {
	var p BrokerDealPack
	var mapLat, mapLng *float64
	var journal, transport, economics []byte
	var constituentIDs []string
	err := row.Scan(
		&p.ID, &p.WorkspaceID, &p.UserID, &p.Name, &mapLat, &mapLng, &p.Status,
		&journal, &transport, &economics, &constituentIDs, &p.CreatedAt, &p.UpdatedAt,
	)
	p.MapLat = mapLat
	p.MapLng = mapLng
	p.Journal = brokerJSONOrEmpty(journal)
	p.Transport = brokerJSONOrEmpty(transport)
	p.Economics = brokerJSONOrEmpty(economics)
	p.ConstituentEntityIDs = constituentIDs
	if p.ConstituentEntityIDs == nil {
		p.ConstituentEntityIDs = []string{}
	}
	return p, err
}

func (s *Server) UpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	_, err := s.Pool.Exec(ctx, `
		UPDATE user_workspaces SET
			name = COALESCE($3, name),
			description = COALESCE($4, description),
			updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, wsID, userID, req.Name, req.Description)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) DeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var isDefault bool
	_ = s.Pool.QueryRow(ctx, `SELECT is_default FROM user_workspaces WHERE id = $1`, wsID).Scan(&isDefault)
	if isDefault {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot delete default workspace"})
		return
	}
	_, err := s.Pool.Exec(ctx, `DELETE FROM user_workspaces WHERE id = $1 AND user_id = $2`, wsID, userID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) ListWorkspaceEntities(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	looseOnly := r.URL.Query().Get("loose") == "true"
	q := `
		SELECT id, workspace_id, entity_type, ref_kind, ref_id, display_name, lat, lng,
			deal_signal, dd_stage, in_dd_queue, packed_into_pack_id, metadata, created_at, updated_at
		FROM workspace_entities WHERE workspace_id = $1`
	if looseOnly {
		q += ` AND packed_into_pack_id IS NULL`
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.Pool.Query(ctx, q, wsID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer rows.Close()
	var entities []WorkspaceEntity
	for rows.Next() {
		e, err := scanWorkspaceEntity(rows)
		if err == nil {
			entities = append(entities, e)
		}
	}
	if entities == nil {
		entities = []WorkspaceEntity{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entities": entities})
}

func (s *Server) CreateWorkspaceEntity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req WorkspaceEntity
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.EntityType == "" || req.DisplayName == "" {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.RefKind == "" {
		req.RefKind = "custom"
	}
	if req.DealSignal == "" {
		req.DealSignal = "maybe"
	}
	if req.DdStage == "" {
		req.DdStage = "New"
	}
	meta := req.Metadata
	if meta == nil {
		meta = json.RawMessage(`{}`)
	}
	var id string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO workspace_entities (
			workspace_id, entity_type, ref_kind, ref_id, display_name, lat, lng,
			deal_signal, dd_stage, in_dd_queue, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (workspace_id, ref_kind, ref_id) WHERE ref_id IS NOT NULL AND ref_id <> ''
		DO UPDATE SET
			display_name = EXCLUDED.display_name,
			lat = EXCLUDED.lat,
			lng = EXCLUDED.lng,
			deal_signal = EXCLUDED.deal_signal,
			dd_stage = EXCLUDED.dd_stage,
			in_dd_queue = EXCLUDED.in_dd_queue,
			metadata = EXCLUDED.metadata,
			updated_at = now()
		RETURNING id
	`, wsID, req.EntityType, req.RefKind, req.RefID, req.DisplayName, req.Lat, req.Lng,
		req.DealSignal, req.DdStage, req.InDdQueue, meta).Scan(&id)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}

func (s *Server) ImportSearchEntity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		HitType     string  `json:"hit_type"`
		RefID       string  `json:"ref_id"`
		DisplayName string  `json:"display_name"`
		Lat         float64 `json:"lat"`
		Lng         float64 `json:"lng"`
		EntityType  string  `json:"entity_type"`
		DealSignal  string  `json:"deal_signal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	refKind := "custom"
	switch req.HitType {
	case "vessel":
		refKind = "vessel"
	case "terminal":
		refKind = "terminal"
	case "company", "organization":
		refKind = "oil_company"
	case "license":
		refKind = "license"
	}
	if req.EntityType == "" {
		req.EntityType = "supplier"
	}
	if req.DealSignal == "" {
		req.DealSignal = "good"
	}
	meta, _ := json.Marshal(map[string]string{"import_source": "search"})
	var id string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO workspace_entities (
			workspace_id, entity_type, ref_kind, ref_id, display_name, lat, lng,
			deal_signal, dd_stage, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'New',$9)
		ON CONFLICT (workspace_id, ref_kind, ref_id) WHERE ref_id IS NOT NULL AND ref_id <> ''
		DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
		RETURNING id
	`, wsID, req.EntityType, refKind, req.RefID, req.DisplayName, req.Lat, req.Lng,
		req.DealSignal, meta).Scan(&id)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "imported"})
}

func (s *Server) UpdateWorkspaceEntity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	eid := entityIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		DisplayName *string          `json:"display_name"`
		Lat         *float64         `json:"lat"`
		Lng         *float64         `json:"lng"`
		DealSignal  *string          `json:"deal_signal"`
		DdStage     *string          `json:"dd_stage"`
		InDdQueue   *bool            `json:"in_dd_queue"`
		Metadata    *json.RawMessage `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	tag, err := s.Pool.Exec(ctx, `
		UPDATE workspace_entities SET
			display_name = COALESCE($3, display_name),
			lat = COALESCE($4, lat),
			lng = COALESCE($5, lng),
			deal_signal = COALESCE($6, deal_signal),
			dd_stage = COALESCE($7, dd_stage),
			in_dd_queue = COALESCE($8, in_dd_queue),
			metadata = COALESCE($9, metadata),
			updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, eid, wsID, req.DisplayName, req.Lat, req.Lng, req.DealSignal, req.DdStage, req.InDdQueue, req.Metadata)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeBrokerErr(w, errEntityNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) DeleteWorkspaceEntity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	eid := entityIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	tag, err := s.Pool.Exec(ctx, `DELETE FROM workspace_entities WHERE id = $1 AND workspace_id = $2`, eid, wsID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeBrokerErr(w, errEntityNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) ListBrokerDealPacks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, workspace_id, user_id, name, map_lat, map_lng, status,
			journal, transport, economics, constituent_entity_ids, created_at, updated_at
		FROM broker_deal_packs WHERE workspace_id = $1 AND user_id = $2
		ORDER BY updated_at DESC
	`, wsID, userID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer rows.Close()
	var packs []BrokerDealPack
	for rows.Next() {
		p, err := scanBrokerDealPack(rows)
		if err == nil {
			packs = append(packs, p)
		}
	}
	if packs == nil {
		packs = []BrokerDealPack{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"packs": packs})
}

func (s *Server) CreateBrokerDealPack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		Name                 string   `json:"name"`
		ConstituentEntityIDs []string `json:"constituent_entity_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.Name == "" {
		req.Name = "New Deal Pack"
	}
	var id string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO broker_deal_packs (workspace_id, user_id, name, constituent_entity_ids)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, wsID, userID, req.Name, req.ConstituentEntityIDs).Scan(&id)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}

func (s *Server) UpdateBrokerDealPack(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	packID := packIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertPackInWorkspace(ctx, wsID, packID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		Name      *string          `json:"name"`
		Journal   *json.RawMessage `json:"journal"`
		Transport *json.RawMessage `json:"transport"`
		Economics *json.RawMessage `json:"economics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	_, err := s.Pool.Exec(ctx, `
		UPDATE broker_deal_packs SET
			name = COALESCE($4, name),
			journal = COALESCE($5, journal),
			transport = COALESCE($6, transport),
			economics = COALESCE($7, economics),
			updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND user_id = $3
	`, packID, wsID, userID, req.Name, req.Journal, req.Transport, req.Economics)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) PackBrokerDeal(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	packID := packIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertPackInWorkspace(ctx, wsID, packID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		MapLat               float64  `json:"map_lat"`
		MapLng               float64  `json:"map_lng"`
		ConstituentEntityIDs []string `json:"constituent_entity_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if len(req.ConstituentEntityIDs) == 0 {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		UPDATE workspace_entities SET packed_into_pack_id = $1, updated_at = now()
		WHERE workspace_id = $2 AND id = ANY($3::uuid[])
	`, packID, wsID, req.ConstituentEntityIDs)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	_, err = tx.Exec(ctx, `
		UPDATE broker_deal_packs SET
			status = 'packed',
			map_lat = $4,
			map_lng = $5,
			constituent_entity_ids = $6,
			updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND user_id = $3
	`, packID, wsID, userID, req.MapLat, req.MapLng, req.ConstituentEntityIDs)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "packed"})
}

func (s *Server) UnpackBrokerDeal(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	packID := packIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertPackInWorkspace(ctx, wsID, packID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		UPDATE workspace_entities SET packed_into_pack_id = NULL, updated_at = now()
		WHERE packed_into_pack_id = $1 AND workspace_id = $2
	`, packID, wsID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	_, err = tx.Exec(ctx, `
		UPDATE broker_deal_packs SET status = 'draft', map_lat = NULL, map_lng = NULL, updated_at = now()
		WHERE id = $1 AND workspace_id = $2 AND user_id = $3
	`, packID, wsID, userID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unpacked"})
}

func (s *Server) GetWorkspaceMap(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}

	entityRows, err := s.Pool.Query(ctx, `
		SELECT id, workspace_id, entity_type, ref_kind, ref_id, display_name, lat, lng,
			deal_signal, dd_stage, in_dd_queue, packed_into_pack_id, metadata, created_at, updated_at
		FROM workspace_entities WHERE workspace_id = $1
		ORDER BY created_at DESC
	`, wsID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer entityRows.Close()
	var entities []WorkspaceEntity
	for entityRows.Next() {
		e, err := scanWorkspaceEntity(entityRows)
		if err == nil {
			entities = append(entities, e)
		}
	}
	if entities == nil {
		entities = []WorkspaceEntity{}
	}

	packRows, err := s.Pool.Query(ctx, `
		SELECT id, workspace_id, user_id, name, map_lat, map_lng, status,
			journal, transport, economics, constituent_entity_ids, created_at, updated_at
		FROM broker_deal_packs WHERE workspace_id = $1 AND user_id = $2 AND status = 'packed'
		ORDER BY updated_at DESC
	`, wsID, userID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer packRows.Close()
	var packs []BrokerDealPack
	for packRows.Next() {
		p, err := scanBrokerDealPack(packRows)
		if err == nil {
			packs = append(packs, p)
		}
	}
	if packs == nil {
		packs = []BrokerDealPack{}
	}

	edgeRows, err := s.Pool.Query(ctx, `
		SELECT id, workspace_id, source_entity_id, target_entity_id, label
		FROM workspace_entity_edges WHERE workspace_id = $1
	`, wsID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer edgeRows.Close()
	var edges []WorkspaceEdge
	for edgeRows.Next() {
		var e WorkspaceEdge
		if err := edgeRows.Scan(&e.ID, &e.WorkspaceID, &e.SourceNodeID, &e.TargetNodeID, &e.Label); err == nil {
			edges = append(edges, e)
		}
	}
	if edges == nil {
		edges = []WorkspaceEdge{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entities": entities,
		"packs":    packs,
		"edges":    edges,
	})
}

func (s *Server) SeedDefaultWorkspace(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := brokerUserID(r)
	var wsID string
	err := s.Pool.QueryRow(ctx, `
		SELECT id FROM user_workspaces WHERE user_id = $1 AND is_default = true LIMIT 1
	`, userID).Scan(&wsID)
	if err == pgx.ErrNoRows {
		err = s.Pool.QueryRow(ctx, `
			INSERT INTO user_workspaces (user_id, name, description, is_default)
			VALUES ($1, 'Default Pipeline', 'Supplier pipeline from Deal signals', true)
			RETURNING id
		`, userID).Scan(&wsID)
	}
	if err != nil {
		writeBrokerErr(w, err)
		return
	}

	var req struct {
		Entities []struct {
			RefKind     string  `json:"ref_kind"`
			RefID       string  `json:"ref_id"`
			DisplayName string  `json:"display_name"`
			Lat         float64 `json:"lat"`
			Lng         float64 `json:"lng"`
			DealSignal  string  `json:"deal_signal"`
			DdStage     string  `json:"dd_stage"`
			InDdQueue   bool    `json:"in_dd_queue"`
		} `json:"entities"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	imported := 0
	for _, e := range req.Entities {
		if e.RefID == "" || e.DisplayName == "" {
			continue
		}
		if e.DealSignal == "" {
			e.DealSignal = "good"
		}
		if e.DdStage == "" {
			e.DdStage = "New"
		}
		if e.RefKind == "" {
			e.RefKind = "license"
		}
		_, err := s.Pool.Exec(ctx, `
			INSERT INTO workspace_entities (
				workspace_id, entity_type, ref_kind, ref_id, display_name, lat, lng,
				deal_signal, dd_stage, in_dd_queue, metadata
			) VALUES ($1,'supplier',$2,$3,$4,$5,$6,$7,$8,$9,'{"import_source":"seed"}')
			ON CONFLICT (workspace_id, ref_kind, ref_id) WHERE ref_id IS NOT NULL AND ref_id <> ''
			DO UPDATE SET
				deal_signal = EXCLUDED.deal_signal,
				dd_stage = EXCLUDED.dd_stage,
				in_dd_queue = EXCLUDED.in_dd_queue,
				updated_at = now()
		`, wsID, e.RefKind, e.RefID, e.DisplayName, e.Lat, e.Lng, e.DealSignal, e.DdStage, e.InDdQueue)
		if err == nil {
			imported++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": wsID, "imported": imported})
}

func (s *Server) ListDealPackFollowups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	packID := packIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertPackInWorkspace(ctx, wsID, packID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	dueOnly := r.URL.Query().Get("due") == "now"
	q := `
		SELECT id, pack_id, remind_at, title, message, completed_at, delivery_channel, created_at
		FROM deal_pack_followups WHERE pack_id = $1`
	if dueOnly {
		q += ` AND completed_at IS NULL AND remind_at <= now()`
	}
	q += ` ORDER BY remind_at ASC`
	rows, err := s.Pool.Query(ctx, q, packID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer rows.Close()
	var followups []DealPackFollowup
	for rows.Next() {
		var f DealPackFollowup
		var msg *string
		if err := rows.Scan(&f.ID, &f.PackID, &f.RemindAt, &f.Title, &msg, &f.CompletedAt, &f.DeliveryChannel, &f.CreatedAt); err == nil {
			if msg != nil {
				f.Message = *msg
			}
			followups = append(followups, f)
		}
	}
	if followups == nil {
		followups = []DealPackFollowup{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"followups": followups})
}

func (s *Server) CreateDealPackFollowup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	packID := packIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertPackInWorkspace(ctx, wsID, packID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		RemindAt        string `json:"remind_at"`
		Title           string `json:"title"`
		Message         string `json:"message"`
		DeliveryChannel string `json:"delivery_channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.Title == "" || req.RemindAt == "" {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	remindAt, err := time.Parse(time.RFC3339, req.RemindAt)
	if err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.DeliveryChannel == "" {
		req.DeliveryChannel = "in_app"
	}
	var id string
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO deal_pack_followups (pack_id, remind_at, title, message, delivery_channel)
		VALUES ($1, $2, $3, $4, $5) RETURNING id
	`, packID, remindAt, req.Title, req.Message, req.DeliveryChannel).Scan(&id)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}

func (s *Server) CompleteDealPackFollowup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	packID := packIDFromRequest(r)
	fid := chi.URLParam(r, "fid")
	userID := brokerUserID(r)
	if err := s.assertPackInWorkspace(ctx, wsID, packID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	tag, err := s.Pool.Exec(ctx, `
		UPDATE deal_pack_followups SET completed_at = now()
		WHERE id = $1 AND pack_id = $2 AND completed_at IS NULL
	`, fid, packID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "followup not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "completed"})
}

func (s *Server) CreateWorkspaceEntityEdge(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	wsID := workspaceIDFromRequest(r)
	userID := brokerUserID(r)
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		writeBrokerErr(w, err)
		return
	}
	var req struct {
		SourceEntityID string `json:"source_entity_id"`
		TargetEntityID string `json:"target_entity_id"`
		Label          string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.SourceEntityID == "" || req.TargetEntityID == "" {
		writeBrokerErr(w, errInvalidRequest)
		return
	}
	if req.Label == "" {
		req.Label = "logistics_route"
	}
	var id string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO workspace_entity_edges (workspace_id, source_entity_id, target_entity_id, label)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, wsID, req.SourceEntityID, req.TargetEntityID, req.Label).Scan(&id)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "created"})
}

func (s *Server) ListDueFollowups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := brokerUserID(r)
	rows, err := s.Pool.Query(ctx, `
		SELECT f.id, f.pack_id, f.remind_at, f.title, f.message, f.completed_at, f.delivery_channel, f.created_at
		FROM deal_pack_followups f
		JOIN broker_deal_packs p ON p.id = f.pack_id
		WHERE p.user_id = $1 AND f.completed_at IS NULL AND f.remind_at <= now()
		ORDER BY f.remind_at ASC
		LIMIT 50
	`, userID)
	if err != nil {
		writeBrokerErr(w, err)
		return
	}
	defer rows.Close()
	var followups []DealPackFollowup
	for rows.Next() {
		var f DealPackFollowup
		var msg *string
		if err := rows.Scan(&f.ID, &f.PackID, &f.RemindAt, &f.Title, &msg, &f.CompletedAt, &f.DeliveryChannel, &f.CreatedAt); err == nil {
			if msg != nil {
				f.Message = *msg
			}
			followups = append(followups, f)
		}
	}
	if followups == nil {
		followups = []DealPackFollowup{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"followups": followups})
}
