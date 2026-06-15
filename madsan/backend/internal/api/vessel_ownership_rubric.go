package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type vesselFleetMatch struct {
	Matched    bool
	MatchBy    string
	MatchValue string
	Name       string
}

type vesselHistoryCandidate struct {
	Name      string
	FromDate  string
	ToDate    string
	Disponent string
}

func loadVesselFleetMatch(ctx context.Context, pool *pgxpool.Pool, ownerCompanyID, mmsi, imo string, names []map[string]any) vesselFleetMatch {
	if pool == nil || ownerCompanyID == "" {
		return vesselFleetMatch{}
	}
	var raw []byte
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(fleet_list, '[]'::jsonb)
		FROM shipvault_companies
		WHERE shipvault_company_id = $1
	`, ownerCompanyID).Scan(&raw)
	if err != nil {
		return vesselFleetMatch{}
	}
	return matchVesselInFleetList(raw, mmsi, imo, names)
}

func matchVesselInFleetList(raw []byte, mmsi, imo string, names []map[string]any) vesselFleetMatch {
	if len(raw) == 0 {
		return vesselFleetMatch{}
	}
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		var generic []any
		if err := json.Unmarshal(raw, &generic); err != nil {
			return vesselFleetMatch{}
		}
		for _, item := range generic {
			if m, ok := item.(map[string]any); ok {
				rows = append(rows, m)
			}
		}
	}
	nameSet := vesselNameSet(names)
	imo = strings.TrimSpace(imo)
	mmsi = strings.TrimSpace(mmsi)
	for _, row := range rows {
		rowIMO := firstStringField(row, "imo", "IMO")
		rowMMSI := firstStringField(row, "mmsi", "MMSI")
		rowName := firstStringField(row, "name", "Name", "vessel_name", "vesselName")
		switch {
		case imo != "" && rowIMO == imo:
			return vesselFleetMatch{Matched: true, MatchBy: "imo", MatchValue: imo, Name: rowName}
		case mmsi != "" && rowMMSI == mmsi:
			return vesselFleetMatch{Matched: true, MatchBy: "mmsi", MatchValue: mmsi, Name: rowName}
		case normalizeVesselName(rowName) != "" && nameSet[normalizeVesselName(rowName)]:
			return vesselFleetMatch{Matched: true, MatchBy: "name_history", MatchValue: rowName, Name: rowName}
		}
	}
	return vesselFleetMatch{}
}

func mergeVesselOwnershipIntel(summary map[string]any, ownerProfile map[string]any, fleetMatch vesselFleetMatch) {
	if summary == nil {
		return
	}
	intel := buildVesselOwnershipIntel(summary, ownerProfile, fleetMatch)
	if len(intel) > 0 {
		summary["ownership_intel"] = intel
	}
}

func buildVesselOwnershipIntel(summary map[string]any, ownerProfile map[string]any, fleetMatch vesselFleetMatch) map[string]any {
	imo := strings.TrimSpace(fmt.Sprint(summary["imo"]))
	mmsi := strings.TrimSpace(fmt.Sprint(summary["mmsi"]))
	owner := strings.TrimSpace(fmt.Sprint(summary["owner_name"]))
	operator := strings.TrimSpace(fmt.Sprint(summary["operator_name"]))
	if imo == "<nil>" {
		imo = ""
	}
	if mmsi == "<nil>" {
		mmsi = ""
	}
	if owner == "<nil>" {
		owner = ""
	}
	if operator == "<nil>" {
		operator = ""
	}
	if owner == "" && operator == "" && imo == "" && mmsi == "" {
		return nil
	}

	score := 0
	evidence := make([]map[string]any, 0, 8)
	addEvidence := func(key, label, status, detail string, weight int) {
		if detail == "" {
			return
		}
		score += weight
		evidence = append(evidence, map[string]any{
			"key":    key,
			"label":  label,
			"status": status,
			"detail": detail,
			"weight": weight,
		})
	}

	if imo != "" {
		addEvidence("imo_anchor", "IMO anchor", "observed", fmt.Sprintf("IMO %s is the stable vessel identity across name, owner, and flag changes.", imo), 15)
	} else if mmsi != "" {
		addEvidence("mmsi_anchor", "MMSI anchor", "observed", fmt.Sprintf("MMSI %s anchors current AIS identity; IMO should still be collected for ownership work.", mmsi), 8)
	}
	if owner != "" {
		addEvidence("registered_owner", "Registered owner", "source-backed", owner, 20)
	}
	if operator != "" {
		addEvidence("operator_manager", "Operator / manager", "source-backed", operator, 10)
	}

	fleetSize := intFromAny(ownerProfile["fleet_size"])
	if id := strings.TrimSpace(fmt.Sprint(ownerProfile["shipvault_company_id"])); id != "" && id != "<nil>" {
		addEvidence("owner_profile", "Owner profile", "source-backed", fmt.Sprintf("ShipVault company profile %s", id), 10)
	}
	if fleetSize > 0 {
		addEvidence("owner_fleet", "Owner fleet", "source-backed", fmt.Sprintf("%d vessel(s) in provider fleet profile.", fleetSize), 8)
	}
	if id := strings.TrimSpace(fmt.Sprint(ownerProfile["madsan_company_id"])); id != "" && id != "<nil>" {
		addEvidence("madsan_company_link", "MadSan company link", "observed", "Owner profile is linked to a MadSan company dossier.", 8)
	}
	if fleetMatch.Matched {
		detail := fmt.Sprintf("Owner fleet profile contains this vessel by %s", fleetMatch.MatchBy)
		if fleetMatch.MatchValue != "" {
			detail += fmt.Sprintf(" (%s)", fleetMatch.MatchValue)
		}
		if fleetMatch.Name != "" {
			detail += fmt.Sprintf(" as %s", fleetMatch.Name)
		}
		addEvidence("fleet_vessel_match", "Fleet-vessel match", "source-backed", detail, 18)
	}

	names := readRubricNameHistory(summary)
	if len(names) > 0 {
		addEvidence("name_history", "Name history", "observed", fmt.Sprintf("%d historical name(s) available for sale/purchase and prior-name checks.", len(names)), 7)
	}
	historyCandidates := readHistoricalOwnershipCandidates(summary, owner, operator)
	if len(historyCandidates) > 0 {
		addEvidence("historical_disponent", "Historical operator/owner clue", "source-backed", fmt.Sprintf("%d prior disponent/operator clue(s) from name-history records.", len(historyCandidates)), 8)
	}

	limitations := make([]string, 0, 3)
	beneficialStatus := "not_confirmed"
	switch {
	case owner == "" && operator == "":
		beneficialStatus = "unknown"
		limitations = append(limitations, "No owner or operator is available yet; ownership chain cannot be assessed.")
	case fleetSize == 1 && !fleetMatch.Matched:
		beneficialStatus = "registered_owner_only"
		limitations = append(limitations, "Fleet profile looks like a one-vessel registered owner; look for parent or beneficial owner before outreach.")
	case fleetMatch.Matched:
		beneficialStatus = "candidate_owner_chain"
		limitations = append(limitations, "Fleet match supports the owner chain, but beneficial ownership still needs independent public-source confirmation.")
	default:
		limitations = append(limitations, "Registry owner/operator evidence is useful for lead generation, not final compliance verification.")
	}
	if imo == "" {
		limitations = append(limitations, "IMO is missing; vessel names and MMSI can change or collide.")
	}

	tier := "low"
	switch {
	case score >= 70:
		tier = "high"
	case score >= 45:
		tier = "medium"
	case score <= 0:
		tier = "unknown"
	}

	return map[string]any{
		"method":                  "imo_first_owner_osint_v1",
		"tier":                    tier,
		"score":                   score,
		"registered_owner":        emptyNil(owner),
		"operator_or_manager":     emptyNil(operator),
		"beneficial_owner_status": beneficialStatus,
		"previous_ownership_status": func() string {
			if len(historyCandidates) > 0 {
				return "candidate_from_name_history"
			}
			return "not_available"
		}(),
		"summary":            vesselOwnershipSummary(tier, beneficialStatus),
		"role_chain":         vesselOwnershipRoleChain(imo, mmsi, owner, operator, ownerProfile, fleetMatch),
		"evidence":           evidence,
		"history_candidates": historyCandidatesMap(historyCandidates),
		"registry_checks":    vesselRegistryChecks(imo, owner, operator, names, historyCandidates),
		"search_pivots":      vesselOwnershipSearchPivots(imo, owner, operator, names, historyCandidates),
		"limitations":        limitations,
	}
}

func vesselOwnershipSummary(tier, status string) string {
	switch tier {
	case "high":
		return "Strong owner-chain evidence for commercial intelligence; use independent public records before treating it as confirmed beneficial ownership."
	case "medium":
		return "Usable owner-chain lead: registry and company clues exist, but the beneficial owner is not fully confirmed."
	case "unknown":
		return "Ownership chain is not available yet."
	default:
		if status == "registered_owner_only" {
			return "Possible one-vessel registered owner; prioritize parent and manager checks before outreach."
		}
		return "Thin owner-chain evidence; treat as a research lead."
	}
}

func vesselOwnershipRoleChain(imo, mmsi, owner, operator string, ownerProfile map[string]any, fleetMatch vesselFleetMatch) []map[string]any {
	chain := make([]map[string]any, 0, 5)
	if imo != "" {
		chain = append(chain, map[string]any{"role": "vessel", "label": "IMO " + imo, "status": "observed"})
	} else if mmsi != "" {
		chain = append(chain, map[string]any{"role": "vessel", "label": "MMSI " + mmsi, "status": "observed"})
	}
	if owner != "" {
		chain = append(chain, map[string]any{"role": "registered_owner", "label": owner, "status": "source-backed"})
	}
	if operator != "" {
		chain = append(chain, map[string]any{"role": "operator_manager", "label": operator, "status": "source-backed"})
	}
	if name := strings.TrimSpace(fmt.Sprint(ownerProfile["name"])); name != "" && name != "<nil>" && name != owner {
		chain = append(chain, map[string]any{"role": "owner_profile", "label": name, "status": "source-backed"})
	}
	if parent := strings.TrimSpace(fmt.Sprint(ownerProfile["parent_name"])); parent != "" && parent != "<nil>" {
		chain = append(chain, map[string]any{"role": "parent_or_group", "label": parent, "status": "source-backed"})
	}
	if fleetMatch.Matched {
		chain = append(chain, map[string]any{"role": "fleet_match", "label": "vessel found in owner fleet profile", "status": "source-backed"})
	}
	return chain
}

func vesselOwnershipSearchPivots(imo, owner, operator string, names []string, historyCandidates []vesselHistoryCandidate) []string {
	pivots := make([]string, 0, 8)
	if imo != "" {
		pivots = append(pivots, fmt.Sprintf("IMO %s in Equasis / IMO GISIS", imo))
	}
	for _, name := range names {
		if name == "" {
			continue
		}
		pivots = append(pivots, fmt.Sprintf("%q sold purchased tanker", name))
		if len(pivots) >= 4 {
			break
		}
	}
	if operator != "" {
		pivots = append(pivots, fmt.Sprintf("%q fleet list", operator))
	}
	for _, candidate := range historyCandidates {
		if candidate.Disponent != "" {
			pivots = append(pivots, fmt.Sprintf("%q %q vessel owner operator", candidate.Disponent, candidate.Name))
		}
	}
	if owner != "" {
		pivots = append(pivots, fmt.Sprintf("%q beneficial owner", owner))
	}
	return dedupeStrings(pivots)
}

func vesselRegistryChecks(imo, owner, operator string, names []string, historyCandidates []vesselHistoryCandidate) []map[string]any {
	checks := make([]map[string]any, 0, 5)
	if imo != "" {
		checks = append(checks, map[string]any{
			"name":    "Equasis",
			"purpose": "Verify registered owner, ISM manager, commercial manager, flag, and ownership history by IMO.",
			"query":   "IMO " + imo,
			"status":  "manual_check_required",
		})
		checks = append(checks, map[string]any{
			"name":    "IMO GISIS",
			"purpose": "Cross-check company jurisdiction and registry identity by IMO.",
			"query":   "IMO " + imo,
			"status":  "manual_check_required",
		})
	}
	if owner != "" {
		checks = append(checks, map[string]any{
			"name":    "Owner website / fleet list",
			"purpose": "Confirm whether the owner or parent publicly lists this vessel in its fleet.",
			"query":   owner + " fleet list " + firstNonEmpty(imo, strings.Join(names, " ")),
			"status":  "manual_check_required",
		})
	}
	if operator != "" && !strings.EqualFold(operator, owner) {
		checks = append(checks, map[string]any{
			"name":    "Manager / operator website",
			"purpose": "Separate technical/commercial manager from owner before outreach.",
			"query":   operator + " fleet list " + firstNonEmpty(imo, strings.Join(names, " ")),
			"status":  "manual_check_required",
		})
	}
	if len(historyCandidates) > 0 || len(names) > 0 {
		queryName := ""
		if len(historyCandidates) > 0 {
			queryName = historyCandidates[0].Name
		} else {
			queryName = names[0]
		}
		checks = append(checks, map[string]any{
			"name":    "Trade press sale/purchase trail",
			"purpose": "Use previous vessel names to find sale reports and infer buyer/seller changes.",
			"query":   fmt.Sprintf("%q sold purchased tanker", queryName),
			"status":  "manual_check_required",
		})
	}
	return checks
}

func readRubricNameHistory(summary map[string]any) []string {
	raw, ok := summary["name_history"].([]map[string]any)
	if ok {
		out := make([]string, 0, len(raw))
		for _, item := range raw {
			name := strings.TrimSpace(fmt.Sprint(item["name"]))
			if name != "" && name != "<nil>" {
				out = append(out, name)
			}
		}
		return dedupeStrings(out)
	}
	if generic, ok := summary["name_history"].([]any); ok {
		out := make([]string, 0, len(generic))
		for _, item := range generic {
			if m, ok := item.(map[string]any); ok {
				name := strings.TrimSpace(fmt.Sprint(m["name"]))
				if name != "" && name != "<nil>" {
					out = append(out, name)
				}
			}
		}
		return dedupeStrings(out)
	}
	return nil
}

func readHistoricalOwnershipCandidates(summary map[string]any, currentOwner, currentOperator string) []vesselHistoryCandidate {
	raw := historicalCandidateRows(summary["name_history"])
	out := make([]vesselHistoryCandidate, 0, len(raw))
	currentOwner = normalizeCompanyToken(currentOwner)
	currentOperator = normalizeCompanyToken(currentOperator)
	seen := map[string]bool{}
	for _, item := range raw {
		disponent := stringFromAny(item["disponent"])
		name := stringFromAny(item["name"])
		if disponent == "" || normalizeCompanyToken(disponent) == currentOwner || normalizeCompanyToken(disponent) == currentOperator {
			continue
		}
		key := normalizeVesselName(name) + "|" + normalizeCompanyToken(disponent)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, vesselHistoryCandidate{
			Name:      name,
			FromDate:  stringFromAny(item["from_date"]),
			ToDate:    stringFromAny(item["to_date"]),
			Disponent: disponent,
		})
	}
	return out
}

func historicalCandidateRows(raw any) []map[string]any {
	if rows, ok := raw.([]map[string]any); ok {
		return rows
	}
	if generic, ok := raw.([]any); ok {
		out := make([]map[string]any, 0, len(generic))
		for _, item := range generic {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func historyCandidatesMap(candidates []vesselHistoryCandidate) []map[string]any {
	out := make([]map[string]any, 0, len(candidates))
	for _, c := range candidates {
		row := map[string]any{
			"vessel_name": c.Name,
			"disponent":   c.Disponent,
			"role":        "historical_disponent_or_operator",
			"status":      "candidate",
			"detail":      "Name-history disponent/operator clue; verify as prior owner before treating it as beneficial ownership.",
		}
		if c.FromDate != "" {
			row["from_date"] = c.FromDate
		}
		if c.ToDate != "" {
			row["to_date"] = c.ToDate
		}
		out = append(out, row)
	}
	return out
}

func vesselNameSet(names []map[string]any) map[string]bool {
	out := map[string]bool{}
	for _, item := range names {
		name := normalizeVesselName(fmt.Sprint(item["name"]))
		if name != "" && name != "<nil>" {
			out[name] = true
		}
	}
	return out
}

func firstStringField(row map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := row[key]; ok {
			s := stringFromAny(v)
			if s != "" {
				return s
			}
		}
	}
	return ""
}

func stringFromAny(v any) string {
	if v == nil {
		return ""
	}
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "<nil>" {
		return ""
	}
	return s
}

func normalizeVesselName(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	replacer := strings.NewReplacer(".", " ", ",", " ", "-", " ", "_", " ", "/", " ")
	s = replacer.Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

func normalizeCompanyToken(s string) string {
	s = normalizeVesselName(s)
	for _, suffix := range []string{" LTD", " LIMITED", " LLC", " INC", " SA", " BV", " GMBH", " PTE"} {
		s = strings.TrimSuffix(s, suffix)
	}
	return strings.TrimSpace(s)
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		var out int
		_, _ = fmt.Sscan(fmt.Sprint(v), &out)
		return out
	}
}

func emptyNil(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func dedupeStrings(vals []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}
