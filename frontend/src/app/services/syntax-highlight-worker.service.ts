import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Observable, of, BehaviorSubject } from 'rxjs';

export interface HighlightResult {
  html: string;
  lineCount: number;
  isLarge: boolean;
}

interface WorkerRequest {
  id: number;
  content: string;
  type: 'highlight';
}

interface WorkerResponse {
  id: number;
  html: string;
  lineCount: number;
  isLarge: boolean;
  type: 'highlight-result';
}

/**
 * Service that performs syntax highlighting using a Web Worker.
 * All highlighting logic lives in the Worker to keep the main thread free.
 */
@Injectable({ providedIn: 'root' })
export class SyntaxHighlightWorkerService implements OnDestroy {
  private cache = new Map<string, HighlightResult>();
  private readonly CACHE_MAX_SIZE = 20;
  private pendingRequests = new Map<string, BehaviorSubject<HighlightResult | null>>();
  private worker: Worker | null = null;
  private requestId = 0;
  private workerCallbacks = new Map<number, (result: HighlightResult) => void>();

  constructor(private ngZone: NgZone) {
    this.initWorker();
  }

  ngOnDestroy(): void {
    this.terminateWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('../workers/syntax-highlight.worker', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, html, lineCount, isLarge, type } = event.data;

        if (type !== 'highlight-result') return;

        const callback = this.workerCallbacks.get(id);
        if (callback) {
          this.workerCallbacks.delete(id);
          this.ngZone.run(() => {
            callback({ html, lineCount, isLarge });
          });
        }
      };

      this.worker.onerror = (error) => {
        console.error('Syntax highlight worker error:', error);
      };
    } catch (e) {
      console.error('Failed to create syntax highlight worker:', e);
    }
  }

  private terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerCallbacks.clear();
  }

  /**
   * Highlight content asynchronously using the Web Worker.
   * Returns an Observable that emits the result when ready.
   */
  highlight(content: string): Observable<HighlightResult | null> {
    if (!content) {
      return of(null);
    }

    const cacheKey = this.hashContent(content);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return of(cached);
    }

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending.asObservable();
    }

    const subject = new BehaviorSubject<HighlightResult | null>(null);
    this.pendingRequests.set(cacheKey, subject);

    if (!this.worker) {
      // Worker not available - return plain escaped text
      const result = this.plainTextFallback(content);
      this.addToCache(cacheKey, result);
      subject.next(result);
      subject.complete();
      this.pendingRequests.delete(cacheKey);
      return subject.asObservable();
    }

    const id = ++this.requestId;
    this.workerCallbacks.set(id, (result) => {
      this.addToCache(cacheKey, result);
      subject.next(result);
      subject.complete();
      this.pendingRequests.delete(cacheKey);
    });

    const request: WorkerRequest = { id, content, type: 'highlight' };
    this.worker.postMessage(request);

    return subject.asObservable();
  }

  /**
   * Minimal fallback if Worker somehow fails - just escape HTML, no highlighting.
   */
  private plainTextFallback(content: string): HighlightResult {
    const lineCount = (content.match(/\n/g) || []).length + 1;
    const html = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return { html, lineCount, isLarge: lineCount > 5000 };
  }

  private hashContent(content: string): string {
    const len = content.length;
    if (len < 100) return content;

    const sample = [
      content.slice(0, 50),
      content.slice(Math.floor(len / 4), Math.floor(len / 4) + 20),
      content.slice(Math.floor(len / 2), Math.floor(len / 2) + 20),
      content.slice(Math.floor(3 * len / 4), Math.floor(3 * len / 4) + 20),
      content.slice(-50)
    ].join('|');

    return `${len}:${sample}`;
  }

  private addToCache(key: string, result: HighlightResult): void {
    if (this.cache.size >= this.CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, result);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

