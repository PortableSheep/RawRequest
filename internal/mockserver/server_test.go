package mockserver

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
