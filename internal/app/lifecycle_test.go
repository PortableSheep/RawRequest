package app

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestShutdownRunsCleanupOnceAcrossHooks(t *testing.T) {
	app := NewApp()
	var calls []string

	app.stopMockServerFn = func() error {
		calls = append(calls, "mock")
		return nil
	}
	app.stopManagedSvcFn = func() error {
		calls = append(calls, "service")
		return nil
	}
	app.saveWindowStateFn = func() error {
		calls = append(calls, "window")
		return nil
	}

	if prevent := app.OnBeforeClose(context.Background()); prevent {
		t.Fatal("OnBeforeClose should not prevent the close")
	}
	app.Shutdown(context.Background())

	want := []string{"mock", "service", "window"}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("cleanup calls = %v, want %v", calls, want)
	}
}

func TestShutdownReturnsJoinedCleanupError(t *testing.T) {
	app := NewApp()
	mockErr := errors.New("mock stop failed")
	saveErr := errors.New("save failed")

	app.stopMockServerFn = func() error { return mockErr }
	app.stopManagedSvcFn = func() error { return nil }
	app.saveWindowStateFn = func() error { return saveErr }

	err := app.shutdown()
	if !errors.Is(err, mockErr) {
		t.Fatalf("shutdown error %v does not include mock error", err)
	}
	if !errors.Is(err, saveErr) {
		t.Fatalf("shutdown error %v does not include save error", err)
	}
}

// TestStopManagedServiceDelegatesToOwner locks in the App-level wiring to
// internal/procowner: stopManagedService (App's stopManagedSvcFn shutdown
// hook) must clear whatever PID is currently owned. PID/mutex lifecycle
// semantics themselves (matching-PID clears, concurrent access, real-process
// kill) are covered by internal/procowner's own tests.
func TestStopManagedServiceDelegatesToOwner(t *testing.T) {
	app := NewApp()
	// A PID this large is virtually guaranteed not to correspond to a real
	// process, so Stop's best-effort kill is a safe no-op here.
	app.managedService.Set(1 << 30)

	if err := app.stopManagedService(); err != nil {
		t.Fatalf("stopManagedService() = %v, want nil", err)
	}
	if got := app.managedService.Get(); got != 0 {
		t.Fatalf("managedService PID after stopManagedService = %d, want 0", got)
	}
}
