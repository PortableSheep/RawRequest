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
	PerformRequest    func(ctx context.Context, requestID, method, url, headersJSON, body string, timeoutMs int) string
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
		// Support a few shapes depending on how the data reaches Go (Wails/runtime, tests, etc).
		readTimeoutFromOptions := func(options map[string]interface{}) int {
			if options == nil {
				return 0
			}
			if timeout, ok := options["timeout"].(float64); ok {
				return int(timeout)
			}
			if timeout, ok := options["timeout"].(int); ok {
				return timeout
			}
			if timeout, ok := options["timeout"].(int64); ok {
				return int(timeout)
			}
			if timeout, ok := options["timeout"].(string); ok {
				// Be lenient: treat non-empty numeric strings as ms.
				// (If parsing fails, fall back to 0.)
				var n int
				_, _ = fmt.Sscanf(strings.TrimSpace(timeout), "%d", &n)
				return n
			}
			return 0
		}

		if raw, exists := req["options"]; exists {
			switch opt := raw.(type) {
			case map[string]interface{}:
				return readTimeoutFromOptions(opt)
			case map[string]float64:
				if v, ok := opt["timeout"]; ok {
					return int(v)
				}
			case map[string]int:
				if v, ok := opt["timeout"]; ok {
					return v
				}
			}
		}

		// Back-compat: allow a top-level "timeout" field.
		if v, ok := req["timeout"].(float64); ok {
			return int(v)
		}
		if v, ok := req["timeout"].(int); ok {
			return v
		}

		return 0
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

		scriptCtx := &sr.ExecutionContext{
			Request:       req,
			Variables:     safeSnapshot(deps.VariablesSnapshot),
			ResponseStore: responseStore,
			Assertions:    make([]sr.AssertionResult, 0),
		}

		// Ensure headers exists in request map so scripts can safely mutate it.
		if _, exists := req["headers"]; !exists {
			req["headers"] = map[string]string{}
		}

		// Run pre-script *before* extracting request fields so updateRequest/setHeader changes apply.
		if deps.ExecuteScript != nil {
			if preScript, exists := req["preScript"].(string); exists && strings.TrimSpace(preScript) != "" {
				// Reuse a single context per request so assertions can be collected across pre/post.
				scriptCtx.Request = req
				scriptCtx.Variables = safeSnapshot(deps.VariablesSnapshot)
				scriptCtx.Response = nil
				scriptCtx.ResponseStore = responseStore
				deps.ExecuteScript(preScript, scriptCtx, "pre")
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
		resultRaw := deps.PerformRequest(ctx, "", method, url, string(headersJSON), body, timeoutMs)
		if resultRaw == deps.CancelledResponse {
			return deps.CancelledResponse
		}

		// On any request error (including timeout), stop the chain and return partial results.
		// The caller can parse/display the error response as the final chain step.
		if strings.HasPrefix(resultRaw, "Error:") || strings.HasPrefix(resultRaw, "Error ") {
			results = append(results, resultRaw)
			break
		}

		responseData := deps.ParseResponse(resultRaw)
		responseStore[fmt.Sprintf("request%d", i+1)] = responseData

		if deps.ApplyVarsFromBody != nil {
			if responseBody, exists := responseData["body"].(string); exists {
				deps.ApplyVarsFromBody(responseBody)
			}
		}

		if deps.ExecuteScript != nil {
			if postScript, exists := req["postScript"].(string); exists && strings.TrimSpace(postScript) != "" {
				scriptCtx.Request = req
				scriptCtx.Response = responseData
				scriptCtx.Variables = safeSnapshot(deps.VariablesSnapshot)
				scriptCtx.ResponseStore = responseStore
				deps.ExecuteScript(postScript, scriptCtx, "post")
				if ctx.Err() == context.Canceled {
					return deps.CancelledResponse
				}
			}
		}

		result := resultRaw
		if len(scriptCtx.Assertions) > 0 {
			if b, err := json.Marshal(scriptCtx.Assertions); err == nil {
				result += "\nAsserts: " + string(b)
			}
		}
		results = append(results, result)
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
