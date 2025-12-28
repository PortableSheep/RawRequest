import { AssertionResult, Request } from '../../models/http.models';
import { buildConsoleMessage, buildScriptSource, ensureScriptRequest } from './script-utils';

export type ScriptStage = 'pre' | 'post' | 'custom';

export type ScriptRunnerDeps = {
  cleanScript: (script: string) => string;
  recordConsole: (level: 'info' | 'warn' | 'error' | 'debug', source: string, message: string) => void;
  setVariable: (key: string, value: string) => Promise<void>;
};

class AssertionError extends Error {
  readonly isAssertionError = true;
}

export async function runScript(script: string, context: any, stage: ScriptStage, deps: ScriptRunnerDeps): Promise<AssertionResult[]> {
  if (!script || !script.trim()) {
    return [];
  }

  const assertions: AssertionResult[] = [];

  try {
    const clean = deps.cleanScript(script).trim();
    if (!clean) {
      return [];
    }

    const scriptContext = context || {};
    scriptContext.variables = scriptContext.variables || {};
    scriptContext.assertions = scriptContext.assertions || [];
    const source = buildScriptSource(stage, scriptContext.request as Request | undefined);

    const emitLog = (level: 'info' | 'warn' | 'error' | 'debug', args: any[]) => {
      const message = buildConsoleMessage(args);
      if (!message) {
        return;
      }
      deps.recordConsole(level, source, message);
    };

    const setVar = (key: string, value: any) => {
      if (!key) {
        return;
      }
      const stringValue = String(value ?? '');
      scriptContext.variables[key] = stringValue;
      deps.setVariable(key, stringValue).catch(err => console.error('Failed to sync variable:', err));
    };

    const getVar = (key: string) => {
      if (!key) {
        return '';
      }
      return scriptContext.variables[key] || '';
    };

    const setHeader = (header: string, value: any) => {
      if (!header) {
        return;
      }
      const request = ensureScriptRequest(scriptContext);
      request.headers[header] = String(value ?? '');
    };

    const updateRequest = (patch: Record<string, any>) => {
      if (!patch || typeof patch !== 'object') {
        return;
      }
      const request = ensureScriptRequest(scriptContext);
      Object.entries(patch).forEach(([key, val]) => {
        if (key === 'headers' && val && typeof val === 'object') {
          Object.entries(val as Record<string, any>).forEach(([headerKey, headerValue]) => {
            request.headers[headerKey] = String(headerValue ?? '');
          });
          return;
        }
        (request as any)[key] = val;
      });
    };

    const recordAssertion = (passed: boolean, message: string) => {
      const entry: AssertionResult = { passed, message, stage };
      assertions.push(entry);
      scriptContext.assertions.push(entry);
    };

    const assertFn = (condition: any, message?: string) => {
      const passed = Boolean(condition);
      if (passed) {
        const msg = (message && String(message)) || 'Assertion passed';
        recordAssertion(true, msg);
        return;
      }
      const msg = (message && String(message)) || 'Assertion failed';
      recordAssertion(false, msg);
      throw new AssertionError(msg);
    };

    const delayFn = (duration: any) => {
      const parsed = Number(duration);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return Promise.resolve();
      }
      return new Promise<void>(resolve => setTimeout(resolve, parsed));
    };

    const consoleProxy = {
      log: (...args: any[]) => emitLog('info', args),
      info: (...args: any[]) => emitLog('info', args),
      warn: (...args: any[]) => emitLog('warn', args),
      error: (...args: any[]) => emitLog('error', args),
      debug: (...args: any[]) => emitLog('debug', args)
    };

    // Extract response and request from context for direct access in scripts
    const response = scriptContext.response || {};
    const request = scriptContext.request || {};

    const func = new Function(
      'context',
      'setVar',
      'getVar',
      'console',
      'setHeader',
      'updateRequest',
      'assert',
      'delay',
      'response',
      'request',
      clean
    );

    const result = func(
      scriptContext,
      setVar,
      getVar,
      consoleProxy,
      setHeader,
      updateRequest,
      assertFn,
      delayFn,
      response,
      request
    );

    if (result instanceof Promise) {
      await result;
    }
  } catch (error: any) {
    // Assertion failures already emitted a log line; don't duplicate as a generic runtime error.
    if (!error?.isAssertionError) {
      console.error('Script execution error:', error);
      const message = error?.message || String(error);
      const source = buildScriptSource(stage, context?.request as Request | undefined);
      deps.recordConsole('error', source, `runtime error: ${message}`);
    }
  }

  return assertions;
}
