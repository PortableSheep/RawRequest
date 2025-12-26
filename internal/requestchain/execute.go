package requestchain

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	sr "rawrequest/internal/scriptruntime"
)

type Dependencies struct {
	CancelledResponse string

	VariablesSnapshot func() map[string]string

	Resolve           func(input string, responseStore map[string]map[string]interface{}) string
	PerformRequest    func(ctx context.Context, method, url, headersJSON, body string, timeoutMs int) string
	ParseResponse     func(response string) map[string]interface{}
	ApplyVarsFromBody func(responseBody string)
	ExecuteScript     func(rawScript string, ctx *sr.ExecutionContext, stage string)
}

func Execute(ctx context.Context, requests []map[string]interface{}, deps Dependencies) string {
	var results []string
	responseStore := make(map[string]map[string]interface{})

	resolveHeaders := func(headers map[string]string) map[string]string {
		if headers == nil {
			return map[string]string{}
		}
		out := make(map[string]string, len(headers))
		for k, v := range headers {
			if deps.Resolve != nil {
				out[k] = deps.Resolve(v, responseStore)
			} else {
				out[k] = v
			}
		}
		return out
	}

	readTimeoutMs := func(req map[string]interface{}) int {
		timeoutMs := 0
		if options, exists := req["options"].(map[string]interface{}); exists {
			if timeout, ok := options["timeout"].(float64); ok {
				timeoutMs = int(timeout)
			} else if timeout, ok := options["timeout"].(int); ok {
				timeoutMs = timeout
			}
		}
		return timeoutMs
	}

	readHeaders := func(req map[string]interface{}) map[string]string {
		headers := map[string]string{}
		if rawHeaders, exists := req["headers"]; exists {
			switch h := rawHeaders.(type) {
			case map[string]string:
				headers = h
			case map[string]interface{}:
				for key, value := range h {
					headers[key] = fmt.Sprint(value)
				}
			}
		}
		return headers
	}

	for i, req := range requests {
		if ctx.Err() == context.Canceled {
			return deps.CancelledResponse
		}

		// Ensure headers exists in request map so scripts can safely mutate it.
		if _, exists := req["headers"]; !exists {
			req["headers"] = map[string]string{}
		}

		// Run pre-script *before* extracting request fields so updateRequest/setHeader changes apply.
		if deps.ExecuteScript != nil {
			if preScript, exists := req["preScript"].(string); exists && strings.TrimSpace(preScript) != "" {
				deps.ExecuteScript(preScript, &sr.ExecutionContext{
					Request:       req,
					Variables:     safeSnapshot(deps.VariablesSnapshot),
					ResponseStore: responseStore,
				}, "pre")
				if ctx.Err() == context.Canceled {
					return deps.CancelledResponse
				}
			}
		}

		method, ok := req["method"].(string)
		if !ok {
			continue
		}
		url, ok := req["url"].(string)
		if !ok {
			continue
		}
		body, _ := req["body"].(string)

		// Resolve placeholders after preScript so setVar can affect the same request.
		if deps.Resolve != nil {
			url = deps.Resolve(url, responseStore)
			body = deps.Resolve(body, responseStore)
		}
		headers := resolveHeaders(readHeaders(req))
		timeoutMs := readTimeoutMs(req)

		headersJSON, _ := json.Marshal(headers)
		result := deps.PerformRequest(ctx, method, url, string(headersJSON), body, timeoutMs)
		if result == deps.CancelledResponse {
			return deps.CancelledResponse
		}
		results = append(results, result)

		responseData := deps.ParseResponse(result)
		responseStore[fmt.Sprintf("request%d", i+1)] = responseData

		if deps.ApplyVarsFromBody != nil {
			if responseBody, exists := responseData["body"].(string); exists {
				deps.ApplyVarsFromBody(responseBody)
			}
		}

		if deps.ExecuteScript != nil {
			if postScript, exists := req["postScript"].(string); exists && strings.TrimSpace(postScript) != "" {
				deps.ExecuteScript(postScript, &sr.ExecutionContext{
					Request:       req,
					Response:      responseData,
					Variables:     safeSnapshot(deps.VariablesSnapshot),
					ResponseStore: responseStore,
				}, "post")
				if ctx.Err() == context.Canceled {
					return deps.CancelledResponse
				}
			}
		}
	}

	return strings.Join(results, "\n\n")
}

func safeSnapshot(snapshot func() map[string]string) map[string]string {
	if snapshot == nil {
		return map[string]string{}
	}
	vars := snapshot()
	if vars == nil {
		return map[string]string{}
	}
	return vars
}
