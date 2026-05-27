package mockserver

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"

	"github.com/dop251/goja"
	_ "modernc.org/sqlite"
)

// MockRequest represents a parsed HTTP request to be mocked
type MockRequest struct {
	Name       string
	Method     string
	URL        string
	Headers    map[string]string
	Body       string
	PreScript  string
	PostScript string
}

// Route holds a compiled route rule for endpoint matching
type Route struct {
	Method      string
	PathPattern string
	Regex       *regexp.Regexp
	ParamNames  []string
	Request     MockRequest
}

var (
	activeServer *http.Server
	serverMu     sync.Mutex
	LogListener  func(level, source, message string)
)

func broadcastLog(level, source, format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	fmt.Print(msg)
	if LogListener != nil {
		cleanMsg := strings.TrimRight(msg, "\r\n")
		LogListener(level, source, cleanMsg)
	}
}

// StopMockServer stops the running mock server instance if active
func StopMockServer() error {
	serverMu.Lock()
	defer serverMu.Unlock()
	if activeServer == nil {
		return nil
	}
	err := activeServer.Close()
	activeServer = nil
	broadcastLog("info", "mockserver", "[Mock Server] Stopped successfully.\n")
	return err
}

// StartMockServer parses the .http file, compiles routing rules, and boots the HTTP server
func StartMockServer(file string, port int, dbPath string, requests []MockRequest) error {
	broadcastLog("info", "mockserver", "[Mock Server] Parsing and compiling endpoints from %s...\n", file)
	var routes []Route
	for _, req := range requests {
		if req.Method == "MOCKINIT" {
			continue
		}
		route := compileRoute(req)
		routes = append(routes, route)
		broadcastLog("info", "mockserver", "  - %-7s %s\n", route.Method, route.PathPattern)
	}

	var db *sql.DB
	if dbPath != "" {
		broadcastLog("info", "mockserver", "[Mock Server] Opening SQLite database: %s\n", dbPath)
		d, err := sql.Open("sqlite", dbPath)
		if err != nil {
			return fmt.Errorf("failed to open SQLite database: %w", err)
		}
		db = d
		defer db.Close()

		// Verify connection
		if err := db.Ping(); err != nil {
			return fmt.Errorf("failed to connect to SQLite database: %w", err)
		}
		broadcastLog("info", "mockserver", "[Mock Server] SQLite database connection established.\n")
	}

	// Run mock initialization script if present
	for _, req := range requests {
		if req.Method == "MOCKINIT" {
			broadcastLog("info", "mockserver", "[Mock Server] Running database initialization script...\n")
			executeMockInitScript(req, db)
		}
	}


	handler := func(w http.ResponseWriter, r *http.Request) {
		reqPath := r.URL.Path
		reqMethod := strings.ToUpper(r.Method)

		var matchedRoute *Route
		var pathParams map[string]string

		for _, route := range routes {
			if route.Method == reqMethod {
				if matches := route.Regex.FindStringSubmatch(reqPath); matches != nil {
					matchedRoute = &route
					pathParams = make(map[string]string)
					for i, val := range matches[1:] {
						if i < len(route.ParamNames) {
							pathParams[route.ParamNames[i]] = val
						}
					}
					break
				}
			}
		}

		if matchedRoute == nil {
			broadcastLog("warn", "mockserver", "[Mock Server] 404 Not Found: %s %s\n", reqMethod, reqPath)
			w.WriteHeader(http.StatusNotFound)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"error": "Resource not matched by any mock endpoint in .http file"}`))
			return
		}

		broadcastLog("info", "mockserver", "[Mock Server] Matched: %s %s -> Name: %s\n", reqMethod, reqPath, matchedRoute.Request.Name)

		// Read Request Body
		var reqBodyBytes []byte
		if r.Body != nil {
			reqBodyBytes, _ = io.ReadAll(r.Body)
		}

		// Check if mock has custom scripts
		hasScript := matchedRoute.Request.PreScript != "" || matchedRoute.Request.PostScript != ""

		if hasScript {
			executeMockScript(w, r, matchedRoute, pathParams, reqBodyBytes, db)
		} else {
			executeFallbackMock(w, r, matchedRoute, pathParams, reqBodyBytes)
		}
	}

	addr := fmt.Sprintf(":%d", port)

	serverMu.Lock()
	if activeServer != nil {
		serverMu.Unlock()
		return fmt.Errorf("a mock server is already running")
	}
	activeServer = &http.Server{
		Addr:    addr,
		Handler: http.HandlerFunc(handler),
	}
	serverMu.Unlock()

	broadcastLog("info", "mockserver", "[Mock Server] Ready! Listening on http://localhost%s\n", addr)
	
	err := activeServer.ListenAndServe()

	serverMu.Lock()
	activeServer = nil
	serverMu.Unlock()

	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func getRoutePath(rawURL string) string {
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		u, err := url.Parse(rawURL)
		if err == nil {
			return u.Path
		}
	}
	parts := strings.Split(rawURL, "?")
	return parts[0]
}

func compileRoute(req MockRequest) Route {
	method := strings.ToUpper(req.Method)
	pathTemplate := getRoutePath(req.URL)

	// Escape path literal segments while preserving parameters {{param}} or :param
	paramRegex := regexp.MustCompile(`\{\{([a-zA-Z0-9_]+)\}\}|:([a-zA-Z0-9_]+)`)
	matches := paramRegex.FindAllStringSubmatchIndex(pathTemplate, -1)

	var regexBuf strings.Builder
	regexBuf.WriteString("^")

	var paramNames []string
	lastIdx := 0
	for _, m := range matches {
		literal := pathTemplate[lastIdx:m[0]]
		regexBuf.WriteString(regexp.QuoteMeta(literal))

		name := ""
		matchStr := pathTemplate[m[0]:m[1]]
		sub := paramRegex.FindStringSubmatch(matchStr)
		if sub[1] != "" {
			name = sub[1]
		} else {
			name = sub[2]
		}
		paramNames = append(paramNames, name)

		regexBuf.WriteString(`([^/]+)`)
		lastIdx = m[1]
	}
	regexBuf.WriteString(regexp.QuoteMeta(pathTemplate[lastIdx:]))
	regexBuf.WriteString("$")

	re, err := regexp.Compile(regexBuf.String())
	if err != nil {
		re = regexp.MustCompile("^" + regexp.QuoteMeta(pathTemplate) + "$")
	}

	return Route{
		Method:      method,
		PathPattern: pathTemplate,
		Regex:       re,
		ParamNames:  paramNames,
		Request:     req,
	}
}

func executeFallbackMock(w http.ResponseWriter, r *http.Request, route *Route, params map[string]string, reqBody []byte) {
	// Set Headers defined in request as starting headers
	for k, v := range route.Request.Headers {
		w.Header().Set(k, v)
	}

	// Dynamic placeholder interpolation in body
	body := route.Request.Body
	for k, v := range params {
		body = strings.ReplaceAll(body, "{{"+k+"}}", v)
		body = strings.ReplaceAll(body, ":"+k, v)
	}

	if w.Header().Get("Content-Type") == "" {
		if strings.HasPrefix(strings.TrimSpace(body), "{") || strings.HasPrefix(strings.TrimSpace(body), "[") {
			w.Header().Set("Content-Type", "application/json")
		} else {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		}
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}

func executeMockScript(w http.ResponseWriter, r *http.Request, route *Route, params map[string]string, reqBody []byte, db *sql.DB) {
	vm := goja.New()

	// Assemble query params map
	queryMap := make(map[string]interface{})
	for k, vals := range r.URL.Query() {
		if len(vals) == 1 {
			queryMap[k] = vals[0]
		} else {
			queryMap[k] = vals
		}
	}

	// Assemble request headers map
	headersMap := make(map[string]string)
	for k, vals := range r.Header {
		if len(vals) > 0 {
			headersMap[k] = vals[0]
		}
	}

	// Assemble path params map
	paramsMap := make(map[string]interface{})
	for k, v := range params {
		paramsMap[k] = v
	}

	// Inject JS `request` object
	reqObj := vm.NewObject()
	_ = reqObj.Set("method", route.Method)
	_ = reqObj.Set("path", r.URL.Path)
	_ = reqObj.Set("params", paramsMap)
	_ = reqObj.Set("query", queryMap)
	_ = reqObj.Set("headers", headersMap)
	_ = reqObj.Set("body", string(reqBody))
	_ = vm.Set("request", reqObj)

	// Inject JS `response` object
	respObj := vm.NewObject()
	_ = respObj.Set("status", 200)
	_ = respObj.Set("headers", vm.NewObject())
	_ = respObj.Set("body", "")
	_ = vm.Set("response", respObj)

	// Inject JS `console` helper
	consoleObj := vm.NewObject()
	logFn := func(call goja.FunctionCall) goja.Value {
		var args []string
		for _, arg := range call.Arguments {
			args = append(args, arg.String())
		}
		broadcastLog("log", "console", "[Mock Script Log] %s\n", strings.Join(args, " "))
		return goja.Undefined()
	}
	_ = consoleObj.Set("log", logFn)
	_ = consoleObj.Set("info", logFn)
	_ = consoleObj.Set("warn", logFn)
	_ = consoleObj.Set("error", logFn)
	_ = vm.Set("console", consoleObj)

	// Inject JS `db` object if SQLite is active
	if db != nil {
		_ = vm.Set("db", createDbObject(vm, db))
	}

	// Combine and clean PreScript and PostScript
	script := ""
	if route.Request.PreScript != "" {
		script += cleanScript(route.Request.PreScript) + "\n"
	}
	if route.Request.PostScript != "" {
		script += cleanScript(route.Request.PostScript) + "\n"
	}

	// Wrap execution in a nice enclosure that safely injects request and response
	wrappedScript := fmt.Sprintf(
		"(function(__g){\n"+
			"  (function(request, response){\n%s\n"+
			"  })(__g.request, __g.response);\n"+
			"})(Function('return this')());",
		script,
	)

	_, err := vm.RunString(wrappedScript)
	if err != nil {
		broadcastLog("error", "console", "[Mock Script Error] Runtime Exception: %v\n", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"error": "Mock script execution failed", "details": %q}`, err.Error())))
		return
	}

	// Extract status
	statusVal := respObj.Get("status")
	status := 200
	if statusVal != nil {
		status = int(statusVal.ToInteger())
	}

	// Extract headers
	headersVal := respObj.Get("headers")
	if headersVal != nil {
		if hObj, ok := headersVal.Export().(map[string]interface{}); ok {
			for k, v := range hObj {
				w.Header().Set(k, fmt.Sprintf("%v", v))
			}
		}
	}

	// Extract body
	bodyVal := respObj.Get("body")
	var bodyBytes []byte
	isJSON := false

	if bodyVal != nil {
		exported := bodyVal.Export()
		switch v := exported.(type) {
		case string:
			bodyBytes = []byte(v)
			// check if string is valid JSON
			trimmed := strings.TrimSpace(v)
			if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
				(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
				var js interface{}
				if json.Unmarshal(bodyBytes, &js) == nil {
					isJSON = true
				}
			}
		case nil:
			bodyBytes = []byte("")
		default:
			// serialize to JSON
			bytes, err := json.Marshal(v)
			if err == nil {
				bodyBytes = bytes
				isJSON = true
			} else {
				bodyBytes = []byte(fmt.Sprintf("%v", v))
			}
		}
	}

	if w.Header().Get("Content-Type") == "" {
		if isJSON {
			w.Header().Set("Content-Type", "application/json")
		} else {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		}
	}

	w.WriteHeader(status)
	_, _ = w.Write(bodyBytes)
}

func createDbObject(vm *goja.Runtime, db *sql.DB) *goja.Object {
	dbObj := vm.NewObject()

	// db.exec(query, ...args)
	_ = dbObj.Set("exec", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			panic(vm.ToValue("db.exec requires a query string"))
		}
		query := call.Arguments[0].String()
		var args []interface{}
		for _, arg := range call.Arguments[1:] {
			args = append(args, arg.Export())
		}

		res, err := db.Exec(query, args...)
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("db.exec error: %v", err)))
		}

		lastId, _ := res.LastInsertId()
		rowsAff, _ := res.RowsAffected()

		ret := vm.NewObject()
		_ = ret.Set("lastInsertId", lastId)
		_ = ret.Set("rowsAffected", rowsAff)
		return ret
	})

	// db.query(query, ...args)
	_ = dbObj.Set("query", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			panic(vm.ToValue("db.query requires a query string"))
		}
		query := call.Arguments[0].String()
		var args []interface{}
		for _, arg := range call.Arguments[1:] {
			args = append(args, arg.Export())
		}

		rows, err := db.Query(query, args...)
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("db.query error: %v", err)))
		}
		defer rows.Close()

		cols, err := rows.Columns()
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("db.query error: %v", err)))
		}

		var jsRows []goja.Value
		for rows.Next() {
			columns := make([]interface{}, len(cols))
			columnPointers := make([]interface{}, len(cols))
			for i := range columns {
				columnPointers[i] = &columns[i]
			}

			if err := rows.Scan(columnPointers...); err != nil {
				panic(vm.ToValue(fmt.Sprintf("db.query scan error: %v", err)))
			}

			rowObj := vm.NewObject()
			for i, colName := range cols {
				val := columns[i]
				if b, ok := val.([]byte); ok {
					_ = rowObj.Set(colName, vm.ToValue(string(b)))
				} else {
					_ = rowObj.Set(colName, vm.ToValue(val))
				}
			}
			jsRows = append(jsRows, rowObj)
		}

		return vm.ToValue(jsRows)
	})

	// db.get(query, ...args)
	_ = dbObj.Set("get", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			panic(vm.ToValue("db.get requires a query string"))
		}
		query := call.Arguments[0].String()
		var args []interface{}
		for _, arg := range call.Arguments[1:] {
			args = append(args, arg.Export())
		}

		rows, err := db.Query(query, args...)
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("db.get error: %v", err)))
		}
		defer rows.Close()

		cols, err := rows.Columns()
		if err != nil {
			panic(vm.ToValue(fmt.Sprintf("db.get error: %v", err)))
		}

		if rows.Next() {
			columns := make([]interface{}, len(cols))
			columnPointers := make([]interface{}, len(cols))
			for i := range columns {
				columnPointers[i] = &columns[i]
			}

			if err := rows.Scan(columnPointers...); err != nil {
				panic(vm.ToValue(fmt.Sprintf("db.get scan error: %v", err)))
			}

			rowObj := vm.NewObject()
			for i, colName := range cols {
				val := columns[i]
				if b, ok := val.([]byte); ok {
					_ = rowObj.Set(colName, vm.ToValue(string(b)))
				} else {
					_ = rowObj.Set(colName, vm.ToValue(val))
				}
			}
			return rowObj
		}

		return goja.Null()
	})

	return dbObj
}

// cleanScript strips script block markers (< { ... } or > { ... }).
func cleanScript(script string) string {
	lines := strings.Split(script, "\n")
	lines = trimScriptEdges(lines)
	if len(lines) == 0 {
		return ""
	}
	first := strings.TrimSpace(lines[0])
	if !strings.HasPrefix(first, "<") && !strings.HasPrefix(first, ">") {
		return script
	}
	
	lines = lines[1:]
	lines = trimScriptEdges(lines)
	if len(lines) == 0 {
		return ""
	}
	if strings.TrimSpace(lines[len(lines)-1]) == "}" {
		lines = lines[:len(lines)-1]
	}
	lines = trimScriptEdges(lines)
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}

func trimScriptEdges(lines []string) []string {
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func executeMockInitScript(req MockRequest, db *sql.DB) {
	vm := goja.New()

	// Inject JS `console` helper
	consoleObj := vm.NewObject()
	logFn := func(call goja.FunctionCall) goja.Value {
		var args []string
		for _, arg := range call.Arguments {
			args = append(args, arg.String())
		}
		broadcastLog("log", "console", "[Mock Init Log] %s\n", strings.Join(args, " "))
		return goja.Undefined()
	}
	_ = consoleObj.Set("log", logFn)
	_ = consoleObj.Set("info", logFn)
	_ = consoleObj.Set("warn", logFn)
	_ = consoleObj.Set("error", logFn)
	_ = vm.Set("console", consoleObj)

	// Inject JS `db` object if SQLite is active
	if db != nil {
		_ = vm.Set("db", createDbObject(vm, db))
	}

	// Combine and clean PreScript and PostScript
	script := ""
	if req.PreScript != "" {
		script += cleanScript(req.PreScript) + "\n"
	}
	if req.PostScript != "" {
		script += cleanScript(req.PostScript) + "\n"
	}

	_, err := vm.RunString(script)
	if err != nil {
		broadcastLog("error", "console", "[Mock Init Error] Runtime Exception: %v\n", err)
	} else {
		broadcastLog("info", "mockserver", "[Mock Server] Database initialization script completed successfully.\n")
	}
}

