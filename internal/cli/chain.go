package cli

import (
	"fmt"

	rc "rawrequest/internal/requestchain"
)

// RunSelected finds the requests in parsed matching names (same matching
// semantics as FindRequestsByName — case-insensitive, empty names selects
// every request), expands each match into its full @depends dependency
// chain via requestchain.ResolveOrder, and executes the resulting ordered,
// de-duplicated list with runner. A single positional response store is
// shared across the whole run so later requests can reference earlier ones
// via {{requestN.response...}} — the same convention requestchain.Execute
// and templating.Resolve use for the Desktop app's request chains (see
// Runner.ExecuteRequestWithResponses / templating.ResolveResponseReferences).
//
// This is the entry point shared by CLI's `run` command and MCP's
// run_request tool, so both modes get identical @depends ordering and
// response-reference resolution instead of each re-implementing it (or, in
// MCP's case, not implementing it at all — MCP previously executed only the
// single named request, silently ignoring @depends).
//
// A request is skipped (not executed, and reported with a descriptive
// Error) if the request it @depends on failed (returned a transport error or
// a >=400 status) or was itself skipped. This propagates only along
// @depends edges: unrelated requests selected in the same call are
// unaffected by one another's failures, preserving CLI's long-standing
// behavior of running every explicitly selected request regardless of
// earlier, unrelated failures.
//
// Returns an error only for structural problems in the chain itself (e.g. a
// circular @depends reference); per-request HTTP/script failures are
// reported in the returned results, not as an error.
func RunSelected(parsed *ParsedHttpFile, runner *Runner, names []string) ([]ResponseResult, error) {
	seeds := parsed.findIndexesByName(names)
	if len(seeds) == 0 {
		return nil, nil
	}

	refs := make([]rc.ChainRef, len(parsed.Requests))
	for i, req := range parsed.Requests {
		refs[i] = rc.ChainRef{Name: req.Name, Depends: req.Depends}
	}

	order, err := rc.ResolveOrder(refs, seeds)
	if err != nil {
		return nil, err
	}

	responseStore := make(map[string]map[string]interface{}, len(order))
	failed := make(map[int]bool, len(order))
	results := make([]ResponseResult, 0, len(order))

	for pos, idx := range order {
		req := parsed.Requests[idx]

		if depIdx, ok := dependencyIndex(refs, idx); ok && failed[depIdx] {
			failed[idx] = true
			results = append(results, ResponseResult{
				RequestName: req.Name,
				Method:      req.Method,
				URL:         req.URL,
				Error:       fmt.Sprintf("Skipped: dependency %q did not succeed", req.Depends),
			})
			continue
		}

		result := runner.ExecuteRequestWithResponses(req, responseStore)
		results = append(results, result)

		responseStore[rc.ResponseStoreKey(pos)] = map[string]interface{}{
			"body":    result.Body,
			"status":  result.Status,
			"headers": result.Headers,
		}

		if result.Error != "" || result.Status >= 400 {
			failed[idx] = true
		}
	}

	return results, nil
}

// dependencyIndex resolves refs[idx]'s @depends name to an index into refs,
// mirroring requestchain.ResolveOrder's own name lookup (a dangling or empty
// @depends resolves to ok=false, meaning "no dependency to check").
func dependencyIndex(refs []rc.ChainRef, idx int) (int, bool) {
	dep := refs[idx].Depends
	if dep == "" {
		return 0, false
	}
	for i, r := range refs {
		if r.Name == dep {
			return i, true
		}
	}
	return 0, false
}
