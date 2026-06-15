package documents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxUploadBytes = 25 << 20 // 25 MiB
)

var allowedMIMETypes = map[string]bool{
	"application/pdf":    true,
	"image/jpeg":         true,
	"image/png":          true,
	"image/webp":         true,
	"text/plain":         true,
	"text/csv":           true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
}

type UploadInput struct {
	TenantID   *uuid.UUID
	UploadedBy *uuid.UUID
	FileName   string
	MimeType   string
	EntityType string
	EntityID   *uuid.UUID
	DealID     *uuid.UUID
	Metadata   map[string]any
}

type Record struct {
	ID          string         `json:"id"`
	FileName    string         `json:"file_name"`
	MimeType    string         `json:"mime_type"`
	StoragePath string         `json:"storage_path"`
	SHA256      string         `json:"sha256"`
	EntityType  string         `json:"entity_type,omitempty"`
	EntityID    string         `json:"entity_id,omitempty"`
	DealID      string         `json:"deal_id,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	CreatedAt   string         `json:"created_at"`
}

type Service struct {
	pool *pgxpool.Pool
	root string
}

func New(pool *pgxpool.Pool, root string) *Service {
	if root == "" {
		root = defaultDocumentsRoot()
	}
	return &Service{pool: pool, root: root}
}

func defaultDocumentsRoot() string {
	if v := strings.TrimSpace(os.Getenv("MADSAN_DOCUMENTS_DIR")); v != "" {
		return v
	}
	if wd, err := os.Getwd(); err == nil {
		if filepath.Base(wd) == "backend" {
			return filepath.Join(filepath.Dir(wd), "data", "documents")
		}
	}
	return filepath.Join("data", "documents")
}

func (s *Service) Save(ctx context.Context, in UploadInput, body io.Reader, size int64) (Record, error) {
	if size <= 0 {
		return Record{}, fmt.Errorf("empty upload")
	}
	if size > MaxUploadBytes {
		return Record{}, fmt.Errorf("file exceeds %d byte limit", MaxUploadBytes)
	}
	mime := strings.TrimSpace(in.MimeType)
	if mime != "" && !allowedMIMETypes[mime] {
		return Record{}, fmt.Errorf("mime type not allowed: %s", mime)
	}
	name := sanitizeFileName(in.FileName)
	if name == "" {
		return Record{}, fmt.Errorf("invalid file name")
	}

	docID := uuid.New()
	tenantPart := "public"
	if in.TenantID != nil {
		tenantPart = in.TenantID.String()
	}
	dir := filepath.Join(s.root, tenantPart, docID.String())
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return Record{}, err
	}
	destPath := filepath.Join(dir, name)

	f, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return Record{}, err
	}
	defer f.Close()

	hasher := sha256.New()
	limited := io.LimitReader(body, MaxUploadBytes+1)
	written, err := io.Copy(f, io.TeeReader(limited, hasher))
	if err != nil {
		_ = os.Remove(destPath)
		return Record{}, err
	}
	if written > MaxUploadBytes {
		_ = os.Remove(destPath)
		return Record{}, fmt.Errorf("file exceeds %d byte limit", MaxUploadBytes)
	}
	sum := hex.EncodeToString(hasher.Sum(nil))

	meta := in.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	if in.DealID != nil {
		meta["deal_id"] = in.DealID.String()
	}
	metaJSON, _ := json.Marshal(meta)

	var uploadedBy any
	if in.UploadedBy != nil {
		uploadedBy = *in.UploadedBy
	}
	var entityID any
	if in.EntityID != nil {
		entityID = *in.EntityID
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO documents (id, tenant_id, file_name, mime_type, storage_path, sha256, uploaded_by, entity_type, entity_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, docID, in.TenantID, name, nullIfEmpty(mime), destPath, sum, uploadedBy, nullIfEmpty(in.EntityType), entityID, metaJSON)
	if err != nil {
		_ = os.Remove(destPath)
		return Record{}, err
	}

	rec := Record{
		ID:          docID.String(),
		FileName:    name,
		MimeType:    mime,
		StoragePath: destPath,
		SHA256:      sum,
		EntityType:  in.EntityType,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		Metadata:    meta,
	}
	if in.EntityID != nil {
		rec.EntityID = in.EntityID.String()
	}
	if in.DealID != nil {
		rec.DealID = in.DealID.String()
	}
	return rec, nil
}

func sanitizeFileName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '.', r == '-', r == '_':
			return r
		default:
			return -1
		}
	}, name)
	if len(name) > 180 {
		name = name[:180]
	}
	return name
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
