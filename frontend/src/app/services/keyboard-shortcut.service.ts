import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';

export interface KeyCombo {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

export interface ShortcutRegistration {
  id: string;
  combo: KeyCombo;
  action: () => void;
  /** Higher priority wins when multiple shortcuts match. Default 0. */
  priority?: number;
}

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService implements OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly registrations = new Map<string, ShortcutRegistration>();
  private readonly listener: (event: KeyboardEvent) => void;
  private attached = false;

  constructor() {
    this.listener = (event: KeyboardEvent) => this.handleKeydown(event);
    this.attach();
  }

  ngOnDestroy(): void {
    this.detach();
  }

  register(reg: ShortcutRegistration): void {
    this.registrations.set(reg.id, reg);
  }

  registerMany(regs: ShortcutRegistration[]): void {
    for (const reg of regs) {
      this.registrations.set(reg.id, reg);
    }
  }

  unregister(id: string): void {
    this.registrations.delete(id);
  }

  unregisterMany(ids: string[]): void {
    for (const id of ids) {
      this.registrations.delete(id);
    }
  }

  private attach(): void {
    if (this.attached) return;
    this.ngZone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.listener, true);
    });
    this.attached = true;
  }

  private detach(): void {
    if (!this.attached) return;
    document.removeEventListener('keydown', this.listener, true);
    this.attached = false;
  }

  /** @internal exposed for testing */
  handleKeydown(event: KeyboardEvent): void {
    const match = this.findMatch(event);
    if (!match) return;

    if (match.combo.preventDefault !== false) {
      event.preventDefault();
    }
    if (match.combo.stopPropagation !== false) {
      event.stopPropagation();
    }

    this.ngZone.run(() => match.action());
  }

  private findMatch(event: KeyboardEvent): ShortcutRegistration | null {
    let best: ShortcutRegistration | null = null;
    let bestPriority = -Infinity;

    for (const reg of this.registrations.values()) {
      if (this.matches(event, reg.combo)) {
        const priority = reg.priority ?? 0;
        if (priority > bestPriority) {
          best = reg;
          bestPriority = priority;
        }
      }
    }
    return best;
  }

  private matches(event: KeyboardEvent, combo: KeyCombo): boolean {
    if (event.key.toLowerCase() !== combo.key.toLowerCase()) return false;

    const wantsMod = combo.ctrl ?? false;
    const hasMod = event.metaKey || event.ctrlKey;
    if (wantsMod !== hasMod) return false;

    const wantsShift = combo.shift ?? false;
    if (wantsShift !== event.shiftKey) return false;

    const wantsAlt = combo.alt ?? false;
    if (wantsAlt !== event.altKey) return false;

    return true;
  }
}
