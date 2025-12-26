package scripthelpers

import (
	"testing"
	"time"

	"github.com/dop251/goja"
)

func TestToStringMap(t *testing.T) {
	got := ToStringMap(map[string]interface{}{"a": 1, "b": "x"})
	if got["a"] != "1" || got["b"] != "x" {
		t.Fatalf("unexpected map: %#v", got)
	}

	got = ToStringMap(map[string]string{"k": "v"})
	if got["k"] != "v" {
		t.Fatalf("unexpected map: %#v", got)
	}

	vm := goja.New()
	val := vm.ToValue(map[string]interface{}{"x": 2})
	got = ToStringMap(val)
	if got["x"] != "2" {
		t.Fatalf("unexpected map: %#v", got)
	}
}

func TestToInterfaceMap(t *testing.T) {
	vm := goja.New()
	val := vm.ToValue(map[string]interface{}{"a": "b"})
	got := ToInterfaceMap(val)
	if got["a"] != "b" {
		t.Fatalf("unexpected map: %#v", got)
	}

	if ToInterfaceMap(nil) != nil {
		t.Fatalf("expected nil")
	}
}

func TestMergeStringMaps(t *testing.T) {
	dst := map[string]string{"a": "1"}
	src := map[string]string{"b": "2", "a": "3"}
	merged := MergeStringMaps(dst, src)
	if merged["a"] != "3" || merged["b"] != "2" {
		t.Fatalf("unexpected merged: %#v", merged)
	}
}

func TestValueToString(t *testing.T) {
	if ValueToString(nil) != "" {
		t.Fatalf("expected empty")
	}
	if ValueToString("x") != "x" {
		t.Fatalf("expected x")
	}
}

func TestDurationFromValue(t *testing.T) {
	d, ok := DurationFromValue(150)
	if !ok || d != 150*time.Millisecond {
		t.Fatalf("unexpected duration: %v ok=%v", d, ok)
	}

	d, ok = DurationFromValue("-5")
	if !ok || d != 0 {
		t.Fatalf("expected clamp to 0: %v ok=%v", d, ok)
	}

	vm := goja.New()
	d, ok = DurationFromValue(vm.ToValue(10))
	if !ok || d != 10*time.Millisecond {
		t.Fatalf("unexpected duration: %v ok=%v", d, ok)
	}
}
