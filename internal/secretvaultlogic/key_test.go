package secretvaultlogic

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestDecodeKeyFromFileBase64(t *testing.T) {
	good := make([]byte, 32)
	encoded := base64.StdEncoding.EncodeToString(good)

	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{name: "valid", input: encoded, wantErr: ""},
		{name: "valid with whitespace", input: " \n\t" + encoded + "\n ", wantErr: ""},
		{name: "invalid base64", input: "not-base64!!!", wantErr: "illegal base64 data"},
		{name: "invalid length", input: base64.StdEncoding.EncodeToString([]byte{1, 2, 3}), wantErr: "vault key has invalid length"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeKeyFromFileBase64(tt.input)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				if len(got) != 32 {
					t.Fatalf("expected 32 bytes, got %d", len(got))
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if got != nil {
				t.Fatalf("expected nil key on error, got %v", got)
			}
			if tt.wantErr != "" && !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %q", tt.wantErr, err.Error())
			}
		})
	}
}

func TestDecodeKeyFromKeyringBase64_InvalidLengthMessage(t *testing.T) {
	_, err := DecodeKeyFromKeyringBase64(base64.StdEncoding.EncodeToString([]byte{1, 2, 3}))
	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() != "invalid key length from keyring" {
		t.Fatalf("expected keyring length error, got %q", err.Error())
	}
}
