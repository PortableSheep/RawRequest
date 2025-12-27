package requestchain

import (
	"context"
	"testing"

	sr "rawrequest/internal/scriptruntime"
)

func TestExecute_CallsPreBeforeResolve(t *testing.T) {
	vars := map[string]string{}
	preRan := false
	var gotURL string

	deps := Dependencies{
		CancelledResponse: "__CANCELLED__",
		VariablesSnapshot: func() map[string]string { return vars },
		ExecuteScript: func(_ string, _ *sr.ExecutionContext, stage string) {
			if stage == "pre" {
				vars["x"] = "ok"
				preRan = true
			}
		},
		Resolve: func(input string, _ map[string]map[string]interface{}) string {
			if input == "{{x}}" {
				if !preRan {
					t.Fatalf("expected preScript to run before Resolve")
				}
				return vars["x"]
			}
			return input
		},
		PerformRequest: func(_ context.Context, _ string, url string, _ string, _ string, _ int) string {
			gotURL = url
			return "resp"
		},
		ParseResponse: func(_ string) map[string]interface{} {
			return map[string]interface{}{"body": "{}"}
		},
	}

	requests := []map[string]interface{}{
		{
			"method":    "GET",
			"url":       "{{x}}",
			"preScript": "setVar('x','ok')",
		},
	}

	got := Execute(context.Background(), requests, deps)
	if got != "resp" {
		t.Fatalf("got %q want %q", got, "resp")
	}
	if gotURL != "ok" {
		t.Fatalf("got url %q want %q", gotURL, "ok")
	}
}

func TestExecute_ResponseStoreAvailableForLaterRequests(t *testing.T) {
	deps := Dependencies{
		CancelledResponse: "__CANCELLED__",
		PerformRequest: func(_ context.Context, _ string, url string, _ string, _ string, _ int) string {
			return "resp:" + url
		},
		ParseResponse: func(resp string) map[string]interface{} {
			return map[string]interface{}{"body": resp, "marker": "m"}
		},
		Resolve: func(input string, store map[string]map[string]interface{}) string {
			if input == "needsPrev" {
				if store["request1"] == nil {
					t.Fatalf("expected request1 in responseStore")
				}
				if store["request1"]["marker"] != "m" {
					t.Fatalf("unexpected marker: %v", store["request1"]["marker"])
				}
				return "ok"
			}
			return input
		},
	}

	requests := []map[string]interface{}{
		{"method": "GET", "url": "first"},
		{"method": "GET", "url": "needsPrev"},
	}

	got := Execute(context.Background(), requests, deps)
	if got != "resp:first\n\nresp:ok" {
		t.Fatalf("got %q", got)
	}
}

func TestExecute_ImmediateCancelReturnsCancelledResponse(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	deps := Dependencies{CancelledResponse: "__CANCELLED__"}
	got := Execute(ctx, []map[string]interface{}{{"method": "GET", "url": "x"}}, deps)
	if got != "__CANCELLED__" {
		t.Fatalf("got %q want %q", got, "__CANCELLED__")
	}
}

func TestExecute_ReadsTimeoutFromOptions(t *testing.T) {
	var gotTimeout int
	deps := Dependencies{
		CancelledResponse: "__CANCELLED__",
		PerformRequest: func(_ context.Context, _ string, _ string, _ string, _ string, timeoutMs int) string {
			gotTimeout = timeoutMs
			return "Status: 200 OK\nHeaders: {}\nBody: {}"
		},
		ParseResponse: func(_ string) map[string]interface{} {
			return map[string]interface{}{"body": "{}"}
		},
	}

	requests := []map[string]interface{}{
		{
			"method":  "GET",
			"url":     "x",
			"options": map[string]interface{}{"timeout": float64(123)},
		},
	}

	_ = Execute(context.Background(), requests, deps)
	if gotTimeout != 123 {
		t.Fatalf("got timeout %d want %d", gotTimeout, 123)
	}
}

func TestExecute_ErrorStopsChain(t *testing.T) {
	called := 0
	deps := Dependencies{
		CancelledResponse: "__CANCELLED__",
		PerformRequest: func(_ context.Context, _ string, url string, _ string, _ string, _ int) string {
			called++
			if url == "first" {
				return "Error: Request timeout after 1ms"
			}
			return "Status: 200 OK\nHeaders: {}\nBody: {}"
		},
		ParseResponse: func(_ string) map[string]interface{} {
			return map[string]interface{}{"body": "{}"}
		},
	}

	requests := []map[string]interface{}{
		{"method": "GET", "url": "first"},
		{"method": "GET", "url": "second"},
	}

	got := Execute(context.Background(), requests, deps)
	if called != 1 {
		t.Fatalf("expected chain to stop after error; called=%d", called)
	}
	if got != "Error: Request timeout after 1ms" {
		t.Fatalf("got %q", got)
	}
}
