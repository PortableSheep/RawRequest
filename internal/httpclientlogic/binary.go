package httpclientlogic

import (
	"mime"
	"strings"
)

// IsBinaryContentType returns true if the given Content-Type header value
// indicates a binary (non-text) response body. Detection uses a whitelist
// of known text-like types; anything not on the list is assumed binary.
func IsBinaryContentType(contentType string) bool {
	if contentType == "" {
		return false
	}

	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.TrimSpace(strings.ToLower(contentType))
	}
	mediaType = strings.ToLower(mediaType)

	if strings.HasPrefix(mediaType, "text/") {
		return false
	}

	textLikeTypes := map[string]bool{
		"application/json":                  true,
		"application/xml":                   true,
		"application/javascript":            true,
		"application/ecmascript":            true,
		"application/x-javascript":          true,
		"application/x-www-form-urlencoded": true,
		"application/graphql":               true,
		"application/graphql+json":          true,
		"application/ld+json":               true,
		"application/manifest+json":         true,
		"application/x-ndjson":              true,
		"application/soap+xml":              true,
		"application/xhtml+xml":             true,
		"application/x-sh":                  true,
		"multipart/form-data":               true,
	}

	if textLikeTypes[mediaType] {
		return false
	}

	// Structured syntax suffixes: +json, +xml, +yaml indicate text
	if strings.HasSuffix(mediaType, "+json") ||
		strings.HasSuffix(mediaType, "+xml") ||
		strings.HasSuffix(mediaType, "+yaml") {
		return false
	}

	// Everything else (application/octet-stream, image/*, audio/*, video/*,
	// application/zip, application/pdf, application/java-archive, etc.)
	return true
}

// ContentTypeForFilename returns a suggested filename extension for the given
// content type, used when proposing a save-as filename.
func ExtensionForContentType(contentType string) string {
	if contentType == "" {
		return ".bin"
	}

	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.TrimSpace(strings.ToLower(contentType))
	}
	mediaType = strings.ToLower(mediaType)

	known := map[string]string{
		"application/octet-stream":  ".bin",
		"application/pdf":           ".pdf",
		"application/zip":           ".zip",
		"application/gzip":          ".gz",
		"application/x-tar":         ".tar",
		"application/x-gzip":        ".tar.gz",
		"application/java-archive":  ".jar",
		"application/wasm":          ".wasm",
		"application/x-7z-compressed": ".7z",
		"application/x-rar-compressed": ".rar",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
		"application/vnd.ms-excel":       ".xls",
		"application/msword":             ".doc",
		"image/png":                      ".png",
		"image/jpeg":                     ".jpg",
		"image/gif":                      ".gif",
		"image/webp":                     ".webp",
		"image/svg+xml":                  ".svg",
		"image/bmp":                      ".bmp",
		"image/tiff":                     ".tiff",
		"image/x-icon":                   ".ico",
		"audio/mpeg":                     ".mp3",
		"audio/ogg":                      ".ogg",
		"audio/wav":                      ".wav",
		"video/mp4":                      ".mp4",
		"video/webm":                     ".webm",
		"video/ogg":                      ".ogv",
		"font/woff":                      ".woff",
		"font/woff2":                     ".woff2",
		"font/ttf":                       ".ttf",
		"font/otf":                       ".otf",
		"application/x-protobuf":         ".pb",
		"application/protobuf":           ".pb",
	}

	if ext, ok := known[mediaType]; ok {
		return ext
	}

	// Fallback: derive from subtype
	parts := strings.SplitN(mediaType, "/", 2)
	if len(parts) == 2 {
		sub := parts[1]
		// Strip vendor prefix (x-, vnd.)
		sub = strings.TrimPrefix(sub, "x-")
		sub = strings.TrimPrefix(sub, "vnd.")
		// Use first segment before any +
		if idx := strings.Index(sub, "+"); idx > 0 {
			sub = sub[:idx]
		}
		if sub != "" && len(sub) <= 6 {
			return "." + sub
		}
	}

	return ".bin"
}
