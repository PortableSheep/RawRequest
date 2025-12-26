package ringbuffer

// Buffer is a simple append-only ring buffer that retains at most cap items.
// When the cap is exceeded, the oldest items are dropped.
//
// It is not safe for concurrent use without external synchronization.
type Buffer[T any] struct {
	cap   int
	items []T
}

// New constructs a new Buffer retaining at most cap items.
// If cap <= 0, the buffer will retain zero items.
func New[T any](cap int) *Buffer[T] {
	if cap < 0 {
		cap = 0
	}
	return &Buffer[T]{cap: cap}
}

// Append adds an item and trims the buffer to its configured cap.
func (b *Buffer[T]) Append(item T) {
	if b == nil {
		return
	}
	if b.cap <= 0 {
		b.items = nil
		return
	}
	b.items = append(b.items, item)
	if len(b.items) > b.cap {
		b.items = b.items[len(b.items)-b.cap:]
	}
}

// Items returns a copy of the current contents.
func (b *Buffer[T]) Items() []T {
	if b == nil {
		return nil
	}
	out := make([]T, len(b.items))
	copy(out, b.items)
	return out
}

// Clear removes all items.
func (b *Buffer[T]) Clear() {
	if b == nil {
		return
	}
	b.items = nil
}

// Len returns the current number of stored items.
func (b *Buffer[T]) Len() int {
	if b == nil {
		return 0
	}
	return len(b.items)
}
