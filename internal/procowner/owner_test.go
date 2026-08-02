package procowner

import (
	"os/exec"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestNewTracksNoProcess(t *testing.T) {
	o := New()
	if got := o.Get(); got != 0 {
		t.Fatalf("Get() = %d, want 0 for new Owner", got)
	}
}

func TestSetThenGetReturnsPID(t *testing.T) {
	o := New()
	o.Set(1234)
	if got := o.Get(); got != 1234 {
		t.Fatalf("Get() = %d, want 1234", got)
	}
}

func TestSetReplacesPreviousPID(t *testing.T) {
	o := New()
	o.Set(1234)
	o.Set(5678)
	if got := o.Get(); got != 5678 {
		t.Fatalf("Get() = %d, want 5678", got)
	}
}

func TestClearIfMatchOnlyClearsMatchingPID(t *testing.T) {
	o := New()
	o.Set(1234)

	if cleared := o.ClearIfMatch(4321); cleared {
		t.Fatalf("ClearIfMatch(4321) = true, want false for non-matching PID")
	}
	if got := o.Get(); got != 1234 {
		t.Fatalf("Get() after non-matching clear = %d, want 1234", got)
	}

	if cleared := o.ClearIfMatch(1234); !cleared {
		t.Fatalf("ClearIfMatch(1234) = false, want true for matching PID")
	}
	if got := o.Get(); got != 0 {
		t.Fatalf("Get() after matching clear = %d, want 0", got)
	}
}

// TestClearIfMatchOnFreshOwnerMatchesZero documents that a fresh Owner
// starts at PID 0, so ClearIfMatch(0) reports a match (it's already
// cleared) rather than a no-op false. This mirrors the original
// clearManagedServicePID behavior, which compared by value with no special
// case for zero.
func TestClearIfMatchOnFreshOwnerMatchesZero(t *testing.T) {
	o := New()
	if cleared := o.ClearIfMatch(0); !cleared {
		t.Fatalf("ClearIfMatch(0) on fresh Owner = false, want true")
	}
	if got := o.Get(); got != 0 {
		t.Fatalf("Get() = %d, want 0", got)
	}
}

func TestStopOnUnsetOwnerIsNoOp(t *testing.T) {
	o := New()
	if err := o.Stop(); err != nil {
		t.Fatalf("Stop() on unset Owner = %v, want nil", err)
	}
	if got := o.Get(); got != 0 {
		t.Fatalf("Get() after Stop = %d, want 0", got)
	}
}

func TestStopWithInvalidPIDReturnsNilAndClears(t *testing.T) {
	o := New()
	// A PID this large is virtually guaranteed not to exist, and
	// os.FindProcess is expected to fail or return a handle whose Kill()
	// harmlessly errors; either way Stop must swallow it.
	o.Set(1 << 30)
	if err := o.Stop(); err != nil {
		t.Fatalf("Stop() with bogus PID = %v, want nil (best-effort)", err)
	}
	if got := o.Get(); got != 0 {
		t.Fatalf("Get() after Stop = %d, want 0", got)
	}
}

// TestStopKillsRealProcess verifies Stop actually terminates a live,
// externally-owned process by PID, matching the behavior EnsureServiceRunning
// depends on to shut down the managed service.
func TestStopKillsRealProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a unix 'sleep' child process")
	}
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep binary not available")
	}

	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start test child process: %v", err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()

	o := New()
	o.Set(cmd.Process.Pid)

	if err := o.Stop(); err != nil {
		t.Fatalf("Stop() = %v, want nil", err)
	}
	if got := o.Get(); got != 0 {
		t.Fatalf("Get() after Stop = %d, want 0", got)
	}

	select {
	case <-done:
		// process exited as expected after Stop killed it
	case <-time.After(5 * time.Second):
		t.Fatal("child process was not killed within timeout")
	}
}

// TestOwnerConcurrentAccess exercises Set/Get/ClearIfMatch/Stop concurrently
// to catch data races (run with -race) and confirm the Owner never panics
// under contention.
func TestOwnerConcurrentAccess(t *testing.T) {
	o := New()
	const goroutines = 50
	const iterations = 200

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				switch i % 4 {
				case 0:
					o.Set(g*1000 + i)
				case 1:
					_ = o.Get()
				case 2:
					_ = o.ClearIfMatch(g * 1000)
				default:
					_ = o.Stop()
				}
			}
		}(g)
	}
	wg.Wait()
}
