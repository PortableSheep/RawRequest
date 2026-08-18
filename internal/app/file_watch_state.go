package app

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// watchedFileState tracks both the last-seen modification time and a hash of
// the last-seen content for a watched file. The content hash lets the file
// watcher distinguish a real external edit from spurious mtime churn (e.g.
// `touch`, filesystem snapshot tooling, or sub-second mtime granularity drift
// after our own SaveFile), so the frontend isn't asked to silently reload an
// unchanged buffer — which would replace the editor doc and reset scroll.
type watchedFileState struct {
	modTime     time.Time
	contentHash string
}

// hashFileContent returns a stable, short fingerprint of the given bytes. It
// is only used for equality comparisons within the watcher, never persisted,
// so collision resistance need only be cryptographic-grade overkill for the
// task.
func hashFileContent(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
