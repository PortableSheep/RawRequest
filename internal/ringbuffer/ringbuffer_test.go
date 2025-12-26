package ringbuffer

import "testing"

func TestBufferAppendTrimsOldest(t *testing.T) {
	b := New[int](3)
	b.Append(1)
	b.Append(2)
	b.Append(3)
	b.Append(4)

	got := b.Items()
	want := []int{2, 3, 4}
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got[%d]=%d want %d", i, got[i], want[i])
		}
	}
}

func TestBufferItemsReturnsCopy(t *testing.T) {
	b := New[int](10)
	b.Append(1)
	b.Append(2)

	a := b.Items()
	a[0] = 999

	b2 := b.Items()
	if b2[0] != 1 {
		t.Fatalf("buffer was mutated via snapshot: got %d want 1", b2[0])
	}
}

func TestBufferClear(t *testing.T) {
	b := New[string](2)
	b.Append("a")
	b.Clear()
	if b.Len() != 0 {
		t.Fatalf("Len=%d want 0", b.Len())
	}
	if got := b.Items(); len(got) != 0 {
		t.Fatalf("Items len=%d want 0", len(got))
	}
}

func TestBufferCapZeroRetainsNothing(t *testing.T) {
	b := New[int](0)
	b.Append(1)
	b.Append(2)
	if b.Len() != 0 {
		t.Fatalf("Len=%d want 0", b.Len())
	}
}
