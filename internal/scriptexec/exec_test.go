package scriptexec

import (
	"strings"
	"testing"
	"time"

	sr "rawrequest/internal/scriptruntime"
)

type logEntry struct {
	level   string
	source  string
	message string
}

func TestExecute_SetVarAndConsoleLog(t *testing.T) {
	vars := map[string]string{}
	ctx := &sr.ExecutionContext{
		Request: map[string]interface{}{
			"method": "GET",
			"url":    "http://example.com",
		},
	}
	logs := make([]logEntry, 0, 4)

	Execute("setVar('token','abc'); console.log('hello', 2)", ctx, "pre", Dependencies{
		VariablesSnapshot: func() map[string]string { return vars },
		SetVar: func(key, value string) {
			vars[key] = value
		},
		AppendLog: func(level, source, message string) {
			logs = append(logs, logEntry{level: level, source: source, message: message})
		},
	})

	if vars["token"] != "abc" {
		t.Fatalf("vars[token]=%q want %q", vars["token"], "abc")
	}
	if len(logs) != 1 {
		t.Fatalf("logs=%d want 1", len(logs))
	}
	if logs[0].level != "info" {
		t.Fatalf("level=%q want info", logs[0].level)
	}
	if !strings.HasPrefix(logs[0].source, "pre:") {
		t.Fatalf("source=%q want prefix pre:", logs[0].source)
	}
	if logs[0].message != "hello 2" {
		t.Fatalf("message=%q want %q", logs[0].message, "hello 2")
	}
}

func TestExecute_DelayUsesInjectedSleep(t *testing.T) {
	ctx := &sr.ExecutionContext{}
	var slept time.Duration
	var called int

	Execute("delay(7)", ctx, "pre", Dependencies{
		VariablesSnapshot: func() map[string]string { return map[string]string{} },
		Sleep: func(d time.Duration) {
			slept = d
			called++
		},
	})

	if called != 1 {
		t.Fatalf("sleep called %d times want 1", called)
	}
	if slept != 7*time.Millisecond {
		t.Fatalf("slept=%v want %v", slept, 7*time.Millisecond)
	}
}

func TestExecute_RuntimeErrorLogged(t *testing.T) {
	ctx := &sr.ExecutionContext{}
	var got logEntry
	count := 0

	Execute("throw new Error('bad')", ctx, "pre", Dependencies{
		VariablesSnapshot: func() map[string]string { return map[string]string{} },
		AppendLog: func(level, source, message string) {
			got = logEntry{level: level, source: source, message: message}
			count++
		},
	})

	if count != 1 {
		t.Fatalf("logs=%d want 1", count)
	}
	if got.level != "error" {
		t.Fatalf("level=%q want error", got.level)
	}
	if !strings.Contains(got.message, "runtime error:") {
		t.Fatalf("message=%q missing runtime error", got.message)
	}
}

func TestExecute_AssertRecordsAndLogs(t *testing.T) {
	ctx := &sr.ExecutionContext{}
	logs := make([]logEntry, 0, 2)

	Execute("assert(true, 'ok'); assert(false, 'nope')", ctx, "pre", Dependencies{
		VariablesSnapshot: func() map[string]string { return map[string]string{} },
		AppendLog: func(level, source, message string) {
			logs = append(logs, logEntry{level: level, source: source, message: message})
		},
	})

	if len(logs) != 0 {
		t.Fatalf("logs=%d want 0", len(logs))
	}

	if len(ctx.Assertions) != 2 {
		t.Fatalf("assertions=%d want 2", len(ctx.Assertions))
	}
	if !ctx.Assertions[0].Passed || ctx.Assertions[0].Message != "ok" {
		t.Fatalf("assertion[0]=%+v", ctx.Assertions[0])
	}
	if ctx.Assertions[1].Passed || ctx.Assertions[1].Message != "nope" {
		t.Fatalf("assertion[1]=%+v", ctx.Assertions[1])
	}
}

func TestExecute_ResponseIsDefinedInPreScripts(t *testing.T) {
	ctx := &sr.ExecutionContext{
		Request: map[string]interface{}{
			"method": "GET",
			"url":    "http://example.com",
		},
	}
	count := 0
	Execute("if (typeof response === 'undefined') { throw new Error('missing') }; if (response !== null) { throw new Error('expected null') }", ctx, "pre", Dependencies{
		VariablesSnapshot: func() map[string]string { return map[string]string{} },
		AppendLog: func(level, source, message string) {
			count++
		},
	})

	if count != 0 {
		t.Fatalf("unexpected error logs: %d", count)
	}
}

func TestExecute_ResponseIsAvailableInPostScripts(t *testing.T) {
	ctx := &sr.ExecutionContext{
		Request: map[string]interface{}{
			"method": "GET",
			"url":    "http://example.com",
		},
		Response: map[string]interface{}{
			"status": 200,
		},
	}
	count := 0
	Execute("if (response.status !== 200) { throw new Error('bad status') }", ctx, "post", Dependencies{
		VariablesSnapshot: func() map[string]string { return map[string]string{} },
		AppendLog: func(level, source, message string) {
			count++
		},
	})

	if count != 0 {
		t.Fatalf("unexpected error logs: %d", count)
	}
}
