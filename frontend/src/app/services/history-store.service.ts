import { Injectable, inject } from '@angular/core';
import type { HistoryItem } from '../models/http.models';
import { HttpService } from './http.service';

@Injectable({ providedIn: 'root' })
export class HistoryStoreService {
  private readonly http = inject(HttpService);
  private readonly cache = new Map<string, HistoryItem[]>();

  get(fileId: string): HistoryItem[] | undefined {
    return this.cache.get(fileId);
  }

  set(fileId: string, history: HistoryItem[]): void {
    this.cache.set(fileId, history);
  }

  delete(fileId: string): void {
    this.cache.delete(fileId);
  }

  clear(): void {
    this.cache.clear();
  }

  async load(fileId: string, filePath?: string): Promise<HistoryItem[]> {
    const history = await this.http.loadHistory(fileId, filePath);
    this.cache.set(fileId, history);
    return history;
  }

  async ensureLoaded(fileId: string, filePath?: string): Promise<HistoryItem[]> {
    const cached = this.cache.get(fileId);
    if (cached) {
      return cached;
    }
    return this.load(fileId, filePath);
  }
}
