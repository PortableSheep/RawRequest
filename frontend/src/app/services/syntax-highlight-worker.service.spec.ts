import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { SyntaxHighlightWorkerService } from './syntax-highlight-worker.service';

describe('SyntaxHighlightWorkerService', () => {
  let service: SyntaxHighlightWorkerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SyntaxHighlightWorkerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return null for empty content', fakeAsync(() => {
    let result: any;
    service.highlight('').subscribe(r => result = r);
    tick();
    expect(result).toBeNull();
  }));

  it('should highlight JSON and cache results', fakeAsync(() => {
    const json = '{"key": "value"}';
    
    // First call - async
    let result1: any;
    service.highlight(json).subscribe(r => result1 = r);
    tick();
    
    expect(result1).toBeTruthy();
    expect(result1.html).toContain('json-key');
    expect(result1.html).toContain('json-string');
    
    // Second call - should use cache and return same result
    let result2: any;
    service.highlight(json).subscribe(r => result2 = r);
    tick();
    expect(result2).toEqual(result1);
  }));

  it('should highlight JSON with proper classes', fakeAsync(() => {
    const json = JSON.stringify({ name: "test", count: 42, active: true, data: null }, null, 2);
    
    let result: any;
    service.highlight(json).subscribe(r => result = r);
    tick();
    
    expect(result.html).toContain('json-key');
    expect(result.html).toContain('json-string');
    expect(result.html).toContain('json-number');
    expect(result.html).toContain('json-boolean');
    expect(result.html).toContain('json-null');
    expect(result.lineCount).toBe(6); // JSON.stringify with indent creates 6 lines
  }));

  it('should highlight XML', fakeAsync(() => {
    const xml = '<root><item id="1">Test</item></root>';
    
    let result: any;
    service.highlight(xml).subscribe(r => result = r);
    tick();
    
    expect(result.html).toContain('xml-tag');
    // id="1" attribute should be highlighted
    expect(result.html).toContain('xml-attr');
    expect(result.html).toContain('xml-string');
  }));

  it('should escape HTML in plain text', fakeAsync(() => {
    const text = 'Hello <script>alert("xss")</script>';
    
    let result: any;
    service.highlight(text).subscribe(r => result = r);
    tick();
    
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  }));

  it('should report isLarge for content over threshold', fakeAsync(() => {
    // Create content with > 5000 lines
    const lines = Array(6000).fill('{"id": 1}').join('\n');
    
    let result: any;
    service.highlight(lines).subscribe(r => result = r);
    tick();
    
    expect(result.isLarge).toBe(true);
    expect(result.lineCount).toBe(6000);
  }));

  it('should clear cache when requested', fakeAsync(() => {
    const json = '{"test": 1}';
    
    // Populate cache
    let result1: any;
    service.highlight(json).subscribe(r => result1 = r);
    tick();
    expect(result1).toBeTruthy();
    
    // Clear cache
    service.clearCache();
    
    // Highlight again - should still work
    let result2: any;
    service.highlight(json).subscribe(r => result2 = r);
    tick();
    expect(result2).toBeTruthy();
    expect(result2.html).toEqual(result1.html);
  }));

  it('should handle invalid JSON gracefully', fakeAsync(() => {
    const invalidJson = '{not valid json}';
    
    let result: any;
    service.highlight(invalidJson).subscribe(r => result = r);
    tick();
    
    // Should return escaped text, not throw
    expect(result.html).toBeTruthy();
    expect(result.html).toContain('{not valid json}');
  }));

  it('should count lines correctly', fakeAsync(() => {
    const multiLine = 'line1\nline2\nline3';
    
    let result: any;
    service.highlight(multiLine).subscribe(r => result = r);
    tick();
    
    expect(result.lineCount).toBe(3);
  }));
});
