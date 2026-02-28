import { Injectable, inject, signal } from '@angular/core';
import { ScriptLogEntry } from '../models/http.models';
import { BACKEND_CLIENT } from './backend-client.contract';
import { EventTransportService } from './event-transport.service';

const SCRIPT_LOG_EVENT = 'script-log';
const MAX_ENTRIES = 500;

@Injectable({ providedIn: 'root' })
export class ScriptConsoleService {
  private readonly backend = inject(BACKEND_CLIENT);
  private readonly events = inject(EventTransportService);
  private initialized = false;
  private unsubscribe?: () => void;
  readonly logs = signal<ScriptLogEntry[]>([]);

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    try {
      const entries = await this.backend.getScriptLogs() as ScriptLogEntry[];
      if (Array.isArray(entries) && entries.length) {
        this.logs.set(entries);
      }
    } catch (error) {
      console.error('[ScriptConsole] Failed to fetch existing logs', error);
    }

    this.unsubscribe = this.events.on(SCRIPT_LOG_EVENT, (entry: ScriptLogEntry) => {
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
      await this.backend.clearScriptLogs();
    } catch (error) {
      console.error('[ScriptConsole] Failed to clear logs', error);
    } finally {
      this.logs.set([]);
    }
  }

  async record(level: string, source: string, message: string): Promise<void> {
    try {
      await this.backend.recordScriptLog(level, source, message);
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
