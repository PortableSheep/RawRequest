package cli

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rawrequest/internal/mockserver"
)

func TestRunMockServerUsesSQLiteThroughCLI(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "mock.http")
	dbPath := filepath.Join(dir, "cli-mock.db")
	port := getFreePort(t)
	content := `
### bootstrap
@mockinit
< {
  db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
}

###
@mock
POST /users
Content-Type: application/json

< {
  const payload = JSON.parse(request.body);
  const result = db.exec("INSERT INTO users (name) VALUES (?)", payload.name);
  response.status = 201;
  response.body = { id: result.lastInsertId, name: payload.name };
}

###
@mock
GET /users

< {
  response.body = db.query("SELECT id, name FROM users ORDER BY id ASC");
}
`
	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	opts := &Options{
		Command:  CommandMock,
		File:     filePath,
		MockPort: port,
		MockDB:   dbPath,
	}

	exitCodeCh := make(chan int, 1)
	go func() {
		exitCodeCh <- RunMockServer(opts)
	}()

	waitForServer(t, port, "/users")
	t.Cleanup(func() {
		if err := mockserver.StopMockServer(); err != nil {
			t.Fatalf("StopMockServer() cleanup error = %v", err)
		}
		select {
		case exitCode := <-exitCodeCh:
			if exitCode != 0 {
				t.Fatalf("RunMockServer() exit code = %d, want 0", exitCode)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for CLI mock server to exit")
		}
	})

	postJSON(t, port, "/users", `{"name":"CLI Alice"}`)

	users := getJSON[[]map[string]interface{}](t, port, "/users")
	if len(users) != 1 || users[0]["name"] != "CLI Alice" {
		t.Fatalf("users = %v, want one CLI Alice row", users)
	}
}

func waitForServer(t *testing.T, port int, path string) {
	t.Helper()
	client := &http.Client{Timeout: 200 * time.Millisecond}
	url := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)

	var lastErr error
	for range 80 {
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			return
		}
		lastErr = err
		time.Sleep(25 * time.Millisecond)
	}

	t.Fatalf("mock server did not become ready at %s: %v", url, lastErr)
}

func postJSON(t *testing.T, port int, path string, body string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), strings.NewReader(body))
	if err != nil {
		t.Fatalf("http.NewRequest() error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST %s returned status %d, want %d", path, resp.StatusCode, http.StatusCreated)
	}
}

func getJSON[T any](t *testing.T, port int, path string) T {
	t.Helper()
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, path))
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s returned status %d, want %d", path, resp.StatusCode, http.StatusOK)
	}

	var got T
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return got
}

func getFreePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}
