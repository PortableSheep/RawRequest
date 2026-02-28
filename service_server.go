package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"rawrequest/internal/cli"
)

const defaultServiceAddr = "127.0.0.1:7345"

func startServiceServer(opts *cli.Options) error {
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
	fmt.Fprintf(os.Stderr, "RawRequest service listening on http://%s\n", addr)
	return server.ListenAndServe()
}

type httpService struct {
	app *App
}

func (s *httpService) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/health", s.handleHealth)
	mux.HandleFunc("/v1/events", s.handleEvents)
	mux.HandleFunc("/v1/send-request", s.handleSendRequest)
	mux.HandleFunc("/v1/send-request-with-id", s.handleSendRequestWithID)
	mux.HandleFunc("/v1/send-request-with-timeout", s.handleSendRequestWithTimeout)
	mux.HandleFunc("/v1/execute-requests", s.handleExecuteRequests)
	mux.HandleFunc("/v1/execute-requests-with-id", s.handleExecuteRequestsWithID)
	mux.HandleFunc("/v1/cancel-request", s.handleCancelRequest)
	mux.HandleFunc("/v1/start-load-test", s.handleStartLoadTest)
	mux.HandleFunc("/v1/set-variable", s.handleSetVariable)
	mux.HandleFunc("/v1/get-variable", s.handleGetVariable)
	mux.HandleFunc("/v1/get-script-logs", s.handleGetScriptLogs)
	mux.HandleFunc("/v1/clear-script-logs", s.handleClearScriptLogs)
	mux.HandleFunc("/v1/record-script-log", s.handleRecordScriptLog)
	mux.HandleFunc("/v1/load-file-history-from-dir", s.handleLoadFileHistoryFromDir)
	mux.HandleFunc("/v1/load-file-history-from-run-location", s.handleLoadFileHistoryFromRunLocation)
	mux.HandleFunc("/v1/save-response-file", s.handleSaveResponseFile)
	mux.HandleFunc("/v1/save-response-file-to-run-location", s.handleSaveResponseFileToRunLocation)

	// Secret management
	mux.HandleFunc("/v1/list-secrets", s.handleListSecrets)
	mux.HandleFunc("/v1/save-secret", s.handleSaveSecret)
	mux.HandleFunc("/v1/delete-secret", s.handleDeleteSecret)
	mux.HandleFunc("/v1/get-secret-value", s.handleGetSecretValue)
	mux.HandleFunc("/v1/get-vault-info", s.handleGetVaultInfo)
	mux.HandleFunc("/v1/has-master-password", s.handleHasMasterPassword)
	mux.HandleFunc("/v1/set-master-password", s.handleSetMasterPassword)
	mux.HandleFunc("/v1/verify-master-password", s.handleVerifyMasterPassword)
	mux.HandleFunc("/v1/reset-vault", s.handleResetVault)
	mux.HandleFunc("/v1/export-secrets", s.handleExportSecrets)

	// Environment management
	mux.HandleFunc("/v1/get-environments", s.handleGetEnvironments)
	mux.HandleFunc("/v1/set-environment", s.handleSetEnvironment)
	mux.HandleFunc("/v1/get-env-variables", s.handleGetEnvVariables)
	mux.HandleFunc("/v1/set-env-variable", s.handleSetEnvVariable)
	mux.HandleFunc("/v1/get-variables", s.handleGetVariables)
	mux.HandleFunc("/v1/add-env-variable", s.handleAddEnvVariable)
	mux.HandleFunc("/v1/rename-environment", s.handleRenameEnvironment)

	// Import
	mux.HandleFunc("/v1/import-collection", s.handleImportCollection)
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

func (s *httpService) requirePost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
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

type sendRequestPayload struct {
	Method      string `json:"method"`
	URL         string `json:"url"`
	HeadersJSON string `json:"headersJson"`
	Body        string `json:"body"`
}

func (s *httpService) handleSendRequest(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload sendRequestPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload sendRequestWithIDPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload sendRequestWithTimeoutPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceText(w, s.app.sendRequestWithTimeout(payload.ID, payload.Method, payload.URL, payload.HeadersJSON, payload.Body, payload.TimeoutMs))
}

type executeRequestsPayload struct {
	Requests []map[string]interface{} `json:"requests"`
}

func (s *httpService) handleExecuteRequests(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload executeRequestsPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceText(w, s.app.executeRequests(payload.Requests))
}

type executeRequestsWithIDPayload struct {
	ID       string                   `json:"id"`
	Requests []map[string]interface{} `json:"requests"`
}

func (s *httpService) handleExecuteRequestsWithID(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload executeRequestsWithIDPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceText(w, s.app.executeRequestsWithID(payload.ID, payload.Requests))
}

type cancelRequestPayload struct {
	RequestID string `json:"requestId"`
}

func (s *httpService) handleCancelRequest(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload cancelRequestPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload startLoadTestPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.app.startLoadTest(payload.RequestID, payload.Method, payload.URL, payload.HeadersJSON, payload.Body, payload.LoadConfigJSON); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setVariablePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleSetVariable(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload setVariablePayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	s.app.SetVariable(payload.Key, payload.Value)
	w.WriteHeader(http.StatusNoContent)
}

type getVariablePayload struct {
	Key string `json:"key"`
}

func (s *httpService) handleGetVariable(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload getVariablePayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceText(w, s.app.GetVariable(payload.Key))
}

func (s *httpService) handleGetScriptLogs(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceJSON(w, s.app.GetScriptLogs())
}

func (s *httpService) handleClearScriptLogs(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload recordScriptLogPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload loadFileHistoryFromDirPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceText(w, s.app.LoadFileHistoryFromDir(payload.FileID, payload.Dir))
}

type loadFileHistoryFromRunLocationPayload struct {
	FileID string `json:"fileId"`
}

func (s *httpService) handleLoadFileHistoryFromRunLocation(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload loadFileHistoryFromRunLocationPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceText(w, s.app.LoadFileHistoryFromRunLocation(payload.FileID))
}

type saveResponseFilePayload struct {
	RequestFilePath string `json:"requestFilePath"`
	ResponseJSON    string `json:"responseJson"`
}

func (s *httpService) handleSaveResponseFile(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload saveResponseFilePayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	path, err := s.app.SaveResponseFile(payload.RequestFilePath, payload.ResponseJSON)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceText(w, path)
}

type saveResponseFileToRunLocationPayload struct {
	FileID       string `json:"fileId"`
	ResponseJSON string `json:"responseJson"`
}

func (s *httpService) handleSaveResponseFileToRunLocation(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload saveResponseFileToRunLocationPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	path, err := s.app.SaveResponseFileToRunLocation(payload.FileID, payload.ResponseJSON)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceText(w, path)
}

// --- Secret management handlers ---

func (s *httpService) handleListSecrets(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.ListSecrets()
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}

type saveSecretPayload struct {
	Env   string `json:"env"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleSaveSecret(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload saveSecretPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.SaveSecret(payload.Env, payload.Key, payload.Value)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}

type deleteSecretPayload struct {
	Env string `json:"env"`
	Key string `json:"key"`
}

func (s *httpService) handleDeleteSecret(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload deleteSecretPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.DeleteSecret(payload.Env, payload.Key)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}

type getSecretValuePayload struct {
	Env string `json:"env"`
	Key string `json:"key"`
}

func (s *httpService) handleGetSecretValue(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload getSecretValuePayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.GetSecretValue(payload.Env, payload.Key)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceText(w, result)
}

func (s *httpService) handleGetVaultInfo(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.GetVaultInfo()
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}

func (s *httpService) handleHasMasterPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.HasMasterPassword()
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, map[string]bool{"result": result})
}

type setMasterPasswordPayload struct {
	Password string `json:"password"`
}

func (s *httpService) handleSetMasterPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload setMasterPasswordPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.app.SetMasterPassword(payload.Password); err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type verifyMasterPasswordPayload struct {
	Password string `json:"password"`
}

func (s *httpService) handleVerifyMasterPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload verifyMasterPasswordPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.VerifyMasterPassword(payload.Password)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, map[string]bool{"result": result})
}

func (s *httpService) handleResetVault(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.ResetVault()
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}

func (s *httpService) handleExportSecrets(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.ExportSecrets()
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}

// --- Environment management handlers ---

func (s *httpService) handleGetEnvironments(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceJSON(w, s.app.GetEnvironments())
}

type setEnvironmentPayload struct {
	Env string `json:"env"`
}

func (s *httpService) handleSetEnvironment(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload setEnvironmentPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	s.app.SetEnvironment(payload.Env)
	w.WriteHeader(http.StatusNoContent)
}

type getEnvVariablesPayload struct {
	Env string `json:"env"`
}

func (s *httpService) handleGetEnvVariables(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload getEnvVariablesPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceJSON(w, s.app.GetEnvVariables(payload.Env))
}

type setEnvVariablePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleSetEnvVariable(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload setEnvVariablePayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	s.app.SetEnvVariable(payload.Key, payload.Value)
	w.WriteHeader(http.StatusNoContent)
}

func (s *httpService) handleGetVariables(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload struct{}
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	writeServiceJSON(w, s.app.GetVariables())
}

type addEnvVariablePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (s *httpService) handleAddEnvVariable(w http.ResponseWriter, r *http.Request) {
	if !s.requirePost(w, r) {
		return
	}
	var payload addEnvVariablePayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload renameEnvironmentPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
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
	if !s.requirePost(w, r) {
		return
	}
	var payload importCollectionPayload
	if err := decodeServicePayload(r, &payload); err != nil {
		writeServiceError(w, http.StatusBadRequest, err)
		return
	}
	result, err := s.app.ImportFromPath(payload.Path)
	if err != nil {
		writeServiceError(w, http.StatusInternalServerError, err)
		return
	}
	writeServiceJSON(w, result)
}
