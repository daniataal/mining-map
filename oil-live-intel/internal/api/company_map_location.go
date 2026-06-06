package api

// companyMapLocationSource mirrors the SQL CASE used in listCompanies.
func companyMapLocationSource(termLat, mcrLat *float64) string {
	if termLat != nil {
		return "terminal"
	}
	if mcrLat != nil {
		return "corridor"
	}
	return ""
}
