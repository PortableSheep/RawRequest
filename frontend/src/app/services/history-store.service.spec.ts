import { Injector, inject, runInInjectionContext } from '@angular/core';
import type { HistoryItem } from '../models/http.models';
import { HistoryStoreService } from './history-store.service';
import { HttpService } from './http.service';

describe('HistoryStoreService', () => {
  it('loads once then serves from cache', async () => {
    const history: HistoryItem[] = [{
      id: 'h1',
      requestName: 'r',
      request: { method: 'GET', url: 'https://example.com', headers: {}, body: '' } as any,
      responseData: { status: 200, statusText: 'OK', headers: {}, body: 'ok', responseTime: 1 } as any,
      timestamp: new Date()
    } as any];

    const httpMock: Pick<HttpService, 'loadHistory'> = {
      loadHistory: jest.fn().mockResolvedValue(history)
    };

    const injector = Injector.create({
      providers: [
        HistoryStoreService,
        { provide: HttpService, useValue: httpMock }
      ]
    });

    const store = runInInjectionContext(injector, () => inject(HistoryStoreService));

    const first = await store.ensureLoaded('file1', '/tmp/file.http');
    const second = await store.ensureLoaded('file1', '/tmp/file.http');

    expect(first).toBe(history);
    expect(second).toBe(history);
    expect((httpMock.loadHistory as any)).toHaveBeenCalledTimes(1);
  });
});
