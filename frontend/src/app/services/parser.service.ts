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
    let currentSection = '';
    let inRequest = false;
    let requestBody = '';
    let inBody = false;
    let pendingMetadata: { name?: string, depends?: string, loadTest?: any, options?: { timeout?: number } } = {};
    let fileDisplayName: string | undefined;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#') || line.startsWith('//')) {
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
            assertions: [],
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

      // Check for scripts
      if (inRequest && (line.startsWith('>') || line.startsWith('<'))) {
        const result = this.extractScript(lines, i);
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

      // Check for assertions
      if (inRequest && line.startsWith('???')) {
        const assertion = this.parseAssertion(line);
        if (assertion) {
          currentRequest!.assertions!.push(assertion);
        }
        i++;
        continue;
      }

      // Check for body start (empty line or JSON/array start)
      if (inRequest && (line === '' || line.trim().startsWith('{') || line.trim().startsWith('['))) {
        inBody = true;
        if (line.trim()) {
          // If the line is not empty, it's the start of the body
          requestBody += line + '\n';
        }
        i++;
        continue;
      }

      // Add to body
      if (inRequest && inBody) {
        requestBody += line + '\n';
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

  private parseAssertion(line: string): any {
    // Basic assertion parsing - can be expanded
    const match = line.match(/\?\?\?\s*(.+)/);
    if (match) {
      return {
        type: 'status',
        operator: '==',
        expected: match[1]
      };
    }
    return null;
  }

  private parseLoadConfig(configStr: string): any {
    const config: any = {};

    // Parse key=value pairs
    const pairs = configStr.match(/(\w+)=(\S+)/g);
    if (pairs) {
      pairs.forEach(pair => {
        const [key, value] = pair.split('=');
        if (key === 'concurrent' || key === 'iterations' || key === 'start' || key === 'max' || key === 'requestsPerSecond') {
          config[key] = parseInt(value, 10);
        } else {
          config[key] = value;
        }
      });
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