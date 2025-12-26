package varsjson

import "testing"

func TestApplyFromMap_NestedAndFloatFormatting(t *testing.T) {
	vars := map[string]string{}
	ApplyFromMap(vars, "", map[string]interface{}{
		"a": "x",
		"n": float64(12),
		"obj": map[string]interface{}{
			"b": "y",
			"m": float64(3.4),
		},
		"ignoredBool": true,
		"ignoredArr":  []interface{}{1, 2},
	})

	if vars["a"] != "x" {
		t.Fatalf("expected a=x, got %q", vars["a"])
	}
	if vars["n"] != "12" {
		t.Fatalf("expected n=12, got %q", vars["n"])
	}
	if vars["obj.b"] != "y" {
		t.Fatalf("expected obj.b=y, got %q", vars["obj.b"])
	}
	if vars["obj.m"] != "3" {
		t.Fatalf("expected obj.m=3 (%.0f), got %q", 3.4, vars["obj.m"])
	}
	if _, ok := vars["ignoredBool"]; ok {
		t.Fatalf("did not expect bool to be stored")
	}
}

func TestApplyFromMap_Prefix(t *testing.T) {
	vars := map[string]string{}
	ApplyFromMap(vars, "root", map[string]interface{}{"k": "v"})
	if vars["root.k"] != "v" {
		t.Fatalf("expected root.k=v, got %q", vars["root.k"])
	}
}

func TestApplyFromJSON_InvalidOrNonObject_NoChange(t *testing.T) {
	vars := map[string]string{"keep": "1"}
	ApplyFromJSON(vars, "{not valid")
	ApplyFromJSON(vars, "[1,2,3]")
	ApplyFromJSON(vars, "\"str\"")

	if vars["keep"] != "1" || len(vars) != 1 {
		t.Fatalf("expected vars unchanged, got %#v", vars)
	}
}

func TestApplyFromJSON_Object(t *testing.T) {
	vars := map[string]string{}
	ApplyFromJSON(vars, `{"u":{"id":7,"name":"alice"}}`)
	if vars["u.id"] != "7" {
		t.Fatalf("expected u.id=7, got %q", vars["u.id"])
	}
	if vars["u.name"] != "alice" {
		t.Fatalf("expected u.name=alice, got %q", vars["u.name"])
	}
}
