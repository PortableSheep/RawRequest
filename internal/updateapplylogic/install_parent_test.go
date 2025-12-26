package updateapplylogic

import "testing"

func TestInstallParentDir(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		want    string
		wantErr string
	}{
		{name: "empty", path: "", want: "", wantErr: "could not determine install parent directory"},
		{name: "regular path", path: "/Applications/RawRequest", want: "/Applications/RawRequest", wantErr: ""},
		{name: "app bundle", path: "/Applications/RawRequest.app", want: "/Applications", wantErr: ""},
		{name: "app bundle case-insensitive", path: "/Applications/RawRequest.APP", want: "/Applications", wantErr: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := InstallParentDir(tt.path)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				if got != tt.want {
					t.Fatalf("InstallParentDir(%q)=%q want %q", tt.path, got, tt.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if err.Error() != tt.wantErr {
				t.Fatalf("expected error %q, got %q", tt.wantErr, err.Error())
			}
		})
	}
}
