package httpclientlogic

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExecute_SetsDefaultsAndCapturesResponse(t *testing.T) {
	var seenUA, seenContentType, seenBody string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUA = r.Header.Get("User-Agent")
		seenContentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		seenBody = string(body)
		w.Header().Set("X-Test", "ok")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)

	got, err := Execute(ExecuteInput{
		Context:               context.Background(),
		Method:                http.MethodPost,
		URL:                   srv.URL,
		Headers:               map[string]string{"X-Req": "yes"},
		Body:                  strings.NewReader(`{"k":"v"}`),
		RawBody:               `{"k":"v"}`,
		DefaultUserAgent:      "RawRequest/test",
		SetDefaultContentType: true,
		Client:                srv.Client(),
	})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if got.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want %d", got.StatusCode, http.StatusCreated)
	}
	if got.StatusText != "201 Created" {
		t.Fatalf("status text = %q", got.StatusText)
	}
	if string(got.Body) != `{"ok":true}` {
		t.Fatalf("body = %q", string(got.Body))
	}
	if got.ResponseHeaders["x-test"] != "ok" {
		t.Fatalf("response headers = %#v", got.ResponseHeaders)
	}
	if got.RequestHeaders["Content-Type"] != "application/json" {
		t.Fatalf("request headers = %#v", got.RequestHeaders)
	}
	if got.RequestHeaders["User-Agent"] != "RawRequest/test" {
		t.Fatalf("request headers = %#v", got.RequestHeaders)
	}
	if seenUA != "RawRequest/test" {
		t.Fatalf("seen user-agent = %q", seenUA)
	}
	if seenContentType != "application/json" {
		t.Fatalf("seen content-type = %q", seenContentType)
	}
	if seenBody != `{"k":"v"}` {
		t.Fatalf("seen body = %q", seenBody)
	}
	if got.Timing.Total < 0 || got.Timing.ContentTransfer < 0 {
		t.Fatalf("unexpected timing = %#v", got.Timing)
	}
}

func TestExecute_ReportsStageErrors(t *testing.T) {
	_, err := Execute(ExecuteInput{Method: http.MethodGet, URL: "://bad"})
	assertExecuteStage(t, err, StageCreateRequest)

	doErr := errors.New("boom")
	_, err = Execute(ExecuteInput{
		Method: http.MethodGet,
		URL:    "http://example.com",
		Client: &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			return nil, doErr
		})},
	})
	assertExecuteStage(t, err, StageDoRequest)
	if !errors.Is(err, doErr) {
		t.Fatalf("expected wrapped do error")
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)
	readErr := errors.New("read failed")
	_, err = Execute(ExecuteInput{
		Method: http.MethodGet,
		URL:    srv.URL,
		Client: srv.Client(),
		ReadBody: func(context.Context, *http.Response) ([]byte, error) {
			return nil, readErr
		},
	})
	assertExecuteStage(t, err, StageReadBody)
	if !errors.Is(err, readErr) {
		t.Fatalf("expected wrapped read error")
	}
}

func assertExecuteStage(t *testing.T, err error, stage ExecuteStage) {
	t.Helper()
	var execErr *ExecuteError
	if !errors.As(err, &execErr) {
		t.Fatalf("expected ExecuteError, got %v", err)
	}
	if execErr.Stage != stage {
		t.Fatalf("stage = %q, want %q", execErr.Stage, stage)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
