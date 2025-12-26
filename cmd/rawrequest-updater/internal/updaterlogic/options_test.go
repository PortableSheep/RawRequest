package updaterlogic

import "testing"

func TestValidateOptions(t *testing.T) {
	cases := []struct {
		name string
		o    Options
		want string
	}{
		{
			name: "missing install path",
			o:    Options{InstallPath: "", ArtifactURL: "u"},
			want: "missing --install-path",
		},
		{
			name: "missing artifact",
			o:    Options{InstallPath: "/x"},
			want: "missing --artifact-url (or --artifact-path)",
		},
		{
			name: "both url and path",
			o:    Options{InstallPath: "/x", ArtifactURL: "u", ArtifactPath: "p"},
			want: "provide only one of --artifact-url or --artifact-path",
		},
		{
			name: "ok url",
			o:    Options{InstallPath: "/x", ArtifactURL: "u"},
			want: "",
		},
		{
			name: "ok path",
			o:    Options{InstallPath: "/x", ArtifactPath: "p"},
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateOptions(tc.o)
			if tc.want == "" {
				if err != nil {
					t.Fatalf("expected nil error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error %q, got nil", tc.want)
			}
			if err.Error() != tc.want {
				t.Fatalf("expected error %q, got %q", tc.want, err.Error())
			}
		})
	}
}

func TestArtifactLabel(t *testing.T) {
	if got := ArtifactLabel(Options{ArtifactURL: "u"}); got != "u" {
		t.Fatalf("expected url label, got %q", got)
	}
	if got := ArtifactLabel(Options{ArtifactPath: "p"}); got != "p" {
		t.Fatalf("expected path label, got %q", got)
	}
	if got := ArtifactLabel(Options{ArtifactURL: "u", ArtifactPath: "p"}); got != "p" {
		t.Fatalf("expected path preferred, got %q", got)
	}
}

func TestArtifactFormatsForLabel(t *testing.T) {
	cases := []struct {
		name  string
		label string
		want  []ArtifactFormat
	}{
		{name: "zip", label: "file.zip", want: []ArtifactFormat{ArtifactZip}},
		{name: "tar.gz", label: "file.tar.gz", want: []ArtifactFormat{ArtifactTarGz}},
		{name: "tgz", label: "file.tgz", want: []ArtifactFormat{ArtifactTarGz}},
		{name: "unknown", label: "artifact", want: []ArtifactFormat{ArtifactZip, ArtifactTarGz}},
		{name: "empty", label: "", want: []ArtifactFormat{ArtifactZip, ArtifactTarGz}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ArtifactFormatsForLabel(tc.label)
			if len(got) != len(tc.want) {
				t.Fatalf("expected %d formats, got %d", len(tc.want), len(got))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("at %d expected %v, got %v", i, tc.want[i], got[i])
				}
			}
		})
	}

}
