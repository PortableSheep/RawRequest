import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Names supported by {@link IconComponent}. Intentionally a small, closed
 * set: this is an incremental start to shared icon infrastructure, covering
 * only the handful of icons that were copy-pasted as identical inline
 * `<svg>` markup across many components (the modal close "X", the dropdown
 * chevron, and the "more actions" kebab). The other ~80 one-off icons in
 * the app are left as inline `<svg>` for now — migrating all of them in one
 * pass would be a large, high-risk visual-regression surface for a single
 * PR. Add new names here only when a *duplicated* icon (not a one-off)
 * needs a home.
 */
export type IconName = 'close' | 'chevron-down' | 'more-vertical';

/**
 * Drop-in replacement for the inline `<svg>` markup used for a small set of
 * duplicated icons. Usage mirrors the `<svg>` it replaces: apply the same
 * sizing/color utility classes (`rr-icon`, `rr-btn__icon`, `rr-icon--md`,
 * `rr-icon--warning`, ...) directly on `<app-icon>`:
 *
 * ```html
 * <app-icon name="close" class="rr-icon rr-icon--md"></app-icon>
 * ```
 *
 * `:host` sets `display: inline-block` unconditionally so those utility
 * classes' `width`/`height` rules take effect exactly as they did on the
 * `<svg>` element (a custom element's default `display: inline` would
 * otherwise silently ignore them). The inner `<svg>` fills the host and
 * uses `stroke="currentColor"`, so existing color utility classes (which
 * only set the CSS `color` property) continue to work via inheritance.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (name()) {
      @case ('close') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      }
      @case ('chevron-down') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      }
      @case ('more-vertical') {
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      }
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
        line-height: 0;
      }

      svg {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
