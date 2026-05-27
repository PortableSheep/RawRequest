package app

import (
	"fmt"
	"rawrequest/internal/cli"
	"rawrequest/internal/mockserver"
	"sync"
	"time"
)

type MockServerStatus struct {
	Running bool   `json:"running"`
	Port    int    `json:"port"`
	DBPath  string `json:"dbPath"`
}

type MockServerLogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
}

var (
	guiMockRunning bool
	guiMockPort    int
	guiMockDBPath  string
	guiMockMu      sync.RWMutex
)

// StartMockServer starts the mock server from the given file content in a background goroutine.
func (a *App) StartMockServer(content string, filePath string, port int, dbPath string) error {
	guiMockMu.Lock()
	defer guiMockMu.Unlock()

	if guiMockRunning {
		return fmt.Errorf("a mock server is already running in the application")
	}

	parsed := cli.ParseHttpFile(content)
	if len(parsed.Requests) == 0 {
		return fmt.Errorf("no requests found in file")
	}

	var mockReqs []mockserver.MockRequest
	for _, req := range parsed.Requests {
		if req.IsMock {
			mockReqs = append(mockReqs, mockserver.MockRequest{
				Name:       req.Name,
				Method:     req.Method,
				URL:        req.URL,
				Headers:    req.Headers,
				Body:       req.Body,
				PreScript:  req.PreScript,
				PostScript: req.PostScript,
			})
		}
	}

	if len(mockReqs) == 0 {
		return fmt.Errorf("no mock endpoint definitions found in file (use the @mock annotation to mark a request block as a mock endpoint)")
	}

	// Register log listener to forward logs to Wails frontend
	mockserver.LogListener = func(level, source, message string) {
		a.emitEvent("mock-server-log", MockServerLogEntry{
			Timestamp: time.Now().Format("15:04:05"),
			Level:     level,
			Source:    source,
			Message:   message,
		})
	}

	guiMockRunning = true
	guiMockPort = port
	guiMockDBPath = dbPath

	go func() {
		err := mockserver.StartMockServer(filePath, port, dbPath, mockReqs)
		guiMockMu.Lock()
		guiMockRunning = false
		guiMockPort = 0
		guiMockDBPath = ""
		guiMockMu.Unlock()

		if err != nil {
			a.emitEvent("mock-server-log", MockServerLogEntry{
				Timestamp: time.Now().Format("15:04:05"),
				Level:     "error",
				Source:    "mockserver",
				Message:   fmt.Sprintf("[Mock Server Error] Server exited: %v", err),
			})
		}
	}()

	return nil
}

// StopMockServer stops the running mock server.
func (a *App) StopMockServer() error {
	err := mockserver.StopMockServer()
	
	guiMockMu.Lock()
	guiMockRunning = false
	guiMockPort = 0
	guiMockDBPath = ""
	guiMockMu.Unlock()

	return err
}

// GetMockServerStatus returns the status of the GUI mock server.
func (a *App) GetMockServerStatus() (MockServerStatus, error) {
	guiMockMu.RLock()
	defer guiMockMu.RUnlock()

	return MockServerStatus{
		Running: guiMockRunning,
		Port:    guiMockPort,
		DBPath:  guiMockDBPath,
	}, nil
}
