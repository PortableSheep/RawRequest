package mockserver

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCompileRoute(t *testing.T) {
	req := MockRequest{
		Method: "GET",
		URL:    "http://localhost/users/{{userId}}/posts/:postId",
	}

	route := compileRoute(req)

	if route.Method != "GET" {
		t.Errorf("Expected method GET, got %s", route.Method)
	}

	if len(route.ParamNames) != 2 {
		t.Errorf("Expected 2 param names, got %d: %v", len(route.ParamNames), route.ParamNames)
	}

	if route.ParamNames[0] != "userId" || route.ParamNames[1] != "postId" {
		t.Errorf("Unexpected param names: %v", route.ParamNames)
	}

	path := "/users/123/posts/abc"
	matches := route.Regex.FindStringSubmatch(path)
	if matches == nil {
		t.Fatalf("Path '%s' did not match route regex", path)
	}

	params := make(map[string]string)
	for i, val := range matches[1:] {
		params[route.ParamNames[i]] = val
	}

	if params["userId"] != "123" {
		t.Errorf("Expected userId '123', got '%s'", params["userId"])
	}
	if params["postId"] != "abc" {
		t.Errorf("Expected postId 'abc', got '%s'", params["postId"])
	}
}

func TestExecuteFallbackMock(t *testing.T) {
	req := MockRequest{
		Method: "GET",
		URL:    "/users/{{userId}}",
		Body:   `{"id": "{{userId}}", "status": "active"}`,
		Headers: map[string]string{
			"X-Custom-Header": "custom-value",
		},
	}

	route := compileRoute(req)
	params := map[string]string{"userId": "999"}

	rec := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/users/999", nil)

	executeFallbackMock(rec, r, &route, params, nil)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}

	if rec.Header().Get("X-Custom-Header") != "custom-value" {
		t.Errorf("Expected header X-Custom-Header 'custom-value', got '%s'", rec.Header().Get("X-Custom-Header"))
	}

	expectedBody := `{"id": "999", "status": "active"}`
	actualBody := strings.TrimSpace(rec.Body.String())
	if actualBody != expectedBody {
		t.Errorf("Expected body '%s', got '%s'", expectedBody, actualBody)
	}
}

func TestExecuteMockScriptWithDB(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("Failed to open in-memory SQLite: %v", err)
	}
	defer db.Close()

	req := MockRequest{
		Method: "POST",
		URL:    "/todos",
		PreScript: `
			db.exec("CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT UNIQUE, done BOOLEAN)");
			db.exec("INSERT OR IGNORE INTO todos (title, done) VALUES (?, ?)", "Buy milk", false);
			db.exec("INSERT OR IGNORE INTO todos (title, done) VALUES (?, ?)", "Clean room", true);
			
			const id = parseInt(request.params.id);
			if (id) {
				const item = db.get("SELECT * FROM todos WHERE id = ?", id);
				if (item) {
					response.body = item;
				} else {
					response.status = 404;
					response.body = { error: "Todo not found" };
				}
			} else {
				const items = db.query("SELECT * FROM todos ORDER BY id ASC");
				response.body = items;
			}
		`,
	}

	route := compileRoute(req)

	// Test 1: GET All todos
	{
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/todos", nil)
		executeMockScript(rec, r, &route, map[string]string{}, nil, db)

		if rec.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rec.Code)
		}

		var items []map[string]interface{}
		if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		if len(items) != 2 {
			t.Errorf("Expected 2 items, got %d", len(items))
		}

		if items[0]["title"] != "Buy milk" || items[0]["done"].(float64) != 0 {
			t.Errorf("Unexpected first item: %v", items[0])
		}
	}

	// Test 2: GET single todo (by path param)
	{
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/todos/2", nil)
		executeMockScript(rec, r, &route, map[string]string{"id": "2"}, nil, db)

		if rec.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", rec.Code)
		}

		var item map[string]interface{}
		if err := json.Unmarshal(rec.Body.Bytes(), &item); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		if item["title"] != "Clean room" || item["done"].(float64) != 1 {
			t.Errorf("Unexpected item: %v", item)
		}
	}
}

func TestStartMockServerWithSQLiteFilePersistsStateAcrossRestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "mock.db")

	requests := []MockRequest{
		{
			Method: "MOCKINIT",
			URL:    "@mockinit",
			PreScript: `
				db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)");
			`,
		},
		{
			Method: "POST",
			URL:    "/users",
			PreScript: `
				const payload = JSON.parse(request.body);
				const result = db.exec("INSERT INTO users (name) VALUES (?)", payload.name);
				response.status = 201;
				response.body = { id: result.lastInsertId, name: payload.name };
			`,
		},
		{
			Method: "GET",
			URL:    "/users",
			PreScript: `
				response.body = db.query("SELECT id, name FROM users ORDER BY id ASC");
			`,
		},
	}

	port := getFreePort(t)
	runMockServerAsync(t, "test.http", port, dbPath, requests)

	postJSON(t, port, "/users", `{"name":"Alice"}`)
	users := getJSON[[]map[string]interface{}](t, port, "/users")
	if len(users) != 1 || users[0]["name"] != "Alice" {
		t.Fatalf("users after first run = %v, want one Alice row", users)
	}

	if err := StopMockServer(); err != nil {
		t.Fatalf("StopMockServer() error = %v", err)
	}

	port = getFreePort(t)
	runMockServerAsync(t, "test.http", port, dbPath, requests)

	users = getJSON[[]map[string]interface{}](t, port, "/users")
	if len(users) != 1 || users[0]["name"] != "Alice" {
		t.Fatalf("users after restart = %v, want persisted Alice row", users)
	}

	info, err := os.Stat(dbPath)
	if err != nil {
		t.Fatalf("expected SQLite file to exist: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("expected SQLite file to be non-empty")
	}
}

func runMockServerAsync(t *testing.T, file string, port int, dbPath string, requests []MockRequest) {
	t.Helper()
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- StartMockServer(file, port, dbPath, requests)
	}()

	waitForServer(t, port, "/users")

	t.Cleanup(func() {
		if err := StopMockServer(); err != nil {
			t.Fatalf("StopMockServer() cleanup error = %v", err)
		}
		select {
		case err := <-serverErr:
			if err != nil {
				t.Fatalf("StartMockServer() exited with error: %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for mock server goroutine to exit")
		}
	})
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

func postJSON(t *testing.T, port int, path string, body string) map[string]interface{} {
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

	var got map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	return got
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
