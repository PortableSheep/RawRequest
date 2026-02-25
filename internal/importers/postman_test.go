package importers

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParsePostmanCollection(t *testing.T) {
	tests := []struct {
		name      string
		input     PostmanCollection
		wantErr   bool
		checks    func(t *testing.T, result *ImportResult)
	}{
		{
			name: "simple GET request",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "Simple API"},
				Item: []PostmanItem{
					{
						Name: "Get Users",
						Request: &PostmanRequest{
							Method: "GET",
							Header: []PostmanHeader{
								{Key: "Accept", Value: "application/json"},
							},
							URL: mustMarshal(PostmanURL{Raw: "https://api.example.com/users"}),
						},
					},
				},
			},
			checks: func(t *testing.T, r *ImportResult) {
				if len(r.Files) != 1 {
					t.Fatalf("expected 1 file, got %d", len(r.Files))
				}
				c := r.Files[0].Content
				assertContains(t, c, "# Imported from Postman: Simple API")
				assertContains(t, c, "@name Get Users")
				assertContains(t, c, "GET https://api.example.com/users")
				assertContains(t, c, "Accept: application/json")
			},
		},
		{
			name: "POST with JSON body",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "Body Test"},
				Item: []PostmanItem{
					{
						Name: "Create User",
						Request: &PostmanRequest{
							Method: "POST",
							Header: []PostmanHeader{
								{Key: "Content-Type", Value: "application/json"},
							},
							URL: mustMarshal(PostmanURL{Raw: "https://api.example.com/users"}),
							Body: &PostmanBody{
								Mode: "raw",
								Raw:  `{"name": "John"}`,
							},
						},
					},
				},
			},
			checks: func(t *testing.T, r *ImportResult) {
				c := r.Files[0].Content
				assertContains(t, c, "POST https://api.example.com/users")
				assertContains(t, c, "Content-Type: application/json")
				assertContains(t, c, `{"name": "John"}`)
			},
		},
		{
			name: "nested folders produce separator comments",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "Folders"},
				Item: []PostmanItem{
					{
						Name: "User Folder",
						Item: []PostmanItem{
							{
								Name: "List Users",
								Request: &PostmanRequest{
									Method: "GET",
									URL:    mustMarshal(PostmanURL{Raw: "https://api.example.com/users"}),
								},
							},
						},
					},
				},
			},
			checks: func(t *testing.T, r *ImportResult) {
				c := r.Files[0].Content
				assertContains(t, c, "### --- User Folder ---")
				assertContains(t, c, "@name List Users")
				assertContains(t, c, "GET https://api.example.com/users")
			},
		},
		{
			name: "collection variables at top",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "Vars"},
				Variable: []PostmanVar{
					{Key: "baseUrl", Value: "https://api.example.com"},
					{Key: "token", Value: "abc123"},
				},
				Item: []PostmanItem{
					{
						Name: "Ping",
						Request: &PostmanRequest{
							Method: "GET",
							URL:    mustMarshal(PostmanURL{Raw: "{{baseUrl}}/ping"}),
						},
					},
				},
			},
			checks: func(t *testing.T, r *ImportResult) {
				c := r.Files[0].Content
				assertContains(t, c, "@baseUrl = https://api.example.com")
				assertContains(t, c, "@token = abc123")
				// Variables should appear before the request.
				varIdx := strings.Index(c, "@baseUrl")
				reqIdx := strings.Index(c, "### Ping")
				if varIdx >= reqIdx {
					t.Error("variables should appear before requests")
				}
			},
		},
		{
			name: "URL as plain string",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "String URL"},
				Item: []PostmanItem{
					{
						Name: "Health",
						Request: &PostmanRequest{
							Method: "GET",
							URL:    mustMarshalString("https://api.example.com/health"),
						},
					},
				},
			},
			checks: func(t *testing.T, r *ImportResult) {
				c := r.Files[0].Content
				assertContains(t, c, "GET https://api.example.com/health")
			},
		},
		{
			name: "empty collection produces minimal output",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "Empty"},
				Item: []PostmanItem{},
			},
			checks: func(t *testing.T, r *ImportResult) {
				if len(r.Files) != 1 {
					t.Fatalf("expected 1 file, got %d", len(r.Files))
				}
				c := r.Files[0].Content
				assertContains(t, c, "# Imported from Postman: Empty")
				if r.Files[0].Name != "Empty.http" {
					t.Errorf("expected file name Empty.http, got %s", r.Files[0].Name)
				}
			},
		},
		{
			name: "disabled headers are skipped",
			input: PostmanCollection{
				Info: PostmanInfo{Name: "Headers"},
				Item: []PostmanItem{
					{
						Name: "With Headers",
						Request: &PostmanRequest{
							Method: "GET",
							URL:    mustMarshal(PostmanURL{Raw: "https://api.example.com"}),
							Header: []PostmanHeader{
								{Key: "Accept", Value: "application/json", Disabled: false},
								{Key: "X-Debug", Value: "true", Disabled: true},
							},
						},
					},
				},
			},
			checks: func(t *testing.T, r *ImportResult) {
				c := r.Files[0].Content
				assertContains(t, c, "Accept: application/json")
				assertNotContains(t, c, "X-Debug")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.input)
			if err != nil {
				t.Fatalf("failed to marshal test input: %v", err)
			}
			result, err := ParsePostmanCollection(data)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			tt.checks(t, result)
		})
	}
}

func TestParsePostmanCollectionInvalidJSON(t *testing.T) {
	_, err := ParsePostmanCollection([]byte(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParsePostmanEnvironment(t *testing.T) {
	data := []byte(`{
		"name": "Production",
		"values": [
			{"key": "baseUrl", "value": "https://prod.example.com", "enabled": true},
			{"key": "debug", "value": "true", "enabled": false},
			{"key": "token", "value": "secret", "enabled": true}
		]
	}`)

	vars, err := ParsePostmanEnvironment(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vars) != 2 {
		t.Fatalf("expected 2 enabled vars, got %d", len(vars))
	}
	if vars[0].Key != "baseUrl" || vars[0].Value != "https://prod.example.com" {
		t.Errorf("unexpected first var: %+v", vars[0])
	}
	if vars[1].Key != "token" || vars[1].Value != "secret" {
		t.Errorf("unexpected second var: %+v", vars[1])
	}
}

func TestSanitizeName(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Get Users", "Get Users"},
		{"Create User (admin)", "Create User admin"},
		{"delete/user", "deleteuser"},
		{"  spaces  ", "spaces"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeName(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// Helpers

func mustMarshal(v interface{}) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func mustMarshalString(s string) json.RawMessage {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return b
}

func assertContains(t *testing.T, content, substr string) {
	t.Helper()
	if !strings.Contains(content, substr) {
		t.Errorf("expected content to contain %q, got:\n%s", substr, content)
	}
}

func assertNotContains(t *testing.T, content, substr string) {
	t.Helper()
	if strings.Contains(content, substr) {
		t.Errorf("expected content NOT to contain %q, got:\n%s", substr, content)
	}
}
