import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';

import { findChainVarOriginText } from './editor.chain-vars';

export type TooltipDeps = {
  getVariables: () => { [key: string]: string };
  getEnvironments: () => { [env: string]: { [key: string]: string } };
  getCurrentEnv: () => string;
  getSecrets: () => Partial<Record<string, string[]>>;

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
              <div class="tooltip-header">📦 Variable</div>
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
              <div class="tooltip-header">🌍 Environment Variable</div>
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
                <div class="tooltip-header">🌍 Environment Variable</div>
                <div class="tooltip-name">${escapeHtml(envName)} → ${escapeHtml(key)}</div>
                <div class="tooltip-value">${escapeHtml(displayValue)}</div>
              `;
              return { dom };
            }
          };
        }
      }

      // Check if it's a secret reference (don't reveal value)
      const secretMatch = varName.match(/^secret:([a-zA-Z0-9_\-\.]+)$/);
      if (secretMatch) {
        const secretKey = secretMatch[1];
        const env = (currentEnvName || 'default').trim() || 'default';
        const keys = new Set<string>([...(secrets[env] || []), ...(secrets['default'] || [])]);
        const exists = keys.has(secretKey);
        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip' + (exists ? '' : ' cm-variable-undefined');
            dom.innerHTML = `
              <div class="tooltip-header">🔐 Secret</div>
              <div class="tooltip-name">${escapeHtml(secretKey)}</div>
              <div class="tooltip-hint">${exists ? 'Resolved at runtime from vault' : 'Missing secret in current environment'}</div>
            `;
            return { dom };
          }
        };
      }

      // Check if it's a request reference
      const reqMatch = varName.match(/^(request\d+)\.(response\.(body|status|headers|json|timing|size).*)/);
      if (reqMatch) {
        return {
          pos: start,
          end: end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-variable-tooltip';
            dom.innerHTML = `
              <div class="tooltip-header">🔗 Request Reference</div>
              <div class="tooltip-name">${escapeHtml(reqMatch[1])}.${escapeHtml(reqMatch[2])}</div>
              <div class="tooltip-hint">Value resolved at runtime from previous request</div>
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
              <div class="tooltip-header">🔗 Chain Variable</div>
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
            <div class="tooltip-header">⚠️ Undefined Variable</div>
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
