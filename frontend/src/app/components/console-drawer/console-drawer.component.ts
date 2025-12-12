import { CommonModule } from '@angular/common';
import { Component, input, output, signal, HostListener, ElementRef, inject } from '@angular/core';
import { ScriptLogEntry } from '../../models/http.models';

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
  
  open = input<boolean>(false);
  logs = input<ScriptLogEntry[]>([]);
  latestLog = input<ScriptLogEntry | null>(null);
  status = input<{ label: string; detail: string; tone: FooterTone } | null>(null);
  version = input<string>('Raw Request v1');

  onToggle = output<void>();
  onClear = output<void>();

  // Resize state
  panelHeight = signal<number>(256); // Default 256px (max-h-64)
  isResizing = signal<boolean>(false);
  private startY = 0;
  private startHeight = 0;
  private readonly minHeight = 150;

  private get maxHeight(): number {
    return typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
  }

  handleToggle() {
    this.onToggle.emit();
  }

  handleClear() {
    this.onClear.emit();
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
