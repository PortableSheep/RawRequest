package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// drainEvents reads everything currently buffered on the channel without
// blocking. Returns the slice of received events.
func drainEvents(ch <-chan appEvent) []appEvent {
	var out []appEvent
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return out
			}
			out = append(out, evt)
		default:
			return out
		}
	}
}

func writeFileWithMTime(t *testing.T, path, content string, mtime time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
}

func TestCheckWatchedFilesEmitsOnRealContentChange(t *testing.T) {
	a := NewApp()

	dir := t.TempDir()
	fp := filepath.Join(dir, "test.http")
	t0 := time.Now().Add(-1 * time.Hour)
	writeFileWithMTime(t, fp, "GET /a", t0)

	a.WatchFiles([]string{fp})

	events, unsubscribe := a.subscribeEvents(8)
	defer unsubscribe()

	// First tick: nothing changed yet, no event.
	a.checkWatchedFiles()
	if got := drainEvents(events); len(got) != 0 {
		t.Fatalf("expected no events on no-op tick, got %v", got)
	}

	// Real edit: change content AND advance mtime.
	t1 := t0.Add(1 * time.Minute)
	writeFileWithMTime(t, fp, "GET /b", t1)

	a.checkWatchedFiles()
	got := drainEvents(events)
	if len(got) != 1 {
		t.Fatalf("expected 1 event on real change, got %d: %v", len(got), got)
	}
	if got[0].Event != "file-externally-modified" {
		t.Fatalf("event=%q, want file-externally-modified", got[0].Event)
	}
	payload, ok := got[0].Payload.(map[string]string)
	if !ok {
		t.Fatalf("payload type=%T", got[0].Payload)
	}
	if payload["content"] != "GET /b" {
		t.Fatalf("content=%q, want %q", payload["content"], "GET /b")
	}
}

func TestCheckWatchedFilesSuppressesMTimeOnlyChurn(t *testing.T) {
	a := NewApp()

	dir := t.TempDir()
	fp := filepath.Join(dir, "test.http")
	t0 := time.Now().Add(-1 * time.Hour)
	writeFileWithMTime(t, fp, "GET /a", t0)

	a.WatchFiles([]string{fp})

	// Prime the content hash by running one tick. mtime is still t0 here, so
	// the watcher won't emit but should record the hash on the no-op path
	// — actually it only records the hash when mtime advances. So instead,
	// simulate the first observed change by rewriting with the same bytes
	// at a later mtime. That bumps mtime and seeds the hash; one event will
	// fire because there is no prior hash to compare against.
	t1 := t0.Add(1 * time.Minute)
	writeFileWithMTime(t, fp, "GET /a", t1)

	events, unsubscribe := a.subscribeEvents(8)
	defer unsubscribe()

	a.checkWatchedFiles()
	first := drainEvents(events)
	if len(first) != 1 {
		t.Fatalf("expected first observed change to emit once (seed), got %d", len(first))
	}

	// Now `touch` the file — bytes unchanged, mtime advances. Should NOT
	// emit, because the content hash hasn't changed.
	t2 := t1.Add(1 * time.Minute)
	writeFileWithMTime(t, fp, "GET /a", t2)

	a.checkWatchedFiles()
	if got := drainEvents(events); len(got) != 0 {
		t.Fatalf("expected no event for mtime-only churn, got %d: %v", len(got), got)
	}
}

func TestUpdateWatchedFileTimePrimesHashSoSubsequentTickIsSilent(t *testing.T) {
	a := NewApp()

	dir := t.TempDir()
	fp := filepath.Join(dir, "test.http")
	t0 := time.Now().Add(-1 * time.Hour)
	writeFileWithMTime(t, fp, "GET /a", t0)

	a.WatchFiles([]string{fp})

	// Simulate SaveFile: rewrite the file then call updateWatchedFileTime.
	// (This is what SaveFile does at the end of its body.)
	t1 := t0.Add(1 * time.Minute)
	writeFileWithMTime(t, fp, "GET /b", t1)
	a.updateWatchedFileTime(fp)

	events, unsubscribe := a.subscribeEvents(8)
	defer unsubscribe()

	// Subsequent watcher tick must be silent: even though mtime is now in the
	// future relative to the very first WatchFiles snapshot, updateWatched-
	// FileTime resealed both mtime and hash.
	a.checkWatchedFiles()
	if got := drainEvents(events); len(got) != 0 {
		t.Fatalf("expected no event after SaveFile-style write, got %d: %v", len(got), got)
	}
}
