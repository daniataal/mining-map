package equasis

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ShipRecord is normalized registry data from an Equasis ShipInfo page.
type ShipRecord struct {
	IMO          string
	Name         string
	Flag         string
	CallSign     string
	MMSI         string
	VesselType   string
	BuildYear    *int
	GrossTonnage *float64
	Deadweight   *float64
	OwnerName    string
	OperatorName string
	Management   []ManagementRow
	RawHTMLLen   int
}

type ManagementRow struct {
	IMO      string
	Role     string
	Name     string
	Address  string
	Effective string
}

var (
	reIMOInHeader = regexp.MustCompile(`IMO[^0-9]*(\d{7})`)
	reLabelRow    = regexp.MustCompile(`(?is)<div[^>]*class="[^"]*col-[^"]*"[^>]*>\s*<b>([^<]+)</b>\s*</div>\s*<div[^>]*class="[^"]*col-[^"]*"[^>]*>(.*?)</div>`)
	reStripTags   = regexp.MustCompile(`<[^>]+>`)
	reSpaces      = regexp.MustCompile(`\s+`)
	reMgmtRow     = regexp.MustCompile(`(?is)<tr[^>]*>(.*?)</tr>`)
	reMgmtCell    = regexp.MustCompile(`(?is)<td[^>]*>(.*?)</td>`)
)

// ParseShipInfo extracts vessel registry fields from Equasis ShipInfo HTML.
func ParseShipInfo(html []byte, imo string) (ShipRecord, error) {
	text := string(html)
	if len(text) == 0 {
		return ShipRecord{}, fmt.Errorf("equasis parse: empty response")
	}
	rec := ShipRecord{IMO: imo, RawHTMLLen: len(text)}

	if h := extractVesselHeader(text); h != "" {
		rec.Name = h
	}
	if m := reIMOInHeader.FindStringSubmatch(text); len(m) == 2 {
		rec.IMO = m[1]
	}

	for _, match := range reLabelRow.FindAllStringSubmatch(text, -1) {
		label := strings.ToLower(strings.TrimSpace(stripHTML(match[1])))
		value := strings.TrimSpace(stripHTML(match[2]))
		switch {
		case strings.Contains(label, "flag"):
			if rec.Flag == "" {
				rec.Flag = parentheticalCountry(value)
			}
		case strings.Contains(label, "call sign"):
			rec.CallSign = value
		case label == "mmsi":
			rec.MMSI = value
		case strings.Contains(label, "gross tonnage"):
			rec.GrossTonnage = parseNum(value)
		case label == "dwt" || strings.Contains(label, "deadweight"):
			rec.Deadweight = parseNum(value)
		case strings.Contains(label, "type of ship"):
			rec.VesselType = value
		case strings.Contains(label, "year of build") || strings.Contains(label, "year built"):
			if y, err := strconv.Atoi(strings.Fields(value)[0]); err == nil {
				rec.BuildYear = &y
			}
		}
	}

	rec.Management = parseManagementTable(text)
	for _, row := range rec.Management {
		role := strings.ToLower(strings.TrimSpace(row.Role))
		name := strings.TrimSpace(row.Name)
		if name == "" {
			continue
		}
		switch {
		case strings.Contains(role, "registered owner"):
			if rec.OwnerName == "" {
				rec.OwnerName = name
			}
		case strings.Contains(role, "ship manager"), strings.Contains(role, "commercial manager"):
			if rec.OperatorName == "" || strings.Contains(role, "ship manager") {
				rec.OperatorName = name
			}
		case strings.Contains(role, "ism manager"):
			if rec.OperatorName == "" {
				rec.OperatorName = name
			}
		}
	}

	if rec.Name == "" && rec.OwnerName == "" && rec.OperatorName == "" {
		return ShipRecord{}, fmt.Errorf("equasis parse: no vessel data in response")
	}
	return rec, nil
}

func extractVesselHeader(html string) string {
	// <h4 class="color-gris-bleu-copyright"><b>NAME</b> ...
	idx := strings.Index(html, `class="color-gris-bleu-copyright"`)
	if idx < 0 {
		return ""
	}
	chunk := html[idx:]
	start := strings.Index(chunk, "<b>")
	if start < 0 {
		return ""
	}
	start += 3
	end := strings.Index(chunk[start:], "</b>")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(stripHTML(chunk[start : start+end]))
}

func parseManagementTable(html string) []ManagementRow {
	section := html
	if i := strings.Index(html, `id="collapse3"`); i >= 0 {
		section = html[i:]
		if j := strings.Index(section[200:], `id="collapse`); j > 0 {
			section = section[:200+j]
		}
	}
	var rows []ManagementRow
	for _, tr := range reMgmtRow.FindAllStringSubmatch(section, -1) {
		var cells []string
		for _, td := range reMgmtCell.FindAllStringSubmatch(tr[1], -1) {
			cells = append(cells, strings.TrimSpace(stripHTML(td[1])))
		}
		if len(cells) < 3 {
			continue
		}
		// Equasis table: IMO | Role | Name | Address | Date
		row := ManagementRow{
			IMO:  cells[0],
			Role: cells[1],
			Name: cells[2],
		}
		if len(cells) > 3 {
			row.Address = cells[3]
		}
		if len(cells) > 4 {
			row.Effective = cells[4]
		}
		if row.Role == "" && row.Name == "" {
			continue
		}
		if strings.EqualFold(row.Role, "role") {
			continue
		}
		rows = append(rows, row)
	}
	return rows
}

func stripHTML(s string) string {
	s = reStripTags.ReplaceAllString(s, " ")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	return strings.TrimSpace(reSpaces.ReplaceAllString(s, " "))
}

func parentheticalCountry(s string) string {
	if i := strings.Index(s, "("); i >= 0 {
		if j := strings.Index(s[i:], ")"); j > 0 {
			return strings.TrimSpace(s[i+1 : i+j])
		}
	}
	return strings.TrimSpace(s)
}

func parseNum(s string) *float64 {
	s = strings.ReplaceAll(s, ",", "")
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return nil
	}
	if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
		return &v
	}
	return nil
}
