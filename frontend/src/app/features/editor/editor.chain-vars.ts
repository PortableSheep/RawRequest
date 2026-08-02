import { extractSetVarKeys } from '../../utils/http-file-analysis';

import { buildDependsIndex, buildNameToIndex } from './editor.lint.logic';

export type ChainVarOrigin = {
  requestIndex: number;
  stage: 'pre' | 'post';
  requestLabel: string;
};

export type ChainVarOriginTextOptions = {
  // Whether to include variables created in the current request's post-script.
  // For placeholders within the same request, this should be false (default).
  includeCurrentRequestPost?: boolean;
};

export function formatChainVarOrigin(origin: ChainVarOrigin): string {
  return `Set in chain: ${origin.requestLabel} (${origin.stage})`;
}

export function findChainVarOrigin(
  varName: string,
  requestIndex: number,
  requests: any[],
  options: ChainVarOriginTextOptions = {}
): ChainVarOrigin | null {
  if (!varName || requestIndex < 0 || requestIndex >= (requests?.length ?? 0)) {
    return null;
  }

  const includeCurrentRequestPost = options.includeCurrentRequestPost === true;

  const nameToIndex = buildNameToIndex(requests);
  const dependsIndex = buildDependsIndex(requests, nameToIndex);

  const requestLabelForIndex = (idx: number): string => {
    const name = String(requests[idx]?.name || '').trim();
    return name || `request${idx + 1}`;
  };

  // Compute dependency chain in execution order: root -> ... -> requestIndex.
  // Guard against cycles with a visited set.
  const chain: number[] = [];
  const visiting = new Set<number>();
  const buildChain = (idx: number) => {
    if (idx < 0 || idx >= requests.length) return;
    if (visiting.has(idx)) return;
    visiting.add(idx);

    const dep = dependsIndex[idx];
    if (dep !== null && dep !== undefined) {
      buildChain(dep);
    }

    chain.push(idx);
  };
  buildChain(requestIndex);

  const setOriginIfMissing = (map: Map<string, ChainVarOrigin>, key: string, origin: ChainVarOrigin) => {
    if (!key) return;
    if (map.has(key)) return;
    map.set(key, origin);
  };

  const addScriptKeys = (map: Map<string, ChainVarOrigin>, idx: number, stage: 'pre' | 'post', script: string) => {
    for (const key of extractSetVarKeys(script || '')) {
      setOriginIfMissing(map, key, {
        requestIndex: idx,
        stage,
        requestLabel: requestLabelForIndex(idx)
      });
    }
  };

  // First definition in the chain wins.
  const originByVar = new Map<string, ChainVarOrigin>();
  for (const idx of chain) {
    addScriptKeys(originByVar, idx, 'pre', String(requests[idx]?.preScript || ''));

    const isCurrent = idx === requestIndex;
    if (!isCurrent || includeCurrentRequestPost) {
      addScriptKeys(originByVar, idx, 'post', String(requests[idx]?.postScript || ''));
    }
  }

  return originByVar.get(varName) ?? null;
}

export function findChainVarOriginText(
  varName: string,
  requestIndex: number,
  requests: any[],
  options: ChainVarOriginTextOptions = {}
): string | null {
  const origin = findChainVarOrigin(varName, requestIndex, requests, options);
  if (!origin) return null;
  return formatChainVarOrigin(origin);
}
