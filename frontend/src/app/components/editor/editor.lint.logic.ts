import type { Diagnostic } from '@codemirror/lint';

import {
  extractPlaceholders,
  extractSetVarKeys,
  ENV_PLACEHOLDER_REGEX,
  REQUEST_REF_PLACEHOLDER_REGEX,
  SECRET_PLACEHOLDER_REGEX
} from '../../utils/http-file-analysis';

export function buildKnownLoadKeysSet(keys: ReadonlyArray<{ label: string }>): Set<string> {
  return new Set<string>(keys.map((k) => String(k.label).toLowerCase()));
}

export function buildNameToIndex(requests: any[]): Map<string, number> {
  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < requests.length; i++) {
    const name = String(requests[i]?.name || '').trim();
    if (name) nameToIndex.set(name, i);
  }
  return nameToIndex;
}

export function buildDependsIndex(requests: any[], nameToIndex: Map<string, number>): Array<number | null> {
  return requests.map((r: any) => {
    const dependsName = String(r?.depends || '').trim();
    if (!dependsName) return null;
    return nameToIndex.get(dependsName) ?? null;
  });
}

export function buildSetVarsByRequest(requests: any[]): Array<Set<string>> {
  return requests.map((r: any) => {
    const keys = new Set<string>();
    for (const k of extractSetVarKeys(String(r?.preScript || ''))) keys.add(k);
    for (const k of extractSetVarKeys(String(r?.postScript || ''))) keys.add(k);
    return keys;
  });
}

export function buildChainVarsCache(params: {
  requests: any[];
  dependsIndex: Array<number | null>;
  setVarsByRequest: Array<Set<string>>;
}): Array<Set<string>> {
  const { requests, dependsIndex, setVarsByRequest } = params;
  const chainVarsCache: Array<Set<string>> = requests.map(() => new Set<string>());
  const chainStack = new Set<number>();

  const buildChainVars = (idx: number): Set<string> => {
    if (chainVarsCache[idx].size) return chainVarsCache[idx];
    if (chainStack.has(idx)) return chainVarsCache[idx];

    chainStack.add(idx);
    const result = new Set<string>();

    const dep = dependsIndex[idx];
    if (dep !== null && dep !== undefined) {
      const depVars = buildChainVars(dep);
      for (const k of depVars) result.add(k);
      for (const k of setVarsByRequest[dep] || []) result.add(k);
    }

    for (const k of extractSetVarKeys(String(requests[idx]?.preScript || ''))) result.add(k);

    chainVarsCache[idx] = result;
    chainStack.delete(idx);
    return result;
  };

  for (let i = 0; i < requests.length; i++) buildChainVars(i);
  return chainVarsCache;
}

export function collectUnknownLoadKeyDiagnosticsForLine(params: {
  lineFrom: number;
  trimmedStartIndex: number;
  trimmedText: string;
  knownLoadKeys: Set<string>;
}): Diagnostic[] {
  const trimmedLower = params.trimmedText.toLowerCase();
  if (!trimmedLower.startsWith('@load')) return [];

  const after = params.trimmedText.slice('@load'.length);
  const tokenRx = /([A-Za-z_][\w-]*)\s*=/g;
  const diagnostics: Diagnostic[] = [];

  let m: RegExpExecArray | null;
  while ((m = tokenRx.exec(after)) !== null) {
    const key = m[1] || '';
    if (!key) continue;
    if (params.knownLoadKeys.has(key.toLowerCase())) continue;

    const from = params.lineFrom + params.trimmedStartIndex + '@load'.length + m.index;
    const to = from + key.length;
    diagnostics.push({ from, to, severity: 'warning', message: `Unknown @load key "${key}"` });
  }

  return diagnostics;
}

export function collectTimeoutDiagnosticsForLine(params: {
  lineFrom: number;
  trimmedStartIndex: number;
  trimmedText: string;
}): Diagnostic[] {
  const trimmedLower = params.trimmedText.toLowerCase();
  if (!trimmedLower.startsWith('@timeout')) return [];

  const match = params.trimmedText.match(/^@timeout\s+([^\s#]+)?/i);
  const token = String(match?.[1] ?? '').trim();
  if (!token) return [];

  const n = Number(token);
  if (Number.isFinite(n) && n >= 0) return [];

  const tokenStartInTrimmed = trimmedLower.indexOf('@timeout') + '@timeout'.length;
  const afterTimeout = params.trimmedText.slice(tokenStartInTrimmed);
  const leading = afterTimeout.match(/^\s*/)?.[0].length ?? 0;
  const start = params.lineFrom + params.trimmedStartIndex + tokenStartInTrimmed + leading;

  return [
    {
      from: start,
      to: start + token.length,
      severity: 'warning',
      message: 'Invalid @timeout value (expected non-negative number)'
    }
  ];
}

export type DependsToken = { target: string; from: number; to: number };

export function collectUnknownDependsDiagnostics(params: {
  requests: any[];
  nameToIndex: Map<string, number>;
  dependsTokenByRequestIndex: Array<DependsToken | null>;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < params.requests.length; i++) {
    const dependsName = String(params.requests[i]?.depends || '').trim();
    if (!dependsName) continue;
    if (params.nameToIndex.has(dependsName)) continue;

    const token = params.dependsTokenByRequestIndex[i];
    const from = token?.from ?? 0;
    const to = token?.to ?? 0;
    if (from && to && to > from) {
      diagnostics.push({ from, to, severity: 'error', message: `Unknown @depends target "${dependsName}"` });
    }
  }

  return diagnostics;
}

export function collectDependsCycleDiagnostics(params: {
  dependsIndex: Array<number | null>;
  dependsTokenByRequestIndex: Array<DependsToken | null>;
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visiting = new Set<number>();
  const visited = new Set<number>();

  const dfs = (node: number): boolean => {
    if (visited.has(node)) return false;
    if (visiting.has(node)) return true;

    visiting.add(node);
    const next = params.dependsIndex[node];
    if (next !== null && next !== undefined) {
      if (dfs(next)) {
        const token = params.dependsTokenByRequestIndex[node];
        if (token && token.to > token.from) {
          diagnostics.push({ from: token.from, to: token.to, severity: 'error', message: 'Cyclic @depends chain' });
        }
        visiting.delete(node);
        visited.add(node);
        return true;
      }
    }

    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (let i = 0; i < params.dependsIndex.length; i++) {
    dfs(i);
  }

  return diagnostics;
}

export function collectUnknownVariableDiagnosticsForLine(params: {
  text: string;
  lineFrom: number;
  envName: string;
  vars: Record<string, string>;
  envs: Record<string, Record<string, string>>;
  currentEnvVars: Record<string, string>;
  secretKeys: Set<string>;
  requestIndexForPlaceholderLine: number | null;
  chainVarsCache: Array<Set<string>>;
}): Diagnostic[] {
  const placeholders = extractPlaceholders(params.text);
  if (!placeholders.length) return [];

  const diagnostics: Diagnostic[] = [];

  for (const ph of placeholders) {
    const inner = ph.inner;
    const from = params.lineFrom + ph.start;
    const to = params.lineFrom + ph.end;

    if (REQUEST_REF_PLACEHOLDER_REGEX.test(inner)) continue;

    const secretMatch = inner.match(SECRET_PLACEHOLDER_REGEX);
    if (secretMatch) {
      const key = secretMatch[1];
      if (params.secretKeys.has(key)) continue;
      diagnostics.push({
        from,
        to,
        severity: 'warning',
        message: `Unknown secret "${key}" for environment "${params.envName}"`
      });
      continue;
    }

    const envMatch = inner.match(ENV_PLACEHOLDER_REGEX);
    if (envMatch) {
      const [, e, k] = envMatch;
      if (params.envs?.[e]?.[k] !== undefined) continue;
      diagnostics.push({ from, to, severity: 'warning', message: `Unknown env var "${e}.${k}"` });
      continue;
    }

    if (params.vars[inner] !== undefined) continue;
    if (params.currentEnvVars[inner] !== undefined) continue;

    if (
      params.requestIndexForPlaceholderLine !== null &&
      params.requestIndexForPlaceholderLine >= 0 &&
      params.requestIndexForPlaceholderLine < params.chainVarsCache.length
    ) {
      if (params.chainVarsCache[params.requestIndexForPlaceholderLine].has(inner)) continue;
    }

    diagnostics.push({ from, to, severity: 'warning', message: `Unknown variable "${inner}"` });
  }

  return diagnostics;
}
