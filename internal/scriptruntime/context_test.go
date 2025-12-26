package scriptruntime

import "testing"

func TestBuildSource_Defaults(t *testing.T) {
	if got := BuildSource(nil); got != "script" {
		t.Fatalf("expected default script, got %q", got)
	}

	ctx := &ExecutionContext{}
	if got := BuildSource(ctx); got != "script" {
		t.Fatalf("expected default script, got %q", got)
	}
}

func TestBuildSource_StageAndRequestName(t *testing.T) {
	ctx := &ExecutionContext{Stage: "pre", Request: map[string]interface{}{"name": "Login"}}
	if got := BuildSource(ctx); got != "pre:Login" {
		t.Fatalf("expected pre:Login, got %q", got)
	}
}

func TestBuildSource_MethodAndURL(t *testing.T) {
	ctx := &ExecutionContext{Stage: "post", Request: map[string]interface{}{"method": "GET", "url": "https://x.test"}}
	if got := BuildSource(ctx); got != "post:GET https://x.test" {
		t.Fatalf("expected post:GET https://x.test, got %q", got)
	}

	ctx = &ExecutionContext{Stage: "post", Request: map[string]interface{}{"method": "DELETE"}}
	if got := BuildSource(ctx); got != "post:DELETE" {
		t.Fatalf("expected post:DELETE, got %q", got)
	}
}
