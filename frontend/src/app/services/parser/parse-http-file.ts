import { Request } from '../../models/http.models';
import { parseLoadConfig } from './load-config';
import { normalizeDisplayName } from './display-name';
import { extractScript } from './script-block';

export interface ParsedHttpFile {
  requests: Request[];
  environments: { [env: string]: { [key: string]: string } };
  variables: { [key: string]: string };
  groups: string[];
  fileDisplayName?: string;
}

export type PendingMetadata = {
  name?: string;
  depends?: string;
  loadTest?: any;
  options?: { timeout?: number };
};

export type ParseHttpFileDeps = {
  normalizeDisplayName?: (value: string) => string;
  parseLoadConfig?: (configStr: string) => any;
  extractScript?: (lines: string[], startIndex: number) => { script: string; linesConsumed: number };
};

export function parseHttpFile(content: string, deps: ParseHttpFileDeps = {}): ParsedHttpFile {
  const normalizeName = deps.normalizeDisplayName ?? normalizeDisplayName;
  const parseLoad = deps.parseLoadConfig ?? parseLoadConfig;
  const extract = deps.extractScript ?? extractScript;

  const lines = content.split('\n');
  const requests: Request[] = [];
  const environments: { [env: string]: { [key: string]: string } } = {};
  const variables: { [key: string]: string } = {};
  const groups: string[] = [];

  let currentRequest: Partial<Request> | null = null;
  let inRequest = false;
  let requestBody = '';
  let inBody = false;
  let pendingMetadata: PendingMetadata = {};
  let fileDisplayName: string | undefined;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (inRequest && line.startsWith('###')) {
      const metaMatch = line.match(/^###\s*(.+?)\s*###$/);
      const meta = metaMatch
        ? metaMatch[1]
        : line.replace(/^###\s*/, '').replace(/\s*###$/, '').trim();

      if (meta) {
        if (meta.startsWith('name:')) {
          currentRequest!.name = meta.substring(5).trim();
        } else if (meta.startsWith('group:')) {
          currentRequest!.group = meta.substring(6).trim();
          if (!groups.includes(currentRequest!.group!)) {
            groups.push(currentRequest!.group!);
          }
        } else if (meta.startsWith('depends:')) {
          currentRequest!.depends = meta.substring(8).trim();
        } else if (meta.startsWith('tab:')) {
          fileDisplayName = normalizeName(meta.substring(4));
        }

        if (
          meta.startsWith('name:') ||
          meta.startsWith('group:') ||
          meta.startsWith('depends:') ||
          meta.startsWith('tab:')
        ) {
          i++;
          continue;
        }
      }
    }

    if (line.startsWith('#') || line.startsWith('//')) {
      i++;
      continue;
    }

    if (!line) {
      if (inRequest && !inBody) {
        inBody = true;
      } else if (inRequest && inBody) {
        requestBody += '\n';
      }
      i++;
      continue;
    }

    if (line.startsWith('@env.')) {
	  const envMatch = line.match(/^@env\.(\w+)\.(\w+)\s*(?:=|\s+)\s*(.+)$/);
      if (envMatch) {
        const envName = envMatch[1];
        const key = envMatch[2];
        const value = envMatch[3];

        if (!environments[envName]) {
          environments[envName] = {};
        }

        environments[envName][key] = value;
      }
      i++;
      continue;
    }

    if (line.startsWith('@tab ')) {
      fileDisplayName = normalizeName(line.substring(5));
      i++;
      continue;
    }

    if (line.startsWith('@name ')) {
      pendingMetadata.name = line.substring(6).trim();
      i++;
      continue;
    }

    if (line.startsWith('@depends ')) {
      pendingMetadata.depends = line.substring(9).trim();
      i++;
      continue;
    }

    if (line.startsWith('@load ')) {
      pendingMetadata.loadTest = parseLoad(line.substring(6).trim());
      i++;
      continue;
    }

    if (line.startsWith('@timeout ')) {
      const timeoutValue = parseInt(line.substring(9).trim(), 10);
      if (!isNaN(timeoutValue) && timeoutValue > 0) {
        if (!pendingMetadata.options) {
          pendingMetadata.options = {};
        }
        pendingMetadata.options.timeout = timeoutValue;
      }
      i++;
      continue;
    }

    if (line.startsWith('@')) {
      const varMatch = line.match(/^@(\w+)\s*=?\s*(.*)$/);
      if (varMatch) {
        variables[varMatch[1]] = varMatch[2] ? varMatch[2] : '';
      }
      i++;
      continue;
    }

    if (line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i)) {
      if (currentRequest && currentRequest.method) {
        if (requestBody.trim()) {
          currentRequest.body = requestBody.trim();
        }
        requests.push(currentRequest as Request);
      }

      const methodMatch = line.match(/^(\w+)\s+(.+)$/);
      if (methodMatch) {
        currentRequest = {
          method: methodMatch[1].toUpperCase(),
          url: methodMatch[2],
          headers: {},
          ...pendingMetadata,
        };
        pendingMetadata = {};
        inRequest = true;
        inBody = false;
        requestBody = '';
      }
      i++;
      continue;
    }

    if (inRequest && line.includes(':') && !inBody) {
      const headerMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (headerMatch) {
        currentRequest!.headers![headerMatch[1]] = headerMatch[2];
      }
      i++;
      continue;
    }

    if (inRequest && (line === '<' || line === '>' || line.match(/^[<>]\s*\{/))) {
      const result = extract(lines, i);
      if (result.script) {
        if (line.startsWith('<')) {
          currentRequest!.preScript = result.script;
        } else if (line.startsWith('>')) {
          currentRequest!.postScript = result.script;
        }
        i += result.linesConsumed;
        continue;
      }
    }

    if (inRequest && !inBody) {
      const looksLikeHeader = line.match(/^[A-Za-z][\w-]*:\s*.+$/);
      if (!looksLikeHeader) {
        inBody = true;
        requestBody += lines[i] + '\n';
        i++;
        continue;
      }
    }

    if (inRequest && inBody) {
      requestBody += lines[i] + '\n';
    }
    i++;
  }

  if (currentRequest && currentRequest.method) {
    if (requestBody.trim()) {
      currentRequest.body = requestBody.trim();
    }
    requests.push(currentRequest as Request);
  }

  return { requests, environments, variables, groups, fileDisplayName };
}
