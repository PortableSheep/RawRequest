package binarybodystore

import (
	"sync"
	"testing"
)

func TestPutThenGetReturnsStoredBody(t *testing.T) {
	s := New()
	want := []byte{0x89, 0x50, 0x4e, 0x47}
	s.Put("req-1", want)

	got, ok := s.Get("req-1")
	if !ok {
		t.Fatalf("Get() ok = false, want true")
	}
	if string(got) != string(want) {
		t.Fatalf("Get() = %v, want %v", got, want)
	}
}

func TestGetMissingReturnsNotOK(t *testing.T) {
	s := New()
	got, ok := s.Get("does-not-exist")
	if ok {
		t.Fatalf("Get() ok = true for missing key, want false")
	}
	if got != nil {
		t.Fatalf("Get() = %v, want nil", got)
	}
}

func TestPutReplacesPreviousBody(t *testing.T) {
	s := New()
	s.Put("req-1", []byte("first"))
	s.Put("req-1", []byte("second"))

	got, ok := s.Get("req-1")
	if !ok {
		t.Fatalf("Get() ok = false, want true")
	}
	if string(got) != "second" {
		t.Fatalf("Get() = %q, want %q", got, "second")
	}
}

func TestPutEmptyRequestIDIsNoOp(t *testing.T) {
	s := New()
	s.Put("", []byte("ignored"))

	if _, ok := s.Get(""); ok {
		t.Fatalf("Get(\"\") ok = true, want false after Put with empty requestID")
	}
}

func TestDeleteRemovesStoredBody(t *testing.T) {
	s := New()
	s.Put("req-1", []byte("data"))
	s.Delete("req-1")

	if _, ok := s.Get("req-1"); ok {
		t.Fatalf("Get() ok = true after Delete, want false")
	}
}

func TestDeleteMissingKeyIsNoOp(t *testing.T) {
	s := New()
	s.Delete("does-not-exist") // must not panic
}

// TestStoreConcurrentAccess exercises Put/Get/Delete concurrently to catch
// data races (run with -race) and confirm the store never panics under
// contention.
func TestStoreConcurrentAccess(t *testing.T) {
	s := New()
	const goroutines = 50
	const iterations = 200

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				switch i % 3 {
				case 0:
					s.Put("shared-key", []byte("data"))
				case 1:
					_, _ = s.Get("shared-key")
				default:
					s.Delete("shared-key")
				}
			}
		}(g)
	}
	wg.Wait()
}
