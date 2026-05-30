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

func TestClearManagedServicePIDClearsOnlyMatchingPID(t *testing.T) {
	app := NewApp()
	app.managedServicePID = 1234

	app.clearManagedServicePID(4321)
	if got := app.managedServicePID; got != 1234 {
		t.Fatalf("managedServicePID after non-matching clear = %d, want 1234", got)
	}

	app.clearManagedServicePID(1234)
	if got := app.managedServicePID; got != 0 {
		t.Fatalf("managedServicePID after matching clear = %d, want 0", got)
	}
}
