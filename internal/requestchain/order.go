package requestchain

import "fmt"

// ChainRef is the minimal name/dependency information needed to resolve a
// dependency-first execution order across a flat list of requests. It
// exists so callers that don't share the Desktop app's
// map[string]interface{} request shape (e.g. the CLI's Request struct) can
// reuse the same ordering algorithm without adapting their whole model.
type ChainRef struct {
	Name    string
	Depends string
}

// ErrCircularDependency is returned by ResolveOrder when a @depends cycle
// is detected while expanding one of the seed indices.
type ErrCircularDependency struct {
	Name string
}

func (e *ErrCircularDependency) Error() string {
	return fmt.Sprintf("circular dependency detected in request chain at %q", e.Name)
}

// ResolveOrder expands each of the given seed indices (into refs) into a
// dependency-first execution order: for every request, its single @depends
// target (matched by exact name, if set and found) is scheduled before it,
// recursively. This mirrors the Desktop frontend's buildRequestChain
// (frontend/src/app/components/request-manager/request-chain.ts), so
// CLI/MCP share the same @depends semantics as the Desktop app: one
// dependency per request, matched by exact (case-sensitive) name,
// depth-first, single parent — not a comma-separated dependency list.
// Normalizing that surface (e.g. supporting multiple @depends targets) is
// intentionally deferred; this preserves the one supported form.
//
// Multiple seeds share one "already scheduled" set, so a dependency needed
// by more than one seed is only executed once, at the position it is first
// required. This lets ResolveOrder double as the ordering primitive for
// CLI's batch selection (e.g. `rawrequest run file.http reqA reqB`) as well
// as a single chain lookup (MCP's run_request).
func ResolveOrder(refs []ChainRef, seeds []int) ([]int, error) {
	order := make([]int, 0, len(refs))
	scheduled := make(map[int]bool, len(refs))
	visiting := make(map[int]bool)

	var visit func(idx int) error
	visit = func(idx int) error {
		if idx < 0 || idx >= len(refs) || scheduled[idx] {
			return nil
		}
		if visiting[idx] {
			return &ErrCircularDependency{Name: refs[idx].Name}
		}
		visiting[idx] = true
		defer delete(visiting, idx)

		if dep := refs[idx].Depends; dep != "" {
			if depIdx := indexByName(refs, dep); depIdx != -1 {
				if err := visit(depIdx); err != nil {
					return err
				}
			}
		}
		scheduled[idx] = true
		order = append(order, idx)
		return nil
	}

	for _, seed := range seeds {
		if err := visit(seed); err != nil {
			return nil, err
		}
	}
	return order, nil
}

func indexByName(refs []ChainRef, name string) int {
	for i, r := range refs {
		if r.Name == name {
			return i
		}
	}
	return -1
}

// ResponseStoreKey returns the positional response-store key for the
// request at the given zero-based execution position, matching the
// "request1", "request2", ... convention used by Execute's responseStore
// and templating.Resolve / templating.ResolveResponseReferences's
// {{requestN...}} placeholders.
func ResponseStoreKey(position int) string {
	return fmt.Sprintf("request%d", position+1)
}
