package app

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	hcl "rawrequest/internal/httpclientlogic"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// storeBinaryBody stores the raw response bytes for a given request ID,
// replacing any previously stored body.
func (a *App) storeBinaryBody(requestID string, body []byte) {
	a.binaryBodiesMu.Lock()
	defer a.binaryBodiesMu.Unlock()
	a.binaryBodies[requestID] = body
}

// clearBinaryBody removes the stored binary body for a given request ID.
func (a *App) clearBinaryBody(requestID string) {
	a.binaryBodiesMu.Lock()
	defer a.binaryBodiesMu.Unlock()
	delete(a.binaryBodies, requestID)
}

// SaveBinaryResponse opens a native Save dialog and writes the stored binary
// response body to the file the user selects. contentType and requestURL are
// used to derive a sensible default filename.
func (a *App) SaveBinaryResponse(requestID, contentType, requestURL string) (string, error) {
	a.binaryBodiesMu.Lock()
	body, exists := a.binaryBodies[requestID]
	a.binaryBodiesMu.Unlock()

	if !exists {
		return "", errors.New("no binary response stored for this request")
	}

	defaultName := suggestFilename(requestURL, contentType)

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Response Body",
		DefaultFilename: defaultName,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", errors.New("save cancelled")
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(path, body, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return path, nil
}

// SaveBinaryResponseToPath writes the stored binary response body to the
// given file path without opening a dialog. Used by the service backend.
func (a *App) SaveBinaryResponseToPath(requestID, destPath string) error {
	a.binaryBodiesMu.Lock()
	body, exists := a.binaryBodies[requestID]
	a.binaryBodiesMu.Unlock()

	if !exists {
		return errors.New("no binary response stored for this request")
	}

	dir := filepath.Dir(destPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	return os.WriteFile(destPath, body, 0644)
}

// SaveBase64ToFile decodes a base64-encoded response body and saves it
// via a native Save dialog. This is the Wails-callable method for frontend
// use when the raw bytes weren't stored (e.g. after app restart).
func (a *App) SaveBase64ToFile(base64Body, contentType, requestURL string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Body)
	if err != nil {
		return "", fmt.Errorf("failed to decode body: %w", err)
	}

	defaultName := suggestFilename(requestURL, contentType)

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Response Body",
		DefaultFilename: defaultName,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", errors.New("save cancelled")
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return path, nil
}

// suggestFilename derives a sensible download filename from the request URL
// and content type.
func suggestFilename(requestURL, contentType string) string {
	// Try to extract a filename from the URL path
	if requestURL != "" {
		if parsed, err := url.Parse(requestURL); err == nil {
			base := filepath.Base(parsed.Path)
			if base != "" && base != "." && base != "/" && strings.Contains(base, ".") {
				return base
			}
		}
	}

	ext := hcl.ExtensionForContentType(contentType)
	return "response" + ext
}
