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
		{"application/java", ".class"},
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

func TestIsBinaryBody(t *testing.T) {
	tests := []struct {
		name       string
		data       []byte
		wantBinary bool
	}{
		{"empty body", nil, false},
		{"empty slice", []byte{}, false},
		{"plain ASCII", []byte("Hello, world!"), false},
		{"JSON text", []byte(`{"key": "value"}`), false},
		{"HTML text", []byte("<html><body>hello</body></html>"), false},
		{"multibyte UTF-8", []byte("日本語テキスト"), false},
		{"UTF-8 with emoji", []byte("Hello 🌍 world"), false},
		{"newlines and tabs", []byte("line1\nline2\ttab\r\n"), false},

		{"null byte at start", []byte{0x00, 0x48, 0x65, 0x6c}, true},
		{"null byte in middle", []byte("hel\x00lo"), true},
		{"PNG magic bytes", []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, true},
		{"PDF magic bytes", []byte("%PDF-1.4 \x00"), true},
		{"ZIP magic bytes", []byte{0x50, 0x4B, 0x03, 0x04, 0x00, 0x00}, true},
		{"GIF magic bytes", []byte("GIF89a\x00\x01"), true},
		{"invalid UTF-8 sequence", []byte{0xFF, 0xFE, 0x41, 0x42}, true},
		{"lone continuation byte", []byte{0x80, 0x41, 0x42}, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := IsBinaryBody(tc.data)
			if got != tc.wantBinary {
				t.Errorf("IsBinaryBody(%q) = %v, want %v", tc.name, got, tc.wantBinary)
			}
		})
	}
}

func TestSniffContentType(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		wantType string
	}{
		{"empty data", nil, "application/octet-stream"},
		{"plain text", []byte("Hello, world!"), "text/plain; charset=utf-8"},
		{"HTML", []byte("<html><body>test</body></html>"), "text/html; charset=utf-8"},
		{"PNG", []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, "image/png"},
		{"GIF", []byte("GIF89a"), "image/gif"},
		{"PDF", []byte("%PDF-1.4"), "application/pdf"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := SniffContentType(tc.data)
			if got != tc.wantType {
				t.Errorf("SniffContentType(%s) = %q, want %q", tc.name, got, tc.wantType)
			}
		})
	}
}