// Package scriptlogstore owns the concurrency-safe storage and bounded
// buffering of script log entries that was previously held directly as
// fields on internal/app.App (scriptLogs/scriptLogMutex). It has no
// dependency on Wails or event transport: callers are responsible for
// publishing the Entry returned by Append to whatever event system they
// use, keeping this type unit- and race-testable in isolation.
package scriptlogstore

import (
	"strings"
	"sync"
	"time"

	rb "rawrequest/internal/ringbuffer"
)

// Entry is a single recorded script log line.
type Entry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

// defaultSource is used when Append is called with a blank source.
const defaultSource = "script"

// Store holds a fixed-capacity, thread-safe buffer of script log entries.
type Store struct {
	mu     sync.Mutex
	buffer *rb.Buffer[Entry]

	// now is overridable in tests; defaults to time.Now.
	now func() time.Time
}

// New creates a Store that retains at most capacity entries, discarding the
// oldest once the limit is exceeded (see internal/ringbuffer).
func New(capacity int) *Store {
	return &Store{
		buffer: rb.New[Entry](capacity),
		now:    time.Now,
	}
}

// Append normalizes and records a log entry: message is trimmed (a blank
// message is dropped entirely), source defaults to "script" when blank,
// level is lowercased, and the timestamp is captured as RFC3339Nano UTC.
// It returns the stored entry and true, or a zero Entry and false if the
// message was blank and nothing was recorded. Callers own publishing the
// returned entry as an event.
func (s *Store) Append(level, source, message string) (Entry, bool) {
	message = strings.TrimSpace(message)
	if message == "" {
		return Entry{}, false
	}
	if source == "" {
		source = defaultSource
	}

	entry := Entry{
		Timestamp: s.now().UTC().Format(time.RFC3339Nano),
		Level:     strings.ToLower(level),
		Source:    source,
		Message:   message,
	}

	s.mu.Lock()
	s.buffer.Append(entry)
	s.mu.Unlock()

	return entry, true
}

// Items returns a snapshot copy of all currently retained entries, oldest
// first.
func (s *Store) Items() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buffer.Items()
}

// Clear discards all retained entries.
func (s *Store) Clear() {
	s.mu.Lock()
	s.buffer.Clear()
	s.mu.Unlock()
}
