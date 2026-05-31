package api

// nonNilMapSlice ensures JSON encodes [] instead of null for slice fields.
func nonNilMapSlice(v []map[string]any) []map[string]any {
	if v == nil {
		return []map[string]any{}
	}
	return v
}

// nonNilAnySlice ensures JSON encodes [] instead of null for slice fields.
func nonNilAnySlice(v []any) []any {
	if v == nil {
		return []any{}
	}
	return v
}

// nonNilStringSlice ensures JSON encodes [] instead of null for slice fields.
func nonNilStringSlice(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// nonNilStringMapSlice ensures JSON encodes [] instead of null for slice fields.
func nonNilStringMapSlice(v []map[string]string) []map[string]string {
	if v == nil {
		return []map[string]string{}
	}
	return v
}
