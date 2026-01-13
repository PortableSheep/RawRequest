package scriptruntime

import "fmt"

type AssertionResult struct {
	Passed  bool   `json:"passed"`
	Message string `json:"message"`
	Stage   string `json:"stage"`
}

type ExecutionContext struct {
	Request       map[string]interface{}            `json:"request"`
	Response      map[string]interface{}            `json:"response"`
	Variables     map[string]string                 `json:"variables"`
	ResponseStore map[string]map[string]interface{} `json:"responseStore"`
	Stage         string                            `json:"stage"`
	Assertions    []AssertionResult                 `json:"assertions"`
}

func BuildSource(ctx *ExecutionContext) string {
	stage := "script"
	if ctx != nil && ctx.Stage != "" {
		stage = ctx.Stage
	}

	if ctx != nil && ctx.Request != nil {
		if name, ok := ctx.Request["name"].(string); ok && name != "" {
			return fmt.Sprintf("%s:%s", stage, name)
		}
		if method, ok := ctx.Request["method"].(string); ok && method != "" {
			if url, ok := ctx.Request["url"].(string); ok && url != "" {
				return fmt.Sprintf("%s:%s %s", stage, method, url)
			}
			return fmt.Sprintf("%s:%s", stage, method)
		}
	}

	return stage
}
