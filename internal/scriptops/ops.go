package scriptops

import (
	"errors"
	"time"

	sh "rawrequest/internal/scripthelpers"
	sr "rawrequest/internal/scriptruntime"
)

type VarGetter func(key string) (string, bool)
type VarSetter func(key, value string)

func EnsureRequest(ctx *sr.ExecutionContext) map[string]interface{} {
	if ctx.Request == nil {
		ctx.Request = make(map[string]interface{})
	}
	return ctx.Request
}

func SetVar(setAppVar VarSetter, ctx *sr.ExecutionContext, key, value string) {
	if setAppVar != nil {
		setAppVar(key, value)
	}
	if ctx == nil {
		return
	}
	if ctx.Variables == nil {
		ctx.Variables = make(map[string]string)
	}
	ctx.Variables[key] = value
}

func GetVar(getAppVar VarGetter, key string) (string, bool) {
	if getAppVar == nil {
		return "", false
	}
	return getAppVar(key)
}

func SetHeader(ctx *sr.ExecutionContext, name, value string) {
	req := EnsureRequest(ctx)
	headers := sh.ToStringMap(req["headers"])
	headers[name] = value
	req["headers"] = headers
}

func UpdateRequest(ctx *sr.ExecutionContext, patch map[string]interface{}) {
	if patch == nil {
		return
	}
	req := EnsureRequest(ctx)
	for key, val := range patch {
		if key == "headers" {
			existing := sh.ToStringMap(req["headers"])
			incoming := sh.ToStringMap(val)
			req["headers"] = sh.MergeStringMaps(existing, incoming)
			continue
		}
		req[key] = val
	}
}

func Assert(condition bool, message string) error {
	if condition {
		return nil
	}
	if message == "" {
		message = "Assertion failed"
	}
	return errors.New(message)
}

func Delay(duration time.Duration, sleep func(time.Duration)) {
	if duration <= 0 {
		return
	}
	if sleep == nil {
		return
	}
	sleep(duration)
}
