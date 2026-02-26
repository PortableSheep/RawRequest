package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"rawrequest/internal/cli"

	"github.com/mark3labs/mcp-go/mcp"
)

const testHTTPFile = `
@baseUrl = https://api.example.com
@token = test-token-123

@env.dev.baseUrl = https://dev.example.com
@env.prod.baseUrl = https://prod.example.com

###

@name listUsers
GET {{baseUrl}}/users
Authorization: Bearer {{token}}

###

@name createUser
POST {{baseUrl}}/users
Content-Type: application/json

{"name": "John", "email": "john@example.com"}

###

@name secretTest
GET {{baseUrl}}/secret
Authorization: Bearer {{secret:apiKey}}
`

// mockSecretResolver implements cli.SecretResolver for testing.
type mockSecretResolver struct {
	secrets map[string]map[string]string
}

func (m *mockSecretResolver) GetSecret(env, key string) (string, error) {
	if envSecrets, ok := m.secrets[env]; ok {
		if val, exists := envSecrets[key]; exists {
			return val, nil
		}
	}
	return "", fmt.Errorf("secret %s not found in %s", key, env)
}

func writeTestFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.http")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}
	return path
}

func TestHandleListRequests(t *testing.T) {
	filePath := writeTestFile(t, testHTTPFile)

	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]interface{}{
		"file": filePath,
	}

	result, err := h.handleListRequests(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %v", result.Content)
	}

	// Parse the JSON response
	text := result.Content[0].(mcp.TextContent).Text
	var summaries []cli.RequestSummary
	if err := json.Unmarshal([]byte(text), &summaries); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if len(summaries) != 3 {
		t.Fatalf("expected 3 requests, got %d", len(summaries))
	}

	// Verify request details
	if summaries[0].Name != "listUsers" {
		t.Errorf("expected first request name 'listUsers', got '%s'", summaries[0].Name)
	}
	if summaries[0].Method != "GET" {
		t.Errorf("expected GET method, got '%s'", summaries[0].Method)
	}
	if summaries[1].Name != "createUser" {
		t.Errorf("expected second request name 'createUser', got '%s'", summaries[1].Name)
	}
	if summaries[1].Method != "POST" {
		t.Errorf("expected POST method, got '%s'", summaries[1].Method)
	}
}

func TestHandleListRequestsFileNotFound(t *testing.T) {
	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]interface{}{
		"file": "/nonexistent/file.http",
	}

	result, err := h.handleListRequests(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected tool error for missing file")
	}
}

func TestHandleListEnvironments(t *testing.T) {
	filePath := writeTestFile(t, testHTTPFile)

	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]interface{}{
		"file": filePath,
	}

	result, err := h.handleListEnvironments(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %v", result.Content)
	}

	text := result.Content[0].(mcp.TextContent).Text
	type envInfo struct {
		Name      string            `json:"name"`
		Variables map[string]string `json:"variables"`
	}
	var envs []envInfo
	if err := json.Unmarshal([]byte(text), &envs); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if len(envs) != 2 {
		t.Fatalf("expected 2 environments, got %d", len(envs))
	}

	// Check that dev and prod are present (order may vary)
	envMap := make(map[string]envInfo)
	for _, e := range envs {
		envMap[e.Name] = e
	}
	if _, ok := envMap["dev"]; !ok {
		t.Error("expected 'dev' environment")
	}
	if _, ok := envMap["prod"]; !ok {
		t.Error("expected 'prod' environment")
	}
	if envMap["dev"].Variables["baseUrl"] != "https://dev.example.com" {
		t.Errorf("expected dev baseUrl, got '%s'", envMap["dev"].Variables["baseUrl"])
	}
}

func TestHandleSetVariable(t *testing.T) {
	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]interface{}{
		"key":   "myVar",
		"value": "myValue",
	}

	result, err := h.handleSetVariable(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected tool error: %v", result.Content)
	}

	// Verify the variable is stored
	if h.sessionVars["myVar"] != "myValue" {
		t.Errorf("expected session var 'myVar'='myValue', got '%s'", h.sessionVars["myVar"])
	}
}

func TestHandleSetVariablePersistsAcrossCalls(t *testing.T) {
	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	// Set two variables
	for _, pair := range [][2]string{{"a", "1"}, {"b", "2"}} {
		req := mcp.CallToolRequest{}
		req.Params.Arguments = map[string]interface{}{
			"key":   pair[0],
			"value": pair[1],
		}
		if _, err := h.handleSetVariable(context.Background(), req); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	if h.sessionVars["a"] != "1" || h.sessionVars["b"] != "2" {
		t.Errorf("expected a=1, b=2; got a=%s, b=%s", h.sessionVars["a"], h.sessionVars["b"])
	}
}

func TestHandleRunRequestNotFound(t *testing.T) {
	filePath := writeTestFile(t, testHTTPFile)

	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]interface{}{
		"file": filePath,
		"name": "nonExistent",
	}

	result, err := h.handleRunRequest(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected tool error for missing request")
	}
	text := result.Content[0].(mcp.TextContent).Text
	if !contains(text, "nonExistent") {
		t.Errorf("error message should mention request name, got: %s", text)
	}
}

func TestResolveSecrets(t *testing.T) {
	mock := &mockSecretResolver{
		secrets: map[string]map[string]string{
			"default": {"apiKey": "secret-123", "dbPass": "pass-456"},
			"dev":     {"apiKey": "dev-secret"},
		},
	}

	runner := cli.NewRunner(&cli.Options{
		Variables:   make(map[string]string),
		Environment: "dev",
	}, "test")
	runner.SetSecretResolver(mock)

	// Test that ResolveSecrets works via the exported method
	// We test indirectly through the runner's variable resolution
	tests := []struct {
		name     string
		input    string
		env      string
		expected string
	}{
		{
			name:     "resolve from specific env",
			input:    "Bearer {{secret:apiKey}}",
			env:      "dev",
			expected: "Bearer dev-secret",
		},
		{
			name:     "fallback to default env",
			input:    "pass: {{secret:dbPass}}",
			env:      "dev",
			expected: "pass: pass-456",
		},
		{
			name:     "resolve from default",
			input:    "key={{secret:apiKey}}",
			env:      "default",
			expected: "key=secret-123",
		},
		{
			name:     "unresolved secret stays as-is",
			input:    "{{secret:unknown}}",
			env:      "default",
			expected: "{{secret:unknown}}",
		},
		{
			name:     "no secret placeholder",
			input:    "plain text",
			env:      "default",
			expected: "plain text",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := cli.NewRunner(&cli.Options{
				Variables:   make(map[string]string),
				Environment: tt.env,
			}, "test")
			r.SetSecretResolver(mock)
			// Use ResolveForTest to exercise the resolve path
			got := r.ResolveForTest(tt.input)
			if got != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, got)
			}
		})
	}
}

func TestHandleGuideResource(t *testing.T) {
	h := &handlers{
		defaultEnv:  "default",
		version:     "test",
		sessionVars: make(map[string]string),
	}

	result, err := h.handleGuideResource(context.Background(), mcp.ReadResourceRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 resource content, got %d", len(result))
	}

	text := result[0].(mcp.TextResourceContents).Text
	if !contains(text, "RawRequest") {
		t.Error("guide should mention RawRequest")
	}
	if !contains(text, "list_requests") {
		t.Error("guide should mention list_requests tool")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
