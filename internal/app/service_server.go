package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rawrequest/internal/cli"
	"rawrequest/internal/secretvaultlogic"
)

const defaultServiceAddr = "127.0.0.1:7345"

func StartServiceServer(opts *cli.Options) error {
	addr := defaultServiceAddr
	if opts != nil {
		if trimmed := strings.TrimSpace(opts.ServiceAddr); trimmed != "" {
			addr = trimmed
		}
	}

	app := NewApp()
	svc := &httpService{app: app}
	mux := http.NewServeMux()
	svc.registerRoutes(mux)

	server := &http.Server{
		Addr:              addr,
		Handler:           withServiceCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Background parent-death detection loop to ensure child service exits if the GUI app dies/exits
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if os.Getppid() == 1 {
				fmt.Println("Parent process died. Terminating RawRequest service...")
				os.Exit(0)
			}
		}
	}()

	fmt.Fprintf(os.Stderr, "RawRequest service listening on http://%s\n", addr)
	return server.ListenAndServe()
}

type httpService struct {
	app *App
}

// registerRoutes wires every transport route to its handler. GET-only
// endpoints (health, the SSE stream) register directly since each has its
// own method handling; every other route is POST-only and is registered via
// post(), which centralizes the "reject non-POST with 405" behavior instead
// of repeating a method check inside each handler.
func (s *httpService) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/health", s.handleHealth)
	mux.HandleFunc("/v1/events", s.handleEvents)

	post := func(pattern string, handler http.HandlerFunc) {
		mux.HandleFunc(pattern, requirePostMethod(handler))
	}

	post("/v1/send-request", s.handleSendRequest)
	post("/v1/send-request-with-id", s.handleSendRequestWithID)
	post("/v1/send-request-with-timeout", s.handleSendRequestWithTimeout)
	post("/v1/execute-requests", s.handleExecuteRequests)
	post("/v1/execute-requests-with-id", s.handleExecuteRequestsWithID)
	post("/v1/cancel-request", s.handleCancelRequest)
	post("/v1/start-load-test", s.handleStartLoadTest)
	post("/v1/set-variable", s.handleSetVariable)
	post("/v1/get-variable", s.handleGetVariable)
	post("/v1/get-script-logs", s.handleGetScriptLogs)
	post("/v1/clear-script-logs", s.handleClearScriptLogs)
	post("/v1/record-script-log", s.handleRecordScriptLog)
	post("/v1/load-file-history-from-dir", s.handleLoadFileHistoryFromDir)
	post("/v1/load-file-history-from-run-location", s.handleLoadFileHistoryFromRunLocation)
	post("/v1/save-response-file", s.handleSaveResponseFile)
	post("/v1/save-response-file-to-run-location", s.handleSaveResponseFileToRunLocation)

	// Secret management
	post("/v1/list-secrets", s.handleListSecrets)
	post("/v1/save-secret", s.handleSaveSecret)
	post("/v1/delete-secret", s.handleDeleteSecret)
	post("/v1/get-secret-value", s.handleGetSecretValue)
	post("/v1/get-vault-info", s.handleGetVaultInfo)
	post("/v1/has-master-password", s.handleHasMasterPassword)
	post("/v1/set-master-password", s.handleSetMasterPassword)
	post("/v1/verify-master-password", s.handleVerifyMasterPassword)
	post("/v1/reset-vault", s.handleResetVault)
	post("/v1/export-secrets", s.handleExportSecrets)
	post("/v1/get-enterprise-config", s.handleGetEnterpriseConfig)
	post("/v1/save-enterprise-config", s.handleSaveEnterpriseConfig)
	post("/v1/test-enterprise-secret", s.handleTestEnterpriseSecret)
	post("/v1/open-enterprise-config", s.handleOpenEnterpriseConfig)

	// Environment management
	post("/v1/get-environments", s.handleGetEnvironments)
	post("/v1/set-environment", s.handleSetEnvironment)
	post("/v1/get-env-variables", s.handleGetEnvVariables)
	post("/v1/set-env-variable", s.handleSetEnvVariable)
	post("/v1/get-variables", s.handleGetVariables)
	post("/v1/add-env-variable", s.handleAddEnvVariable)
	post("/v1/rename-environment", s.handleRenameEnvironment)

	// Import
	post("/v1/import-collection", s.handleImportCollection)

	// Binary response save
	post("/v1/save-binary-response", s.handleSaveBinaryResponse)
}

// requirePostMethod wraps a handler so that any non-POST request is rejected
// with 405 before the handler body runs, centralizing the method check that
// used to be duplicated at the top of every POST-only handler.
func requirePostMethod(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next(w, r)
	}
}

func withServiceCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *httpService) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeServiceText(w, "ok")
}

func (s *httpService) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch, unsubscribe := s.app.subscribeEvents(256)
	defer unsubscribe()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			data, err := json.Marshal(evt)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// decodeJSONBody decodes the request body as JSON into a new T, rejecting
// unknown fields (see decodeServicePayload). On failure it writes a 400 and
// returns ok=false so callers can simply `return` without duplicating the
// error response boilerplate that used to appear in every handler.
func decodeJSONBody[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var payload T
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return payload, false
	}
	return payload, true
}

// writeJSONOrError writes result as JSON on success, or maps a non-nil err
// to errStatus and writes it as the response body. This is the shared
// "call -> map error -> encode" tail for handlers whose app call returns
// (result, error).
func writeJSONOrError[T any](w http.ResponseWriter, result T, err error, errStatus int) {
	if err != nil {
		writeServiceError(w, errStatus, err)
		return
	}
	writeServiceJSON(w, result)
}

// writeTextOrError is writeJSONOrError's plain-text counterpart, used by
// handlers that return a bare string result (e.g. secret values).
func writeTextOrError(w http.ResponseWriter, result string, err error, errStatus int) {
	if err != nil {
		writeServiceError(w, errStatus, err)
		return
	}
	writeServiceText(w, result)
}

// writeNoContentOrError writes 204 on success (err == nil), or maps a
// non-nil err to errStatus. Used by handlers whose app call only returns an
// error (no result payload).
func writeNoContentOrError(w http.ResponseWriter, err error, errStatus int) {
	if err != nil {
		writeServiceError(w, errStatus, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeServicePayload(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("invalid json payload: %w", err)
	}
	return nil
}

func writeServiceText(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(body))
}

func writeServiceJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(payload)
}

func writeServiceError(w http.ResponseWriter, status int, err error) {
	http.Error(w, err.Error(), status)
}

func decodeBase64Body(encoded string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(encoded)
}

type sendRequestPayload struct {
	Method      string `json:"method"`
	URL         string `json:"url"`
	HeadersJSON string `json:"headersJson"`
	Body        string `json:"body"`
}

func (s *httpService) handleSendRequest(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[sendRequestPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.sendRequest(payload.Method, payload.URL, payload.HeadersJSON, payload.Body))
}

type sendRequestWithIDPayload struct {
	ID          string `json:"id"`
	Method      string `json:"method"`
	URL         string `json:"url"`
	HeadersJSON string `json:"headersJson"`
	Body        string `json:"body"`
}

func (s *httpService) handleSendRequestWithID(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[sendRequestWithIDPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.sendRequestWithID(payload.ID, payload.Method, payload.URL, payload.HeadersJSON, payload.Body))
}

type sendRequestWithTimeoutPayload struct {
	ID          string `json:"id"`
	Method      string `json:"method"`
	URL         string `json:"url"`
	HeadersJSON string `json:"headersJson"`
	Body        string `json:"body"`
	TimeoutMs   int    `json:"timeoutMs"`
}

func (s *httpService) handleSendRequestWithTimeout(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[sendRequestWithTimeoutPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.sendRequestWithTimeout(payload.ID, payload.Method, payload.URL, payload.HeadersJSON, payload.Body, payload.TimeoutMs))
}

type executeRequestsPayload struct {
	Requests []map[string]interface{} `json:"requests"`
}

func (s *httpService) handleExecuteRequests(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[executeRequestsPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.executeRequests(payload.Requests))
}

type executeRequestsWithIDPayload struct {
	ID       string                   `json:"id"`
	Requests []map[string]interface{} `json:"requests"`
}

func (s *httpService) handleExecuteRequestsWithID(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[executeRequestsWithIDPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.executeRequestsWithID(payload.ID, payload.Requests))
}

type cancelRequestPayload struct {
	RequestID string `json:"requestId"`
}

func (s *httpService) handleCancelRequest(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[cancelRequestPayload](w, r)
	if !ok {
		return
	}
	s.app.cancelRequest(payload.RequestID)
	w.WriteHeader(http.StatusNoContent)
}

type startLoadTestPayload struct {
	RequestID      string `json:"requestId"`
	Method         string `json:"method"`
	URL            string `json:"url"`
	HeadersJSON    string `json:"headersJson"`
	Body           string `json:"body"`
	LoadConfigJSON string `json:"loadConfigJson"`
}

func (s *httpService) handleStartLoadTest(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[startLoadTestPayload](w, r)
	if !ok {
		return
	}
	err := s.app.startLoadTest(payload.RequestID, payload.Method, payload.URL, payload.HeadersJSON, payload.Body, payload.LoadConfigJSON)
	writeNoContentOrError(w, err, http.StatusBadRequest)
}

type setVariablePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleSetVariable(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[setVariablePayload](w, r)
	if !ok {
		return
	}
	s.app.SetVariable(payload.Key, payload.Value)
	w.WriteHeader(http.StatusNoContent)
}

type getVariablePayload struct {
	Key string `json:"key"`
}

func (s *httpService) handleGetVariable(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[getVariablePayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.GetVariable(payload.Key))
}

func (s *httpService) handleGetScriptLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	writeServiceJSON(w, s.app.GetScriptLogs())
}

func (s *httpService) handleClearScriptLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	s.app.ClearScriptLogs()
	w.WriteHeader(http.StatusNoContent)
}

type recordScriptLogPayload struct {
	Level   string `json:"level"`
	Source  string `json:"source"`
	Message string `json:"message"`
}

func (s *httpService) handleRecordScriptLog(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[recordScriptLogPayload](w, r)
	if !ok {
		return
	}
	s.app.RecordScriptLog(payload.Level, payload.Source, payload.Message)
	w.WriteHeader(http.StatusNoContent)
}

type loadFileHistoryFromDirPayload struct {
	FileID string `json:"fileId"`
	Dir    string `json:"dir"`
}

func (s *httpService) handleLoadFileHistoryFromDir(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[loadFileHistoryFromDirPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.LoadFileHistoryFromDir(payload.FileID, payload.Dir))
}

type loadFileHistoryFromRunLocationPayload struct {
	FileID string `json:"fileId"`
}

func (s *httpService) handleLoadFileHistoryFromRunLocation(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[loadFileHistoryFromRunLocationPayload](w, r)
	if !ok {
		return
	}
	writeServiceText(w, s.app.LoadFileHistoryFromRunLocation(payload.FileID))
}

type saveResponseFilePayload struct {
	RequestFilePath string `json:"requestFilePath"`
	ResponseJSON    string `json:"responseJson"`
}

func (s *httpService) handleSaveResponseFile(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[saveResponseFilePayload](w, r)
	if !ok {
		return
	}
	path, err := s.app.SaveResponseFile(payload.RequestFilePath, payload.ResponseJSON)
	writeTextOrError(w, path, err, http.StatusInternalServerError)
}

type saveResponseFileToRunLocationPayload struct {
	FileID       string `json:"fileId"`
	ResponseJSON string `json:"responseJson"`
}

func (s *httpService) handleSaveResponseFileToRunLocation(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[saveResponseFileToRunLocationPayload](w, r)
	if !ok {
		return
	}
	path, err := s.app.SaveResponseFileToRunLocation(payload.FileID, payload.ResponseJSON)
	writeTextOrError(w, path, err, http.StatusInternalServerError)
}

// --- Secret management handlers ---

func (s *httpService) handleListSecrets(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	result, err := s.app.ListSecrets()
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

type saveSecretPayload struct {
	Env   string `json:"env"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleSaveSecret(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[saveSecretPayload](w, r)
	if !ok {
		return
	}
	result, err := s.app.SaveSecret(payload.Env, payload.Key, payload.Value)
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

type deleteSecretPayload struct {
	Env string `json:"env"`
	Key string `json:"key"`
}

func (s *httpService) handleDeleteSecret(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[deleteSecretPayload](w, r)
	if !ok {
		return
	}
	result, err := s.app.DeleteSecret(payload.Env, payload.Key)
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

type getSecretValuePayload struct {
	Env string `json:"env"`
	Key string `json:"key"`
}

func (s *httpService) handleGetSecretValue(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[getSecretValuePayload](w, r)
	if !ok {
		return
	}
	result, err := s.app.GetSecretValue(payload.Env, payload.Key)
	writeTextOrError(w, result, err, http.StatusInternalServerError)
}

func (s *httpService) handleGetVaultInfo(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	result, err := s.app.GetVaultInfo()
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

func (s *httpService) handleHasMasterPassword(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	result, err := s.app.HasMasterPassword()
	writeJSONOrError(w, map[string]bool{"result": result}, err, http.StatusInternalServerError)
}

type setMasterPasswordPayload struct {
	Password string `json:"password"`
}

func (s *httpService) handleSetMasterPassword(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[setMasterPasswordPayload](w, r)
	if !ok {
		return
	}
	err := s.app.SetMasterPassword(payload.Password)
	writeNoContentOrError(w, err, http.StatusInternalServerError)
}

type verifyMasterPasswordPayload struct {
	Password string `json:"password"`
}

func (s *httpService) handleVerifyMasterPassword(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[verifyMasterPasswordPayload](w, r)
	if !ok {
		return
	}
	result, err := s.app.VerifyMasterPassword(payload.Password)
	writeJSONOrError(w, map[string]bool{"result": result}, err, http.StatusInternalServerError)
}

func (s *httpService) handleResetVault(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	result, err := s.app.ResetVault()
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

func (s *httpService) handleExportSecrets(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	result, err := s.app.ExportSecrets()
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

func (s *httpService) handleGetEnterpriseConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	result, err := s.app.GetEnterpriseConfig()
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

func (s *httpService) handleSaveEnterpriseConfig(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[secretvaultlogic.EnterpriseConfig](w, r)
	if !ok {
		return
	}
	err := s.app.SaveEnterpriseConfig(&payload)
	writeNoContentOrError(w, err, http.StatusInternalServerError)
}

type testEnterpriseSecretPayload struct {
	Key string `json:"key"`
}

func (s *httpService) handleTestEnterpriseSecret(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[testEnterpriseSecretPayload](w, r)
	if !ok {
		return
	}
	result, err := s.app.TestEnterpriseSecret(payload.Key)
	writeJSONOrError(w, map[string]string{"result": result}, err, http.StatusInternalServerError)
}

func (s *httpService) handleOpenEnterpriseConfig(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	err := s.app.OpenEnterpriseConfig()
	writeNoContentOrError(w, err, http.StatusInternalServerError)
}

// --- Environment management handlers ---

func (s *httpService) handleGetEnvironments(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	writeServiceJSON(w, s.app.GetEnvironments())
}

type setEnvironmentPayload struct {
	Env string `json:"env"`
}

func (s *httpService) handleSetEnvironment(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[setEnvironmentPayload](w, r)
	if !ok {
		return
	}
	s.app.SetEnvironment(payload.Env)
	w.WriteHeader(http.StatusNoContent)
}

type getEnvVariablesPayload struct {
	Env string `json:"env"`
}

func (s *httpService) handleGetEnvVariables(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[getEnvVariablesPayload](w, r)
	if !ok {
		return
	}
	writeServiceJSON(w, s.app.GetEnvVariables(payload.Env))
}

type setEnvVariablePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleSetEnvVariable(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[setEnvVariablePayload](w, r)
	if !ok {
		return
	}
	s.app.SetEnvVariable(payload.Key, payload.Value)
	w.WriteHeader(http.StatusNoContent)
}

func (s *httpService) handleGetVariables(w http.ResponseWriter, r *http.Request) {
	if _, ok := decodeJSONBody[struct{}](w, r); !ok {
		return
	}
	writeServiceJSON(w, s.app.GetVariables())
}

type addEnvVariablePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleAddEnvVariable(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[addEnvVariablePayload](w, r)
	if !ok {
		return
	}
	s.app.AddEnvVariable(payload.Key, payload.Value)
	w.WriteHeader(http.StatusNoContent)
}

type renameEnvironmentPayload struct {
	OldName string `json:"oldName"`
	NewName string `json:"newName"`
}

func (s *httpService) handleRenameEnvironment(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[renameEnvironmentPayload](w, r)
	if !ok {
		return
	}
	s.app.RenameEnvironment(payload.OldName, payload.NewName)
	w.WriteHeader(http.StatusNoContent)
}

// --- Import handler ---

type importCollectionPayload struct {
	Path string `json:"path"`
}

func (s *httpService) handleImportCollection(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[importCollectionPayload](w, r)
	if !ok {
		return
	}
	result, err := s.app.ImportFromPath(payload.Path)
	writeJSONOrError(w, result, err, http.StatusInternalServerError)
}

type saveBinaryResponsePayload struct {
	RequestID   string `json:"requestId"`
	DestPath    string `json:"destPath"`
	Base64Body  string `json:"base64Body,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	RequestURL  string `json:"requestUrl,omitempty"`
}

// errBadRequestBinary wraps an error that should map to 400 instead of the
// handler's default 500, used to distinguish client input errors (missing
// source, invalid base64) from server-side write/lookup failures.
type errBadRequestBinary struct{ err error }

func (e errBadRequestBinary) Error() string { return e.err.Error() }
func (e errBadRequestBinary) Unwrap() error { return e.err }

// writeBinaryResponsePayload resolves the requested binary data (either from
// a prior request's stored response, or from an inline base64 body) and
// writes it to destPath. It returns errBadRequestBinary for client-input
// errors so the caller can map them to 400 instead of 500.
func (s *httpService) writeBinaryResponsePayload(payload saveBinaryResponsePayload, destPath string) error {
	switch {
	case payload.RequestID != "":
		return s.app.SaveBinaryResponseToPath(payload.RequestID, destPath)
	case payload.Base64Body != "":
		data, err := decodeBase64Body(payload.Base64Body)
		if err != nil {
			return errBadRequestBinary{err}
		}
		return os.WriteFile(destPath, data, 0644)
	default:
		return errBadRequestBinary{fmt.Errorf("requestId or base64Body required")}
	}
}

func (s *httpService) handleSaveBinaryResponse(w http.ResponseWriter, r *http.Request) {
	payload, ok := decodeJSONBody[saveBinaryResponsePayload](w, r)
	if !ok {
		return
	}

	destPath := payload.DestPath
	if destPath == "" {
		name := suggestFilename(payload.RequestURL, payload.ContentType)
		destPath = filepath.Join(os.TempDir(), name)
	}

	if err := s.writeBinaryResponsePayload(payload, destPath); err != nil {
		status := http.StatusInternalServerError
		var badReq errBadRequestBinary
		if errors.As(err, &badReq) {
			status = http.StatusBadRequest
		}
		writeServiceError(w, status, err)
		return
	}
	writeServiceJSON(w, map[string]string{"path": destPath})
}
