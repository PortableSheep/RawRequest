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

func TestExecute_AssertPanicRecoveredAndLogged(t *testing.T) {
	ctx := &sr.ExecutionContext{}
	var got logEntry
	count := 0

	Execute("assert(false, 'nope')", ctx, "pre", Dependencies{
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
	if !strings.HasPrefix(got.message, "panic:") {
		t.Fatalf("message=%q want prefix panic:", got.message)
	}
}
