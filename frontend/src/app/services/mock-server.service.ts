import { Injectable, signal, computed } from '@angular/core';
import { StartMockServer, StopMockServer, GetMockServerStatus } from '@wailsjs/go/app/App';
import { EventsOn } from '@wailsjs/runtime/runtime';

export interface MockServerState {
  running: boolean;
  port: number;
  dbPath: string;
}

export interface MockServerLogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class MockServerService {
  readonly status = signal<MockServerState>({ running: false, port: 8080, dbPath: '' });
  readonly logs = signal<MockServerLogEntry[]>([]);
  
  private unsubscribeLogEvents?: () => void;

  constructor() {
    void this.syncStatus();
    
    // Subscribe to mock server logs globally
    try {
      this.unsubscribeLogEvents = EventsOn('mock-server-log', (log: MockServerLogEntry) => {
        if (log) {
          this.logs.update(entries => [...entries, log]);
        }
      });
    } catch (error) {
      console.error("Failed to subscribe to mock-server-log event:", error);
    }
  }

  async syncStatus(): Promise<void> {
    try {
      const state = await GetMockServerStatus();
      if (state) {
        this.status.set({
          running: state.running,
          port: state.port || 8080,
          dbPath: state.dbPath || ''
        });
      }
    } catch (err) {
      console.error("Failed to sync mock server status:", err);
    }
  }

  async start(content: string, filePath: string, port: number, dbPath: string): Promise<void> {
    try {
      await StartMockServer(content, filePath, port, dbPath);
      this.status.set({ running: true, port, dbPath });
      this.logs.set([{
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        source: 'mockserver',
        message: `[Mock Server] Started on http://localhost:${port}`
      }]);
    } catch (err: any) {
      console.error("Failed to start mock server:", err);
      this.logs.update(entries => [...entries, {
        timestamp: new Date().toLocaleTimeString(),
        level: 'error',
        source: 'mockserver',
        message: `[Mock Server Error] Failed to start: ${err?.message || err}`
      }]);
      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      await StopMockServer();
      const current = this.status();
      this.status.set({ running: false, port: current.port, dbPath: current.dbPath });
    } catch (err: any) {
      console.error("Failed to stop mock server:", err);
      throw err;
    }
  }

  clearLogs(): void {
    this.logs.set([]);
  }

  destroy(): void {
    if (this.unsubscribeLogEvents) {
      this.unsubscribeLogEvents();
    }
  }
}
