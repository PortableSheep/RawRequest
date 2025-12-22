import { Injectable } from '@angular/core';
import { Request } from '../models/http.models';

export interface ParsedHttpFile {
  requests: Request[];
  environments: { [env: string]: { [key: string]: string } };
  variables: { [key: string]: string };
  groups: string[];
  fileDisplayName?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ParserService {
  parseHttpFile(content: string): ParsedHttpFile {
    const lines = content.split('\n');
    const requests: Request[] = [];
    const environments: { [env: string]: { [key: string]: string } } = {};
    const variables: { [key: string]: string } = {};
    const groups: string[] = [];

    let currentRequest: Partial<Request> | null = null;
    let inRequest = false;
    let requestBody = '';
    let inBody = false;
    let pendingMetadata: { name?: string, depends?: string, loadTest?: any, options?: { timeout?: number } } = {};
    let fileDisplayName: string | undefined;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip comments (but NOT empty lines - those are significant for body detection)
      if (line.startsWith('#') || line.startsWith('//')) {
        i++;
        continue;
      }

      // Handle empty lines - they can mark the start of body content
      if (!line) {
        if (inRequest && !inBody) {
          // Empty line after headers marks start of body section
          inBody = true;
        } else if (inRequest && inBody) {
          // Empty line within body - preserve it
          requestBody += '\n';
        }
        i++;
        continue;
      }

      // Check for environment variables with format: @env.{environmentName}.{key} {value}
      if (line.startsWith('@env.')) {
        const envMatch = line.match(/^@env\.(\w+)\.(\w+)\s+(.+)$/);
        if (envMatch) {
          const envName = envMatch[1];
          const key = envMatch[2];
          const value = envMatch[3];

          // Initialize environment object if it doesn't exist
          if (!environments[envName]) {
            environments[envName] = {};
          }

          // Store the key-value pair for this environment
          environments[envName][key] = value;
        }
        i++;
        continue;
      }

      // Check for request metadata annotations (before HTTP method)
      if (line.startsWith('@tab ')) {
        fileDisplayName = this.normalizeDisplayName(line.substring(5));
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
        pendingMetadata.loadTest = this.parseLoadConfig(line.substring(6).trim());
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

      // Check for variables
      if (line.startsWith('@')) {
        const varMatch = line.match(/^@(\w+)\s*=?\s*(.*)$/);
        if (varMatch) {
          if (varMatch[2]) {
            variables[varMatch[1]] = varMatch[2];
          } else {
            variables[varMatch[1]] = '';
          }
        }
        i++;
        continue;
      }

      // Check for HTTP method (start of request)
      if (line.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i)) {
        // Save previous request if exists
        if (currentRequest && currentRequest.method) {
          if (requestBody.trim()) {
            currentRequest.body = requestBody.trim();
          }
          requests.push(currentRequest as Request);
        }

        // Start new request
        const methodMatch = line.match(/^(\w+)\s+(.+)$/);
        if (methodMatch) {
          currentRequest = {
            method: methodMatch[1].toUpperCase(),
            url: methodMatch[2],
            headers: {},
            ...pendingMetadata
          };
          pendingMetadata = {}; // Reset pending metadata
          inRequest = true;
          inBody = false;
          requestBody = '';
        }
        i++;
        continue;
      }

      // Check for request metadata
      if (inRequest && line.startsWith('###')) {
        const metaMatch = line.match(/^###\s*(.+?)\s*###$/);
        if (metaMatch) {
          const meta = metaMatch[1];
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
            fileDisplayName = this.normalizeDisplayName(meta.substring(4));
          }
        }
        i++;
        continue;
      }

      // Check for headers
      if (inRequest && line.includes(':') && !inBody) {
        const headerMatch = line.match(/^([^:]+):\s*(.+)$/);
        if (headerMatch) {
          currentRequest!.headers![headerMatch[1]] = headerMatch[2];
        }
        i++;
        continue;
      }

      // Check for scripts - must be < or > followed by { on same line or next line
      // This prevents XML bodies like <?xml or <root> from being parsed as scripts
      if (inRequest && (line === '<' || line === '>' || line.match(/^[<>]\s*\{/))) {
        const result = this.extractScript(lines, i);
        if (result.script) {
          if (line.startsWith('<')) {
            // Pre-script
            currentRequest!.preScript = result.script;
          } else if (line.startsWith('>')) {
            // Post-script
            currentRequest!.postScript = result.script;
          }
          i += result.linesConsumed;
          continue;
        }
      }

      // Check for body start - content that's not a header starts body mode
      if (inRequest && !inBody) {
        // If we're still in request but line doesn't look like a header, it's body content
        // Headers must have "Key: Value" format
        const looksLikeHeader = line.match(/^[A-Za-z][\w-]*:\s*.+$/);
        if (!looksLikeHeader) {
          inBody = true;
          requestBody += lines[i] + '\n';  // Use original line, not trimmed
          i++;
          continue;
        }
      }

      // Add to body
      if (inRequest && inBody) {
        requestBody += lines[i] + '\n';  // Use original line to preserve indentation
      }
      i++;
    }

    // Save last request
    if (currentRequest && currentRequest.method) {
      if (requestBody.trim()) {
        currentRequest.body = requestBody.trim();
      }
      requests.push(currentRequest as Request);
    }

    return { requests, environments, variables, groups, fileDisplayName };
  }

  private extractScript(lines: string[], startIndex: number): { script: string, linesConsumed: number } {
    let script = '';
    let braceCount = 0;
    let inScript = false;
    let linesConsumed = 0;
    const firstLine = lines[startIndex].trim();

    // Verify this is actually a script block:
    // Must be < or > followed by { on same line, OR standalone < or > with { on next line
    const hasBraceOnFirstLine = firstLine.match(/^[<>]\s*\{/);
    const isStandaloneMarker = firstLine === '<' || firstLine === '>';
    const nextLine = startIndex + 1 < lines.length ? lines[startIndex + 1].trim() : '';
    const nextLineStartsWithBrace = nextLine.startsWith('{');

    if (!hasBraceOnFirstLine && !(isStandaloneMarker && nextLineStartsWithBrace)) {
      // Not a valid script block (probably XML or other content)
      return { script: '', linesConsumed: 0 };
    }

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      linesConsumed++;

      if (line.includes('{')) {
        inScript = true;
        braceCount += (line.match(/{/g) || []).length;
      }

      if (inScript) {
        script += line + '\n';
        braceCount -= (line.match(/}/g) || []).length;

        if (braceCount <= 0) {
          break;
        }
      }
    }

    return { script: script.trim(), linesConsumed };
  }

  private parseLoadConfig(configStr: string): any {
    const config: any = {};
    const source = (configStr || '').trim();
    if (!source.length) {
      return config;
    }

    const normalizeKey = (raw: string): string => {
      const k = (raw || '').trim().toLowerCase();
      const map: Record<string, string> = {
        // concurrency
        concurrency: 'concurrent',
        concurrent: 'concurrent',
        users: 'concurrent',
        user: 'concurrent',
        u: 'concurrent',

        // total work
        amount: 'iterations',
        requests: 'iterations',
        requestcount: 'iterations',
        iterations: 'iterations',
        count: 'iterations',

        // runtime
        runtime: 'duration',
        duration: 'duration',
        time: 'duration',

        // pacing
        delay: 'delay',
        wait: 'delay',
        waittime: 'delay',
        thinktime: 'delay',
        minwait: 'waitMin',
        waitmin: 'waitMin',
        maxwait: 'waitMax',
        waitmax: 'waitMax',

        // ramp
        ramp: 'rampUp',
        rampup: 'rampUp',
        spawnrate: 'spawnRate',
        spawn_rate: 'spawnRate',
        r: 'spawnRate',

        // users range
        start: 'start',
        startusers: 'startUsers',
        max: 'max',
        maxusers: 'maxUsers',

        // global throttle
        rps: 'requestsPerSecond',
        requestspersecond: 'requestsPerSecond',

        // early abort
        failureratethreshold: 'failureRateThreshold',
        failurethreshold: 'failureRateThreshold',
        failthreshold: 'failureRateThreshold',
        failrate: 'failureRateThreshold',
        maxfailurerate: 'failureRateThreshold',
        maxfailure: 'failureRateThreshold',
        failpct: 'failureRateThreshold',
        failurepct: 'failureRateThreshold',
      };
      return map[k] || raw.trim();
    };

    const shouldParseInt = (key: string): boolean => {
      return ['concurrent', 'iterations', 'start', 'max', 'spawnRate', 'requestsPerSecond'].includes(key);
    };

    // Match key=value pairs where value may be quoted or unquoted.
    // Examples:
    //   users=10 iterations=200 duration=30s delay=250ms
    //   waitMin="100ms" waitMax='500ms'
    const pairRx = /([A-Za-z_][\w-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,]+)\s*(?:,|\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = pairRx.exec(source)) !== null) {
      const rawKey = match[1];
      let rawValue = match[2] ?? '';
      rawValue = rawValue.trim();
      if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
        rawValue = rawValue.substring(1, rawValue.length - 1);
      }

      const key = normalizeKey(rawKey);
      if (shouldParseInt(key)) {
        const n = parseInt(rawValue, 10);
        if (!isNaN(n)) {
          config[key] = n;
        } else {
          config[key] = rawValue;
        }
      } else {
        config[key] = rawValue;
      }
    }

    return config;
  }

  private normalizeDisplayName(value: string): string {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return '';
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
      return trimmed.substring(1, trimmed.length - 1).trim();
    }
    return trimmed;
  }
}