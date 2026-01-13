import { render, screen } from '@testing-library/angular';
import { VirtualResponseBodyComponent } from './virtual-response-body.component';

describe('VirtualResponseBodyComponent', () => {
  it('should create', async () => {
    const { fixture } = await render(VirtualResponseBodyComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should not use virtual scroll for small bodies', async () => {
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: 'short body\nwith\nfew\nlines',
        threshold: 1000
      }
    });
    
    expect(fixture.componentInstance.useVirtualScroll()).toBe(false);
  });

  it('should use virtual scroll for large bodies', async () => {
    const largeBody = Array(1001).fill('line').join('\n');
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: largeBody,
        threshold: 1000
      }
    });
    
    expect(fixture.componentInstance.useVirtualScroll()).toBe(true);
  });

  it('should split body into lines for virtual scroll', async () => {
    const testBody = 'line1\nline2\nline3';
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: testBody,
        threshold: 1
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
        body: testBody,
        threshold: 0 // Force virtual scroll mode
      }
    });
    
    // Wait for the async highlighting to complete and trigger change detection multiple times
    // to ensure signals propagate
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      fixture.detectChanges();
    }
    
    // Now should be done processing
    expect(fixture.componentInstance.isProcessing()).toBe(false);
    
    // The highlighting service was invoked and lines should be available
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(3); // Pretty-printed JSON has 3 lines
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[1].lineNumber).toBe(2);
    expect(lines[2].lineNumber).toBe(3);
    // Line 2 should contain the key/value
    expect(String(lines[1].content)).toContain('key');
  });

  it('should display plain text while highlighting is processing', async () => {
    const testBody = '{"test": true}';
    
    const { fixture } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: testBody,
        threshold: 0
      }
    });
    
    // Lines should still be available immediately (plain text)
    const lines = fixture.componentInstance.lines();
    expect(lines.length).toBe(1);
    // Content should contain the text, even before highlighting
    expect(String(lines[0].content)).toContain('test');
  });

  it('should respect custom threshold', async () => {
    const body = Array(100).fill('line').join('\n');
    
    const { fixture, rerender } = await render(VirtualResponseBodyComponent, {
      componentInputs: {
        body: body,
        threshold: 50
      }
    });
    expect(fixture.componentInstance.useVirtualScroll()).toBe(true);
    
    await rerender({
      componentInputs: {
        body: body,
        threshold: 150
      }
    });
    expect(fixture.componentInstance.useVirtualScroll()).toBe(false);
  });

  it('should have trackByLineNumber function', async () => {
    const { fixture } = await render(VirtualResponseBodyComponent);
    
    const line = { lineNumber: 42, content: 'test' };
    expect(fixture.componentInstance.trackByLineNumber(0, line)).toBe(42);
  });
});
