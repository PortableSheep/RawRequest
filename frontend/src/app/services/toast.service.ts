import { Injectable, signal, computed } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  exiting?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  private _idCounter = 0;

  readonly toasts = computed(() => this._toasts());

  success(message: string, duration = 3000): void {
    this.show(message, 'success', duration);
  }

  error(message: string, duration = 4000): void {
    this.show(message, 'error', duration);
  }

  info(message: string, duration = 3000): void {
    this.show(message, 'info', duration);
  }

  private show(message: string, type: Toast['type'], duration: number): void {
    const id = ++this._idCounter;
    const toast: Toast = { id, message, type };
    
    this._toasts.update(toasts => [...toasts, toast]);

    setTimeout(() => this.dismiss(id), duration);
  }

  dismiss(id: number): void {
    // Mark as exiting for animation
    this._toasts.update(toasts =>
      toasts.map(t => t.id === id ? { ...t, exiting: true } : t)
    );

    // Remove after animation completes
    setTimeout(() => {
      this._toasts.update(toasts => toasts.filter(t => t.id !== id));
    }, 200);
  }
}
