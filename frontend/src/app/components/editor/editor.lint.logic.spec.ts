import {
  buildChainVarsCache,
  buildDependsIndex,
  buildKnownLoadKeysSet,
  buildNameToIndex,
  buildSetVarsByRequest,
  collectDependsCycleDiagnostics,
  collectTimeoutDiagnosticsForLine,
  collectUnknownDependsDiagnostics,
  collectUnknownLoadKeyDiagnosticsForLine,
  collectUnknownVariableDiagnosticsForLine
} from './editor.lint.logic';

describe('editor.lint.logic', () => {
  it('collectUnknownLoadKeyDiagnosticsForLine warns on unknown keys', () => {
    const known = buildKnownLoadKeysSet([{ label: 'users' }, { label: 'rampUp' }]);
    const diags = collectUnknownLoadKeyDiagnosticsForLine({
      lineFrom: 10,
      trimmedStartIndex: 2,
      trimmedText: '@load users=1 banana=2',
      knownLoadKeys: known
    });

    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('banana');
  });

  it('collectTimeoutDiagnosticsForLine flags non-numeric and negative', () => {
    expect(
      collectTimeoutDiagnosticsForLine({ lineFrom: 0, trimmedStartIndex: 0, trimmedText: '@timeout abc' })
    ).toHaveLength(1);
    expect(
      collectTimeoutDiagnosticsForLine({ lineFrom: 0, trimmedStartIndex: 0, trimmedText: '@timeout -1' })
    ).toHaveLength(1);
    expect(
      collectTimeoutDiagnosticsForLine({ lineFrom: 0, trimmedStartIndex: 0, trimmedText: '@timeout 0' })
    ).toEqual([]);
  });

  it('unknown depends diagnostics uses dependsTokenByRequestIndex ranges', () => {
    const requests = [{ name: 'A', depends: 'Missing' }];
    const nameToIndex = buildNameToIndex(requests);
    const diags = collectUnknownDependsDiagnostics({
      requests,
      nameToIndex,
      dependsTokenByRequestIndex: [{ target: 'Missing', from: 5, to: 12 }]
    });

    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(5);
    expect(diags[0].to).toBe(12);
  });

  it('cycle diagnostics flags tokens on cycle nodes', () => {
    const requests = [{ name: 'A', depends: 'B' }, { name: 'B', depends: 'A' }];
    const nameToIndex = buildNameToIndex(requests);
    const dependsIndex = buildDependsIndex(requests, nameToIndex);

    const diags = collectDependsCycleDiagnostics({
      dependsIndex,
      dependsTokenByRequestIndex: [
        { target: 'B', from: 10, to: 11 },
        { target: 'A', from: 20, to: 21 }
      ]
    });

    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags.every((d) => d.message === 'Cyclic @depends chain')).toBe(true);
  });

  it('collectUnknownVariableDiagnosticsForLine respects vars/env/secret/chainVars', () => {
    const requests = [{ name: 'A', preScript: "setVar('fromScript', '1')" }];
    const nameToIndex = buildNameToIndex(requests);
    const dependsIndex = buildDependsIndex(requests, nameToIndex);
    const setVarsByRequest = buildSetVarsByRequest(requests);
    const chainVarsCache = buildChainVarsCache({ requests, dependsIndex, setVarsByRequest });

    const diags = collectUnknownVariableDiagnosticsForLine({
      text: 'GET https://x {{known}} {{env.default.defaultKey}} {{secret:sk}} {{fromScript}} {{unknown}}',
      lineFrom: 0,
      envName: 'default',
      vars: { known: '1' },
      envs: { default: { defaultKey: 'x' } },
      currentEnvVars: { defaultKey: 'x' },
      secretKeys: new Set(['sk']),
      requestIndexForPlaceholderLine: 0,
      chainVarsCache
    });

    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('unknown');
  });
});
