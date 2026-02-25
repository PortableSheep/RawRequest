package importers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseBruFile_SimpleGet(t *testing.T) {
	content := `meta {
  name: Get Users
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/users
  body: none
  auth: none
}
`
	req, err := ParseBruFile(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.Name != "Get Users" {
		t.Errorf("name = %q, want %q", req.Name, "Get Users")
	}
	if req.Method != "GET" {
		t.Errorf("method = %q, want %q", req.Method, "GET")
	}
	if req.URL != "{{baseUrl}}/users" {
		t.Errorf("url = %q, want %q", req.URL, "{{baseUrl}}/users")
	}
	if req.Body != "" {
		t.Errorf("body = %q, want empty", req.Body)
	}
}

func TestParseBruFile_PostWithJSONBody(t *testing.T) {
	content := `meta {
  name: Create User
}

post {
  url: https://api.example.com/users
  body: json
  auth: none
}

headers {
  Content-Type: application/json
}

body:json {
  {
    "name": "John",
    "email": "john@example.com"
  }
}
`
	req, err := ParseBruFile(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.Method != "POST" {
		t.Errorf("method = %q, want %q", req.Method, "POST")
	}
	if req.Name != "Create User" {
		t.Errorf("name = %q, want %q", req.Name, "Create User")
	}
	if !strings.Contains(req.Body, `"name": "John"`) {
		t.Errorf("body missing expected JSON content, got: %q", req.Body)
	}
	if !strings.Contains(req.Body, `"email": "john@example.com"`) {
		t.Errorf("body missing email field, got: %q", req.Body)
	}
}

func TestParseBruFile_Headers(t *testing.T) {
	content := `get {
  url: https://api.example.com/data
  body: none
}

headers {
  Authorization: Bearer {{token}}
  Content-Type: application/json
  X-Custom-Header: custom-value
}
`
	req, err := ParseBruFile(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	tests := map[string]string{
		"Authorization":  "Bearer {{token}}",
		"Content-Type":   "application/json",
		"X-Custom-Header": "custom-value",
	}
	for k, want := range tests {
		got, ok := req.Headers[k]
		if !ok {
			t.Errorf("header %q not found", k)
			continue
		}
		if got != want {
			t.Errorf("header %q = %q, want %q", k, got, want)
		}
	}
}

func TestParseBruFile_MetaNameExtraction(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name: "simple name",
			content: `meta {
  name: Login
}

post {
  url: https://api.example.com/login
  body: json
}
`,
			want: "Login",
		},
		{
			name: "name with spaces",
			content: `meta {
  name: Get User Profile
  type: http
}

get {
  url: https://api.example.com/profile
  body: none
}
`,
			want: "Get User Profile",
		},
		{
			name: "no meta block",
			content: `get {
  url: https://api.example.com/health
  body: none
}
`,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := ParseBruFile(tt.content)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if req.Name != tt.want {
				t.Errorf("name = %q, want %q", req.Name, tt.want)
			}
		})
	}
}

func TestParseBruEnvironment(t *testing.T) {
	content := `vars {
  baseUrl: https://api.example.com
  token: abc123
  timeout: 5000
}
`
	vars, err := ParseBruEnvironment(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := map[string]string{
		"baseUrl": "https://api.example.com",
		"token":   "abc123",
		"timeout": "5000",
	}
	for k, want := range expected {
		got, ok := vars[k]
		if !ok {
			t.Errorf("variable %q not found", k)
			continue
		}
		if got != want {
			t.Errorf("variable %q = %q, want %q", k, got, want)
		}
	}
}

func TestParseBruFile_Minimal(t *testing.T) {
	content := `get {
  url: https://example.com
}
`
	req, err := ParseBruFile(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.Method != "GET" {
		t.Errorf("method = %q, want %q", req.Method, "GET")
	}
	if req.URL != "https://example.com" {
		t.Errorf("url = %q, want %q", req.URL, "https://example.com")
	}
	if req.Name != "" {
		t.Errorf("name = %q, want empty", req.Name)
	}
	if len(req.Headers) != 0 {
		t.Errorf("headers = %v, want empty", req.Headers)
	}
}

func TestParseBruFile_MissingMethod(t *testing.T) {
	content := `meta {
  name: Bad Request
}
`
	_, err := ParseBruFile(content)
	if err == nil {
		t.Fatal("expected error for missing method, got nil")
	}
}

func TestParseBruEnvironment_Empty(t *testing.T) {
	content := `vars {
}
`
	vars, err := ParseBruEnvironment(content)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vars) != 0 {
		t.Errorf("vars = %v, want empty", vars)
	}
}

func TestParseBruEnvironment_NoVarsBlock(t *testing.T) {
	vars, err := ParseBruEnvironment("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vars) != 0 {
		t.Errorf("vars = %v, want empty", vars)
	}
}

func TestImportBrunoCollection(t *testing.T) {
	// Create temporary Bruno collection directory
	tmpDir := t.TempDir()

	// Create a request file
	getUsers := `meta {
  name: Get Users
}

get {
  url: {{baseUrl}}/users
  body: none
}

headers {
  Authorization: Bearer {{token}}
}
`
	if err := os.WriteFile(filepath.Join(tmpDir, "get-users.bru"), []byte(getUsers), 0644); err != nil {
		t.Fatal(err)
	}

	// Create a POST request
	createUser := `meta {
  name: Create User
}

post {
  url: {{baseUrl}}/users
  body: json
}

headers {
  Content-Type: application/json
}

body:json {
  {
    "name": "John"
  }
}
`
	if err := os.WriteFile(filepath.Join(tmpDir, "create-user.bru"), []byte(createUser), 0644); err != nil {
		t.Fatal(err)
	}

	// Create environments directory with a dev environment
	envDir := filepath.Join(tmpDir, "environments")
	if err := os.Mkdir(envDir, 0755); err != nil {
		t.Fatal(err)
	}
	devEnv := `vars {
  baseUrl: https://dev.example.com
  token: dev-token
}
`
	if err := os.WriteFile(filepath.Join(envDir, "dev.bru"), []byte(devEnv), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := ImportBrunoCollection(tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(result.Files))
	}

	content := result.Files[0].Content

	// Check environment variables
	if !strings.Contains(content, "@env.dev.baseUrl https://dev.example.com") {
		t.Error("missing dev baseUrl environment variable")
	}
	if !strings.Contains(content, "@env.dev.token dev-token") {
		t.Error("missing dev token environment variable")
	}

	// Check requests
	if !strings.Contains(content, "@name Create User") {
		t.Error("missing Create User request name")
	}
	if !strings.Contains(content, "POST {{baseUrl}}/users") {
		t.Error("missing POST request line")
	}
	if !strings.Contains(content, "@name Get Users") {
		t.Error("missing Get Users request name")
	}
	if !strings.Contains(content, "GET {{baseUrl}}/users") {
		t.Error("missing GET request line")
	}
	if !strings.Contains(content, "Authorization: Bearer {{token}}") {
		t.Error("missing Authorization header")
	}
	if !strings.Contains(content, `"name": "John"`) {
		t.Error("missing JSON body")
	}

	// Check separator between requests
	if !strings.Contains(content, "###") {
		t.Error("missing request separator")
	}
}

func TestImportBrunoCollection_WithSubdirectories(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a subdirectory
	subDir := filepath.Join(tmpDir, "auth")
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatal(err)
	}

	login := `meta {
  name: Login
}

post {
  url: {{baseUrl}}/login
  body: json
}
`
	if err := os.WriteFile(filepath.Join(subDir, "login.bru"), []byte(login), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := ImportBrunoCollection(tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	content := result.Files[0].Content
	if !strings.Contains(content, "# Folder: auth") {
		t.Error("missing folder comment for auth subdirectory")
	}
	if !strings.Contains(content, "@name Login") {
		t.Error("missing Login request")
	}
}

func TestImportBrunoCollection_EmptyDir(t *testing.T) {
	tmpDir := t.TempDir()
	_, err := ImportBrunoCollection(tmpDir)
	if err == nil {
		t.Fatal("expected error for empty directory, got nil")
	}
}

func TestImportBrunoCollection_NotADir(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "file.txt")
	os.WriteFile(tmpFile, []byte("hello"), 0644)
	_, err := ImportBrunoCollection(tmpFile)
	if err == nil {
		t.Fatal("expected error for non-directory, got nil")
	}
}

func TestParseBruFile_AllMethods(t *testing.T) {
	methods := []string{"get", "post", "put", "delete", "patch", "head", "options"}
	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			content := method + " {\n  url: https://example.com\n}\n"
			req, err := ParseBruFile(content)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if req.Method != strings.ToUpper(method) {
				t.Errorf("method = %q, want %q", req.Method, strings.ToUpper(method))
			}
		})
	}
}
