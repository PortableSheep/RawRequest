import { Injectable, signal } from '@angular/core';
import { ScriptLogEntry } from '../models/http.models';
import { EventsOn } from '../../../wailsjs/runtime/runtime';
import { GetScriptLogs, ClearScriptLogs, RecordScriptLog } from '@wailsjs/go/main/App';

const SCRIPT_LOG_EVENT = 'script-log';
const MAX_ENTRIES = 500;

@Injectable({ providedIn: 'root' })
export class ScriptConsoleService {
  private initialized = false;
  private unsubscribe?: () => void;
  readonly logs = signal<ScriptLogEntry[]>([]);

  private hasWailsBindings(): boolean {
    const g: any = globalThis as any;
    // Wails Go bindings are usually exposed under `window.go.*`.
    if (!g || !g.go?.main?.App) {
      return false;
    }
    // Wails runtime bindings live under `window.runtime`.
    if (!g.runtime) {
      return false;
    }
    return true;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    // In unit tests / non-Wails browser contexts, skip wiring.
    if (!this.hasWailsBindings()) {
      return;
    }

    try {
      const entries = await GetScriptLogs() as ScriptLogEntry[];
      if (Array.isArray(entries) && entries.length) {
        this.logs.set(entries);
      }
    } catch (error) {
      console.error('[ScriptConsole] Failed to fetch existing logs', error);
    }

    this.unsubscribe = EventsOn(SCRIPT_LOG_EVENT, (entry: ScriptLogEntry) => {
      if (!entry) {
        return;
      }
      this.logs.update(current => {
        const next = [...current, entry];
        if (next.length > MAX_ENTRIES) {
          next.splice(0, next.length - MAX_ENTRIES);
        }
        return next;
      });
    });
  }

  async clear(): Promise<void> {
    if (!this.hasWailsBindings()) {
      this.logs.set([]);
      return;
    }
    try {
      await ClearScriptLogs();
    } catch (error) {
      console.error('[ScriptConsole] Failed to clear logs', error);
    } finally {
      this.logs.set([]);
    }
  }

  async record(level: string, source: string, message: string): Promise<void> {
    if (!this.hasWailsBindings()) {
      return;
    }
    try {
      await RecordScriptLog(level, source, message);
    } catch (error) {
      console.error('[ScriptConsole] Failed to record log entry', error);
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.initialized = false;
    this.logs.set([]);
  }
}
