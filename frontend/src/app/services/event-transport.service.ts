import { Injectable } from '@angular/core';
import { EventsOn } from '@wailsjs/runtime/runtime';
import { resolveServiceBackendBaseUrl } from './backend-client-config';

type EventHandler = (payload: any) => void;
type TransportMode = 'auto' | 'wails' | 'service';

@Injectable({
  providedIn: 'root'
})
export class EventTransportService {
  private readonly storage = this.resolveStorage();
  private readonly serviceBaseUrl = resolveServiceBackendBaseUrl(globalThis as any, this.storage);
  private source: EventSource | null = null;
  private readonly handlers = new Map<string, Set<EventHandler>>();

  private resolveStorage(): Pick<Storage, 'getItem'> | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  private hasWailsRuntime(): boolean {
    const g: any = globalThis as any;
    return !!g?.runtime;
  }

  private resolveTransport(requested: TransportMode): TransportMode {
    return requested === 'auto' ? 'service' : requested;
  }

  on(event: string, callback: EventHandler, mode: TransportMode = 'auto'): () => void {
    if (!event || typeof callback !== 'function') {
      return () => {};
    }

    const transport = this.resolveTransport(mode);
    if (transport === 'service') {
      return this.subscribeServiceEvent(event, callback);
    }

    if (!this.hasWailsRuntime()) {
      return () => {};
    }
    return EventsOn(event, callback);
  }

  private subscribeServiceEvent(event: string, callback: EventHandler): () => void {
    if (typeof EventSource === 'undefined') {
      return () => {};
    }

    this.ensureServiceStream();

    let set = this.handlers.get(event);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(event, set);
    }
    set.add(callback);

    return () => {
      const current = this.handlers.get(event);
      if (!current) {
        return;
      }
      current.delete(callback);
      if (current.size === 0) {
        this.handlers.delete(event);
      }
      this.closeServiceStreamIfUnused();
    };
  }

  private ensureServiceStream(): void {
    if (this.source) {
      return;
    }

    this.source = new EventSource(`${this.serviceBaseUrl}/v1/events`);
    this.source.onmessage = (message: MessageEvent<string>) => {
      this.dispatchServiceMessage(message.data);
    };
  }

  private closeServiceStreamIfUnused(): void {
    if (this.handlers.size > 0 || !this.source) {
      return;
    }
    this.source.close();
    this.source = null;
  }

  private dispatchServiceMessage(raw: string): void {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const event = data?.event;
    if (typeof event !== 'string' || !event) {
      return;
    }

    const listeners = this.handlers.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const payload = data?.payload;
    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch {
      }
    });
  }
}
