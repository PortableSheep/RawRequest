import { Injectable, signal } from '@angular/core';

type ThemePreference = 'system' | 'dark' | 'light';
type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'rr_theme_preference';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly preferenceSignal = signal<ThemePreference>('system');
  private readonly resolvedThemeSignal = signal<ResolvedTheme>('dark');

  private systemMediaQuery: MediaQueryList | null = null;
  private readonly onSystemPreferenceChange = () => {
    if (this.preferenceSignal() !== 'system') {
      return;
    }
    this.applyResolvedTheme(this.getSystemTheme());
  };

  preference(): ThemePreference {
    return this.preferenceSignal();
  }

  resolvedTheme(): ResolvedTheme {
    return this.resolvedThemeSignal();
  }

  init(): void {
    const stored = this.safeReadPreference();
    this.preferenceSignal.set(stored);
    this.applyPreference(stored);
  }

  setPreference(pref: ThemePreference): void {
    this.preferenceSignal.set(pref);
    this.safeWritePreference(pref);
    this.applyPreference(pref);
  }

  toggle(): void {
    // If the user was following system, toggling should explicitly pick the opposite
    // of the currently resolved theme.
    const next: ThemePreference = this.resolvedThemeSignal() === 'dark' ? 'light' : 'dark';
    this.setPreference(next);
  }

  private applyPreference(pref: ThemePreference): void {
    this.detachSystemListener();

    if (pref === 'system') {
      this.attachSystemListener();
      this.applyResolvedTheme(this.getSystemTheme());
      return;
    }

    this.applyResolvedTheme(pref);
  }

  private applyResolvedTheme(theme: ResolvedTheme): void {
    this.resolvedThemeSignal.set(theme);

    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.dataset['theme'] = theme;
  }

  private getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'dark';
    }

    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  }

  private attachSystemListener(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    try {
      this.systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemMediaQuery.addEventListener('change', this.onSystemPreferenceChange);
    } catch {
      this.systemMediaQuery = null;
    }
  }

  private detachSystemListener(): void {
    if (!this.systemMediaQuery) {
      return;
    }

    try {
      this.systemMediaQuery.removeEventListener('change', this.onSystemPreferenceChange);
    } catch {
      // ignore
    }

    this.systemMediaQuery = null;
  }

  private safeReadPreference(): ThemePreference {
    if (typeof window === 'undefined') {
      return 'system';
    }

    try {
      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === 'dark' || raw === 'light' || raw === 'system') {
        return raw;
      }
    } catch {
      // ignore
    }

    return 'system';
  }

  private safeWritePreference(pref: ThemePreference): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // ignore
    }
  }
}
