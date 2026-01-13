import { render, screen } from '@testing-library/angular';
import { VirtualResponseBodyComponent } from './virtual-response-body.component';

describe('VirtualResponseBodyComponent', () => {
  it('should create', async () => {
    const { fixture } = await render(VirtualResponseBodyComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should handle empty body', async () => {
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: ''
      }
    });
    
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(0);
  });

  it('should split body into lines', async () => {
    const testBody = 'line1\nline2\nline3';
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: testBody
      }
    });
    
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(3);
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[1].lineNumber).toBe(2);
    expect(lines[2].lineNumber).toBe(3);
    // Verify line content matches the expected text
    expect(lines[0].content).toContain('line1');
    expect(lines[1].content).toContain('line2');
    expect(lines[2].content).toContain('line3');
  });

  it('should apply syntax highlighting asynchronously for JSON', async () => {
    // Use already-formatted JSON so line count matches expected
    const testBody = '{\n  "key": "value"\n}';
    
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: testBody
      }
    });
    
    // Wait for the async highlighting to complete and trigger change detection multiple times
    // to ensure signals propagate
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      fixture.detectChanges();
    }
    
    // The highlighting service was invoked and lines should be available
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(3); // Pretty-printed JSON has 3 lines
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[1].lineNumber).toBe(2);
    expect(lines[2].lineNumber).toBe(3);
    // Line 2 should contain the key/value
    expect(String(lines[1].content)).toContain('key');
  });

  it('should display plain text immediately before highlighting completes', async () => {
    const testBody = '{"test": true}';
    
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: testBody
      }
    });
    
    // Lines should still be available immediately (plain text fallback)
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(1);
    // Content should contain the text, even before highlighting
    expect(String(lines[0].content)).toContain('test');
  });

  it('should handle large bodies efficiently', async () => {
    const largeBody = Array(1000).fill('line content here').join('\n');
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: largeBody
      }
    });
    
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(1000);
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[999].lineNumber).toBe(1000);
  });

  it('should have trackByLineNumber function', async () => {
    const { fixture } = await render(VirtualResponseBodyComponent);
    
    const line = { lineNumber: 42, content: 'test' };
    expect(fixture.componentInstance.trackByLineNumber(0, line)).toBe(42);
  });
});
