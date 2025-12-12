import { Injectable, signal } from '@angular/core';
import { ScriptLogEntry } from '../models/http.models';
import { EventsOn } from '../../../wailsjs/runtime/runtime';
import { GetScriptLogs, ClearScriptLogs, RecordScriptLog } from '../../../wailsjs/go/main/App';

const SCRIPT_LOG_EVENT = 'script-log';
const MAX_ENTRIES = 500;

@Injectable({ providedIn: 'root' })
export class ScriptConsoleService {
  private initialized = false;
  private unsubscribe?: () => void;
  readonly logs = signal<ScriptLogEntry[]>([]);

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

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
    try {
      await ClearScriptLogs();
    } catch (error) {
      console.error('[ScriptConsole] Failed to clear logs', error);
    } finally {
      this.logs.set([]);
    }
  }

  async record(level: string, source: string, message: string): Promise<void> {
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
