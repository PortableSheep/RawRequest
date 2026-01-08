import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VirtualResponseBodyComponent } from './virtual-response-body.component';

describe('VirtualResponseBodyComponent', () => {
  let component: VirtualResponseBodyComponent;
  let fixture: ComponentFixture<VirtualResponseBodyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VirtualResponseBodyComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(VirtualResponseBodyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not use virtual scroll for small bodies', () => {
    fixture.componentRef.setInput('body', 'short body\nwith\nfew\nlines');
    fixture.componentRef.setInput('threshold', 1000);
    fixture.detectChanges();
    
    expect(component.useVirtualScroll()).toBe(false);
  });

  it('should use virtual scroll for large bodies', () => {
    const largeBody = Array(1001).fill('line').join('\n');
    fixture.componentRef.setInput('body', largeBody);
    fixture.componentRef.setInput('threshold', 1000);
    fixture.detectChanges();
    
    expect(component.useVirtualScroll()).toBe(true);
  });

  it('should split body into lines for virtual scroll', () => {
    const testBody = 'line1\nline2\nline3';
    fixture.componentRef.setInput('body', testBody);
    fixture.componentRef.setInput('threshold', 1);
    fixture.detectChanges();
    
    const lines = component.lines();
    expect(lines.length).toBe(3);
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[1].lineNumber).toBe(2);
    expect(lines[2].lineNumber).toBe(3);
  });

  it('should respect custom threshold', () => {
    const body = Array(100).fill('line').join('\n');
    
    fixture.componentRef.setInput('body', body);
    fixture.componentRef.setInput('threshold', 50);
    fixture.detectChanges();
    expect(component.useVirtualScroll()).toBe(true);
    
    fixture.componentRef.setInput('threshold', 150);
    fixture.detectChanges();
    expect(component.useVirtualScroll()).toBe(false);
  });
});
