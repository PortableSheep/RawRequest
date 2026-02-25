import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { LRLanguage, LanguageSupport } from '@codemirror/language';

import { parser as rawRequestHttpParser } from './rawrequest-http-parser';
import { computeDiagnostics, LintDeps } from './editor.lint';
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

const rawRequestHttpLanguage = LRLanguage.define({ parser: rawRequestHttpParser });
const rawRequestHttpSupport = new LanguageSupport(rawRequestHttpLanguage);

function makeDeps(overrides: Partial<LintDeps> = {}): LintDeps {
  return {
    getRequests: () => [],
    getVariables: () => ({}),
    getEnvironments: () => ({}),
    getCurrentEnv: () => 'default',
    getSecrets: () => ({}),
    getRequestIndexAtPos: () => null,
    ...overrides
  };
}

function lintDoc(doc: string, deps?: Partial<LintDeps>) {
  const state = EditorState.create({ doc, extensions: [rawRequestHttpSupport] });
  return computeDiagnostics({ state } as EditorView, makeDeps(deps));
}

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

describe('structural lint: annotation after method line', () => {
  it('warns when @name appears after the method line', () => {
    const doc = ['GET https://example.com', '@name myReq'].join('\n');
    const diags = lintDoc(doc);
    const match = diags.filter((d) => d.message === 'Annotation should appear before the request method line');
    expect(match).toHaveLength(1);
  });

  it('does NOT warn when @name appears before the method line', () => {
    const doc = ['@name myReq', 'GET https://example.com'].join('\n');
    const diags = lintDoc(doc);
    const match = diags.filter((d) => d.message === 'Annotation should appear before the request method line');
    expect(match).toHaveLength(0);
  });

  it('does NOT warn for @env annotations after the method line', () => {
    const doc = ['GET https://example.com', '@env.dev.baseUrl = https://api.dev.example.com'].join('\n');
    const diags = lintDoc(doc);
    const match = diags.filter((d) => d.message === 'Annotation should appear before the request method line');
    expect(match).toHaveLength(0);
  });
});
