import { Directive, ElementRef, HostListener, OnDestroy, booleanAttribute, effect, inject, input } from '@angular/core';

/**
 * Focusable-element selector used to build the tab cycle. Intentionally
 * conservative (no `[contenteditable]`, no framework-specific attributes) so
 * it stays cheap to evaluate and predictable across the app's modal shells.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Lightweight focus-trap / focus-restore attribute directive for modal
 * shells. Attach it to the dialog surface (the element with
 * `role="dialog"`/`role="alertdialog"`, not the fixed-position shell/backdrop
 * wrapper around it):
 *
 * ```html
 * <div class="rr-modal" appFocusTrap role="dialog" aria-modal="true">...</div>
 * ```
 *
 * Behavior:
 * - On activation, remembers `document.activeElement` and moves focus into
 *   the host (first focusable descendant, or an element matching
 *   `focusTrapInitialSelector`, or the host itself as a last resort).
 * - While active, Tab/Shift+Tab cycle within the host's focusable
 *   descendants instead of escaping to the rest of the page.
 * - On deactivation (input set to `false`) or destroy (host removed from the
 *   DOM, e.g. by an `@if`), restores focus to the previously-focused
 *   element.
 *
 * Nested dialogs (e.g. a delete-confirmation `alertdialog` rendered on top
 * of an already-open modal) are handled correctly *without* any coordination
 * between directive instances: the Tab/Shift+Tab handling is a `(keydown)`
 * host listener bound to this directive's own element, not a
 * `document`-level listener. Keydown events only bubble up through the DOM
 * ancestors of whichever element currently has focus, so once focus moves
 * into a nested dialog, the outer dialog's trap simply never sees further
 * keydown events — no manual stack/priority bookkeeping required.
 */
@Directive({
  selector: '[appFocusTrap]',
  standalone: true,
})
export class FocusTrapDirective implements OnDestroy {
  /**
   * Whether the trap is active. Defaults to true so a bare `appFocusTrap`
   * attribute works; `transform: booleanAttribute` ensures a bare attribute
   * (which Angular otherwise binds as the empty string) is coerced to
   * `true` rather than treated as falsy.
   */
  readonly appFocusTrap = input(true, { transform: booleanAttribute });

  /** Optional CSS selector for the element that should receive initial focus. */
  readonly focusTrapInitialSelector = input<string | null>(null);

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private previouslyFocused: HTMLElement | null = null;
  private activated = false;

  constructor() {
    effect(() => {
      if (this.appFocusTrap()) {
        this.activate();
      } else {
        this.deactivate();
      }
    });
  }

  ngOnDestroy(): void {
    this.deactivate();
  }

  @HostListener('keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.activated || event.key !== 'Tab') return;

    const focusable = this.getFocusableElements();
    if (focusable.length === 0) {
      // Nothing to tab to inside the dialog: keep focus pinned on the host.
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.elementRef.nativeElement.ownerDocument.activeElement as HTMLElement | null;
    const activeIsInside = !!active && this.elementRef.nativeElement.contains(active);

    if (event.shiftKey) {
      if (!activeIsInside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!activeIsInside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private activate(): void {
    if (this.activated) return;
    this.activated = true;

    const doc = this.elementRef.nativeElement.ownerDocument;
    this.previouslyFocused = doc.activeElement as HTMLElement | null;

    // Defer so structural content (*ngIf/@if bodies, @for lists) has
    // finished rendering before we look for something to focus.
    queueMicrotask(() => {
      if (this.activated) this.focusInitialElement();
    });
  }

  private deactivate(): void {
    if (!this.activated) return;
    this.activated = false;

    const toRestore = this.previouslyFocused;
    this.previouslyFocused = null;
    if (toRestore && toRestore.isConnected) {
      toRestore.focus();
    }
  }

  private focusInitialElement(): void {
    const host = this.elementRef.nativeElement;
    const selector = this.focusTrapInitialSelector();
    const preferred = selector ? (host.querySelector(selector) as HTMLElement | null) : null;
    const target = preferred ?? this.getFocusableElements()[0] ?? host;

    if (target === host && !host.hasAttribute('tabindex')) {
      host.setAttribute('tabindex', '-1');
    }
    target.focus();
  }

  private getFocusableElements(): HTMLElement[] {
    return Array.from(this.elementRef.nativeElement.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
  }
}
