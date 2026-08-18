package parsehttp

import (
	"os"
	"strings"
	"testing"
)

func TestParseBlocks(t *testing.T) {
	content := `@port = 8080
@host = localhost

### Get User
# @name get-user
# Some comment here
GET http://{{host}}:{{port}}/users/1
Authorization: Bearer test-token

### Create User
# @name create-user
POST http://{{host}}:{{port}}/users
Content-Type: application/json

{
  "name": "Alice"
}

### Visual Divider ######

### Update User
PUT http://{{host}}:{{port}}/users/1
`

	blocks := ParseBlocks(content)
	// There are 5 blocks:
	// 1. Initial variables block
	// 2. Get User request block
	// 3. Create User request block
	// 4. Visual Divider block
	// 5. Update User request block
	if len(blocks) != 5 {
		t.Fatalf("expected 5 blocks, got %d", len(blocks))
	}

	b0 := blocks[0]
	if len(b0.Lines) != 3 {
		t.Errorf("expected block 0 to have 3 lines, got %d", len(b0.Lines))
	}
	if b0.Name != "" {
		t.Errorf("expected block 0 name to be empty, got %q", b0.Name)
	}

	b1 := blocks[1]
	if b1.Name != "get-user" {
		t.Errorf("expected block 1 name to be 'get-user', got %q", b1.Name)
	}

	b2 := blocks[2]
	if b2.Name != "create-user" {
		t.Errorf("expected block 2 name to be 'create-user', got %q", b2.Name)
	}
}

func TestWriteRequestToFile_CreateAndAppend(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test_editor_*.http")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.Close()

	// 1. Create a request in a new/empty file
	req1 := RequestData{
		Name:    "get-status",
		Method:  "GET",
		URL:     "https://api.example.com/status",
		Headers: map[string]string{"Accept": "application/json"},
	}

	err = WriteRequestToFile(tmpFile.Name(), req1)
	if err != nil {
		t.Fatalf("WriteRequestToFile failed: %v", err)
	}

	contentBytes, err := os.ReadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}
	content := string(contentBytes)

	if !strings.Contains(content, "###") || !strings.Contains(content, "@name get-status") || !strings.Contains(content, "GET https://api.example.com/status") {
		t.Errorf("invalid formatted request in file: %q", content)
	}

	// 2. Append another request
	req2 := RequestData{
		Name:   "post-data",
		Method: "POST",
		URL:    "https://api.example.com/data",
		Body:   `{"val": 42}`,
	}

	err = WriteRequestToFile(tmpFile.Name(), req2)
	if err != nil {
		t.Fatalf("WriteRequestToFile failed to append: %v", err)
	}

	contentBytes, err = os.ReadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}
	content = string(contentBytes)

	blocks := ParseBlocks(content)
	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks after append, got %d", len(blocks))
	}
	if blocks[0].Name != "get-status" || blocks[1].Name != "post-data" {
		t.Errorf("incorrect block names after append: b0=%q, b1=%q", blocks[0].Name, blocks[1].Name)
	}
}

func TestWriteRequestToFile_UpdateWithCommentsPreserved(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test_editor_*.http")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.Close()

	initialContent := `###
# This is an important developer comment!
# @name get-users
GET https://api.com/users
Accept: application/json
`
	err = os.WriteFile(tmpFile.Name(), []byte(initialContent), 0644)
	if err != nil {
		t.Fatalf("failed to write initial file: %v", err)
	}

	// Update only the URL and add a header, should merge and keep the comment
	updateReq := RequestData{
		Name:    "get-users",
		URL:     "https://api.com/v2/users",
		Headers: map[string]string{"Accept": "application/json", "X-Request-ID": "123"},
	}

	err = WriteRequestToFile(tmpFile.Name(), updateReq)
	if err != nil {
		t.Fatalf("failed to update request: %v", err)
	}

	contentBytes, err := os.ReadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}
	content := string(contentBytes)

	if !strings.Contains(content, "# This is an important developer comment!") {
		t.Error("lost developer comment during update")
	}
	if !strings.Contains(content, "GET https://api.com/v2/users") {
		t.Error("failed to update URL")
	}
	if !strings.Contains(content, "X-Request-ID: 123") {
		t.Error("failed to add/merge headers")
	}
}

func TestSaveVariableInFile(t *testing.T) {
	tmpFile, err := os.CreateTemp("", "test_editor_*.http")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.Close()

	// 1. Save global variable in new file
	err = SaveVariableInFile(tmpFile.Name(), "host", "localhost", "")
	if err != nil {
		t.Fatalf("SaveVariableInFile failed: %v", err)
	}

	// 2. Save environment variable
	err = SaveVariableInFile(tmpFile.Name(), "token", "env-token", "dev")
	if err != nil {
		t.Fatalf("SaveVariableInFile failed: %v", err)
	}

	// 3. Write a request block
	req := RequestData{
		Name:   "ping",
		Method: "GET",
		URL:    "http://{{host}}/ping",
	}
	err = WriteRequestToFile(tmpFile.Name(), req)
	if err != nil {
		t.Fatalf("WriteRequestToFile failed: %v", err)
	}

	// 4. Save another variable (should append to variables block before the request)
	err = SaveVariableInFile(tmpFile.Name(), "port", "8080", "")
	if err != nil {
		t.Fatalf("SaveVariableInFile failed: %v", err)
	}

	// 5. Update an existing variable
	err = SaveVariableInFile(tmpFile.Name(), "host", "127.0.0.1", "")
	if err != nil {
		t.Fatalf("SaveVariableInFile failed: %v", err)
	}

	contentBytes, err := os.ReadFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("failed to read temp file: %v", err)
	}
	content := string(contentBytes)

	if !strings.Contains(content, "@host = 127.0.0.1") {
		t.Error("failed to update global variable")
	}
	if strings.Contains(content, "@host = localhost") {
		t.Error("old global variable value still exists")
	}
	if !strings.Contains(content, "@env.dev.token = env-token") {
		t.Error("failed to save environment variable")
	}
	if !strings.Contains(content, "@port = 8080") {
		t.Error("failed to save new global variable")
	}

	// Verify that variable is inserted at the top / variables block before the request block
	lines := strings.Split(content, "\n")
	pingIdx := -1
	portIdx := -1
	for i, line := range lines {
		if strings.Contains(line, "@name ping") {
			pingIdx = i
		}
		if strings.Contains(line, "@port = 8080") {
			portIdx = i
		}
	}

	if pingIdx == -1 || portIdx == -1 || portIdx > pingIdx {
		t.Errorf("expected variables block before request block: portIdx=%d, pingIdx=%d", portIdx, pingIdx)
	}
}
