package importers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegression_PostmanCRUDCollection(t *testing.T) {
	col := PostmanCollection{
		Info: PostmanInfo{Name: "User CRUD API"},
		Variable: []PostmanVar{
			{Key: "baseUrl", Value: "https://api.example.com"},
			{Key: "token", Value: "bearer-abc"},
		},
		Item: []PostmanItem{
			{
				Name: "List Users",
				Request: &PostmanRequest{
					Method: "GET",
					URL:    mustMarshal(PostmanURL{Raw: "{{baseUrl}}/users"}),
					Header: []PostmanHeader{
						{Key: "Accept", Value: "application/json"},
						{Key: "Authorization", Value: "Bearer {{token}}"},
					},
				},
			},
			{
				Name: "Create User",
				Request: &PostmanRequest{
					Method: "POST",
					URL:    mustMarshal(PostmanURL{Raw: "{{baseUrl}}/users"}),
					Header: []PostmanHeader{
						{Key: "Content-Type", Value: "application/json"},
					},
					Body: &PostmanBody{
						Mode: "raw",
						Raw:  `{"name":"Alice","email":"alice@example.com"}`,
					},
				},
			},
			{
				Name: "Update User",
				Request: &PostmanRequest{
					Method: "PUT",
					URL:    mustMarshal(PostmanURL{Raw: "{{baseUrl}}/users/1"}),
					Header: []PostmanHeader{
						{Key: "Content-Type", Value: "application/json"},
					},
					Body: &PostmanBody{
						Mode: "raw",
						Raw:  `{"name":"Alice Updated"}`,
					},
				},
			},
			{
				Name: "Delete User",
				Request: &PostmanRequest{
					Method: "DELETE",
					URL:    mustMarshal(PostmanURL{Raw: "{{baseUrl}}/users/1"}),
					Header: []PostmanHeader{
						{Key: "Authorization", Value: "Bearer {{token}}"},
					},
				},
			},
		},
	}

	data, err := json.Marshal(col)
	if err != nil {
		t.Fatal(err)
	}
	result, err := ParsePostmanCollection(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(result.Files))
	}
	c := result.Files[0].Content

	// Variables at top
	assertContains(t, c, "@baseUrl = https://api.example.com")
	assertContains(t, c, "@token = bearer-abc")

	// All four CRUD requests present
	assertContains(t, c, "GET {{baseUrl}}/users")
	assertContains(t, c, "POST {{baseUrl}}/users")
	assertContains(t, c, "PUT {{baseUrl}}/users/1")
	assertContains(t, c, "DELETE {{baseUrl}}/users/1")

	// Headers
	assertContains(t, c, "Accept: application/json")
	assertContains(t, c, "Authorization: Bearer {{token}}")
	assertContains(t, c, "Content-Type: application/json")

	// Bodies
	assertContains(t, c, `{"name":"Alice","email":"alice@example.com"}`)
	assertContains(t, c, `{"name":"Alice Updated"}`)

	// @name directives for all requests
	assertContains(t, c, "@name List Users")
	assertContains(t, c, "@name Create User")
	assertContains(t, c, "@name Update User")
	assertContains(t, c, "@name Delete User")

	// Variables appear before requests
	varIdx := strings.Index(c, "@baseUrl")
	reqIdx := strings.Index(c, "GET {{baseUrl}}")
	if varIdx >= reqIdx {
		t.Error("variables should appear before requests")
	}
}

func TestRegression_BrunoMultiFileCollection(t *testing.T) {
	tmpDir := t.TempDir()

	// Root-level request
	listUsers := `meta {
  name: List Users
}

get {
  url: {{baseUrl}}/users
  body: none
}

headers {
  Accept: application/json
}
`
	if err := os.WriteFile(filepath.Join(tmpDir, "list-users.bru"), []byte(listUsers), 0644); err != nil {
		t.Fatal(err)
	}

	// Subfolder with auth requests
	authDir := filepath.Join(tmpDir, "auth")
	if err := os.Mkdir(authDir, 0755); err != nil {
		t.Fatal(err)
	}

	login := `meta {
  name: Login
}

post {
  url: {{baseUrl}}/auth/login
  body: json
}

headers {
  Content-Type: application/json
}

body:json {
  {
    "username": "admin",
    "password": "secret"
  }
}
`
	if err := os.WriteFile(filepath.Join(authDir, "login.bru"), []byte(login), 0644); err != nil {
		t.Fatal(err)
	}

	// Environments
	envDir := filepath.Join(tmpDir, "environments")
	if err := os.Mkdir(envDir, 0755); err != nil {
		t.Fatal(err)
	}

	devEnv := `vars {
  baseUrl: https://dev.example.com
  apiKey: dev-key-123
}
`
	prodEnv := `vars {
  baseUrl: https://api.example.com
  apiKey: prod-key-456
}
`
	if err := os.WriteFile(filepath.Join(envDir, "dev.bru"), []byte(devEnv), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(envDir, "prod.bru"), []byte(prodEnv), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := ImportBrunoCollection(tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(result.Files))
	}
	c := result.Files[0].Content

	// Both environments present
	assertContains(t, c, "@env.dev.baseUrl https://dev.example.com")
	assertContains(t, c, "@env.dev.apiKey dev-key-123")
	assertContains(t, c, "@env.prod.baseUrl https://api.example.com")
	assertContains(t, c, "@env.prod.apiKey prod-key-456")

	// Root request
	assertContains(t, c, "@name List Users")
	assertContains(t, c, "GET {{baseUrl}}/users")
	assertContains(t, c, "Accept: application/json")

	// Auth subfolder
	assertContains(t, c, "# Folder: auth")
	assertContains(t, c, "@name Login")
	assertContains(t, c, "POST {{baseUrl}}/auth/login")
	assertContains(t, c, `"username": "admin"`)

	// Request separator
	assertContains(t, c, "###")
}

func TestRegression_PostmanDetectImportRoundtrip(t *testing.T) {
	col := PostmanCollection{
		Info: PostmanInfo{Name: "Roundtrip Test"},
		Item: []PostmanItem{
			{
				Name: "Health Check",
				Request: &PostmanRequest{
					Method: "GET",
					URL:    mustMarshal(PostmanURL{Raw: "https://api.example.com/health"}),
				},
			},
		},
	}

	data, err := json.Marshal(col)
	if err != nil {
		t.Fatal(err)
	}

	// Write to temp file and detect format
	dir := t.TempDir()
	path := filepath.Join(dir, "collection.json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	format, err := DetectFormat(path)
	if err != nil {
		t.Fatalf("DetectFormat error: %v", err)
	}
	if format != "postman" {
		t.Fatalf("expected postman format, got %s", format)
	}

	// Import via auto-detection
	result, err := ImportFromPath(path)
	if err != nil {
		t.Fatalf("ImportFromPath error: %v", err)
	}

	c := result.Files[0].Content
	assertContains(t, c, "# Imported from Postman: Roundtrip Test")
	assertContains(t, c, "GET https://api.example.com/health")
	assertContains(t, c, "@name Health Check")
}

func TestRegression_BrunoDetectImportRoundtrip(t *testing.T) {
	dir := t.TempDir()

	bruContent := `meta {
  name: Ping
}

get {
  url: https://api.example.com/ping
  body: none
}
`
	if err := os.WriteFile(filepath.Join(dir, "ping.bru"), []byte(bruContent), 0644); err != nil {
		t.Fatal(err)
	}

	format, err := DetectFormat(dir)
	if err != nil {
		t.Fatalf("DetectFormat error: %v", err)
	}
	if format != "bruno" {
		t.Fatalf("expected bruno format, got %s", format)
	}

	// Import via auto-detection
	result, err := ImportFromPath(dir)
	if err != nil {
		t.Fatalf("ImportFromPath error: %v", err)
	}

	c := result.Files[0].Content
	assertContains(t, c, "@name Ping")
	assertContains(t, c, "GET https://api.example.com/ping")
}
