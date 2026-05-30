import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';

import { findChainVarOriginText } from './editor.chain-vars';
import { isExternalSecretReference } from '../../utils/http-file-analysis';

export type TooltipDeps = {
  getVariables: () => { [key: string]: string };
  getEnvironments: () => { [env: string]: { [key: string]: string } };
  getCurrentEnv: () => string;
  getSecrets: () => Partial<Record<string, string[]>>;
  getResponseData: () => Record<number, any>;

  // Optional: enables chain provenance for variables created via setVar(...) in pre/post scripts.
  getRequests?: () => any[];
  getRequestIndexAtPos?: (state: any, pos: number) => number | null;
};

export function createVariableHoverTooltipExtension(deps: TooltipDeps): Extension {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;

    // Find {{variable}} pattern at the hover position
    const varRegex = /\{\{([^}]+)\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = varRegex.exec(lineText)) !== null) {
      const start = line.from + match.index;
      const end = start + match[0].length;

      // Check if cursor is within this match
      if (pos < start || pos > end) continue;

      const varName = match[1].trim();
      const vars = deps.getVariables();
      const envs = deps.getEnvironments();
      const currentEnvName = deps.getCurrentEnv();
      const secrets = deps.getSecrets() || {};
      const currentEnvVars = currentEnvName ? envs[currentEnvName] || {} : {};
      const responseData = deps.getResponseData() || [];

      const requestIndex = deps.getRequests && deps.getRequestIndexAtPos
        ? deps.getRequestIndexAtPos(view.state as any, start)
        : null;
      const chainOrigin = requestIndex !== null && deps.getRequests
        ? findChainVarOriginText(varName, requestIndex, deps.getRequests())
        : null;

      // Check if it's a regular variable
      if (vars[varName] !== undefined) {
        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip';
            const value = vars[varName];
            const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
            dom.innerHTML = `
              <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--var"></span>Variable</div>
              <div class="tooltip-name">${escapeHtml(varName)}</div>
              <div class="tooltip-value">${escapeHtml(displayValue)}</div>
              ${chainOrigin ? `<div class="tooltip-hint">${escapeHtml(chainOrigin)}</div>` : ''}
            `;
            return { dom };
          }
        };
      }

      // Check if it's defined in the current environment
      if (currentEnvVars[varName] !== undefined) {
        const value = currentEnvVars[varName];
        const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip';
            dom.innerHTML = `
              <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--env"></span>Environment Variable</div>
              <div class="tooltip-name">${escapeHtml(currentEnvName)} → ${escapeHtml(varName)}</div>
              <div class="tooltip-value">${escapeHtml(displayValue)}</div>
            `;
            return { dom };
          }
        };
      }

      // Check if it's an env.name.key pattern
      const envMatch = varName.match(/^env\.([^.]+)\.(.+)$/);
      if (envMatch) {
        const [, envName, key] = envMatch;
        if (envs[envName]?.[key] !== undefined) {
          return {
            pos: start,
            end: end,
            above: true,
            create() {
              const dom = document.createElement('div');
              dom.className = 'cm-variable-tooltip';
              const value = envs[envName][key];
              const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
              dom.innerHTML = `
                <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--env"></span>Environment Variable</div>
                <div class="tooltip-name">${escapeHtml(envName)} → ${escapeHtml(key)}</div>
                <div class="tooltip-value">${escapeHtml(displayValue)}</div>
              `;
              return { dom };
            }
          };
        }
      }

      // Check if it's a secret reference (don't reveal value)
      const secretMatch = varName.match(/^secret:(.+)$/);
      if (secretMatch) {
        const secretKey = secretMatch[1].trim();
        const isExternalRef = isExternalSecretReference(secretKey);
        const env = (currentEnvName || 'default').trim() || 'default';
        const keys = new Set<string>([...(secrets[env] || []), ...(secrets['default'] || [])]);
        const exists = isExternalRef || keys.has(secretKey);
        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip' + (exists ? '' : ' cm-variable-undefined');
            dom.innerHTML = `
              <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--secret"></span>Secret</div>
              <div class="tooltip-name">${escapeHtml(secretKey)}</div>
              <div class="tooltip-hint">${isExternalRef ? 'Resolved at runtime via external provider' : exists ? 'Resolved at runtime from vault' : 'Missing secret in current environment'}</div>
            `;
            return { dom };
          }
        };
      }

      // Check if it's a request reference
      const reqMatch = varName.match(/^(request(\d+))\.(response\.(body|status|headers|json|timing|size).*)/);
      if (reqMatch) {
        const reqNum = parseInt(reqMatch[2], 10);
        const reqIdx = reqNum - 1;
        const resPath = reqMatch[3];
        const liveValue = resolveResponseValue(responseData[reqIdx], resPath);

        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip';
            const displayValue = liveValue !== undefined ? String(liveValue) : 'Not executed yet';
            const displayValueTruncated = displayValue.length > 150 ? displayValue.slice(0, 150) + '...' : displayValue;

            dom.innerHTML = `
              <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--link"></span>Request Reference</div>
              <div class="tooltip-name">${escapeHtml(reqMatch[1])}.${escapeHtml(reqMatch[3])}</div>
              <div class="tooltip-value">${escapeHtml(displayValueTruncated)}</div>
              <div class="tooltip-hint">Value from last execution</div>
            `;
            return { dom };
          }
        };
      }

      // Variable isn't defined yet, but will be created by setVar(...) earlier in the chain.
      if (chainOrigin) {
        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip';
            dom.innerHTML = `
              <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--link"></span>Chain Variable</div>
              <div class="tooltip-name">${escapeHtml(varName)}</div>
              <div class="tooltip-hint">${escapeHtml(chainOrigin)}</div>
            `;
            return { dom };
          }
        };
      }

      // Unknown variable
      return {
        pos: start,
        end: end,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-variable-tooltip cm-variable-undefined';
          dom.innerHTML = `
            <div class="tooltip-header"><span class="tooltip-icon tooltip-icon--warn"></span>Undefined Variable</div>
            <div class="tooltip-name">${escapeHtml(varName)}</div>
            <div class="tooltip-hint">This variable is not defined</div>
          `;
          return { dom };
        }
      };
    }

    return null;
  }, { hoverTime: 300 });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resolveResponseValue(responseData: any, path: string): any {
  if (!responseData) return undefined;
  
  const parts = path.split('.');
  // Shift off 'response' if present (which it should be based on regex)
  if (parts[0] === 'response') parts.shift();
  
  let current = responseData;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    
    // Handle 'json' specially if it's a string that needs parsing
    if (part === 'json' && typeof current.body === 'string' && !current.json) {
       try {
         current.json = JSON.parse(current.body);
       } catch {
         return undefined;
       }
    }
    
    current = current[part];
  }
  
  if (typeof current === 'object' && current !== null) {
    return JSON.stringify(current);
  }
  
  return current;
}
