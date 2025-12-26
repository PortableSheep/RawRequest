package loadtestbridge

import (
	"encoding/json"
	"errors"
	"strings"

	lt "rawrequest/internal/loadtest"
)

// NormalizeStartArgs trims and validates required parameters for starting a load test.
func NormalizeStartArgs(requestID, method, url string) (string, string, string, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return "", "", "", errors.New("missing requestId")
	}

	method = strings.TrimSpace(method)
	url = strings.TrimSpace(url)
	if method == "" || url == "" {
		return "", "", "", errors.New("missing method or url")
	}

	return requestID, method, url, nil
}

// ParseAndNormalizeConfig parses JSON into a loadtest Config and normalizes it.
func ParseAndNormalizeConfig(loadConfigJSON string) (lt.NormalizedConfig, error) {
	var cfg lt.Config
	if err := json.Unmarshal([]byte(loadConfigJSON), &cfg); err != nil {
		return lt.NormalizedConfig{}, err
	}
	return lt.NormalizeConfig(cfg)
}
