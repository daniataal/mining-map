package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
)

// BulkDoc is a single document we want to index — id is the ES _id (must be
// unique within the index), body is the JSON-serialisable source.
type BulkDoc struct {
	ID   string
	Body any
}

// BulkResult is what IndexBatch returns: a count of successfully indexed
// documents and the per-doc errors encountered (if any).
type BulkResult struct {
	Indexed int
	Failed  int
	Errors  []BulkItemError
}

// BulkItemError is the trimmed-down error info from a bulk response item, used
// for logging.
type BulkItemError struct {
	ID     string
	Status int
	Type   string
	Reason string
}

// IndexBatch sends a single _bulk request to ES with all the docs in batch,
// using the `index` action so existing docs get overwritten.
//
// Caller is responsible for batching (we recommend 500 docs per call as per
// the indexer worker config).
func IndexBatch(ctx context.Context, c Client, index string, batch []BulkDoc) (BulkResult, error) {
	var res BulkResult
	if len(batch) == 0 {
		return res, nil
	}
	var buf bytes.Buffer
	for _, doc := range batch {
		meta := map[string]any{
			"index": map[string]any{
				"_index": index,
				"_id":    doc.ID,
			},
		}
		mb, err := json.Marshal(meta)
		if err != nil {
			return res, fmt.Errorf("marshal bulk meta %s: %w", doc.ID, err)
		}
		buf.Write(mb)
		buf.WriteByte('\n')
		bb, err := json.Marshal(doc.Body)
		if err != nil {
			return res, fmt.Errorf("marshal bulk body %s: %w", doc.ID, err)
		}
		buf.Write(bb)
		buf.WriteByte('\n')
	}
	resp, err := c.Bulk(ctx, &buf)
	if err != nil {
		return res, err
	}
	for _, item := range resp.Items {
		for _, op := range item {
			if op.Error != nil || (op.Status >= 300 && op.Status != 0) {
				res.Failed++
				reason := ""
				typ := ""
				if op.Error != nil {
					reason = op.Error.Reason
					typ = op.Error.Type
				}
				res.Errors = append(res.Errors, BulkItemError{
					ID:     op.ID,
					Status: op.Status,
					Type:   typ,
					Reason: reason,
				})
				continue
			}
			res.Indexed++
		}
	}
	return res, nil
}
