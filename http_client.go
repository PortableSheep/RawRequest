// HTTP client functionality for RawRequest.
// This file contains all HTTP request execution logic including
// timing instrumentation, request cancellation, and response handling.

package main

import (
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
)

// SendRequest sends an HTTP request and returns the response.
func (a *App) SendRequest(method, url, headersJson, body string) string {
	return a.performRequest(context.Background(), method, url, headersJson, body, 0)
}

// SendRequestWithID sends an HTTP request that can be cancelled via requestID
func (a *App) SendRequestWithID(requestID, method, url, headersJson, body string) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, method, url, headersJson, body, 0)
}

// SendRequestWithTimeout sends an HTTP request with a per-request timeout (in milliseconds)
func (a *App) SendRequestWithTimeout(requestID, method, url, headersJson, body string, timeoutMs int) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, method, url, headersJson, body, timeoutMs)
}

func (a *App) performRequest(ctx context.Context, method, url, headersJson, body string, timeoutMs int) string {
	var headers map[string]string
	if headersJson != "" {
		json.Unmarshal([]byte(headersJson), &headers)
	}

	var reqBody io.Reader
	var contentType string

	// Check if this is a file upload request
	if strings.Contains(body, "Content-Type: multipart/form-data") || strings.Contains(body, "< ") {
		// Handle file upload
		if strings.HasPrefix(strings.TrimSpace(body), "< ") {
			filePath := strings.TrimPrefix(strings.TrimSpace(body), "< ")
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

	// Set Content-Type if specified in headers
	for k, v := range headers {
		if strings.ToLower(k) == "content-type" {
			contentType = v
		}
		req.Header.Set(k, v)
	}

	// If no Content-Type specified and body exists, set default
	if contentType == "" && body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	// Timing variables
	var dnsStart, dnsEnd time.Time
	var connectStart, connectEnd time.Time
	var tlsStart, tlsEnd time.Time
	var gotFirstByte time.Time
	requestStart := time.Now()

	// Create httptrace to capture timing
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

	// Apply timeout if specified
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
		// Check for timeout
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "timeout") {
			return fmt.Sprintf("Error: Request timeout after %dms", timeoutMs)
		}
		return fmt.Sprintf("Error: %s", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	contentDownloadEnd := time.Now()
	if err != nil {
		return fmt.Sprintf("Error reading body: %s", err)
	}
	requestEnd := time.Now()

	// Calculate timing breakdown
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

	// Collect response headers
	respHeaders := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			respHeaders[strings.ToLower(key)] = values[0]
		}
	}

	// Build response metadata
	metadata := ResponseMetadata{
		Timing:  timing,
		Size:    int64(len(respBody)),
		Headers: respHeaders,
	}
	metadataJSON, _ := json.Marshal(metadata)

	return fmt.Sprintf("Status: %s\nHeaders: %s\nBody: %s", resp.Status, string(metadataJSON), string(respBody))
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

// CancelRequest cancels an in-flight request, if present.
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
