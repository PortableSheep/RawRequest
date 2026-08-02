import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FocusTrapDirective } from './focus-trap.directive';

@Component({
  standalone: true,
  imports: [FocusTrapDirective],
  template: `
    <button id="outside-before">Outside before</button>
    @if (open()) {
      <div id="host" appFocusTrap [focusTrapInitialSelector]="initialSelector()">
        <button id="first">First</button>
        <button id="middle">Middle</button>
        <button id="last">Last</button>
      </div>
    }
    <button id="outside-after">Outside after</button>
  `,
})
class TestHostComponent {
  open = signal(true);
  initialSelector = signal<string | null>(null);
}

// Flushes the directive's queued microtask (used to defer initial focus
// until after structural content has rendered) and lets Angular's effect
// scheduler run.
async function flushMicrotasks(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FocusTrapDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
  });

  function el<T extends HTMLElement>(id: string): T {
    return fixture.nativeElement.querySelector(`#${id}`) as T;
  }

  function tabKeydown(target: HTMLElement, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it('moves focus to the first focusable element on activation', async () => {
    fixture.detectChanges();
    await flushMicrotasks(fixture);

    expect(document.activeElement).toBe(el('first'));
  });

  it('focuses the element matching focusTrapInitialSelector when provided', async () => {
    host.initialSelector.set('#middle');
    fixture.detectChanges();
    await flushMicrotasks(fixture);

    expect(document.activeElement).toBe(el('middle'));
  });

  it('wraps focus from the last to the first element on Tab', async () => {
    fixture.detectChanges();
    await flushMicrotasks(fixture);

    const last = el('last');
    last.focus();
    const event = tabKeydown(last);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('first'));
  });

  it('wraps focus from the first to the last element on Shift+Tab', async () => {
    fixture.detectChanges();
    await flushMicrotasks(fixture);

    const first = el('first');
    first.focus();
    const event = tabKeydown(first, true);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('last'));
  });

  it('does not intercept Tab between two interior elements', async () => {
    fixture.detectChanges();
    await flushMicrotasks(fixture);

    const middle = el('middle');
    middle.focus();
    const event = tabKeydown(middle);

    expect(event.defaultPrevented).toBe(false);
  });

  it('restores focus to the previously-focused element when the host is destroyed', async () => {
    const outsideBefore = el('outside-before');
    outsideBefore.focus();
    expect(document.activeElement).toBe(outsideBefore);

    fixture.detectChanges();
    await flushMicrotasks(fixture);
    expect(document.activeElement).toBe(el('first'));

    host.open.set(false);
    fixture.detectChanges();

    expect(document.activeElement).toBe(outsideBefore);
  });

  it('does not let an outer dialog react to Tab events raised inside a nested dialog', async () => {
    // Simulate a confirmation dialog rendered on top of the trapped host by
    // moving focus to an element entirely outside the trapped subtree and
    // dispatching Tab there. Because the directive listens on its own host
    // element (not `document`), it must not see or cancel that keydown.
    fixture.detectChanges();
    await flushMicrotasks(fixture);

    const outsideAfter = el('outside-after');
    outsideAfter.focus();
    const event = tabKeydown(outsideAfter);

    expect(event.defaultPrevented).toBe(false);
  });
});
