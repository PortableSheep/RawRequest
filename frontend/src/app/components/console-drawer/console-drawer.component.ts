import { CommonModule } from '@angular/common';
import { Component, input, output, signal, HostListener, ElementRef, inject, ViewChild, AfterViewInit, effect } from '@angular/core';
import { ScriptLogEntry } from '../../models/http.models';
import { gsap } from 'gsap';

type FooterTone = 'idle' | 'pending' | 'success' | 'warning' | 'error';

@Component({
  selector: 'app-console-drawer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './console-drawer.component.html',
  styleUrls: ['./console-drawer.component.scss']
})
export class ConsoleDrawerComponent {
  private el = inject(ElementRef);

  @ViewChild('drawerShell') drawerShell?: ElementRef<HTMLElement>;
  @ViewChild('bubbleButton') bubbleButton?: ElementRef<HTMLButtonElement>;
  
  open = input<boolean>(false);
  logs = input<ScriptLogEntry[]>([]);
  latestLog = input<ScriptLogEntry | null>(null);
  status = input<{ label: string; detail: string; tone: FooterTone } | null>(null);
  version = input<string>('Raw Request v1');

  onToggle = output<void>();
  onClear = output<void>();

  // Render state: keep the drawer in DOM long enough to animate out.
  isDrawerVisible = signal<boolean>(false);
  private drawerTween: gsap.core.Tween | null = null;
  private bubbleTween: gsap.core.Tween | null = null;
  private hasView = false;
  private pendingOpenAnimation = false;

  // Resize state
  panelHeight = signal<number>(256); // Default 256px (max-h-64)
  isResizing = signal<boolean>(false);
  private startY = 0;
  private startHeight = 0;
  private readonly minHeight = 150;

  private get maxHeight(): number {
    return typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
  }

  constructor() {
    effect(() => {
      const isOpen = this.open();
      if (!this.hasView) {
        // Defer animations until ViewChild refs are available.
        this.isDrawerVisible.set(isOpen);
        return;
      }
      this.syncAnimatedState(isOpen);
    });

    effect(() => {
      // Keep a global CSS var updated so other fixed UI can sit above the console.
      // This avoids the "load test running" bar being hidden behind the drawer.
      if (typeof document === 'undefined') {
        return;
      }

      const visible = this.isDrawerVisible();
      // Track height changes (resize) as well.
      void this.panelHeight();

      const root = document.documentElement;
      if (!visible) {
        root.style.setProperty('--rr-console-offset', '0px');
        return;
      }

      // Measure after layout.
      requestAnimationFrame(() => {
        const shell = this.drawerShell?.nativeElement;
        const rectHeight = shell ? shell.getBoundingClientRect().height : 0;
        root.style.setProperty('--rr-console-offset', `${Math.ceil(rectHeight)}px`);
      });
    });
  }

  ngAfterViewInit(): void {
    this.hasView = true;
    // Apply initial state.
    this.syncAnimatedState(this.open(), true);
  }

  handleToggle() {
    // Parent owns the actual open/close state.
    this.onToggle.emit();
  }

  requestClose() {
    // Animate out first; only then tell parent to close.
    if (!this.open()) {
      return;
    }
    this.animateClose(() => this.onToggle.emit());
  }

  handleClear() {
    this.onClear.emit();
  }

  private syncAnimatedState(open: boolean, immediate = false): void {
    if (open) {
      this.animateOpen(immediate);
      return;
    }
    this.animateClose(undefined, immediate);
  }

  private animateOpen(immediate = false): void {
    this.drawerTween?.kill();
    this.bubbleTween?.kill();

    this.isDrawerVisible.set(true);
    const shell = this.drawerShell?.nativeElement;
    const bubble = this.bubbleButton?.nativeElement;
    if (!shell) {
      // Drawer is controlled by an @if; it won't exist until after this change
      // detection pass. Retry on the next frame.
      if (!this.pendingOpenAnimation) {
        this.pendingOpenAnimation = true;
        requestAnimationFrame(() => {
          this.pendingOpenAnimation = false;
          if (this.open()) {
            this.animateOpen(immediate);
          }
        });
      }
      return;
    }

    if (immediate) {
      gsap.set(shell, { y: 0, opacity: 1, scale: 1 });
      if (bubble) gsap.set(bubble, { opacity: 0, scale: 0.98 });
      return;
    }

    gsap.set(shell, { y: 18, opacity: 0, scale: 0.995 });
    this.drawerTween = gsap.to(shell, {
      y: 0,
      opacity: 1,
      scale: 1,
      duration: 0.22,
      ease: 'power2.out'
    });

    if (bubble) {
      this.bubbleTween = gsap.to(bubble, {
        opacity: 0,
        scale: 0.98,
        duration: 0.14,
        ease: 'power1.out'
      });
    }
  }

  private animateClose(after?: () => void, immediate = false): void {
    this.drawerTween?.kill();
    this.bubbleTween?.kill();

    const shell = this.drawerShell?.nativeElement;
    const bubble = this.bubbleButton?.nativeElement;

    if (immediate) {
      this.isDrawerVisible.set(false);
      if (bubble) gsap.set(bubble, { opacity: 1, scale: 1 });
      if (after) after();
      return;
    }

    if (!shell) {
      this.isDrawerVisible.set(false);
      if (after) after();
      return;
    }

    this.drawerTween = gsap.to(shell, {
      y: 14,
      opacity: 0,
      scale: 0.995,
      duration: 0.18,
      ease: 'power1.in',
      onComplete: () => {
        this.isDrawerVisible.set(false);
        this.drawerTween = null;
        if (bubble) {
          gsap.set(bubble, { opacity: 0, scale: 0.98 });
          this.bubbleTween = gsap.to(bubble, {
            opacity: 1,
            scale: 1,
            duration: 0.16,
            ease: 'power1.out'
          });
        }
        if (after) after();
      }
    });
  }

  trackLogEntry(index: number, entry: ScriptLogEntry): string {
    return `${entry.timestamp}-${entry.source}-${index}`;
  }

  toneDotClass(tone: FooterTone | undefined): string {
    switch (tone) {
      case 'pending':
        return 'bg-blue-400 animate-pulse';
      case 'success':
        return 'bg-emerald-400';
      case 'warning':
        return 'bg-amber-400';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-zinc-500';
    }
  }

  startResize(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    this.isResizing.set(true);
    this.startHeight = this.panelHeight();
    this.startY = 'touches' in event ? event.touches[0].clientY : event.clientY;
  }

  @HostListener('document:mousemove', ['$event'])
  @HostListener('document:touchmove', ['$event'])
  onMouseMove(event: MouseEvent | TouchEvent) {
    if (!this.isResizing()) return;
    
    const currentY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    const deltaY = this.startY - currentY; // Negative because dragging up increases height
    const newHeight = Math.min(this.maxHeight, Math.max(this.minHeight, this.startHeight + deltaY));
    this.panelHeight.set(newHeight);
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  onMouseUp() {
    this.isResizing.set(false);
  }
}
