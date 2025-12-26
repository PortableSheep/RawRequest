package loadtest

import "testing"

func TestParseStatusAndTiming_StatusOnly(t *testing.T) {
	status, timing := ParseStatusAndTiming("Status: 200 OK\nBody: hi")
	if status != 200 {
		t.Fatalf("expected status 200, got %d", status)
	}
	if timing != 0 {
		t.Fatalf("expected timing 0, got %d", timing)
	}
}

func TestParseStatusAndTiming_StatusMalformed(t *testing.T) {
	status, timing := ParseStatusAndTiming("Status: OK\nBody: hi")
	if status != 0 {
		t.Fatalf("expected status 0, got %d", status)
	}
	if timing != 0 {
		t.Fatalf("expected timing 0, got %d", timing)
	}
}

func TestParseStatusAndTiming_HeadersTimingTotal(t *testing.T) {
	result := "Status: 201 Created\nHeaders: {\"timing\":{\"total\":123}}\nBody: hi"
	status, timing := ParseStatusAndTiming(result)
	if status != 201 {
		t.Fatalf("expected status 201, got %d", status)
	}
	if timing != 123 {
		t.Fatalf("expected timing 123, got %d", timing)
	}
}

func TestParseStatusAndTiming_InvalidHeadersJSON(t *testing.T) {
	result := "Status: 200 OK\nHeaders: {not json}\nBody: hi"
	status, timing := ParseStatusAndTiming(result)
	if status != 200 {
		t.Fatalf("expected status 200, got %d", status)
	}
	if timing != 0 {
		t.Fatalf("expected timing 0, got %d", timing)
	}
}

func TestParseStatusAndTiming_MissingMarkers(t *testing.T) {
	// No leading newline before Headers marker means we should not parse it.
	result := "Status: 200 OK\nHeaders: {\"timing\":{\"total\":999}}\nBody: hi"
	status, timing := ParseStatusAndTiming(result)
	if status != 200 {
		t.Fatalf("expected status 200, got %d", status)
	}
	if timing != 999 {
		t.Fatalf("expected timing 999, got %d", timing)
	}
}
