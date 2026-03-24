package httpclientlogic

import "testing"

func TestIsBinaryContentType(t *testing.T) {
	tests := []struct {
		contentType string
		wantBinary  bool
	}{
		// Empty / missing → not binary (preserve existing behaviour)
		{"", false},

		// Text types → not binary
		{"text/plain", false},
		{"text/html", false},
		{"text/html; charset=utf-8", false},
		{"text/css", false},
		{"text/xml", false},
		{"text/csv", false},
		{"text/javascript", false},
		{"Text/Plain", false}, // case-insensitive

		// Application text-like types → not binary
		{"application/json", false},
		{"application/json; charset=utf-8", false},
		{"application/xml", false},
		{"application/javascript", false},
		{"application/x-www-form-urlencoded", false},
		{"application/graphql", false},
		{"application/xhtml+xml", false},
		{"application/ld+json", false},
		{"application/x-ndjson", false},
		{"application/soap+xml", false},
		{"multipart/form-data", false},
		{"application/x-sh", false},

		// Structured syntax suffix → not binary
		{"application/vnd.api+json", false},
		{"application/hal+json", false},
		{"application/atom+xml", false},
		{"application/rss+xml", false},
		{"application/problem+json", false},
		{"application/calendar+xml", false},
		{"application/config+yaml", false},

		// Binary types → binary
		{"application/octet-stream", true},
		{"application/pdf", true},
		{"application/zip", true},
		{"application/gzip", true},
		{"application/x-tar", true},
		{"application/java-archive", true},
		{"application/java", true},
		{"application/wasm", true},
		{"application/x-7z-compressed", true},
		{"application/protobuf", true},
		{"application/x-protobuf", true},
		{"application/vnd.ms-excel", true},
		{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true},
		{"image/png", true},
		{"image/jpeg", true},
		{"image/gif", true},
		{"image/webp", true},
		{"image/bmp", true},
		{"audio/mpeg", true},
		{"audio/ogg", true},
		{"video/mp4", true},
		{"video/webm", true},
		{"font/woff", true},
		{"font/woff2", true},
		{"font/ttf", true},

		// image/svg+xml is a structured suffix → not binary
		{"image/svg+xml", false},
	}

	for _, tc := range tests {
		t.Run(tc.contentType, func(t *testing.T) {
			got := IsBinaryContentType(tc.contentType)
			if got != tc.wantBinary {
				t.Errorf("IsBinaryContentType(%q) = %v, want %v", tc.contentType, got, tc.wantBinary)
			}
		})
	}
}

func TestExtensionForContentType(t *testing.T) {
	tests := []struct {
		contentType string
		wantExt     string
	}{
		{"", ".bin"},
		{"application/octet-stream", ".bin"},
		{"application/pdf", ".pdf"},
		{"application/zip", ".zip"},
		{"application/java-archive", ".jar"},
		{"image/png", ".png"},
		{"image/jpeg", ".jpg"},
		{"image/gif", ".gif"},
		{"video/mp4", ".mp4"},
		{"audio/mpeg", ".mp3"},
		{"font/woff2", ".woff2"},
		{"application/pdf; charset=binary", ".pdf"},
		{"application/wasm", ".wasm"},
	}

	for _, tc := range tests {
		t.Run(tc.contentType, func(t *testing.T) {
			got := ExtensionForContentType(tc.contentType)
			if got != tc.wantExt {
				t.Errorf("ExtensionForContentType(%q) = %q, want %q", tc.contentType, got, tc.wantExt)
			}
		})
	}
}
