import { findChainVarOrigin, findChainVarOriginText } from './editor.chain-vars';

describe('editor.chain-vars', () => {
  it('returns origin for pre-script setVar in same request', () => {
    const requests = [
      { name: 'A', preScript: "setVar('foo', '1')" }
    ];

      expect(findChainVarOriginText('foo', 0, requests)).toBe('Set in chain: A (pre)');
  });

  it('returns origin from ancestor post-script', () => {
    const requests = [
      { name: 'login', postScript: "setVar('token', 'abc')" },
      { name: 'profile', depends: 'login' }
    ];

    const origin = findChainVarOrigin('token', 1, requests);
    expect(origin).not.toBeNull();
    expect(origin!.requestLabel).toBe('login');
    expect(origin!.stage).toBe('post');
      expect(findChainVarOriginText('token', 1, requests)).toBe('Set in chain: login (post)');
  });

  it('walks multi-hop chains and prefers earliest origin', () => {
    const requests = [
      { name: 'A', postScript: "setVar('x', '1')" },
      { name: 'B', depends: 'A', preScript: "setVar('y', '2'); setVar('x', 'override')" },
      { name: 'C', depends: 'B' }
    ];

      expect(findChainVarOriginText('x', 2, requests)).toBe('Set in chain: A (post)');
      expect(findChainVarOriginText('y', 2, requests)).toBe('Set in chain: B (pre)');
  });

  it("does not include the current request's post-script by default", () => {
    const requests = [
      { name: 'A', preScript: "setVar('a', '1')" },
      { name: 'B', depends: 'A', postScript: "setVar('b', '2')" }
    ];

    expect(findChainVarOriginText('b', 1, requests)).toBeNull();
    expect(findChainVarOriginText('b', 1, requests, { includeCurrentRequestPost: true })).toBe(
        'Set in chain: B (post)'
    );
  });

  it('does not infinite loop on cyclic depends', () => {
    const requests = [
      { name: 'A', depends: 'B', preScript: "setVar('a', '1')" },
      { name: 'B', depends: 'A', preScript: "setVar('b', '2')" }
    ];

    // The main thing we care about is that it returns deterministically and doesn't throw.
    const a = findChainVarOriginText('a', 0, requests);
    const b = findChainVarOriginText('b', 1, requests);
    expect(typeof a === 'string' || a === null).toBe(true);
    expect(typeof b === 'string' || b === null).toBe(true);
  });
});
