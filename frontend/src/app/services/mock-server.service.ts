import { Injectable, signal, computed, inject } from '@angular/core';
import { APP_BRIDGE } from './app-bridge.contract';
import { EventTransportService } from './event-transport.service';

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
  private readonly appBridge = inject(APP_BRIDGE);
  private readonly events = inject(EventTransportService);
  readonly status = signal<MockServerState>({ running: false, port: 8080, dbPath: '' });
  readonly logs = signal<MockServerLogEntry[]>([]);
  
  private unsubscribeLogEvents?: () => void;

  constructor() {
    void this.syncStatus();
    
    // Subscribe to mock server logs globally
    // mock-server-log is emitted directly by the desktop App process's
    // mock server via the Wails runtime event bus; it never reaches the
    // standalone service backend's SSE broker, so this must stay pinned
    // to 'wails' rather than the 'auto' (SSE-preferring) default.
    try {
      this.unsubscribeLogEvents = this.events.on(
        'mock-server-log',
        (log: MockServerLogEntry) => {
          if (log) {
            this.logs.update(entries => [...entries, log]);
          }
        },
        'wails'
      );
    } catch (error) {
      console.error("Failed to subscribe to mock-server-log event:", error);
    }
  }

  async syncStatus(): Promise<void> {
    try {
      const state = await this.appBridge.getMockServerStatus();
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
      await this.appBridge.startMockServer(content, filePath, port, dbPath);
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
      await this.appBridge.stopMockServer();
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
