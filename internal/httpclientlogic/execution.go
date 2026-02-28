package httpclientlogic

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptrace"
	"strings"
	"time"
)

type ExecuteStage string

const (
	StageCreateRequest ExecuteStage = "create_request"
	StageDoRequest     ExecuteStage = "do_request"
	StageReadBody      ExecuteStage = "read_body"
)

type ExecuteError struct {
	Stage ExecuteStage
	Err   error
}

func (e *ExecuteError) Error() string {
	return e.Err.Error()
}

func (e *ExecuteError) Unwrap() error {
	return e.Err
}

type ExecutionTiming struct {
	DNSLookup       int64 `json:"dnsLookup"`
	TCPConnect      int64 `json:"tcpConnect"`
	TLSHandshake    int64 `json:"tlsHandshake"`
	TimeToFirstByte int64 `json:"timeToFirstByte"`
	ContentTransfer int64 `json:"contentTransfer"`
	Total           int64 `json:"total"`
}

type ExecuteInput struct {
	Context               context.Context
	Method                string
	URL                   string
	Headers               map[string]string
	Body                  io.Reader
	RawBody               string
	DefaultUserAgent      string
	SetDefaultContentType bool
	CloseConnection       bool
	Client                *http.Client
	ReadBody              func(context.Context, *http.Response) ([]byte, error)
}

type ExecuteOutput struct {
	StatusCode      int
	StatusText      string
	RequestHeaders  map[string]string
	ResponseHeaders map[string]string
	Body            []byte
	Size            int64
	Timing          ExecutionTiming
}

func Execute(input ExecuteInput) (ExecuteOutput, error) {
	var out ExecuteOutput

	ctx := input.Context
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, input.Method, input.URL, input.Body)
	if err != nil {
		return out, &ExecuteError{Stage: StageCreateRequest, Err: err}
	}

	for k, v := range input.Headers {
		req.Header.Set(k, v)
	}

	if input.SetDefaultContentType && ShouldSetDefaultContentType(req.Header.Get("Content-Type"), input.RawBody) {
		req.Header.Set("Content-Type", "application/json")
	}

	if strings.TrimSpace(req.Header.Get("User-Agent")) == "" && strings.TrimSpace(input.DefaultUserAgent) != "" {
		req.Header.Set("User-Agent", input.DefaultUserAgent)
	}

	out.RequestHeaders = flattenHeaders(req.Header, false)

	var dnsStart, dnsEnd, connectStart, connectEnd, tlsStart, tlsEnd, firstByteTime time.Time
	startTime := time.Now()
	trace := &httptrace.ClientTrace{
		DNSStart:             func(_ httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:              func(_ httptrace.DNSDoneInfo) { dnsEnd = time.Now() },
		ConnectStart:         func(_, _ string) { connectStart = time.Now() },
		ConnectDone:          func(_, _ string, _ error) { connectEnd = time.Now() },
		TLSHandshakeStart:    func() { tlsStart = time.Now() },
		TLSHandshakeDone:     func(_ tls.ConnectionState, _ error) { tlsEnd = time.Now() },
		GotFirstResponseByte: func() { firstByteTime = time.Now() },
	}
	req = req.WithContext(httptrace.WithClientTrace(ctx, trace))

	if input.CloseConnection {
		req.Close = true
	}

	client := input.Client
	if client == nil {
		client = &http.Client{}
	}

	resp, err := client.Do(req)
	if err != nil {
		return out, &ExecuteError{Stage: StageDoRequest, Err: err}
	}
	defer resp.Body.Close()

	readBody := input.ReadBody
	if readBody == nil {
		readBody = func(_ context.Context, resp *http.Response) ([]byte, error) {
			return io.ReadAll(resp.Body)
		}
	}

	contentStart := time.Now()
	respBody, err := readBody(ctx, resp)
	contentEnd := time.Now()
	if err != nil {
		return out, &ExecuteError{Stage: StageReadBody, Err: err}
	}

	if !dnsStart.IsZero() && !dnsEnd.IsZero() {
		out.Timing.DNSLookup = dnsEnd.Sub(dnsStart).Milliseconds()
	}
	if !connectStart.IsZero() && !connectEnd.IsZero() {
		out.Timing.TCPConnect = connectEnd.Sub(connectStart).Milliseconds()
	}
	if !tlsStart.IsZero() && !tlsEnd.IsZero() {
		out.Timing.TLSHandshake = tlsEnd.Sub(tlsStart).Milliseconds()
	}
	if !firstByteTime.IsZero() {
		out.Timing.TimeToFirstByte = firstByteTime.Sub(startTime).Milliseconds()
	}
	out.Timing.ContentTransfer = contentEnd.Sub(contentStart).Milliseconds()
	out.Timing.Total = time.Since(startTime).Milliseconds()

	out.StatusCode = resp.StatusCode
	out.StatusText = resp.Status
	out.ResponseHeaders = flattenHeaders(resp.Header, true)
	out.Body = respBody
	out.Size = int64(len(respBody))

	return out, nil
}

func flattenHeaders(headers http.Header, lowercaseKeys bool) map[string]string {
	flat := make(map[string]string, len(headers))
	for k, values := range headers {
		if len(values) == 0 {
			continue
		}
		key := k
		if lowercaseKeys {
			key = strings.ToLower(k)
		}
		flat[key] = values[0]
	}
	return flat
}
