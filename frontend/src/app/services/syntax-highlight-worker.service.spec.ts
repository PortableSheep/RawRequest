import { NgZone } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

// Mock Worker that simulates highlighting
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;

  postMessage(data: { id: number; content: string; type: string }): void {
    if (data.type === 'highlight') {
      // Simulate worker processing
      setTimeout(() => {
        const content = data.content;
        const lineCount = (content.match(/\n/g) || []).length + 1;
        const trimmed = content.trim();
        
        let html: string;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            const formatted = JSON.stringify(parsed, null, 2);
            html = formatted.replace(
              /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
              (match) => {
                let cls = 'json-number';
                if (/^"/.test(match)) {
                  cls = /:$/.test(match) ? 'json-key' : 'json-string';
                } else if (/true|false/.test(match)) {
                  cls = 'json-boolean';
                } else if (/null/.test(match)) {
                  cls = 'json-null';
                }
                return `<span class="${cls}">${match}</span>`;
              }
            );
          } catch {
            html = this.escapeHtml(content);
          }
        } else if (trimmed.startsWith('<')) {
          html = this.escapeHtml(content).replace(
            /(&lt;\/?)(\w[\w:-]*)([^&]*?)(&gt;)/g,
            (_, open, tagName, rest, close) => `${open}<span class="xml-tag">${tagName}</span>${rest}${close}`
          );
        } else {
          html = this.escapeHtml(content);
        }

        if (this.onmessage) {
          this.onmessage({
            data: {
              id: data.id,
              html,
              lineCount: (html.match(/\n/g) || []).length + 1,
              isLarge: lineCount > 5000,
              type: 'highlight-result'
            }
          } as MessageEvent);
        }
      }, 0);
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  terminate(): void {
    this.onmessage = null;
    this.onerror = null;
  }
}

// Mock Worker before importing the service
const originalWorker = globalThis.Worker;
(globalThis as unknown as { Worker: unknown }).Worker = MockWorker;

// Now import the service - it will use our MockWorker
import { SyntaxHighlightWorkerService, HighlightResult } from './syntax-highlight-worker.service';

// Mock NgZone that runs callbacks synchronously
class MockNgZone extends NgZone {
  constructor() {
    super({ enableLongStackTrace: false });
  }
  override run<T>(fn: () => T): T {
    return fn();
  }
  override runOutsideAngular<T>(fn: () => T): T {
    return fn();
  }
}

describe('SyntaxHighlightWorkerService', () => {
  let service: SyntaxHighlightWorkerService;

  beforeEach(() => {
    const mockNgZone = new MockNgZone();
    service = new SyntaxHighlightWorkerService(mockNgZone);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  afterAll(() => {
    // Restore original Worker
    (globalThis as unknown as { Worker: typeof Worker }).Worker = originalWorker;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return null for empty content', async () => {
    const result = await firstValueFrom(service.highlight(''));
    expect(result).toBeNull();
  });

  it('should highlight JSON content with spans', async () => {
    const json = '{"key": "value"}';
    const result = await firstValueFrom(
      service.highlight(json).pipe(filter((r): r is HighlightResult => r !== null))
    );
    
    expect(result).toBeTruthy();
    expect(result.html).toContain('json-key');
    expect(result.html).toContain('json-string');
    expect(result.lineCount).toBeGreaterThan(0);
    expect(result.isLarge).toBe(false);
  });

  it('should cache results', async () => {
    const json = '{"key": "value"}';
    
    const result1 = await firstValueFrom(
      service.highlight(json).pipe(filter((r): r is HighlightResult => r !== null))
    );
    const result2 = await firstValueFrom(
      service.highlight(json).pipe(filter((r): r is HighlightResult => r !== null))
    );
    
    // Both should return the same cached result
    expect(result1).toEqual(result2);
  });

  it('should escape HTML in plain text content', async () => {
    const text = 'Hello <script>alert("xss")</script>';
    const result = await firstValueFrom(
      service.highlight(text).pipe(filter((r): r is HighlightResult => r !== null))
    );
    
    // Must escape HTML to prevent XSS
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('should report isLarge for content over threshold', async () => {
    // Create content with > 5000 lines
    const lines = Array(6000).fill('line').join('\n');
    const result = await firstValueFrom(
      service.highlight(lines).pipe(filter((r): r is HighlightResult => r !== null))
    );
    
    expect(result.isLarge).toBe(true);
    expect(result.lineCount).toBe(6000);
  });

  it('should clear cache when requested', async () => {
    const json = '{"test": 1}';
    
    // Populate cache
    const result1 = await firstValueFrom(
      service.highlight(json).pipe(filter((r): r is HighlightResult => r !== null))
    );
    expect(result1).toBeTruthy();
    
    // Clear cache
    service.clearCache();
    
    // Highlight again - should still work
    const result2 = await firstValueFrom(
      service.highlight(json).pipe(filter((r): r is HighlightResult => r !== null))
    );
    expect(result2).toBeTruthy();
  });

  it('should count lines correctly', async () => {
    const multiLine = 'line1\nline2\nline3';
    const result = await firstValueFrom(
      service.highlight(multiLine).pipe(filter((r): r is HighlightResult => r !== null))
    );
    
    expect(result.lineCount).toBe(3);
  });

  it('should highlight XML content', async () => {
    const xml = '<root><item attr="val">text</item></root>';
    const result = await firstValueFrom(
      service.highlight(xml).pipe(filter((r): r is HighlightResult => r !== null))
    );
    
    expect(result).toBeTruthy();
    expect(result.html).toContain('xml-tag');
  });
});
