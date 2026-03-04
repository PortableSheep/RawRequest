package app

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"
)

const defaultServiceBaseURL = "http://127.0.0.1:7345"

// EnsureServiceRunning starts the local service process when needed and blocks
// until it is healthy, or returns an error if startup fails.
func (a *App) EnsureServiceRunning(baseURL string) error {
	normalizedBaseURL, addr, err := normalizeServiceEndpoint(baseURL)
	if err != nil {
		return err
	}

	if isServiceHealthy(normalizedBaseURL, 750*time.Millisecond) {
		return nil
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}

	cmd := exec.Command(exePath, "service", "--addr", addr)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start service process: %w", err)
	}

	a.managedServiceMu.Lock()
	a.managedServicePID = cmd.Process.Pid
	a.managedServiceMu.Unlock()

	go func() {
		_ = cmd.Wait()
	}()

	if waitForServiceHealth(normalizedBaseURL, 8*time.Second) {
		return nil
	}

	_ = a.stopManagedService()
	return fmt.Errorf("service startup failed at %s", normalizedBaseURL)
}

func (a *App) stopManagedService() error {
	a.managedServiceMu.Lock()
	pid := a.managedServicePID
	a.managedServicePID = 0
	a.managedServiceMu.Unlock()

	if pid <= 0 {
		return nil
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return nil
	}
	_ = proc.Kill()
	return nil
}

func normalizeServiceEndpoint(raw string) (baseURL string, addr string, err error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		trimmed = defaultServiceBaseURL
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", "", fmt.Errorf("invalid service URL: %w", err)
	}
	if parsed.Scheme == "" {
		parsed.Scheme = "http"
	}
	if parsed.Host == "" {
		return "", "", fmt.Errorf("service URL missing host")
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "7345"
	}
	addr = net.JoinHostPort(host, port)
	baseURL = fmt.Sprintf("%s://%s", parsed.Scheme, addr)
	return baseURL, addr, nil
}

func isServiceHealthy(baseURL string, timeout time.Duration) bool {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(baseURL + "/v1/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func waitForServiceHealth(baseURL string, maxWait time.Duration) bool {
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		if isServiceHealthy(baseURL, 500*time.Millisecond) {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}
