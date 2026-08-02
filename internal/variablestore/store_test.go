package variablestore

import (
	"fmt"
	"sync"
	"testing"
)

func TestNew_Defaults(t *testing.T) {
	s := New()

	if got := s.GetVariable("missing"); got != "" {
		t.Fatalf("GetVariable(missing) = %q, want empty", got)
	}
	if vars := s.Variables(); len(vars) != 0 {
		t.Fatalf("Variables() = %+v, want empty", vars)
	}
	if envs := s.Environments(); len(envs) != 0 {
		t.Fatalf("Environments() = %+v, want empty", envs)
	}
	if got := s.CurrentEnvVariables(); got != nil {
		t.Fatalf("CurrentEnvVariables() = %+v, want nil before any environment is populated", got)
	}
}

func TestSetGetVariable(t *testing.T) {
	s := New()

	s.SetVariable("token", "abc123")

	if got := s.GetVariable("token"); got != "abc123" {
		t.Fatalf("GetVariable(token) = %q, want abc123", got)
	}
	val, ok := s.GetVariableOK("token")
	if !ok || val != "abc123" {
		t.Fatalf("GetVariableOK(token) = (%q, %v), want (abc123, true)", val, ok)
	}
	if _, ok := s.GetVariableOK("missing"); ok {
		t.Fatalf("GetVariableOK(missing) ok = true, want false")
	}
}

func TestVariables_ReturnsIndependentCopy(t *testing.T) {
	s := New()
	s.SetVariable("a", "1")

	snapshot := s.Variables()
	snapshot["a"] = "mutated"
	snapshot["b"] = "new"

	if got := s.GetVariable("a"); got != "1" {
		t.Fatalf("GetVariable(a) = %q after mutating snapshot, want unaffected 1", got)
	}
	if _, ok := s.GetVariableOK("b"); ok {
		t.Fatalf("store gained key 'b' via snapshot mutation, snapshot must be independent")
	}
}

func TestApplyFromResponseJSON_MergesFlattenedFields(t *testing.T) {
	s := New()
	s.SetVariable("existing", "keep")

	s.ApplyFromResponseJSON(`{"token":"xyz","nested":{"id":42}}`)

	vars := s.Variables()
	if vars["existing"] != "keep" {
		t.Fatalf("existing variable lost, got %+v", vars)
	}
	if vars["token"] != "xyz" {
		t.Fatalf("token = %q, want xyz", vars["token"])
	}
	if vars["nested.id"] != "42" {
		t.Fatalf("nested.id = %q, want 42", vars["nested.id"])
	}
}

func TestApplyFromResponseJSON_InvalidJSONIsNoop(t *testing.T) {
	s := New()
	s.SetVariable("existing", "keep")

	s.ApplyFromResponseJSON("not json")

	if got := s.GetVariable("existing"); got != "keep" {
		t.Fatalf("GetVariable(existing) = %q, want keep after invalid JSON", got)
	}
}

func TestSetEnvironment_CreatesEnvironmentIfMissing(t *testing.T) {
	s := New()

	s.SetEnvironment("staging")

	envs := s.Environments()
	vars, ok := envs["staging"]
	if !ok {
		t.Fatalf("Environments() = %+v, want staging present after SetEnvironment", envs)
	}
	if len(vars) != 0 {
		t.Fatalf("staging vars = %+v, want empty", vars)
	}
}

func TestSetEnvVariable_WritesToCurrentEnvironment(t *testing.T) {
	s := New()
	s.SetEnvironment("staging")

	s.SetEnvVariable("baseUrl", "https://staging.example.com")

	vars := s.EnvVariables("staging")
	if vars["baseUrl"] != "https://staging.example.com" {
		t.Fatalf("EnvVariables(staging) = %+v, want baseUrl set", vars)
	}

	current := s.CurrentEnvVariables()
	if current["baseUrl"] != "https://staging.example.com" {
		t.Fatalf("CurrentEnvVariables() = %+v, want baseUrl set", current)
	}
}

func TestSetEnvVariable_BeforeSetEnvironment_UsesDefaultEnv(t *testing.T) {
	s := New()

	s.SetEnvVariable("k", "v")

	vars := s.EnvVariables(DefaultEnvironment)
	if vars["k"] != "v" {
		t.Fatalf("EnvVariables(default) = %+v, want k=v written to default env", vars)
	}
}

func TestEnvVariables_UnknownEnvironmentReturnsEmptyNonNilMap(t *testing.T) {
	s := New()

	vars := s.EnvVariables("does-not-exist")
	if vars == nil {
		t.Fatalf("EnvVariables(unknown) = nil, want non-nil empty map")
	}
	if len(vars) != 0 {
		t.Fatalf("EnvVariables(unknown) = %+v, want empty", vars)
	}
}

func TestEnvironments_ReturnsDeepCopy(t *testing.T) {
	s := New()
	s.SetEnvironment("staging")
	s.SetEnvVariable("k", "v")

	envs := s.Environments()
	envs["staging"]["k"] = "mutated"
	envs["staging"]["new"] = "added"
	envs["other"] = map[string]string{"x": "y"}

	vars := s.EnvVariables("staging")
	if vars["k"] != "v" {
		t.Fatalf("EnvVariables(staging)[k] = %q after mutating snapshot, want unaffected v", vars["k"])
	}
	if _, ok := vars["new"]; ok {
		t.Fatalf("EnvVariables(staging) gained 'new' via snapshot mutation, must be independent")
	}
	if envs2 := s.Environments(); len(envs2) != 1 {
		t.Fatalf("Environments() = %+v, want only staging (snapshot mutation must not leak)", envs2)
	}
}

func TestRenameEnvironment(t *testing.T) {
	s := New()
	s.SetEnvironment("staging")
	s.SetEnvVariable("baseUrl", "https://staging.example.com")

	s.RenameEnvironment("staging", "stage")

	envs := s.Environments()
	if _, ok := envs["staging"]; ok {
		t.Fatalf("Environments() = %+v, want staging renamed away", envs)
	}
	vars, ok := envs["stage"]
	if !ok {
		t.Fatalf("Environments() = %+v, want stage present after rename", envs)
	}
	if vars["baseUrl"] != "https://staging.example.com" {
		t.Fatalf("stage vars = %+v, want baseUrl preserved", vars)
	}

	// currentEnv should have followed the rename.
	s.SetEnvVariable("another", "x")
	current := s.CurrentEnvVariables()
	if current["another"] != "x" {
		t.Fatalf("CurrentEnvVariables() = %+v, want writes after rename to land in renamed env", current)
	}
}

func TestRenameEnvironment_UnknownOldNameIsNoop(t *testing.T) {
	s := New()
	s.SetEnvironment("staging")

	s.RenameEnvironment("does-not-exist", "whatever")

	envs := s.Environments()
	if _, ok := envs["staging"]; !ok {
		t.Fatalf("Environments() = %+v, want staging untouched", envs)
	}
	if _, ok := envs["whatever"]; ok {
		t.Fatalf("Environments() = %+v, want no 'whatever' created from no-op rename", envs)
	}
}

func TestRenameEnvironment_DoesNotFollowCurrentEnvWhenDifferent(t *testing.T) {
	s := New()
	s.SetEnvironment("staging")
	s.SetEnvironment("prod") // currentEnv is now "prod"

	s.RenameEnvironment("staging", "stage")

	// currentEnv remains "prod"; new writes should not land in the renamed env.
	s.SetEnvVariable("k", "v")
	stageVars := s.EnvVariables("stage")
	if _, ok := stageVars["k"]; ok {
		t.Fatalf("EnvVariables(stage) = %+v, want write to unrelated currentEnv not to land here", stageVars)
	}
}

func TestGlobalAndEnvironmentVariablesAreIndependent(t *testing.T) {
	s := New()
	s.SetEnvironment("staging")

	s.SetVariable("globalToken", "g1")
	s.SetEnvVariable("apiKey", "secret-ish")

	globals := s.Variables()
	if _, ok := globals["apiKey"]; ok {
		t.Fatalf("Variables() = %+v, want env-scoped apiKey absent from globals", globals)
	}
	envVars := s.EnvVariables("staging")
	if _, ok := envVars["globalToken"]; ok {
		t.Fatalf("EnvVariables(staging) = %+v, want global variable absent from env vars", envVars)
	}
}

// TestConcurrentAccess exercises the Store under concurrent readers and
// writers for both global variables and environments with `go test -race`.
func TestConcurrentAccess(t *testing.T) {
	s := New()
	const workers = 20
	const iterations = 50

	var wg sync.WaitGroup
	wg.Add(workers * 4)

	for i := 0; i < workers; i++ {
		i := i
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				s.SetVariable(fmt.Sprintf("k%d", i), fmt.Sprintf("v%d", j))
			}
		}()
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				_ = s.Variables()
				_, _ = s.GetVariableOK(fmt.Sprintf("k%d", i))
			}
		}()
		go func() {
			defer wg.Done()
			env := fmt.Sprintf("env%d", i%3)
			for j := 0; j < iterations; j++ {
				s.SetEnvironment(env)
				s.SetEnvVariable(fmt.Sprintf("k%d", i), fmt.Sprintf("v%d", j))
			}
		}()
		go func() {
			defer wg.Done()
			env := fmt.Sprintf("env%d", i%3)
			for j := 0; j < iterations; j++ {
				_ = s.Environments()
				_ = s.EnvVariables(env)
				_ = s.CurrentEnvVariables()
			}
		}()
	}

	wg.Wait()
}
