package requestchain

import "testing"

func TestResolveOrder_NoDependencies(t *testing.T) {
	refs := []ChainRef{{Name: "a"}, {Name: "b"}, {Name: "c"}}
	order, err := ResolveOrder(refs, []int{2, 0})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := order; len(got) != 2 || got[0] != 2 || got[1] != 0 {
		t.Fatalf("expected seeds run in given order with no expansion, got %v", got)
	}
}

func TestResolveOrder_SchedulesDependencyBeforeDependent(t *testing.T) {
	refs := []ChainRef{
		{Name: "login"},
		{Name: "getUser", Depends: "login"},
	}
	order, err := ResolveOrder(refs, []int{1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 2 || order[0] != 0 || order[1] != 1 {
		t.Fatalf("expected [login, getUser] order, got %v", order)
	}
}

func TestResolveOrder_TransitiveChain(t *testing.T) {
	refs := []ChainRef{
		{Name: "a"},
		{Name: "b", Depends: "a"},
		{Name: "c", Depends: "b"},
	}
	order, err := ResolveOrder(refs, []int{2})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 3 || order[0] != 0 || order[1] != 1 || order[2] != 2 {
		t.Fatalf("expected [a, b, c] order, got %v", order)
	}
}

func TestResolveOrder_SharedDependencyRunsOnceAcrossSeeds(t *testing.T) {
	refs := []ChainRef{
		{Name: "login"},
		{Name: "getUser", Depends: "login"},
		{Name: "getOrders", Depends: "login"},
	}
	order, err := ResolveOrder(refs, []int{1, 2})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 3 {
		t.Fatalf("expected login to be scheduled once, got %v", order)
	}
	if order[0] != 0 || order[1] != 1 || order[2] != 2 {
		t.Fatalf("expected [login, getUser, getOrders], got %v", order)
	}
}

func TestResolveOrder_UnrelatedSeedsPreserveExplicitOrder(t *testing.T) {
	refs := []ChainRef{
		{Name: "a"},
		{Name: "b"},
	}
	order, err := ResolveOrder(refs, []int{1, 0})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 2 || order[0] != 1 || order[1] != 0 {
		t.Fatalf("expected unrelated seeds to run in the given order, got %v", order)
	}
}

func TestResolveOrder_MissingDependencyNameIsIgnored(t *testing.T) {
	refs := []ChainRef{{Name: "onlyOne", Depends: "doesNotExist"}}
	order, err := ResolveOrder(refs, []int{0})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(order) != 1 || order[0] != 0 {
		t.Fatalf("expected the request to still run despite a dangling @depends, got %v", order)
	}
}

func TestResolveOrder_CircularDependencyReturnsError(t *testing.T) {
	refs := []ChainRef{
		{Name: "a", Depends: "b"},
		{Name: "b", Depends: "a"},
	}
	_, err := ResolveOrder(refs, []int{0})
	if err == nil {
		t.Fatal("expected circular dependency error")
	}
	var circErr *ErrCircularDependency
	if !asCircularError(err, &circErr) {
		t.Fatalf("expected *ErrCircularDependency, got %T: %v", err, err)
	}
}

func asCircularError(err error, target **ErrCircularDependency) bool {
	if e, ok := err.(*ErrCircularDependency); ok {
		*target = e
		return true
	}
	return false
}

func TestResponseStoreKey_IsOneIndexed(t *testing.T) {
	if got := ResponseStoreKey(0); got != "request1" {
		t.Fatalf("ResponseStoreKey(0) = %q, want %q", got, "request1")
	}
	if got := ResponseStoreKey(4); got != "request5" {
		t.Fatalf("ResponseStoreKey(4) = %q, want %q", got, "request5")
	}
}
