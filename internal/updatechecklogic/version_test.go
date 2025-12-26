package updatechecklogic

import "testing"

func TestParseVersion(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want [3]int
	}{
		{name: "plain", in: "1.2.3", want: [3]int{1, 2, 3}},
		{name: "leading v", in: "v1.2.3", want: [3]int{1, 2, 3}},
		{name: "missing minor/patch", in: "2", want: [3]int{2, 0, 0}},
		{name: "missing patch", in: "2.5", want: [3]int{2, 5, 0}},
		{name: "pre-release ignored", in: "1.2.3-beta.1", want: [3]int{1, 2, 3}},
		{name: "leading v pre-release", in: "v1.2.3-rc.0", want: [3]int{1, 2, 3}},
		{name: "garbage returns zeros", in: "not-a-version", want: [3]int{0, 0, 0}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseVersion(tt.in)
			if got != tt.want {
				t.Fatalf("ParseVersion(%q)=%v want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestIsNewerVersion(t *testing.T) {
	tests := []struct {
		name    string
		latest  string
		current string
		want    bool
	}{
		{name: "equal", latest: "1.2.3", current: "1.2.3", want: false},
		{name: "newer patch", latest: "1.2.4", current: "1.2.3", want: true},
		{name: "older patch", latest: "1.2.2", current: "1.2.3", want: false},
		{name: "newer minor", latest: "1.3.0", current: "1.2.9", want: true},
		{name: "newer major", latest: "2.0.0", current: "1.99.99", want: true},
		{name: "leading v tolerated", latest: "v1.2.4", current: "1.2.3", want: true},
		{name: "pre-release numeric portion compared", latest: "1.2.4-beta.1", current: "1.2.3", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsNewerVersion(tt.latest, tt.current)
			if got != tt.want {
				t.Fatalf("IsNewerVersion(%q, %q)=%v want %v", tt.latest, tt.current, got, tt.want)
			}
		})
	}
}
