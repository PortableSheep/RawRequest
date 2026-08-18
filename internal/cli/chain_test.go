package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// These tests characterize CLI's batch-selection and dependency-chain
// execution behavior via RunSelected, the shared entry point CLI's `run`
// command and MCP's run_request tool both use. Before RunSelected existed,
// CLI executed exactly the requests matching the given names, in file
// order, completely ignoring @depends (no ordering, no shared response
// store) — these tests lock in the fixed behavior: dependencies run before
// dependents, prior responses are available via {{requestN.response...}},
// and a failed dependency skips (rather than silently runs) its dependents
// without affecting unrelated requests in the same batch.

func TestRunSelected_OrdersDependencyBeforeDependent(t *testing.T) {
	var calls []string

	loginSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls = append(calls, "login")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"token":"abc123"}`))
	}))
	t.Cleanup(loginSrv.Close)

	var gotAuth string
	userSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, "getUser")
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(userSrv.Close)

	parsed := &ParsedHttpFile{
		Requests: []Request{
			{Name: "login", Method: http.MethodGet, URL: loginSrv.URL},
			{
				Name:    "getUser",
				Method:  http.MethodGet,
				URL:     userSrv.URL,
				Depends: "login",
				Headers: map[string]string{
					"Authorization": "Bearer {{request1.response.body.token}}",
				},
			},
		},
	}

	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	results, err := RunSelected(parsed, runner, []string{"getUser"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(calls) != 2 || calls[0] != "login" || calls[1] != "getUser" {
		t.Fatalf("expected login to be called before getUser, got %v", calls)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results (dependency + selected), got %d", len(results))
	}
	if results[0].RequestName != "login" || results[1].RequestName != "getUser" {
		t.Fatalf("expected results in [login, getUser] order, got %v, %v", results[0].RequestName, results[1].RequestName)
	}
	if gotAuth != "Bearer abc123" {
		t.Fatalf("expected getUser to resolve login's response body via responseStore, got Authorization=%q", gotAuth)
	}
}

func TestRunSelected_SharedDependencyAcrossMultipleSelectedNames(t *testing.T) {
	loginCalls := 0
	loginSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		loginCalls++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(loginSrv.Close)

	otherSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(otherSrv.Close)

	parsed := &ParsedHttpFile{
		Requests: []Request{
			{Name: "login", Method: http.MethodGet, URL: loginSrv.URL},
			{Name: "getUser", Method: http.MethodGet, URL: otherSrv.URL, Depends: "login"},
			{Name: "getOrders", Method: http.MethodGet, URL: otherSrv.URL, Depends: "login"},
		},
	}

	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	results, err := RunSelected(parsed, runner, []string{"getUser", "getOrders"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if loginCalls != 1 {
		t.Fatalf("expected shared dependency 'login' to execute exactly once, called %d times", loginCalls)
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 results (login once + both dependents), got %d", len(results))
	}
}

func TestRunSelected_FailedDependencySkipsDependentButRunsUnrelated(t *testing.T) {
	loginSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	t.Cleanup(loginSrv.Close)

	getUserCalled := false
	getUserSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		getUserCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(getUserSrv.Close)

	healthCalled := false
	healthSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		healthCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(healthSrv.Close)

	parsed := &ParsedHttpFile{
		Requests: []Request{
			{Name: "login", Method: http.MethodGet, URL: loginSrv.URL},
			{Name: "getUser", Method: http.MethodGet, URL: getUserSrv.URL, Depends: "login"},
			{Name: "health", Method: http.MethodGet, URL: healthSrv.URL},
		},
	}

	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	results, err := RunSelected(parsed, runner, []string{"getUser", "health"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if getUserCalled {
		t.Fatal("expected getUser to be skipped because its dependency 'login' failed")
	}
	if !healthCalled {
		t.Fatal("expected unrelated 'health' request to still run despite login's failure")
	}

	var getUserResult, healthResult *ResponseResult
	for i := range results {
		switch results[i].RequestName {
		case "getUser":
			getUserResult = &results[i]
		case "health":
			healthResult = &results[i]
		}
	}
	if getUserResult == nil || getUserResult.Error == "" {
		t.Fatalf("expected getUser result to carry a skip error, got %+v", getUserResult)
	}
	if healthResult == nil || healthResult.Error != "" || healthResult.Status != http.StatusOK {
		t.Fatalf("expected health to succeed independently, got %+v", healthResult)
	}
}

func TestRunSelected_CircularDependencyReturnsError(t *testing.T) {
	parsed := &ParsedHttpFile{
		Requests: []Request{
			{Name: "a", Method: http.MethodGet, URL: "http://example.invalid/a", Depends: "b"},
			{Name: "b", Method: http.MethodGet, URL: "http://example.invalid/b", Depends: "a"},
		},
	}

	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	if _, err := RunSelected(parsed, runner, []string{"a"}); err == nil {
		t.Fatal("expected circular dependency error")
	}
}

func TestRunSelected_NoNamesRunsEveryRequestInFileOrder(t *testing.T) {
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	parsed := &ParsedHttpFile{
		Requests: []Request{
			{Name: "first", Method: http.MethodGet, URL: srv.URL + "/first"},
			{Name: "second", Method: http.MethodGet, URL: srv.URL + "/second"},
		},
	}

	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	results, err := RunSelected(parsed, runner, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected both requests to run when no names given, got %d", len(results))
	}
	if len(calls) != 2 || calls[0] != "/first" || calls[1] != "/second" {
		t.Fatalf("expected file order execution, got %v", calls)
	}
}

func TestRunSelected_ScriptsAndVariablesStillWorkAcrossChain(t *testing.T) {
	loginSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"token":"from-post-script"}`))
	}))
	t.Cleanup(loginSrv.Close)

	var gotAuth string
	userSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(userSrv.Close)

	parsed := &ParsedHttpFile{
		Requests: []Request{
			{
				Name:   "login",
				Method: http.MethodGet,
				URL:    loginSrv.URL,
				PostScript: `> {
  setVar('authToken', response.json.token);
}`,
			},
			{
				Name:    "getUser",
				Method:  http.MethodGet,
				URL:     userSrv.URL,
				Depends: "login",
				Headers: map[string]string{
					"Authorization": "Bearer {{authToken}}",
				},
			},
		},
	}

	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	results, err := RunSelected(parsed, runner, []string{"getUser"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if gotAuth != "Bearer from-post-script" {
		t.Fatalf("expected setVar from login's post-script to resolve in getUser's header, got %q", gotAuth)
	}
}

func TestRunSelected_ResultsAreJSONSerializable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	parsed := &ParsedHttpFile{
		Requests: []Request{{Name: "solo", Method: http.MethodGet, URL: srv.URL}},
	}
	runner := NewRunner(&Options{Variables: make(map[string]string)}, "test")
	results, err := RunSelected(parsed, runner, []string{"solo"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := json.Marshal(results); err != nil {
		t.Fatalf("expected results to be JSON-serializable: %v", err)
	}
}
