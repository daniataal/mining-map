package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

type LicenseFile struct {
	ID         string    `json:"id"`
	LicenseID  string    `json:"license_id"`
	Filename   string    `json:"filename"`
	FilePath   string    `json:"file_path"`
	UploadDate time.Time `json:"upload_date"`
}

// GetLicenseFiles handles GET /licenses/{id}/files
func (s *Server) GetLicenseFiles(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid path"})
		return
	}
	licenseID := parts[4]

	sql := "SELECT id, license_id, filename, file_path, upload_date FROM license_files WHERE license_id = $1 ORDER BY upload_date DESC"
	rows, err := s.Pool.Query(r.Context(), sql, licenseID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	var files []LicenseFile
	for rows.Next() {
		var f LicenseFile
		if err := rows.Scan(&f.ID, &f.LicenseID, &f.Filename, &f.FilePath, &f.UploadDate); err == nil {
			files = append(files, f)
		}
	}
	if files == nil {
		files = []LicenseFile{}
	}

	writeJSON(w, http.StatusOK, files)
}

// UploadLicenseFile handles POST /licenses/{id}/files
func (s *Server) UploadLicenseFile(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid path"})
		return
	}
	licenseID := parts[4]

	var exists bool
	err := s.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM licenses WHERE id = $1)", licenseID).Scan(&exists)
	if err != nil || !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "License not found"})
		return
	}

	if err := r.ParseMultipartForm(50 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "form parse error"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing file"})
		return
	}
	defer file.Close()

	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "/app/uploads"
	}
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create upload dir"})
		return
	}

	fileID := uuid.New().String()
	reg := regexp.MustCompile(`[^a-zA-Z0-9._-]+`)
	safeFilename := reg.ReplaceAllString(strings.ReplaceAll(header.Filename, " ", "_"), "")
	if safeFilename == "" {
		safeFilename = "unnamed_file"
	}

	finalPath := filepath.Join(uploadDir, fmt.Sprintf("%s_%s", fileID, safeFilename))
	out, err := os.Create(finalPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create file"})
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to write file"})
		return
	}

	dbFilePath := fmt.Sprintf("/files/%s_%s", fileID, safeFilename)
	sql := `
		INSERT INTO license_files (id, license_id, filename, file_path)
		VALUES ($1, $2, $3, $4)
	`
	_, err = s.Pool.Exec(r.Context(), sql, fileID, licenseID, header.Filename, dbFilePath)
	if err != nil {
		_ = os.Remove(finalPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"message":   "File uploaded successfully",
		"file_id":   fileID,
		"file_path": dbFilePath,
	})
}
