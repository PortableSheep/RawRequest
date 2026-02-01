package httpclientlogic

import (
	"encoding/json"
	"fmt"
	"net/url"
	"runtime"
	"strings"
)

func ParseHeadersJSON(headersJSON string) map[string]string {
	if strings.TrimSpace(headersJSON) == "" {
		return nil
	}
	var headers map[string]string
	_ = json.Unmarshal([]byte(headersJSON), &headers)
	return headers
}

func IsFileUploadBody(body string) bool {
	return strings.Contains(body, "Content-Type: multipart/form-data") || strings.Contains(body, "< ")
}

func ExtractFileReferencePath(body string) (string, bool) {
	trimmed := strings.TrimSpace(body)
	if !strings.HasPrefix(trimmed, "< ") {
		return "", false
	}
	path := strings.TrimPrefix(trimmed, "< ")
	if strings.TrimSpace(path) == "" {
		return "", false
	}
	return path, true
}

func ShouldSetDefaultContentType(existingContentType string, body string) bool {
	return strings.TrimSpace(existingContentType) == "" && body != ""
}

func BuildDefaultUserAgent(version string) string {
	version = strings.TrimSpace(version)
	ua := "RawRequest"
	if version != "" {
		ua = fmt.Sprintf("RawRequest/%s", version)
	}
	return fmt.Sprintf("%s (Wails; %s/%s)", ua, runtime.GOOS, runtime.GOARCH)
}

// IsLocalhostURL returns true if the URL points to localhost (127.0.0.1, ::1, or localhost hostname)
func IsLocalhostURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1" ||
		strings.HasSuffix(host, ".localhost")
}
