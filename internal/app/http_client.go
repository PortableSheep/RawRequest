package app

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	hcl "rawrequest/internal/httpclientlogic"
)

func (a *App) sendRequest(method, url, headersJson, body string) string {
	return a.performRequest(context.Background(), "", method, url, headersJson, body, 0)
}

func (a *App) sendRequestWithID(requestID, method, url, headersJson, body string) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, requestID, method, url, headersJson, body, 0)
}

func (a *App) sendRequestWithTimeout(requestID, method, url, headersJson, body string, timeoutMs int) string {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a.registerCancel(requestID, cancel)
	defer a.clearCancel(requestID)
	return a.performRequest(ctx, requestID, method, url, headersJson, body, timeoutMs)
}

func (a *App) performRequest(ctx context.Context, requestID, method, url, headersJson, body string, timeoutMs int) string {
	headers := hcl.ParseHeadersJSON(headersJson)

	var reqBody io.Reader

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

	transport := &http.Transport{}
	if hcl.IsLocalhostURL(url) {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	client := &http.Client{Transport: transport}
	if timeoutMs > 0 {
		client.Timeout = time.Duration(timeoutMs) * time.Millisecond
	}

	execResult, err := hcl.Execute(hcl.ExecuteInput{
		Context:               ctx,
		Method:                method,
		URL:                   url,
		Headers:               headers,
		Body:                  reqBody,
		RawBody:               body,
		DefaultUserAgent:      hcl.BuildDefaultUserAgent(Version),
		SetDefaultContentType: true,
		CloseConnection:       timeoutMs > 0 || ctx.Done() != nil,
		Client:                client,
		ReadBody: func(ctx context.Context, resp *http.Response) ([]byte, error) {
			return a.readBodyWithProgress(ctx, resp, requestID)
		},
	})
	if err != nil {
		var execErr *hcl.ExecuteError
		if errors.As(err, &execErr) {
			switch execErr.Stage {
			case hcl.StageDoRequest:
				if errors.Is(execErr, context.Canceled) || ctx.Err() == context.Canceled {
					return requestCancelledResponse
				}
				if errors.Is(execErr, context.DeadlineExceeded) || strings.Contains(execErr.Error(), "timeout") {
					return fmt.Sprintf("Error: Request timeout after %dms", timeoutMs)
				}
				return fmt.Sprintf("Error: %s", execErr)
			case hcl.StageReadBody:
				return fmt.Sprintf("Error reading body: %s", execErr)
			case hcl.StageCreateRequest:
				return fmt.Sprintf("Error: %s", execErr)
			}
		}
		return fmt.Sprintf("Error: %s", err)
	}

	requestMeta := struct {
		Method  string            `json:"method"`
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body,omitempty"`
	}{
		Method:  method,
		URL:     url,
		Headers: execResult.RequestHeaders,
		Body:    body,
	}
	requestMetaJSON, _ := json.Marshal(requestMeta)

	timing := TimingBreakdown{
		DNSLookup:       execResult.Timing.DNSLookup,
		TCPConnect:      execResult.Timing.TCPConnect,
		TLSHandshake:    execResult.Timing.TLSHandshake,
		TimeToFirstByte: execResult.Timing.TimeToFirstByte,
		ContentTransfer: execResult.Timing.ContentTransfer,
		Total:           execResult.Timing.Total,
	}

	metadata := ResponseMetadata{
		Timing:  timing,
		Size:    execResult.Size,
		Headers: execResult.ResponseHeaders,
	}
	metadataJSON, _ := json.Marshal(metadata)

	return fmt.Sprintf(
		"Status: %s\nRequest: %s\nHeaders: %s\nBody: %s",
		execResult.StatusText,
		string(requestMetaJSON),
		string(metadataJSON),
		string(execResult.Body),
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

func (a *App) cancelRequest(requestID string) {
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
	a.emitEvent("request:download-progress", map[string]any{
		"requestId":  requestID,
		"downloaded": downloaded,
		"total":      total,
	})
}
