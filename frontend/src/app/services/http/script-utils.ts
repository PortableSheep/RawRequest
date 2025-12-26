import { Request } from '../../models/http.models';

export function ensureScriptRequest(context: any): { headers: Record<string, string> } & Record<string, any> {
  if (!context.request) {
    context.request = { headers: {} };
  }
  if (!context.request.headers) {
    context.request.headers = {};
  }
  return context.request;
}

export function buildScriptSource(stage: string, request?: Request): string {
  const prefix = stage || 'script';
  if (!request) {
    return prefix;
  }
  if (request.name) {
    return `${prefix}:${request.name}`;
  }
  if (request.method && request.url) {
    return `${prefix}:${request.method} ${request.url}`;
  }
  if (request.method) {
    return `${prefix}:${request.method}`;
  }
  return prefix;
}

export function buildConsoleMessage(args: any[]): string {
  if (!args || !args.length) {
    return '';
  }
  return args
    .map(arg => {
      if (arg == null) {
        return '';
      }
      if (typeof arg === 'string') {
        return arg;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return '[object]';
        }
      }
      return String(arg);
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}
