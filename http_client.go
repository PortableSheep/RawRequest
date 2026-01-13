package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"os"
	"strings"
	"time"

	hcl "rawrequest/internal/httpclientlogic"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) SendRequest(method, url, headersJson, body string) string {
	return a.performRequest(context.Background(), "", method, url, headersJson, body, 0)
}

func (a *App) SendRequestWithID(requestID, method, url, headersJson, body string) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, requestID, method, url, headersJson, body, 0)
}

func (a *App) SendRequestWithTimeout(requestID, method, url, headersJson, body string, timeoutMs int) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, requestID, method, url, headersJson, body, timeoutMs)
}

func (a *App) performRequest(ctx context.Context, requestID, method, url, headersJson, body string, timeoutMs int) string {
	headers := hcl.ParseHeadersJSON(headersJson)

	var reqBody io.Reader
	var contentType string

	if hcl.IsFileUploadBody(body) {
		if filePath, ok := hcl.ExtractFileReferencePath(body); ok {
			if fileContent, err := os.ReadFile(filePath); err == nil {
				reqBody = strings.NewReader(string(fileContent))
			} else {
				return fmt.Sprintf("Error reading file: %s", err)
			}
		} else {
			reqBody = strings.NewReader(body)
		}
	} else {
		reqBody = strings.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return fmt.Sprintf("Error: %s", err)
	}

	for k, v := range headers {
		if strings.ToLower(k) == "content-type" {
			contentType = v
		}
		req.Header.Set(k, v)
	}

	if hcl.ShouldSetDefaultContentType(contentType, body) {
		req.Header.Set("Content-Type", "application/json")
	}

	if strings.TrimSpace(req.Header.Get("User-Agent")) == "" {
		req.Header.Set("User-Agent", hcl.BuildDefaultUserAgent(Version))
	}

	effectiveHeaders := make(map[string]string)
	for k, values := range req.Header {
		if len(values) > 0 {
			effectiveHeaders[k] = values[0]
		}
	}
	requestMeta := struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body,omitempty"`
	}{
		Method:  method,
		URL:     url,
		Headers: effectiveHeaders,
		Body:    body,
	}
	requestMetaJSON, _ := json.Marshal(requestMeta)

	var dnsStart, dnsEnd time.Time
	var connectStart, connectEnd time.Time
	var tlsStart, tlsEnd time.Time
	var gotFirstByte time.Time
	requestStart := time.Now()

	trace := &httptrace.ClientTrace{
		DNSStart: func(_ httptrace.DNSStartInfo) {
			dnsStart = time.Now()
		},
		DNSDone: func(_ httptrace.DNSDoneInfo) {
			dnsEnd = time.Now()
		},
		ConnectStart: func(_, _ string) {
			connectStart = time.Now()
		},
		ConnectDone: func(_, _ string, _ error) {
			connectEnd = time.Now()
		},
		TLSHandshakeStart: func() {
			tlsStart = time.Now()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			tlsEnd = time.Now()
		},
		GotFirstResponseByte: func() {
			gotFirstByte = time.Now()
		},
	}

	req = req.WithContext(httptrace.WithClientTrace(ctx, trace))

	if timeoutMs > 0 || ctx.Done() != nil {
		req.Close = true
	}

	client := &http.Client{}
	if timeoutMs > 0 {
		client.Timeout = time.Duration(timeoutMs) * time.Millisecond
	}

	resp, err := client.Do(req)
	contentDownloadStart := time.Now()
	if err != nil {
		if errors.Is(err, context.Canceled) || ctx.Err() == context.Canceled {
			return requestCancelledResponse
		}
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "timeout") {
			return fmt.Sprintf("Error: Request timeout after %dms", timeoutMs)
		}
		return fmt.Sprintf("Error: %s", err)
	}
	defer resp.Body.Close()

	respBody, err := a.readBodyWithProgress(ctx, resp, requestID)
	contentDownloadEnd := time.Now()
	if err != nil {
		return fmt.Sprintf("Error reading body: %s", err)
	}
	requestEnd := time.Now()

	timing := TimingBreakdown{
		Total: requestEnd.Sub(requestStart).Milliseconds(),
	}
	if !dnsEnd.IsZero() && !dnsStart.IsZero() {
		timing.DNSLookup = dnsEnd.Sub(dnsStart).Milliseconds()
	}
	if !connectEnd.IsZero() && !connectStart.IsZero() {
		timing.TCPConnect = connectEnd.Sub(connectStart).Milliseconds()
	}
	if !tlsEnd.IsZero() && !tlsStart.IsZero() {
		timing.TLSHandshake = tlsEnd.Sub(tlsStart).Milliseconds()
	}
	if !gotFirstByte.IsZero() {
		timing.TimeToFirstByte = gotFirstByte.Sub(requestStart).Milliseconds()
	}
	timing.ContentTransfer = contentDownloadEnd.Sub(contentDownloadStart).Milliseconds()

	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[strings.ToLower(key)] = values[0]
		}
	}

	metadata := ResponseMetadata{
		Timing:  timing,
		Size:    int64(len(respBody)),
		Headers: respHeaders,
	}
	metadataJSON, _ := json.Marshal(metadata)

	return fmt.Sprintf(
		"Status: %s\nRequest: %s\nHeaders: %s\nBody: %s",
		resp.Status,
		string(requestMetaJSON),
		string(metadataJSON),
		string(respBody),
	)
}

func (a *App) registerCancel(requestID string, cancel context.CancelFunc) {
	if requestID == "" {
		return
	}

	a.cancelMutex.Lock()
	a.requestCancels[requestID] = cancel
	a.cancelMutex.Unlock()
}

func (a *App) clearCancel(requestID string) {
	if requestID == "" {
		return
	}

	a.cancelMutex.Lock()
	delete(a.requestCancels, requestID)
	a.cancelMutex.Unlock()
}

func (a *App) CancelRequest(requestID string) {
	if requestID == "" {
		return
	}

	a.cancelMutex.Lock()
	cancel, exists := a.requestCancels[requestID]
	if exists {
		delete(a.requestCancels, requestID)
	}
	a.cancelMutex.Unlock()

	if exists {
		cancel()
	}
}

func (a *App) readBodyWithProgress(ctx context.Context, resp *http.Response, requestID string) ([]byte, error) {
	contentLength := resp.ContentLength

	const progressThreshold = 100 * 1024

	if contentLength > 0 && contentLength < progressThreshold {
		return io.ReadAll(resp.Body)
	}

	var buf bytes.Buffer
	if contentLength > 0 {
		buf.Grow(int(contentLength))
	}

	chunk := make([]byte, 32*1024)
	var totalRead int64
	lastEmit := time.Now()
	const emitInterval = 100 * time.Millisecond

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		n, err := resp.Body.Read(chunk)
		if n > 0 {
			buf.Write(chunk[:n])
			totalRead += int64(n)

			if requestID != "" && time.Since(lastEmit) >= emitInterval {
				a.emitDownloadProgress(requestID, totalRead, contentLength)
				lastEmit = time.Now()
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}

	if requestID != "" && contentLength > progressThreshold {
		a.emitDownloadProgress(requestID, totalRead, contentLength)
	}

	return buf.Bytes(), nil
}

func (a *App) emitDownloadProgress(requestID string, downloaded, total int64) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "request:download-progress", map[string]any{
		"requestId":  requestID,
		"downloaded": downloaded,
		"total":      total,
	})
}
