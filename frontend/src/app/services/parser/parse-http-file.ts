import { Request } from '../../models/http.models';
import { parseLoadConfig } from './load-config';
import { extractScript } from './script-block';
import { isSeparatorLine, METHOD_LINE_REGEX } from '../../utils/http-file-analysis';

function normalizeDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return '';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.substring(1, trimmed.length - 1).trim();
  }
  return trimmed;
}

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

  const finalizeCurrentRequest = () => {
    if (!currentRequest || !currentRequest.method) return;
    if (requestBody.trim()) {
      currentRequest.body = requestBody.trim();
    }
    requests.push(currentRequest as Request);
    currentRequest = null;
    inRequest = false;
    inBody = false;
    requestBody = '';
  };

  const applySeparatorMeta = (meta: string) => {
    if (!meta) return;

    const applyTo = inRequest && currentRequest ? currentRequest : pendingMetadata;

    if (meta.startsWith('name:')) {
      if (applyTo === pendingMetadata) {
        pendingMetadata.name = meta.substring(5).trim();
      } else {
        (applyTo as Partial<Request>).name = meta.substring(5).trim();
      }
      return;
    }
    if (meta.startsWith('group:')) {
      const group = meta.substring(6).trim();
      if (applyTo === pendingMetadata) {
        (pendingMetadata as any).group = group;
      } else {
        (applyTo as Partial<Request>).group = group;
      }
      if (group && !groups.includes(group)) {
        groups.push(group);
      }
      return;
    }
    if (meta.startsWith('depends:')) {
      if (applyTo === pendingMetadata) {
        pendingMetadata.depends = meta.substring(8).trim();
      } else {
        (applyTo as Partial<Request>).depends = meta.substring(8).trim();
      }
      return;
    }
    if (meta.startsWith('tab:')) {
      fileDisplayName = normalizeName(meta.substring(4));
      return;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Separator lines (### ...) delimit requests. They can also carry optional metadata.
    if (isSeparatorLine(rawLine)) {
      const metaMatch = line.match(/^###\s*(.+?)\s*###$/);
      const meta = metaMatch
        ? metaMatch[1]
        : line.replace(/^###\s*/, '').replace(/\s*###$/, '').trim();

      applySeparatorMeta(meta);
      if (inRequest) {
        finalizeCurrentRequest();
      }
      i++;
      continue;
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

    if (METHOD_LINE_REGEX.test(line)) {
      // Enforce a single request line per block: once a request starts, another method line
      // must be separated by a real separator line (### ...) or be commented out.
      if (inRequest) {
        i++;
        continue;
      }

      const methodMatch = line.match(/^(\w+)\s+(.+)$/);
      if (methodMatch) {
        currentRequest = {
          method: methodMatch[1].toUpperCase(),
          url: methodMatch[2],
          headers: {},
          ...(pendingMetadata as any)
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
        requestBody += rawLine + '\n';
        i++;
        continue;
      }
    }

    if (inRequest && inBody) {
      requestBody += rawLine + '\n';
    }
    i++;
  }

  finalizeCurrentRequest();

  return { requests, environments, variables, groups, fileDisplayName };
}
