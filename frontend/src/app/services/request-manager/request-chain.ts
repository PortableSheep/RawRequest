import type { Request } from '../../models/http.models';

export function buildRequestChain(requests: Request[], requestIndex: number): Request[] {
  const chain: Request[] = [];
  const visited = new Set<number>();

  const addToChain = (index: number) => {
    if (visited.has(index)) {
      throw new Error('Circular dependency detected in request chain');
    }
    visited.add(index);

    const req = requests[index];
    if (!req) {
      return;
    }

    if (req.depends) {
      const dependsIndex = requests.findIndex(r => r.name === req.depends);
      if (dependsIndex !== -1) {
        addToChain(dependsIndex);
      }
    }

    chain.push(req);
  };

  addToChain(requestIndex);
  return chain;
}
