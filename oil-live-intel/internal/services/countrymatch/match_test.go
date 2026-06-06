package countrymatch

import "testing"

func TestNormalizeCountryName(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Côte d'Ivoire", "cote d ivoire"},
		{"Congo, Kinshasa", "democratic republic of the congo"},
		{"RUSSIA", "russian federation"},
		{"Russian Federation", "russian federation"},
		{"Trinidad & Tobago", "trinidad and tobago"},
		{"  USA  ", "united states of america"},
		{"United States", "united states of america"},
		{"US", "united states of america"},
		{"DRC", "democratic republic of the congo"},
		{"UAE", "united arab emirates"},
	}

	for _, c := range cases {
		if got := NormalizeCountryName(c.in); got != c.want {
			t.Errorf("NormalizeCountryName(%q) == %q, want %q", c.in, got, c.want)
		}
	}
}

func TestKeysMatch(t *testing.T) {
	pairs := [][2]string{
		{"Russia", "Russian Federation"},
		{"USA", "United States of America"},
		{"US", "United States"},
		{"DRC", "Democratic Republic of the Congo"},
		{"Congo, Kinshasa", "Democratic Republic of the Congo"},
		{"Brazil", "Brazil"},
	}
	for _, p := range pairs {
		if !KeysMatch(p[0], p[1]) {
			t.Errorf("KeysMatch(%q, %q) = false, want true", p[0], p[1])
		}
	}
	if KeysMatch("Russia", "Brazil") {
		t.Fatal("Russia and Brazil should not match")
	}
}

func TestMatchKeys(t *testing.T) {
	keys := MatchKeys("Russian Federation")
	seen := map[string]bool{}
	for _, k := range keys {
		seen[k] = true
	}
	for _, want := range []string{"russian federation", "russia"} {
		if !seen[want] {
			t.Fatalf("MatchKeys missing %q: %v", want, keys)
		}
	}
}
