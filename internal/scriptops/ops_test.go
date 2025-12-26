package scriptops

import (
	"testing"
	"time"

	sr "rawrequest/internal/scriptruntime"
)

func TestEnsureRequest(t *testing.T) {
	ctx := &sr.ExecutionContext{}
	req := EnsureRequest(ctx)
	if req == nil || ctx.Request == nil {
		t.Fatalf("expected request to be initialized")
	}
}

func TestSetVarUpdatesAppAndContext(t *testing.T) {
	appVars := map[string]string{}
	ctx := &sr.ExecutionContext{}
	SetVar(func(key, value string) {
		appVars[key] = value
	}, ctx, "k", "v")
	if appVars["k"] != "v" {
		t.Fatalf("expected app var set")
	}
	if ctx.Variables["k"] != "v" {
		t.Fatalf("expected ctx var set")
	}
}

func TestSetHeaderInitializesAndSets(t *testing.T) {
	ctx := &sr.ExecutionContext{Request: map[string]interface{}{}}
	SetHeader(ctx, "X-Test", "123")
	headers, ok := ctx.Request["headers"].(map[string]string)
	if !ok {
		t.Fatalf("expected headers map[string]string, got %T", ctx.Request["headers"])
	}
	if headers["X-Test"] != "123" {
		t.Fatalf("expected header set")
	}
}

func TestUpdateRequestMergesHeaders(t *testing.T) {
	ctx := &sr.ExecutionContext{Request: map[string]interface{}{}}
	SetHeader(ctx, "A", "1")
	UpdateRequest(ctx, map[string]interface{}{"headers": map[string]interface{}{"B": "2", "A": "3"}, "url": "https://x"})

	headers, ok := ctx.Request["headers"].(map[string]string)
	if !ok {
		t.Fatalf("expected headers map[string]string")
	}
	if headers["A"] != "3" || headers["B"] != "2" {
		t.Fatalf("unexpected headers: %#v", headers)
	}
	if ctx.Request["url"] != "https://x" {
		t.Fatalf("expected url set")
	}
}

func TestAssert(t *testing.T) {
	if err := Assert(true, "nope"); err != nil {
		t.Fatalf("unexpected error")
	}
	if err := Assert(false, "boom"); err == nil || err.Error() != "boom" {
		t.Fatalf("unexpected assert error: %v", err)
	}
	if err := Assert(false, ""); err == nil || err.Error() != "Assertion failed" {
		t.Fatalf("unexpected default assert error: %v", err)
	}
}

func TestDelay_UsesProvidedSleep(t *testing.T) {
	called := false
	var got time.Duration
	Delay(25*time.Millisecond, func(d time.Duration) {
		called = true
		got = d
	})
	if !called || got != 25*time.Millisecond {
		t.Fatalf("expected sleep called with duration, called=%v got=%v", called, got)
	}
}
