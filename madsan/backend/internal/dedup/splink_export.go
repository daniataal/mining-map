package dedup

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CompanyPair is one candidate duplicate pair for Splink batch linking.
type CompanyPair struct {
	NormalizedName string
	MatchScore     float64
	Left           CompanyMember
	Right          CompanyMember
}

var splinkPairCSVHeader = []string{
	"unique_id_l",
	"unique_id_r",
	"name_l",
	"name_r",
	"country_code_l",
	"country_code_r",
	"confidence_score_l",
	"confidence_score_r",
	"normalized_name",
	"sql_match_score",
}

// PairsFromClusters expands duplicate clusters into unique unordered member pairs.
func PairsFromClusters(clusters []CompanyCluster) []CompanyPair {
	var out []CompanyPair
	for _, c := range clusters {
		members := c.Members
		for i := 0; i < len(members); i++ {
			for j := i + 1; j < len(members); j++ {
				out = append(out, CompanyPair{
					NormalizedName: c.NormalizedName,
					MatchScore:     c.MatchScore,
					Left:           members[i],
					Right:          members[j],
				})
			}
		}
	}
	return out
}

func formatConfidence(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatFloat(*v, 'f', -1, 64)
}

// WriteCompanyPairsCSV writes Splink-ready pairwise rows (one pair per line).
func WriteCompanyPairsCSV(w io.Writer, pairs []CompanyPair) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(splinkPairCSVHeader); err != nil {
		return err
	}
	for _, p := range pairs {
		if err := cw.Write([]string{
			p.Left.ID,
			p.Right.ID,
			p.Left.Name,
			p.Right.Name,
			p.Left.CountryCode,
			p.Right.CountryCode,
			formatConfidence(p.Left.ConfidenceScore),
			formatConfidence(p.Right.ConfidenceScore),
			p.NormalizedName,
			strconv.FormatFloat(p.MatchScore, 'f', -1, 64),
		}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// ExportCompanyPairs loads duplicate clusters and expands them to pairwise rows.
func ExportCompanyPairs(ctx context.Context, pool *pgxpool.Pool, clusterLimit int) ([]CompanyPair, error) {
	clusters, err := ListCompanyDuplicateClusters(ctx, pool, clusterLimit)
	if err != nil {
		return nil, err
	}
	return PairsFromClusters(clusters), nil
}

// ExportCompanyPairsCSV loads clusters and writes Splink-ready CSV to w.
func ExportCompanyPairsCSV(ctx context.Context, pool *pgxpool.Pool, clusterLimit int, w io.Writer) (pairCount int, err error) {
	pairs, err := ExportCompanyPairs(ctx, pool, clusterLimit)
	if err != nil {
		return 0, err
	}
	if err := WriteCompanyPairsCSV(w, pairs); err != nil {
		return 0, err
	}
	return len(pairs), nil
}

// PairExportFilename returns a stable download name for admin/CLI exports.
func PairExportFilename() string {
	return "madsan_company_pairs_splink.csv"
}

// PairExportSummary describes an export for JSON admin responses.
func PairExportSummary(pairCount, clusterLimit int) string {
	return fmt.Sprintf("%d pairs from up to %d duplicate name clusters (Splink prep)", pairCount, clusterLimit)
}
