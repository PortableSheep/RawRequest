package scriptexec

import (
	"fmt"
	"strings"
	"time"

	sh "rawrequest/internal/scripthelpers"
	so "rawrequest/internal/scriptops"
	sr "rawrequest/internal/scriptruntime"

	"github.com/dop251/goja"
)

type Dependencies struct {
	VariablesSnapshot func() map[string]string
	GetVar            func(key string) (string, bool)
	SetVar            func(key, value string)
	AppendLog         func(level, source, message string)
	Sleep             func(time.Duration)
}

type assertionFailure struct {
	message string
}

func (a assertionFailure) Error() string {
	if a.message == "" {
		return "Assertion failed"
	}
	return a.message
}

func Execute(cleanScript string, ctx *sr.ExecutionContext, stage string, deps Dependencies) {
	if strings.TrimSpace(cleanScript) == "" {
		return
	}
	if ctx == nil {
		ctx = &sr.ExecutionContext{}
	}
	if ctx.Request == nil {
		ctx.Request = map[string]interface{}{}
	}
	ctx.Stage = stage
	if ctx.Variables == nil {
		ctx.Variables = safeSnapshot(deps.VariablesSnapshot)
	}
	beforeVars := map[string]string(nil)
	if deps.SetVar != nil {
		beforeVars = cloneStringMap(ctx.Variables)
		defer func() {
			mergeVars(deps.SetVar, beforeVars, ctx.Variables)
		}()
	}

	sleepFn := deps.Sleep
	if sleepFn == nil {
		sleepFn = time.Sleep
	}

	vm := goja.New()
	_ = vm.Set("context", ctx)

	// Provide top-level aliases commonly used by scripts/examples.
	// `request` is always available (mutable via helpers).
	// `response` is always defined; for pre-scripts it is null.
	_ = vm.Set("request", ctx.Request)
	if ctx.Response == nil {
		_ = vm.Set("response", goja.Null())
	} else {
		_ = vm.Set("response", ctx.Response)
	}
	source := sr.BuildSource(ctx)

	appendLog := deps.AppendLog
	log := func(level string, message string) {
		if appendLog != nil {
			appendLog(level, source, message)
		}
	}

	_ = vm.Set("setVar", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			return goja.Undefined()
		}
		key := call.Arguments[0].String()
		strVal := call.Arguments[1].String()
		so.SetVar(deps.SetVar, ctx, key, strVal)
		return goja.Undefined()
	})

	_ = vm.Set("getVar", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		key := call.Arguments[0].String()
		if val, ok := so.GetVar(deps.GetVar, key); ok {
			return vm.ToValue(val)
		}
		return goja.Undefined()
	})

	_ = vm.Set("setHeader", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			return goja.Undefined()
		}
		so.SetHeader(ctx, call.Arguments[0].String(), call.Arguments[1].String())
		return goja.Undefined()
	})

	_ = vm.Set("updateRequest", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		patch := sh.ToInterfaceMap(call.Arguments[0])
		if patch == nil {
			return goja.Undefined()
		}
		so.UpdateRequest(ctx, patch)
		return goja.Undefined()
	})

	_ = vm.Set("assert", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		passed := call.Arguments[0].ToBoolean()
		message := ""
		if len(call.Arguments) > 1 {
			message = call.Arguments[1].String()
		}
		if passed {
			if message == "" {
				message = "Assertion passed"
			}
			ctx.Assertions = append(ctx.Assertions, sr.AssertionResult{Passed: true, Message: message, Stage: stage})
			return goja.Undefined()
		}
		if message == "" {
			message = "Assertion failed"
		}
		ctx.Assertions = append(ctx.Assertions, sr.AssertionResult{Passed: false, Message: message, Stage: stage})
		panic(assertionFailure{message: message})
	})

	_ = vm.Set("delay", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 {
			return goja.Undefined()
		}
		if duration, ok := sh.DurationFromValue(call.Arguments[0].Export()); ok {
			so.Delay(duration, sleepFn)
		}
		return goja.Undefined()
	})

	console := vm.NewObject()
	_ = console.Set("log", func(call goja.FunctionCall) goja.Value {
		log("info", sh.BuildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	_ = console.Set("info", func(call goja.FunctionCall) goja.Value {
		log("info", sh.BuildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	_ = console.Set("warn", func(call goja.FunctionCall) goja.Value {
		log("warn", sh.BuildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	_ = console.Set("error", func(call goja.FunctionCall) goja.Value {
		log("error", sh.BuildMessageFromArgs(call.Arguments))
		return goja.Undefined()
	})
	_ = vm.Set("console", console)

	defer func() {
		if r := recover(); r != nil {
			if _, ok := r.(assertionFailure); ok {
				return
			}
			log("error", fmt.Sprintf("panic: %v", r))
		}
	}()

	// Execute inside a wrapper function that provides common globals as parameters.
	// This avoids ReferenceError issues if scripts assume `response` exists even in pre-scripts
	// and keeps any script-provided 'use strict' directive valid.
	wrappedScript := fmt.Sprintf(
		"(function(__g){\n"+
			"(function(context, request, response){\n%s\n"+
			"})(__g.context, __g.request, __g.response);\n"+
			"})(Function('return this')());",
		cleanScript,
	)

	if _, err := vm.RunString(wrappedScript); err != nil {
		log("error", fmt.Sprintf("runtime error: %v", err))
	}
}

func cloneStringMap(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func mergeVars(setVar func(key, value string), before map[string]string, after map[string]string) {
	if setVar == nil || after == nil {
		return
	}
	for k, v := range after {
		if before == nil {
			setVar(k, v)
			continue
		}
		if prev, ok := before[k]; !ok || prev != v {
			setVar(k, v)
		}
	}
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
