package maritime

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const headingBackfillBatch = 500

// VesselHeadingCounts reports vessels.total and vessels with non-null heading.
func VesselHeadingCounts(ctx context.Context, pool *pgxpool.Pool) (total, withHeading int, err error) {
	err = pool.QueryRow(ctx, `
		SELECT count(*)::int, count(heading)::int FROM vessels
	`).Scan(&total, &withHeading)
	return total, withHeading, err
}

// BackfillVesselHeading copies course/heading from the latest legacy oil_ais_positions row per MMSI.
func BackfillVesselHeading(ctx context.Context, madsan, legacy *pgxpool.Pool) (updated int, err error) {
	if legacy == nil {
		return 0, fmt.Errorf("legacy database not configured")
	}

	rows, err := legacy.Query(ctx, `
		SELECT DISTINCT ON (p.mmsi)
			p.mmsi::text,
			p.course,
			p.heading
		FROM oil_ais_positions p
		JOIN oil_vessels v ON v.mmsi = p.mmsi
		WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
		  AND (p.heading IS NOT NULL OR p.course IS NOT NULL)
		ORDER BY p.mmsi, p.ts DESC
	`)
	if err != nil {
		return 0, fmt.Errorf("legacy ais query: %w", err)
	}
	defer rows.Close()

	type row struct {
		mmsi    string
		course  *float64
		heading *float64
	}
	var batch []row
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		mmsis := make([]string, len(batch))
		headings := make([]*float64, len(batch))
		courses := make([]*float64, len(batch))
		for i, r := range batch {
			mmsis[i] = r.mmsi
			headings[i] = r.heading
			courses[i] = r.course
		}
		tag, err := madsan.Exec(ctx, `
			UPDATE vessels v SET
				heading = COALESCE(d.heading, v.heading),
				course = COALESCE(d.course, v.course),
				updated_at = now()
			FROM (
				SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[])
					AS t(mmsi, heading, course)
			) d
			WHERE v.mmsi = d.mmsi
			  AND (d.heading IS NOT NULL OR d.course IS NOT NULL)
		`, mmsis, headings, courses)
		if err != nil {
			return err
		}
		updated += int(tag.RowsAffected())
		batch = batch[:0]
		return nil
	}

	for rows.Next() {
		var r row
		if err := rows.Scan(&r.mmsi, &r.course, &r.heading); err != nil {
			return updated, err
		}
		batch = append(batch, r)
		if len(batch) >= headingBackfillBatch {
			if err := flush(); err != nil {
				return updated, fmt.Errorf("batch update: %w", err)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return updated, err
	}
	if err := flush(); err != nil {
		return updated, fmt.Errorf("batch update: %w", err)
	}
	return updated, nil
}
