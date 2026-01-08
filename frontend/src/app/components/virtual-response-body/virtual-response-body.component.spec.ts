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
});
